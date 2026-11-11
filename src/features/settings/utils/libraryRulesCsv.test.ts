import { describe, expect, it, vi } from 'vitest';
import type { RuleMatch, RulePage } from '@/lib/api/library';
import {
  collectLibraryRulesCsv,
  LibraryRulesCsvCancelled,
  RULES_CSV_BATCH_SIZE,
} from './libraryRulesCsv';

const scope = [{ serverId: 's1', libraryId: null }];
const row = (n: number, name = 'Track ' + n): RuleMatch => ({
  serverId: 's1', libraryId: 'folder', itemId: 't' + n, albumId: 'album1',
  name, artist: 'Artist ' + n,
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const options = (readPage: (ruleJson: string, scopes: typeof scope, limit: number, offset: number) => Promise<RulePage>) => ({
  entity: 'track' as const,
  ruleJson: '{"version":1}',
  scopes: scope,
  readPage,
  signal: new AbortController().signal,
});

describe('Library Rules complete CSV collection', () => {
  it('walks every 200-item page, includes every record and reports progress', async () => {
    const first = Array.from({ length: RULES_CSV_BATCH_SIZE }, (_, i) => row(i));
    const readPage = vi.fn()
      .mockResolvedValueOnce({ items: first, hasMore: true })
      .mockResolvedValueOnce({ items: [row(200, '=SUM(1+1)')], hasMore: false });
    const progress = vi.fn();
    const result = await collectLibraryRulesCsv({ ...options(readPage), onProgress: progress });
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(readPage).toHaveBeenNthCalledWith(1, '{"version":1}', scope, 200, 0);
    expect(readPage).toHaveBeenNthCalledWith(2, '{"version":1}', scope, 200, 200);
    expect(progress.mock.calls.map(call => call[0])).toEqual([200, 201]);
    expect(result.rows).toBe(201);
    expect(result.bytes.slice(0, 3)).toEqual(new Uint8Array([239, 187, 191]));
    const csv = decode(result.bytes);
    expect(csv).toContain('"t0"');
    expect(csv).toContain('"t200"');
    expect(csv).toContain('"\'=SUM(1+1)"');
    expect(csv).toContain('"Entity","Server ID"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('returns only the header for an explicit export of zero matches', async () => {
    const reader = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const result = await collectLibraryRulesCsv({ ...options(reader), entity: 'album' });
    expect(result.rows).toBe(0);
    expect(decode(result.bytes)).toContain('"Entity","Server ID"');
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('checks cancellation between query batches and never returns partial CSV', async () => {
    const abort = new AbortController();
    const reader = vi.fn().mockResolvedValue({
      items: Array.from({ length: 200 }, (_, i) => row(i)), hasMore: true,
    });
    const progress = vi.fn(() => abort.abort());
    await expect(collectLibraryRulesCsv({
      ...options(reader), signal: abort.signal, onProgress: progress,
    })).rejects.toBeInstanceOf(LibraryRulesCsvCancelled);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('does not return a partial CSV after a later page fails', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => row(i)), hasMore: true,
      })
      .mockRejectedValueOnce(new Error('SQLite busy'));
    await expect(collectLibraryRulesCsv(options(reader)))
      .rejects.toThrow('SQLite busy');
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('rejects repeated identities, inconsistent pages and unsafe output budgets', async () => {
    const duplicates = vi.fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => row(i)), hasMore: true,
      })
      .mockResolvedValueOnce({ items: [row(0)], hasMore: false });
    await expect(collectLibraryRulesCsv(options(duplicates)))
      .rejects.toThrow('changed or repeated');
    await expect(collectLibraryRulesCsv(options(async () => ({
      items: [row(0)], hasMore: true,
    })))).rejects.toThrow('inconsistent page');
    await expect(collectLibraryRulesCsv({
      ...options(async () => ({ items: [row(0), row(1)], hasMore: false })),
      limits: { maxRows: 1, maxBytes: 10000 },
    })).rejects.toThrow('row limit');
    await expect(collectLibraryRulesCsv({
      ...options(async () => ({ items: [row(0)], hasMore: false })),
      limits: { maxRows: 1000, maxBytes: 110 },
    })).rejects.toThrow('safe export size');
  });

  it('stops if cancelled while a query is in flight', async () => {
    const abort = new AbortController();
    let release!: (page: RulePage) => void;
    const reader = vi.fn(() => new Promise<RulePage>(resolve => { release = resolve; }));
    const pending = collectLibraryRulesCsv({
      ...options(reader), signal: abort.signal,
    });
    expect(reader).toHaveBeenCalledTimes(1);
    abort.abort();
    release({ items: [row(0)], hasMore: false });
    await expect(pending).rejects.toBeInstanceOf(LibraryRulesCsvCancelled);
  });
});
