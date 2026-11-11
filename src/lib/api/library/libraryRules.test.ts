import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '@/generated/bindings';
import { libraryRulesEvaluate } from './libraryRules';

vi.mock('@/generated/bindings', () => ({
  commands: { libraryRulesEvaluate: vi.fn() },
}));
vi.mock('./scopeReads', () => ({
  mapScopePairs: vi.fn((scopes: Array<{ serverId: string; libraryId: string | null }>) =>
    scopes.map(scope => ({ ...scope, serverId: 'idx-' + scope.serverId }))),
}));
vi.mock('./internal', () => ({
  mapServerIdFromIndexKey: vi.fn((id: string) => id.replace(/^idx-/, '')),
}));

describe('Library Rules typed API', () => {
  beforeEach(() => {
    vi.mocked(commands.libraryRulesEvaluate).mockReset();
  });

  it('sends bounded typed IPC parameters and maps identities back to profile ids', async () => {
    vi.mocked(commands.libraryRulesEvaluate).mockResolvedValueOnce({
      status: 'ok',
      data: {
        items: [{
          serverId: 'idx-s1', libraryId: 'folder1', itemId: 'a1',
          albumId: 'a1', name: 'Album', artist: 'Artist',
        }],
        hasMore: true,
      },
    });

    const page = await libraryRulesEvaluate('{"version":1}', [
      { serverId: 's1', libraryId: 'folder1' },
      { serverId: 's2', libraryId: null },
    ], 50, 50);

    expect(commands.libraryRulesEvaluate).toHaveBeenCalledTimes(1);
    expect(commands.libraryRulesEvaluate).toHaveBeenCalledWith({
      ruleJson: '{"version":1}',
      limit: 50,
      offset: 50,
      scopes: [
        { serverId: 'idx-s1', libraryId: 'folder1' },
        { serverId: 'idx-s2', libraryId: null },
      ],
    });
    expect(page.hasMore).toBe(true);
    expect(page.items[0].serverId).toBe('s1');
  });

  it('rejects a missing scope or an invalid page without invoking Rust', async () => {
    await expect(libraryRulesEvaluate('{}', [], 50, 0)).rejects.toThrow('scopes');
    await expect(libraryRulesEvaluate('{}', [
      { serverId: 's1', libraryId: null },
    ], 0, 0)).rejects.toThrow('page range');
    await expect(libraryRulesEvaluate('{}', [
      { serverId: 's1', libraryId: null },
    ], 201, 0)).rejects.toThrow('page range');
    await expect(libraryRulesEvaluate('{}', [
      { serverId: 's1', libraryId: null },
    ], 50, -1)).rejects.toThrow('page range');
    expect(commands.libraryRulesEvaluate).not.toHaveBeenCalled();
  });

  it('converts Rust error responses to user-displayable errors', async () => {
    vi.mocked(commands.libraryRulesEvaluate).mockResolvedValueOnce({
      status: 'error',
      error: 'Genre/mood projection backfill is incomplete',
    });
    await expect(libraryRulesEvaluate('{}', [
      { serverId: 's1', libraryId: null },
    ], 50, 0)).rejects.toThrow('backfill is incomplete');
  });
});
