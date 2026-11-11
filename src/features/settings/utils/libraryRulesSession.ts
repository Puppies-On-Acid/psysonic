/**
 * Transient Library Rules UI snapshot, mirroring the existing Tag Audit's
 * session-only navigation/back restoration. Never writes to a store, server,
 * database, localStorage or preferences; a full app reload clears it.
 */
import type { LibraryScopePair, RulePage } from '@/lib/api/library';
import type { LibraryRuleDocument, LibraryRuleEntity } from './libraryRuleModel';

export interface LibraryRulesQueryContext {
  ruleJson: string;
  entity: LibraryRuleEntity;
  scopes: LibraryScopePair[];
  scopeFingerprint: string;
  scopedServers: string[];
}

export interface LibraryRulesSnapshot extends LibraryRulesQueryContext {
  page: RulePage;
  pageIndex: number;
  finishedAt: number;
}

export interface LibraryRulesSession {
  document: LibraryRuleDocument;
  snapshot: LibraryRulesSnapshot | null;
  showResults: boolean;
}

let lastSession: LibraryRulesSession | null = null;

export function readLibraryRulesSession(): LibraryRulesSession | null {
  return lastSession;
}

export function cacheLibraryRulesSession(session: LibraryRulesSession): void {
  lastSession = session;
}

/** Explicit reset for account-session cleanup and deterministic component tests. */
export function clearLibraryRulesSession(): void {
  lastSession = null;
}
