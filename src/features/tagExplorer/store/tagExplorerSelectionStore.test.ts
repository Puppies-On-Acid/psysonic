import { beforeEach, describe, expect, it } from 'vitest';

import { useTagExplorerSelectionStore } from './tagExplorerSelectionStore';

describe('tagExplorerSelectionStore', () => {
  beforeEach(() => {
    useTagExplorerSelectionStore.getState().cancel();
  });

  it('keeps one mixed selection while moving between catalogs', () => {
    useTagExplorerSelectionStore.getState().begin('genres');
    useTagExplorerSelectionStore.getState().toggle({
      kind: 'genre',
      value: 'Rock',
    });
    useTagExplorerSelectionStore.getState().toggle({
      kind: 'mood',
      value: 'Dreamy',
    });

    expect(useTagExplorerSelectionStore.getState()).toMatchObject({
      active: true,
      origin: 'genres',
      tags: [
        { kind: 'genre', value: 'Rock' },
        { kind: 'mood', value: 'Dreamy' },
      ],
    });
  });

  it('toggles case-equivalent tags rather than duplicating them', () => {
    useTagExplorerSelectionStore.getState().begin('moods');
    useTagExplorerSelectionStore.getState().toggle({
      kind: 'mood',
      value: 'Dreamy',
    });
    useTagExplorerSelectionStore.getState().toggle({
      kind: 'mood',
      value: ' dreamy ',
    });

    expect(useTagExplorerSelectionStore.getState().tags).toEqual([]);
  });
});
