import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';

const { getPlaylistForServer } = vi.hoisted(() => ({
  getPlaylistForServer: vi.fn(),
}));

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistForServer,
}));

import {
  __resetPlaylistMembershipHydrationForTests,
  hydratePlaylistMembershipsForServer,
  PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY,
} from '@/store/playlistMembershipHydration';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function playlist(
  id: string,
  serverId?: string,
): Pick<SubsonicPlaylist, 'id' | 'serverId'> {
  return { id, serverId };
}

function playlistResponse(songIds: readonly string[]) {
  return {
    playlist: {},
    songs: songIds.map(id => ({ id })),
  };
}

beforeEach(() => {
  __resetPlaylistMembershipHydrationForTests();
  getPlaylistForServer.mockReset();
  usePlaylistMembershipStore.setState({
    songIdsByCacheKey: {},
    revision: 0,
  });
});

describe('hydratePlaylistMembershipsForServer', () => {
  it('reuses cached memberships and fetches only missing playlists', async () => {
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('cached', ['cached-song'], 'srv-1');

    getPlaylistForServer.mockResolvedValue(
      playlistResponse(['network-song']),
    );

    const result = await hydratePlaylistMembershipsForServer(
      [
        playlist('cached', 'srv-1'),
        playlist('missing', 'srv-1'),
      ],
      'srv-1',
    );

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);
    expect(getPlaylistForServer).toHaveBeenCalledWith('srv-1', 'missing');

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('cached', 'srv-1'),
    ).toEqual(['cached-song']);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('missing', 'srv-1'),
    ).toEqual(['network-song']);

    expect(result).toEqual({
      status: 'complete',
      requestedCount: 2,
      networkFetchCount: 1,
      failedPlaylistIds: [],
      unresolvedPlaylistIds: [],
      revisionRaceDetected: false,
    });
  });

  it('never exceeds the fixed network concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    getPlaylistForServer.mockImplementation(async (_serverId, id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await Promise.resolve();

      inFlight -= 1;
      return playlistResponse([`song-${id}`]);
    });

    const playlists = Array.from(
      { length: 11 },
      (_, index) => playlist(`pl-${index}`, 'srv-1'),
    );

    const result = await hydratePlaylistMembershipsForServer(
      playlists,
      'srv-1',
    );

    expect(maxInFlight).toBe(
      PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY,
    );
    expect(getPlaylistForServer).toHaveBeenCalledTimes(11);
    expect(result.networkFetchCount).toBe(11);
    expect(result.status).toBe('complete');
  });

  it('commits successful fetches while leaving failed playlists unresolved', async () => {
    getPlaylistForServer.mockImplementation(
      async (_serverId, id) => {
        if (id === 'bad') throw new Error('network failure');
        return playlistResponse([`song-${id}`]);
      },
    );

    const result = await hydratePlaylistMembershipsForServer(
      [
        playlist('good-1', 'srv-1'),
        playlist('bad', 'srv-1'),
        playlist('good-2', 'srv-1'),
      ],
      'srv-1',
    );

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('good-1', 'srv-1'),
    ).toEqual(['song-good-1']);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('good-2', 'srv-1'),
    ).toEqual(['song-good-2']);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('bad', 'srv-1'),
    ).toBeUndefined();

    expect(result.status).toBe('partial');
    expect(result.failedPlaylistIds).toEqual(['bad']);
    expect(result.unresolvedPlaylistIds).toEqual(['bad']);
  });

  it('does not overwrite a membership mutation that lands during hydration', async () => {
    let resolveFirst!: (
      value: ReturnType<typeof playlistResponse>,
    ) => void;
    let resolveSecond!: (
      value: ReturnType<typeof playlistResponse>,
    ) => void;

    const first = new Promise<ReturnType<typeof playlistResponse>>(
      resolve => { resolveFirst = resolve; },
    );
    const second = new Promise<ReturnType<typeof playlistResponse>>(
      resolve => { resolveSecond = resolve; },
    );

    let secondPlaylistFetches = 0;

    getPlaylistForServer.mockImplementation(
      (_serverId, id) => {
        if (id === 'pl-1') return first;

        secondPlaylistFetches += 1;
        if (secondPlaylistFetches === 1) return second;

        return Promise.resolve(
          playlistResponse(['fresh-pl-2']),
        );
      },
    );

    const pending = hydratePlaylistMembershipsForServer(
      [
        playlist('pl-1', 'srv-1'),
        playlist('pl-2', 'srv-1'),
      ],
      'srv-1',
    );

    await Promise.resolve();

    // A real playlist mutation wins while the first network snapshot is in flight.
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('pl-1', ['newer-truth'], 'srv-1');

    resolveFirst(playlistResponse(['stale-pl-1']));
    resolveSecond(playlistResponse(['stale-pl-2']));

    const result = await pending;

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('pl-1', 'srv-1'),
    ).toEqual(['newer-truth']);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('pl-2', 'srv-1'),
    ).toEqual(['fresh-pl-2']);

    // pl-1 was already resolved by the mutation, so only pl-2 is retried.
    expect(
      getPlaylistForServer.mock.calls.filter(
        ([, id]) => id === 'pl-1',
      ),
    ).toHaveLength(1);

    expect(
      getPlaylistForServer.mock.calls.filter(
        ([, id]) => id === 'pl-2',
      ),
    ).toHaveLength(2);

    expect(result.status).toBe('complete');
    expect(result.revisionRaceDetected).toBe(true);
    expect(result.networkFetchCount).toBe(3);
  });

  it('stops after one retry when membership keeps changing', async () => {
    getPlaylistForServer.mockImplementation(async () => {
      // Invalidating even an uncached key advances the membership revision.
      // Doing it inside every fetch forces both hydration snapshots stale.
      usePlaylistMembershipStore
        .getState()
        .invalidatePlaylistSongIds('unrelated', 'srv-1');

      return playlistResponse(['stale']);
    });

    const result = await hydratePlaylistMembershipsForServer(
      [playlist('pl-1', 'srv-1')],
      'srv-1',
    );

    expect(getPlaylistForServer).toHaveBeenCalledTimes(2);
    expect(result.networkFetchCount).toBe(2);
    expect(result.revisionRaceDetected).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.unresolvedPlaylistIds).toEqual(['pl-1']);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('pl-1', 'srv-1'),
    ).toBeUndefined();
  });

  it('ignores other servers, ownerless playlists, and duplicate targets', async () => {
    getPlaylistForServer.mockResolvedValue(
      playlistResponse(['song-1']),
    );

    const result = await hydratePlaylistMembershipsForServer(
      [
        playlist('wanted', 'srv-1'),
        playlist('wanted', 'srv-1'),
        playlist('other-server', 'srv-2'),
        playlist('ownerless'),
      ],
      'srv-1',
    );

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);
    expect(getPlaylistForServer).toHaveBeenCalledWith(
      'srv-1',
      'wanted',
    );

    expect(result.requestedCount).toBe(1);
    expect(result.status).toBe('complete');
  });

  it('does no network work when every target is already cached', async () => {
    const store = usePlaylistMembershipStore.getState();
    store.setPlaylistSongIds('one', ['a'], 'srv-1');
    store.setPlaylistSongIds('two', [], 'srv-1');

    const revisionBefore = usePlaylistMembershipStore.getState().revision;

    const result = await hydratePlaylistMembershipsForServer(
      [
        playlist('one', 'srv-1'),
        playlist('two', 'srv-1'),
      ],
      'srv-1',
    );

    expect(getPlaylistForServer).not.toHaveBeenCalled();
    expect(
      usePlaylistMembershipStore.getState().revision,
    ).toBe(revisionBefore);

    expect(result).toEqual({
      status: 'complete',
      requestedCount: 2,
      networkFetchCount: 0,
      failedPlaylistIds: [],
      unresolvedPlaylistIds: [],
      revisionRaceDetected: false,
    });
  });

  it('shares one in-flight playlist fetch across concurrent hydration calls', async () => {
    const network = deferred<ReturnType<typeof playlistResponse>>();

    getPlaylistForServer.mockReturnValue(network.promise);

    const first = hydratePlaylistMembershipsForServer(
      [playlist('shared', 'srv-1')],
      'srv-1',
    );

    const second = hydratePlaylistMembershipsForServer(
      [playlist('shared', 'srv-1')],
      'srv-1',
    );

    await Promise.resolve();

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);

    network.resolve(playlistResponse(['song-1']));

    const [firstResult, secondResult] = await Promise.all([
      first,
      second,
    ]);

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);
    expect(firstResult.status).toBe('complete');
    expect(secondResult.status).toBe('complete');

    // Exactly one caller owns the actual network request; the other joined it.
    expect(
      firstResult.networkFetchCount + secondResult.networkFetchCount,
    ).toBe(1);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared', 'srv-1'),
    ).toEqual(['song-1']);
  });

  it('does not share same-id membership fetches across owning servers', async () => {
    getPlaylistForServer.mockImplementation(async (serverId: string) => (
      playlistResponse([serverId === 'srv-1' ? 'song-a' : 'song-b'])
    ));

    const [first, second] = await Promise.all([
      hydratePlaylistMembershipsForServer(
        [playlist('shared', 'srv-1')],
        'srv-1',
      ),
      hydratePlaylistMembershipsForServer(
        [playlist('shared', 'srv-2')],
        'srv-2',
      ),
    ]);

    // Each owner must start its own fetch; a global membership revision
    // change from the other server may safely force one bounded retry.
    expect(getPlaylistForServer).toHaveBeenCalledWith('srv-1', 'shared');
    expect(getPlaylistForServer).toHaveBeenCalledWith('srv-2', 'shared');
    expect(
      new Set(getPlaylistForServer.mock.calls.map(([serverId]) => serverId)),
    ).toEqual(new Set(['srv-1', 'srv-2']));
    expect(first.status).toBe('complete');
    expect(second.status).toBe('complete');
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared', 'srv-1'),
    ).toEqual(['song-a']);
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared', 'srv-2'),
    ).toEqual(['song-b']);
  });

  it('enforces the concurrency ceiling across overlapping hydration runs', async () => {
    const gate = deferred<void>();
    let inFlight = 0;
    let maxInFlight = 0;

    getPlaylistForServer.mockImplementation(
      async (_serverId, id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        await gate.promise;

        inFlight -= 1;
        return playlistResponse([`song-${id}`]);
      },
    );

    const first = hydratePlaylistMembershipsForServer(
      Array.from(
        { length: 6 },
        (_, index) => playlist(`a-${index}`, 'srv-1'),
      ),
      'srv-1',
    );

    const second = hydratePlaylistMembershipsForServer(
      Array.from(
        { length: 6 },
        (_, index) => playlist(`b-${index}`, 'srv-1'),
      ),
      'srv-1',
    );

    // Give the worker pools enough microtasks to fill every available permit.
    for (
      let i = 0;
      i < 10 && getPlaylistForServer.mock.calls.length < 4;
      i += 1
    ) {
      await Promise.resolve();
    }

    expect(getPlaylistForServer).toHaveBeenCalledTimes(
      PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY,
    );

    gate.resolve();

    const [firstResult, secondResult] = await Promise.all([
      first,
      second,
    ]);

    expect(maxInFlight).toBe(
      PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY,
    );
    expect(firstResult.status).toBe('complete');
    expect(secondResult.status).toBe('complete');
  });

  it('does not join an in-flight fetch from before a membership invalidation', async () => {
    const stale = deferred<ReturnType<typeof playlistResponse>>();
    const fresh = deferred<ReturnType<typeof playlistResponse>>();

    getPlaylistForServer
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);

    const first = hydratePlaylistMembershipsForServer(
      [playlist('shared', 'srv-1')],
      'srv-1',
    );

    // Let the revision-0 request enter the single-flight map.
    for (
      let i = 0;
      i < 10 && getPlaylistForServer.mock.calls.length < 1;
      i += 1
    ) {
      await Promise.resolve();
    }

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);

    // Membership truth changed while that old request was still in flight.
    usePlaylistMembershipStore
      .getState()
      .invalidatePlaylistSongIds('shared', 'srv-1');

    const second = hydratePlaylistMembershipsForServer(
      [playlist('shared', 'srv-1')],
      'srv-1',
    );

    // The post-invalidation hydration must start a new request rather than
    // attaching itself to the revision-0 flight.
    for (
      let i = 0;
      i < 10 && getPlaylistForServer.mock.calls.length < 2;
      i += 1
    ) {
      await Promise.resolve();
    }

    expect(getPlaylistForServer).toHaveBeenCalledTimes(2);

    // Let the new snapshot win first.
    fresh.resolve(playlistResponse(['fresh-truth']));
    const secondResult = await second;

    expect(secondResult.status).toBe('complete');
    expect(secondResult.revisionRaceDetected).toBe(false);

    // Now release the obsolete request. It must not replace fresh truth.
    stale.resolve(playlistResponse(['stale-truth']));
    const firstResult = await first;

    expect(firstResult.status).toBe('complete');
    expect(firstResult.revisionRaceDetected).toBe(true);

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('shared', 'srv-1'),
    ).toEqual(['fresh-truth']);
  });

  it('retries an all-failed pass when membership changed while it was in flight', async () => {
    const staleFailure = deferred<ReturnType<typeof playlistResponse>>();

    getPlaylistForServer
      .mockImplementationOnce(() => staleFailure.promise)
      .mockResolvedValueOnce(playlistResponse(['fresh-truth']));

    const pending = hydratePlaylistMembershipsForServer(
      [playlist('pl-1', 'srv-1')],
      'srv-1',
    );

    for (
      let i = 0;
      i < 10 && getPlaylistForServer.mock.calls.length < 1;
      i += 1
    ) {
      await Promise.resolve();
    }

    expect(getPlaylistForServer).toHaveBeenCalledTimes(1);

    usePlaylistMembershipStore
      .getState()
      .invalidatePlaylistSongIds('unrelated', 'srv-1');

    staleFailure.reject(new Error('stale network failure'));

    const result = await pending;

    expect(getPlaylistForServer).toHaveBeenCalledTimes(2);
    expect(result.networkFetchCount).toBe(2);
    expect(result.revisionRaceDetected).toBe(true);
    expect(result.status).toBe('complete');

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('pl-1', 'srv-1'),
    ).toEqual(['fresh-truth']);
  });
});
