import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import {
  tagExplorerTrackRefKey,
  useTagExplorerTrackSelection,
} from './useTagExplorerTrackSelection';

const songs = Array.from({ length: 5 }, (_, index) => ({
  id: `t${index + 1}`,
  serverId: 's1',
  title: `Track ${index + 1}`,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
})) as SubsonicSong[];

describe('useTagExplorerTrackSelection', () => {
  it('supports explicit and shift-range selection', () => {
    const { result } = renderHook(() =>
      useTagExplorerTrackSelection('query-a'),
    );

    act(() => result.current.toggle(songs, 1, false));
    act(() => result.current.toggle(songs, 3, true));

    expect(result.current.selectedCount(5)).toBe(3);
    expect(result.current.isSelected(songs[1])).toBe(true);
    expect(result.current.isSelected(songs[2])).toBe(true);
    expect(result.current.isSelected(songs[3])).toBe(true);
  });

  it('represents complete selection with per-track exclusions', () => {
    const { result } = renderHook(() =>
      useTagExplorerTrackSelection('query-a'),
    );

    act(() => result.current.selectAllMatching());

    expect(result.current.allMatching).toBe(true);
    expect(result.current.selectedCount(5000)).toBe(5000);

    act(() => result.current.toggle(songs, 2, false));

    expect(result.current.isSelected(songs[2])).toBe(false);
    expect(result.current.selectedCount(5000)).toBe(4999);
    expect(
      result.current.exclusions.has(
        tagExplorerTrackRefKey({
          serverId: 's1',
          trackId: 't3',
        }),
      ),
    ).toBe(true);
  });

  it('clears selection when the query universe changes', () => {
    const { result, rerender } = renderHook(
      ({ queryKey }) => useTagExplorerTrackSelection(queryKey),
      { initialProps: { queryKey: 'query-a' } },
    );

    act(() => result.current.toggle(songs, 0, false));
    expect(result.current.selectedCount(5)).toBe(1);

    rerender({ queryKey: 'query-b' });

    expect(result.current.selectedCount(5)).toBe(0);
  });
});
