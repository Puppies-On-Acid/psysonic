import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import type { TrackPlaylistRef } from '@/store/playlistMembershipIndex';
import {
  canRemoveTrackFromPlaylistMembership,
  removeTrackFromPlaylistMembership,
} from './removeTrackFromPlaylistMembership';

const getPlaylistForServerMock = vi.hoisted(() => vi.fn());
const removePlaylistSongsAtIndicesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistForServer: getPlaylistForServerMock,
  removePlaylistSongsAtIndices: removePlaylistSongsAtIndicesMock,
  getPlaylistsForServer: vi.fn(),
  getPlaylistsForServersSettled: vi.fn(),
  createPlaylist: vi.fn(),
}));

vi.mock('@/features/offline', () => ({
  isOfflineBrowseActive: () => false,
  fetchOfflineBrowsablePlaylists: vi.fn(),
}));

function membership(
  overrides: Partial<TrackPlaylistRef> = {},
): TrackPlaylistRef {
  return {
    id: 'mix',
    serverId: 'srv-1',
    name: 'Mix',
    smart: false,
    readonly: false,
    ...overrides,
  };
}

describe('removeTrackFromPlaylistMembership', () => {
  beforeEach(() => {
    getPlaylistForServerMock.mockReset();
    removePlaylistSongsAtIndicesMock.mockReset().mockResolvedValue(undefined);
    usePlaylistMembershipStore.setState({
      songIdsByCacheKey: {},
      revision: 0,
    });
    usePlaylistStore.setState({
      playlists: [{
        id: 'mix',
        serverId: 'srv-1',
        name: 'Mix',
        songCount: 3,
        duration: 180,
        created: '',
        changed: '',
      }],
      recentIds: [],
      lastModified: {},
      playlistsLoading: false,
    });
  });

  it('allows editable manual playlists and rejects smart or read-only membership', () => {
    expect(canRemoveTrackFromPlaylistMembership(membership())).toBe(true);
    expect(canRemoveTrackFromPlaylistMembership(
      membership({ smart: true }),
    )).toBe(false);
    expect(canRemoveTrackFromPlaylistMembership(
      membership({ readonly: true }),
    )).toBe(false);
    expect(canRemoveTrackFromPlaylistMembership(
      membership({ smartMetadataUnavailable: true, smart: undefined }),
    )).toBe(true);
  });

  it('removes every duplicate occurrence and updates cached membership', async () => {
    const first = makeSubsonicSong({ id: 'song-1' });
    const second = makeSubsonicSong({ id: 'song-1' });
    const other = makeSubsonicSong({ id: 'other' });
    getPlaylistForServerMock.mockResolvedValue({
      playlist: {},
      songs: [first, second, other],
    });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('mix', ['song-1', 'song-1', 'other'], 'srv-1');

    await expect(
      removeTrackFromPlaylistMembership(membership(), 'song-1'),
    ).resolves.toBe(2);

    expect(removePlaylistSongsAtIndicesMock).toHaveBeenCalledWith(
      'mix',
      [0, 1],
      'srv-1',
    );
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('mix', 'srv-1'),
    ).toEqual(['other']);
    expect(
      usePlaylistStore.getState().playlists[0]?.songCount,
    ).toBe(1);
  });

  it('invalidates cached membership when server removal fails', async () => {
    getPlaylistForServerMock.mockResolvedValue({
      playlist: {},
      songs: [makeSubsonicSong({ id: 'song-1' })],
    });
    removePlaylistSongsAtIndicesMock.mockRejectedValue(new Error('failed'));
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('mix', ['song-1'], 'srv-1');

    await expect(
      removeTrackFromPlaylistMembership(membership(), 'song-1'),
    ).rejects.toThrow('failed');

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('mix', 'srv-1'),
    ).toBeUndefined();
  });

  it('repairs stale membership when the server no longer contains the song', async () => {
    getPlaylistForServerMock.mockResolvedValue({
      playlist: {},
      songs: [makeSubsonicSong({ id: 'other' })],
    });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('mix', ['song-1'], 'srv-1');

    await expect(
      removeTrackFromPlaylistMembership(membership(), 'song-1'),
    ).resolves.toBe(0);

    expect(removePlaylistSongsAtIndicesMock).not.toHaveBeenCalled();
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('mix', 'srv-1'),
    ).toEqual(['other']);
  });
});
