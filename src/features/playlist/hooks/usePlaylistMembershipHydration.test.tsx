import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import { playlistMembershipsForTrack } from '@/store/playlistMembershipIndex';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { usePlaylistMembershipHydration } from './usePlaylistMembershipHydration';
import { usePlaylistMembershipHydrationForServers } from './usePlaylistMembershipHydrationForServers';

const { getPlaylistsForServerMock, hydratePlaylistMembershipsForServerMock } = vi.hoisted(() => ({
  getPlaylistsForServerMock: vi.fn(),
  hydratePlaylistMembershipsForServerMock: vi.fn(),
}));

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistsForServer: getPlaylistsForServerMock,
  getPlaylistsForServersSettled: vi.fn(),
  createPlaylist: vi.fn(),
}));

vi.mock('@/features/offline', () => ({
  isOfflineBrowseActive: () => false,
  fetchOfflineBrowsablePlaylists: vi.fn(),
}));

vi.mock('@/store/playlistMembershipHydration', () => ({
  hydratePlaylistMembershipsForServer: hydratePlaylistMembershipsForServerMock,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function completeResult() {
  return {
    status: 'complete' as const,
    requestedCount: 0,
    networkFetchCount: 0,
    failedPlaylistIds: [],
    unresolvedPlaylistIds: [],
    revisionRaceDetected: false,
  };
}

beforeEach(() => {
  getPlaylistsForServerMock.mockReset();
  hydratePlaylistMembershipsForServerMock.mockReset();
  hydratePlaylistMembershipsForServerMock.mockResolvedValue(completeResult());
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
});

describe('usePlaylistMembershipHydrationForServers', () => {
  it('does no playlist work while disabled', async () => {
    const { result } = renderHook(() => usePlaylistMembershipHydrationForServers({
      enabled: false,
      serverIds: ['srv-1', 'srv-2'],
    }));

    await Promise.resolve();

    expect(result.current.truthStateByServer).toEqual({});
    expect(result.current.index.playlistsByTrackKey.size).toBe(0);
    expect(getPlaylistsForServerMock).not.toHaveBeenCalled();
    expect(hydratePlaylistMembershipsForServerMock).not.toHaveBeenCalled();
  });

  it('serializes owner hydration so global revisions cannot race each other', async () => {
    getPlaylistsForServerMock.mockImplementation((serverId: string) => Promise.resolve([
      { id: `p-${serverId}`, serverId, name: serverId },
    ]));

    const first = deferred<void>();
    let activeHydrations = 0;
    let maxActiveHydrations = 0;
    hydratePlaylistMembershipsForServerMock.mockImplementation(
      async (_playlists, serverId: string) => {
        activeHydrations += 1;
        maxActiveHydrations = Math.max(maxActiveHydrations, activeHydrations);
        if (serverId === 'srv-1') await first.promise;
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds(`p-${serverId}`, [], serverId);
        activeHydrations -= 1;
        return completeResult();
      },
    );

    const { result } = renderHook(() => usePlaylistMembershipHydrationForServers({
      enabled: true,
      serverIds: ['srv-1', 'srv-2', 'srv-3'],
    }));

    await waitFor(() => {
      expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledTimes(1);
    });
    expect(maxActiveHydrations).toBe(1);

    act(() => {
      first.resolve(undefined);
    });

    await waitFor(() => {
      expect(result.current.truthStateByServer).toEqual({
        'srv-1': 'ready',
        'srv-2': 'ready',
        'srv-3': 'ready',
      });
    });
    expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledTimes(3);
    expect(maxActiveHydrations).toBe(1);
  });

  it('hydrates multiple owners without mixing same track ids', async () => {
    getPlaylistsForServerMock.mockImplementation((serverId: string) => Promise.resolve([
      { id: 'mix', serverId, name: serverId === 'srv-1' ? 'One' : 'Two' },
    ]));
    hydratePlaylistMembershipsForServerMock.mockImplementation(
      async (_playlists, serverId: string) => {
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds(
            'mix',
            serverId === 'srv-1' ? ['shared-song'] : [],
            serverId,
          );
        return completeResult();
      },
    );

    const { result } = renderHook(() => usePlaylistMembershipHydrationForServers({
      enabled: true,
      serverIds: ['srv-1', 'srv-2'],
    }));

    await waitFor(() => {
      expect(result.current.truthStateByServer).toEqual({
        'srv-1': 'ready',
        'srv-2': 'ready',
      });
    });

    expect(
      playlistMembershipsForTrack(result.current.index, {
        id: 'shared-song',
        serverId: 'srv-1',
      }),
    ).toEqual([{ id: 'mix', serverId: 'srv-1', name: 'One' }]);
    expect(
      playlistMembershipsForTrack(result.current.index, {
        id: 'shared-song',
        serverId: 'srv-2',
      }),
    ).toEqual([]);
  });
});

describe('usePlaylistMembershipHydration', () => {
  it('does no playlist work while disabled and reports unknown truth', async () => {
    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: false,
      serverId: 'srv-1',
    }));

    await Promise.resolve();

    expect(result.current.truthState).toBe('unknown');
    expect(result.current.index.playlistsByTrackKey.size).toBe(0);
    expect(getPlaylistsForServerMock).not.toHaveBeenCalled();
    expect(hydratePlaylistMembershipsForServerMock).not.toHaveBeenCalled();
  });

  it('refreshes owner metadata, hydrates membership, and exposes a reverse index', async () => {
    getPlaylistsForServerMock.mockResolvedValue([
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
      { id: 'favorites', serverId: 'srv-1', name: 'Favorites' },
    ]);
    hydratePlaylistMembershipsForServerMock.mockImplementation(async () => {
      const membership = usePlaylistMembershipStore.getState();
      membership.setPlaylistSongIds('road', ['song-1'], 'srv-1');
      membership.setPlaylistSongIds('favorites', ['song-1'], 'srv-1');
      return completeResult();
    });

    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: true,
      serverId: 'srv-1',
    }));

    expect(result.current.truthState).toBe('loading');

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
    });

    expect(getPlaylistsForServerMock).toHaveBeenCalledWith('srv-1');
    expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: 'road', serverId: 'srv-1' }),
        expect.objectContaining({ id: 'favorites', serverId: 'srv-1' }),
      ],
      'srv-1',
    );
    expect(
      playlistMembershipsForTrack(result.current.index, {
        id: 'song-1',
        serverId: 'srv-1',
      }),
    ).toEqual([
      { id: 'favorites', serverId: 'srv-1', name: 'Favorites' },
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);
  });

  it('repairs membership invalidated after ready without presenting stale completeness', async () => {
    getPlaylistsForServerMock.mockResolvedValue([
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);
    const repair = deferred<void>();
    hydratePlaylistMembershipsForServerMock
      .mockImplementationOnce(async () => {
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds('road', ['song-1'], 'srv-1');
        return completeResult();
      })
      .mockImplementationOnce(async () => {
        await repair.promise;
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds('road', ['song-2'], 'srv-1');
        return completeResult();
      });

    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: true,
      serverId: 'srv-1',
    }));

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
    });

    act(() => {
      usePlaylistMembershipStore
        .getState()
        .invalidatePlaylistSongIds('road', 'srv-1');
    });

    await waitFor(() => {
      expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledTimes(2);
      expect(result.current.truthState).toBe('partial');
    });

    act(() => {
      repair.resolve(undefined);
    });

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
      expect(
        usePlaylistMembershipStore
          .getState()
          .getPlaylistSongIds('road', 'srv-1'),
      ).toEqual(['song-2']);
    });
  });

  it('does not loop repair requests when the post-ready repair remains partial', async () => {
    getPlaylistsForServerMock.mockResolvedValue([
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);
    hydratePlaylistMembershipsForServerMock
      .mockImplementationOnce(async () => {
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds('road', ['song-1'], 'srv-1');
        return completeResult();
      })
      .mockResolvedValueOnce({
        ...completeResult(),
        status: 'partial',
        failedPlaylistIds: ['road'],
        unresolvedPlaylistIds: ['road'],
      });

    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: true,
      serverId: 'srv-1',
    }));

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
    });

    act(() => {
      usePlaylistMembershipStore
        .getState()
        .invalidatePlaylistSongIds('road', 'srv-1');
    });

    await waitFor(() => {
      expect(result.current.truthState).toBe('partial');
      expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledTimes(2);
    });

    await Promise.resolve();
    expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledTimes(2);
  });

  it('does not hydrate stale metadata after the owning server changes', async () => {
    const first = deferred<Array<{ id: string; serverId: string; name: string }>>();
    getPlaylistsForServerMock.mockImplementation((ownerServerId: string) => {
      if (ownerServerId === 'srv-1') return first.promise;
      return Promise.resolve([
        { id: 'new-owner', serverId: 'srv-2', name: 'New owner' },
      ]);
    });
    hydratePlaylistMembershipsForServerMock.mockImplementation(
      async (_playlists, ownerServerId: string) => {
        if (ownerServerId === 'srv-2') {
          usePlaylistMembershipStore
            .getState()
            .setPlaylistSongIds('new-owner', [], 'srv-2');
        }
        return completeResult();
      },
    );

    const { rerender, result } = renderHook(
      ({ serverId }) => usePlaylistMembershipHydration({
        enabled: true,
        serverId,
      }),
      { initialProps: { serverId: 'srv-1' } },
    );

    rerender({ serverId: 'srv-2' });

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
      expect(hydratePlaylistMembershipsForServerMock).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'new-owner', serverId: 'srv-2' })],
        'srv-2',
      );
    });

    first.resolve([
      { id: 'stale-owner', serverId: 'srv-1', name: 'Stale owner' },
    ]);
    await Promise.resolve();

    expect(hydratePlaylistMembershipsForServerMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'stale-owner' })]),
      'srv-1',
    );
  });

  it('keeps same playlist and song ids isolated when the owning server changes', async () => {
    getPlaylistsForServerMock.mockImplementation((ownerServerId: string) => Promise.resolve([
      {
        id: 'shared-playlist',
        serverId: ownerServerId,
        name: ownerServerId === 'srv-1' ? 'Server One' : 'Server Two',
      },
    ]));
    hydratePlaylistMembershipsForServerMock.mockImplementation(
      async (_playlists, ownerServerId: string) => {
        usePlaylistMembershipStore
          .getState()
          .setPlaylistSongIds(
            'shared-playlist',
            ownerServerId === 'srv-1' ? ['same-song'] : [],
            ownerServerId,
          );
        return completeResult();
      },
    );

    const { rerender, result } = renderHook(
      ({ serverId }) => usePlaylistMembershipHydration({
        enabled: true,
        serverId,
      }),
      { initialProps: { serverId: 'srv-1' } },
    );

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
      expect(
        playlistMembershipsForTrack(result.current.index, {
          id: 'same-song',
          serverId: 'srv-1',
        }),
      ).toEqual([
        {
          id: 'shared-playlist',
          serverId: 'srv-1',
          name: 'Server One',
        },
      ]);
    });

    rerender({ serverId: 'srv-2' });

    await waitFor(() => {
      expect(result.current.truthState).toBe('ready');
      expect(
        playlistMembershipsForTrack(result.current.index, {
          id: 'same-song',
          serverId: 'srv-2',
        }),
      ).toEqual([]);
    });

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared-playlist', 'srv-1'),
    ).toEqual(['same-song']);
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared-playlist', 'srv-2'),
    ).toEqual([]);
  });

  it('reports partial truth when owner metadata refresh fails', async () => {
    usePlaylistStore.setState({
      playlists: [
        {
          id: 'old',
          serverId: 'srv-1',
          name: 'Old metadata',
          songCount: 0,
          duration: 0,
          created: '',
          changed: '',
        },
      ],
    });
    getPlaylistsForServerMock.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: true,
      serverId: 'srv-1',
    }));

    await waitFor(() => {
      expect(result.current.truthState).toBe('partial');
    });

    expect(hydratePlaylistMembershipsForServerMock).not.toHaveBeenCalled();
  });

  it('reports partial truth when membership hydration settles incomplete', async () => {
    getPlaylistsForServerMock.mockResolvedValue([
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);
    hydratePlaylistMembershipsForServerMock.mockResolvedValue({
      ...completeResult(),
      status: 'partial',
      failedPlaylistIds: ['road'],
      unresolvedPlaylistIds: ['road'],
    });

    const { result } = renderHook(() => usePlaylistMembershipHydration({
      enabled: true,
      serverId: 'srv-1',
    }));

    await waitFor(() => {
      expect(result.current.truthState).toBe('partial');
    });
  });
});
