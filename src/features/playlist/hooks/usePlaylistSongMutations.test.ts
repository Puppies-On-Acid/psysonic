import type { TFunction } from 'i18next';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { usePlaylistSongMutations } from './usePlaylistSongMutations';

describe('usePlaylistSongMutations duplicate occurrence handling', () => {
  it('removing one duplicate occurrence preserves the remaining occurrence', () => {
    const first = makeSubsonicSong({ id: 'duplicate', title: 'First occurrence' });
    const second = makeSubsonicSong({ id: 'duplicate', title: 'Second occurrence' });
    const other = makeSubsonicSong({ id: 'other', title: 'Other' });
    const songs = [first, second, other];
    const setSongs = vi.fn();
    const savePlaylist = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => usePlaylistSongMutations({
      songs,
      setSongs,
      savePlaylist,
      setSuggestions: vi.fn(),
      setSearchResults: vi.fn(),
      playlist: null,
      t: ((key: string) => key) as TFunction,
    }));

    act(() => {
      result.current.removeSong(0);
    });

    expect(setSongs).toHaveBeenCalledWith([second, other]);
    expect(savePlaylist).toHaveBeenCalledWith([second, other], 3);
    expect([second, other].map(song => song.id)).toContain('duplicate');
  });
});
