import type { LibraryScopePair, RuleMatch, RulePage } from '@/lib/api/library';
import type { LibraryRuleEntity } from './libraryRuleModel';
import { csvCell } from './csvCell';

/** Query pages remain limited by the Rust evaluator's 1–200 contract. */
export const RULES_CSV_BATCH_SIZE = 200;
/** Protective memory limits: an export over budget fails with no Save dialog. */
export const RULES_CSV_MAX_ROWS = 500_000;
export const RULES_CSV_MAX_BYTES = 64 * 1024 * 1024;

export interface LibraryRulesCsvExport {
  bytes: Uint8Array;
  rows: number;
}

export class LibraryRulesCsvCancelled extends Error {
  constructor() {
    super('Library Rules CSV export cancelled.');
    this.name = 'LibraryRulesCsvCancelled';
  }
}

type PageReader = (
  ruleJson: string, scopes: LibraryScopePair[], limit: number, offset: number,
) => Promise<RulePage>;

interface CollectOptions {
  entity: LibraryRuleEntity;
  ruleJson: string;
  scopes: readonly LibraryScopePair[];
  readPage: PageReader;
  signal: AbortSignal;
  onProgress?: (rows: number) => void;
  /** Test-only limits; the Settings UI uses the protective defaults. */
  limits?: { maxRows: number; maxBytes: number };
}

const encoder = new TextEncoder();

function rowFor(entity: LibraryRuleEntity, match: RuleMatch): string {
  return [
    entity, match.serverId, match.libraryId, match.itemId,
    match.albumId, match.name, match.artist,
  ].map(csvCell).join(',') + '\r\n';
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new LibraryRulesCsvCancelled();
}

/**
 * Explicitly re-evaluate the captured rule/scope against the CURRENT local
 * index, sequentially in small read-only pages. This is not an export of the
 * cached 50-row preview, and never triggers work unless called by Export.
 *
 * Stage 1's page API cannot hold a SQLite snapshot across IPC calls. Reject
 * repeated item identities, malformed page boundaries, oversized responses,
 * and all incomplete/failed batches rather than producing a truncated CSV.
 * Concurrent index updates may still shift rows across offset pages; manual
 * testing and the benchmark/review gates must evaluate this limitation.
 *
 * Build bytes only after the terminal page and within explicit memory caps.
 * Native file writing is a separate step, after collection succeeds.
 */
export async function collectLibraryRulesCsv({
  entity, ruleJson, scopes, readPage, signal, onProgress, limits,
}: CollectOptions): Promise<LibraryRulesCsvExport> {
  const maxRows = limits?.maxRows ?? RULES_CSV_MAX_ROWS;
  const maxBytes = limits?.maxBytes ?? RULES_CSV_MAX_BYTES;
  if (scopes.length === 0) throw new Error('Select a library before exporting rules.');
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Invalid Library Rules CSV export budget.');
  }

  const header = [
    'Entity', 'Server ID', 'Library ID', 'Item ID', 'Album ID', 'Name', 'Artist',
  ].map(csvCell).join(',') + '\r\n';
  const firstChunk = encoder.encode('\uFEFF' + header);
  if (firstChunk.byteLength > maxBytes) {
    throw new Error('Library Rules CSV exceeds the safe export size; narrow the rule.');
  }

  const chunks: Uint8Array[] = [firstChunk];
  const seen = new Set<string>();
  let totalBytes = firstChunk.byteLength;
  let totalRows = 0;
  let offset = 0;

  for (;;) {
    assertNotCancelled(signal);
    const page = await readPage(ruleJson, [...scopes], RULES_CSV_BATCH_SIZE, offset);
    assertNotCancelled(signal);
    if (page.items.length > RULES_CSV_BATCH_SIZE ||
        (page.hasMore && page.items.length !== RULES_CSV_BATCH_SIZE)) {
      throw new Error('Library Rules CSV received an inconsistent page; export stopped.');
    }
    if (totalRows + page.items.length > maxRows) {
      throw new Error('Library Rules CSV exceeds the safe row limit; narrow the rule.');
    }

    for (const item of page.items) {
      const key = JSON.stringify([item.serverId, item.libraryId, item.itemId]);
      if (seen.has(key)) {
        throw new Error('Library Rules results changed or repeated during export; rerun rules.');
      }
      seen.add(key);
    }

    const bytes = encoder.encode(page.items.map(item => rowFor(entity, item)).join(''));
    if (totalBytes + bytes.byteLength > maxBytes) {
      throw new Error('Library Rules CSV exceeds the safe export size; narrow the rule.');
    }
    chunks.push(bytes);
    totalBytes += bytes.byteLength;
    totalRows += page.items.length;
    onProgress?.(totalRows);
    assertNotCancelled(signal);

    if (!page.hasMore) break;
    if (totalRows >= maxRows || offset > 0xffffffff - RULES_CSV_BATCH_SIZE) {
      throw new Error('Library Rules CSV exceeds the safe row or page limit; narrow the rule.');
    }
    offset += page.items.length;
  }

  assertNotCancelled(signal);
  const output = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const bytes of chunks) {
    output.set(bytes, cursor);
    cursor += bytes.byteLength;
  }
  return { bytes: output, rows: totalRows };
}
