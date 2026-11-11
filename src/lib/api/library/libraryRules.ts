/**
 * Read-only, manually invoked Library Rules evaluator.
 *
 * The local editor owns the versioned AST; the API layer only transports its
 * validated JSON. Never depend on Settings or server-side smart-playlist rules.
 */
import { commands, type RuleEvaluateRequest, type RulePage } from '@/generated/bindings';
import { mapServerIdFromIndexKey } from './internal';
import { mapScopePairs } from './scopeReads';
import type { LibraryScopePair } from './dto';

export type { RuleMatch, RulePage } from '@/generated/bindings';

export async function libraryRulesEvaluate(
  ruleJson: string,
  scopes: LibraryScopePair[],
  limit: number,
  offset: number,
): Promise<RulePage> {
  if (scopes.length === 0 || scopes.length > 150) {
    throw new Error('Select 1–150 library scopes before running a rule.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff) {
    throw new Error('Invalid Library Rules page range.');
  }

  const request: RuleEvaluateRequest = {
    scopes: mapScopePairs(scopes, scopes[0].serverId),
    ruleJson,
    limit,
    offset,
  };
  const response = await commands.libraryRulesEvaluate(request);
  if (response.status === 'error') throw new Error(response.error);
  return {
    ...response.data,
    items: response.data.items.map(item => ({
      ...item,
      serverId: mapServerIdFromIndexKey(item.serverId),
    })),
  };
}
