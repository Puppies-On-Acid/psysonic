import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { migratePlaylistPersistedState, usePlaylistStore } from './playlistStore';
import { setServerReachability } from '@/lib/network/serverReachability';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

const getPlaylistsForServersSettledMock = vi.hoisted(() => vi.fn());
const getPlaylistsForServerMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistsForServer: getPlaylistsForServerMock,
  getPlaylistsForServersSettled: getPlaylistsForServersSettledMock,
  createPlaylist: vi.fn(),
}));

vi.mock('@/features/offline', () => ({
  isOfflineBrowseActive: () => false,
  fetchOfflineBrowsablePlaylists: vi.fn(),
}));

describe('playlistStore scoped fetch', () => {
  beforeEach(() => {
    resetAuthStore();
    getPlaylistsForServerMock.mockReset();
    getPlaylistsForServersSettledMock.mockReset();
    usePlaylistStore.setState({
      playlists: [],
      playlistsLoading: false,
      recentIds: [],
      lastModified: {},
    });
    usePlaylistMembershipStore.setState({
      songIdsByCacheKey: {},
      revision: 0,
    });
    useAuthStore.setState({
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      activeServerId: 'a',
      libraryBrowseServerIds: ['a', 'b'],
    });
  });

  it('loads playlists from the effective server scope', async () => {
    getPlaylistsForServersSettledMock.mockResolvedValue({
      playlists: [
        { id: 'same', serverId: 'a', name: 'From A' },
        { id: 'same', serverId: 'b', name: 'From B' },
      ],
      failedServerIds: [],
    });

    await usePlaylistStore.getState().fetchPlaylists();

    expect(getPlaylistsForServersSettledMock).toHaveBeenCalledWith(['a', 'b']);
    expect(usePlaylistStore.getState().playlists).toHaveLength(2);
  });

  it('omits confirmed unavailable servers without changing saved membership', async () => {
    setServerReachability('b', 'unavailable');
    getPlaylistsForServersSettledMock.mockResolvedValue({ playlists: [], failedServerIds: [] });

    await usePlaylistStore.getState().fetchPlaylists();

    expect(getPlaylistsForServersSettledMock).toHaveBeenCalledWith(['a']);
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual(['a', 'b']);
  });

  it('keeps recent entries distinct when playlist ids match across servers', () => {
    usePlaylistStore.getState().touchPlaylist('same', 'a');
    usePlaylistStore.getState().touchPlaylist('same', 'b');

    expect(usePlaylistStore.getState().recentIds.slice(0, 2)).toEqual(['b:same', 'a:same']);
  });

  it('drops ownerless persisted cache entries during the ownership migration', () => {
    expect(migratePlaylistPersistedState({
      playlists: [
        { id: 'legacy', name: 'Legacy' },
        { id: 'owned', name: 'Owned', serverId: 'a' },
      ],
      recentIds: ['legacy', 'a:owned'],
      lastModified: { legacy: 1, 'a:owned': 2 },
    })).toEqual({
      playlists: [{ id: 'owned', name: 'Owned', serverId: 'a' }],
      recentIds: [],
      lastModified: {},
    });
  });

  it('ignores runtime cache writes that have no owner', () => {
    usePlaylistStore.getState().touchPlaylist('legacy');
    usePlaylistStore.getState().addPlaylist({
      id: 'legacy', name: 'Legacy', songCount: 0, duration: 0, created: '', changed: '',
    });

    expect(usePlaylistStore.getState().recentIds).toEqual([]);
    expect(usePlaylistStore.getState().playlists).toEqual([]);
  });

  it('refreshes one owner without replacing playlists from other servers', async () => {
    usePlaylistStore.setState({
      playlists: [
        {
          id: 'old-a', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '',
        },
        {
          id: 'keep-b', serverId: 'b', name: 'Keep B', songCount: 0, duration: 0, created: '', changed: '',
        },
      ],
    });
    getPlaylistsForServerMock.mockResolvedValue([
      { id: 'new-a', serverId: 'a', name: 'New A' },
    ]);

    const applied = await usePlaylistStore.getState().fetchPlaylistsForServer('a');

    expect(applied).toBe(true);
    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'keep-b', serverId: 'b' }),
      expect.objectContaining({ id: 'new-a', serverId: 'a' }),
    ]);
  });

  it('invalidates cached membership when owner metadata proves a playlist changed', async () => {
    usePlaylistStore.setState({
      playlists: [
        {
          id: 'same',
          serverId: 'a',
          name: 'Mix',
          songCount: 1,
          duration: 60,
          created: '',
          changed: 'old',
        },
      ],
    });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('same', ['old-song'], 'a');
    getPlaylistsForServerMock.mockResolvedValue([
      {
        id: 'same',
        serverId: 'a',
        name: 'Mix',
        songCount: 2,
        duration: 120,
        created: '',
        changed: 'new',
      },
    ]);

    await usePlaylistStore.getState().fetchPlaylistsForServer('a');

    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('same', 'a'),
    ).toBeUndefined();
  });

  it('keeps cached membership when owner metadata is unchanged', async () => {
    const playlist = {
      id: 'same',
      serverId: 'a',
      name: 'Mix',
      songCount: 1,
      duration: 60,
      created: '',
      changed: 'same-stamp',
    };
    usePlaylistStore.setState({ playlists: [playlist] });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('same', ['song-1'], 'a');
    getPlaylistsForServerMock.mockResolvedValue([playlist]);

    await usePlaylistStore.getState().fetchPlaylistsForServer('a');

    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('same', 'a'),
    ).toEqual(['song-1']);
  });

  it('invalidates cached membership when a playlist disappears from its owner', async () => {
    usePlaylistStore.setState({
      playlists: [
        {
          id: 'gone',
          serverId: 'a',
          name: 'Gone',
          songCount: 1,
          duration: 60,
          created: '',
          changed: 'old',
        },
      ],
    });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('gone', ['song-1'], 'a');
    getPlaylistsForServerMock.mockResolvedValue([]);

    await usePlaylistStore.getState().fetchPlaylistsForServer('a');

    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('gone', 'a'),
    ).toBeUndefined();
  });

  it('retains the last-known playlists for an owner whose refresh failed', async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: 'old-a', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '' },
        { id: 'keep-b', serverId: 'b', name: 'Keep B', songCount: 0, duration: 0, created: '', changed: '' },
      ],
    });
    getPlaylistsForServersSettledMock.mockResolvedValue({
      playlists: [{ id: 'new-a', serverId: 'a', name: 'New A' }],
      failedServerIds: ['b'],
    });

    await usePlaylistStore.getState().fetchPlaylists();

    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'new-a', serverId: 'a' }),
      expect.objectContaining({ id: 'keep-b', serverId: 'b' }),
    ]);
  });

  it('patches playlist metadata only for the matching owner', () => {
    usePlaylistStore.setState({
      playlists: [
        { id: 'same', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '' },
        { id: 'same', serverId: 'b', name: 'Old B', songCount: 0, duration: 0, created: '', changed: '' },
      ],
    });

    usePlaylistStore.getState().patchPlaylistMetadata('same', 'a', {
      name: 'Renamed A',
      comment: 'Updated',
    });

    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'same', serverId: 'a', name: 'Renamed A', comment: 'Updated' }),
      expect.objectContaining({ id: 'same', serverId: 'b', name: 'Old B' }),
    ]);
  });

  it('does not let an in-flight owner refresh restore metadata from before a local patch', async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: 'same', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '' },
      ],
    });
    let resolveRefresh!: (value: Array<{
      id: string; serverId: string; name: string; songCount: number; duration: number; created: string; changed: string;
    }>) => void;
    getPlaylistsForServerMock.mockReturnValue(new Promise(resolve => { resolveRefresh = resolve; }));

    const refresh = usePlaylistStore.getState().fetchPlaylistsForServer('a');
    usePlaylistStore.getState().patchPlaylistMetadata('same', 'a', { name: 'Renamed A' });
    resolveRefresh([
      { id: 'same', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '' },
    ]);
    const applied = await refresh;

    expect(applied).toBe(false);
    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'same', serverId: 'a', name: 'Renamed A' }),
    ]);
  });

  it('does not let an owner refresh overwrite a playlist added while it was in flight', async () => {
    let resolveRefresh!: (value: Array<{
      id: string; serverId: string; name: string; songCount: number; duration: number; created: string; changed: string;
    }>) => void;
    getPlaylistsForServerMock.mockReturnValue(new Promise(resolve => { resolveRefresh = resolve; }));

    const refresh = usePlaylistStore.getState().fetchPlaylistsForServer('a');
    usePlaylistStore.getState().addPlaylist({
      id: 'new-a', serverId: 'a', name: 'New A', songCount: 0, duration: 0, created: '', changed: '',
    });
    resolveRefresh([]);
    const applied = await refresh;

    expect(applied).toBe(false);
    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'new-a', serverId: 'a' }),
    ]);
  });

  it('reports a failed owner refresh without replacing last-known metadata', async () => {
    usePlaylistStore.setState({
      playlists: [
        {
          id: 'old-a', serverId: 'a', name: 'Old A', songCount: 0, duration: 0, created: '', changed: '',
        },
      ],
    });
    getPlaylistsForServerMock.mockRejectedValue(new Error('offline'));

    const applied = await usePlaylistStore.getState().fetchPlaylistsForServer('a');

    expect(applied).toBe(false);
    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'old-a', serverId: 'a' }),
    ]);
  });

  it('does not let an older scope request overwrite a newer result', async () => {
    type BatchResult = {
      playlists: Array<{ id: string; serverId: string; name: string }>;
      failedServerIds: string[];
    };
    let resolveFirst!: (value: BatchResult) => void;
    let resolveSecond!: (value: BatchResult) => void;
    getPlaylistsForServersSettledMock
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));

    const first = usePlaylistStore.getState().fetchPlaylists();
    useAuthStore.setState({ libraryBrowseServerIds: ['b'] });
    const second = usePlaylistStore.getState().fetchPlaylists();
    resolveSecond({ playlists: [{ id: 'new', serverId: 'b', name: 'New scope' }], failedServerIds: [] });
    await second;
    resolveFirst({ playlists: [{ id: 'old', serverId: 'a', name: 'Old scope' }], failedServerIds: [] });
    await first;

    expect(usePlaylistStore.getState().playlists).toEqual([
      expect.objectContaining({ id: 'new', serverId: 'b' }),
    ]);
  });
});
