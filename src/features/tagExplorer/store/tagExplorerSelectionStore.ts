import { create } from 'zustand';

import type { LibraryTagFilter } from '@/lib/api/library';
import {
  normalizeTagExplorerTags,
  tagExplorerTagKey,
  type TagExplorerOrigin,
} from '@/features/tagExplorer/utils/tagExplorerQuery';

interface TagExplorerSelectionState {
  active: boolean;
  origin: TagExplorerOrigin | null;
  tags: LibraryTagFilter[];
  begin: (origin: TagExplorerOrigin) => void;
  toggle: (tag: LibraryTagFilter) => void;
  remove: (tag: LibraryTagFilter) => void;
  clear: () => void;
  cancel: () => void;
}

export const useTagExplorerSelectionStore =
  create<TagExplorerSelectionState>((set) => ({
    active: false,
    origin: null,
    tags: [],

    begin: origin => set({
      active: true,
      origin,
      tags: [],
    }),

    toggle: tag => set(state => {
      const normalized = normalizeTagExplorerTags([tag])[0];
      if (!normalized) return state;
      const key = tagExplorerTagKey(normalized);
      const exists = state.tags.some(
        selected => tagExplorerTagKey(selected) === key,
      );
      return {
        active: true,
        tags: exists
          ? state.tags.filter(
              selected => tagExplorerTagKey(selected) !== key,
            )
          : [...state.tags, normalized],
      };
    }),

    remove: tag => set(state => {
      const key = tagExplorerTagKey(tag);
      return {
        tags: state.tags.filter(
          selected => tagExplorerTagKey(selected) !== key,
        ),
      };
    }),

    clear: () => set({ tags: [] }),

    cancel: () => set({
      active: false,
      origin: null,
      tags: [],
    }),
  }));
