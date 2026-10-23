import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { getPlaylistForServer } from '@/lib/api/subsonicPlaylists';
import {
  usePlaylistMembershipStore,
  type PlaylistMembershipBatchEntry,
} from '@/store/playlistMembershipStore';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

export const PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY = 4;
const PLAYLIST_MEMBERSHIP_HYDRATION_MAX_PASSES = 2;

const membershipFetchInflight = new Map<string, Promise<readonly string[]>>();
let membershipFetchSlotsInUse = 0;
const membershipFetchWaiters: Array<() => void> = [];

function releaseMembershipFetchSlot(): void {
  const next = membershipFetchWaiters.shift();

  if (next) {
    // Transfer this permit directly to the oldest waiter. Keep the count
    // unchanged so a new caller cannot steal the slot before its microtask runs.
    next();
    return;
  }

  membershipFetchSlotsInUse -= 1;
}

async function acquireMembershipFetchSlot(): Promise<() => void> {
  if (
    membershipFetchSlotsInUse
    < PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY
  ) {
    membershipFetchSlotsInUse += 1;
    return releaseMembershipFetchSlot;
  }

  await new Promise<void>(resolve => {
    membershipFetchWaiters.push(resolve);
  });

  // The releasing request transferred its existing permit to us.
  return releaseMembershipFetchSlot;
}

interface MembershipFetchFlight {
  readonly promise: Promise<readonly string[]>;
  /** True only for the caller that actually created the network request. */
  readonly started: boolean;
}

function fetchPlaylistMembershipSingleFlight(
  serverId: string,
  playlistId: string,
  expectedRevision: number,
): MembershipFetchFlight {
  const key = `${ownedEntityKey({
    id: playlistId,
    serverId,
  })}\u0000${expectedRevision}`;
  const existing = membershipFetchInflight.get(key);

  if (existing) {
    return {
      promise: existing,
      started: false,
    };
  }

  const flight = (async () => {
    const release = await acquireMembershipFetchSlot();

    try {
      const { songs } = await getPlaylistForServer(serverId, playlistId);
      return songs.map(song => song.id);
    } finally {
      release();
    }
  })().finally(() => {
    if (membershipFetchInflight.get(key) === flight) {
      membershipFetchInflight.delete(key);
    }
  });

  membershipFetchInflight.set(key, flight);

  return {
    promise: flight,
    started: true,
  };
}

/** @internal Vitest-only - reset module-level single-flight/concurrency state. */
export function __resetPlaylistMembershipHydrationForTests(): void {
  membershipFetchInflight.clear();
  membershipFetchSlotsInUse = 0;
  membershipFetchWaiters.splice(0);
}

export type PlaylistMembershipHydrationTarget =
  Pick<SubsonicPlaylist, 'id' | 'serverId'>;

export interface PlaylistMembershipHydrationResult {
  readonly status: 'complete' | 'partial';
  /** Unique, server-owned playlists considered by this hydration run. */
  readonly requestedCount: number;
  /** Network requests this run started; joined single-flight requests do not count. */
  readonly networkFetchCount: number;
  /** Final unresolved playlists whose latest network request failed. */
  readonly failedPlaylistIds: readonly string[];
  /** Playlists still absent from the membership cache when hydration settled. */
  readonly unresolvedPlaylistIds: readonly string[];
  /** True when a fetched batch was discarded because membership changed mid-flight. */
  readonly revisionRaceDetected: boolean;
}

interface FetchPassResult {
  entries: PlaylistMembershipBatchEntry[];
  failedPlaylistIds: Set<string>;
  networkFetchCount: number;
}

function hydrationTargets(
  playlists: readonly PlaylistMembershipHydrationTarget[],
  serverId: string,
): PlaylistMembershipHydrationTarget[] {
  const seen = new Set<string>();
  const targets: PlaylistMembershipHydrationTarget[] = [];

  for (const playlist of playlists) {
    if (playlist.serverId !== serverId || seen.has(playlist.id)) continue;
    seen.add(playlist.id);
    targets.push(playlist);
  }

  return targets;
}

async function fetchMembershipPass(
  playlists: readonly PlaylistMembershipHydrationTarget[],
  serverId: string,
  expectedRevision: number,
): Promise<FetchPassResult> {
  const entries: PlaylistMembershipBatchEntry[] = [];
  const failedPlaylistIds = new Set<string>();
  let next = 0;
  let networkFetchCount = 0;

  const worker = async () => {
    for (;;) {
      const playlist = playlists[next++];
      if (!playlist) return;

      const flight = fetchPlaylistMembershipSingleFlight(
        serverId,
        playlist.id,
        expectedRevision,
      );

      if (flight.started) {
        networkFetchCount += 1;
      }

      try {
        const songIds = await flight.promise;

        entries.push({
          playlistId: playlist.id,
          serverId,
          songIds,
        });
      } catch {
        failedPlaylistIds.add(playlist.id);
      }
    }
  };

  const workerCount = Math.min(
    PLAYLIST_MEMBERSHIP_HYDRATION_CONCURRENCY,
    playlists.length,
  );

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return {
    entries,
    failedPlaylistIds,
    networkFetchCount,
  };
}

/**
 * Fill missing playlist memberships for one owning server.
 *
 * Existing cache entries are never fetched again. Missing memberships are
 * loaded through a fixed-size worker pool, then committed to Zustand as one
 * revision-guarded batch.
 *
 * If any membership mutation lands while network requests are in flight, that
 * fetched batch is discarded rather than overwriting newer state. The hydrator
 * then makes one fresh pass over whatever is still missing. A second race ends
 * the run as partial instead of retrying indefinitely.
 */
export async function hydratePlaylistMembershipsForServer(
  playlists: readonly PlaylistMembershipHydrationTarget[],
  serverId: string,
): Promise<PlaylistMembershipHydrationResult> {
  const targets = hydrationTargets(playlists, serverId);

  let networkFetchCount = 0;
  let revisionRaceDetected = false;
  let finalFailedPlaylistIds = new Set<string>();

  for (let pass = 0; pass < PLAYLIST_MEMBERSHIP_HYDRATION_MAX_PASSES; pass += 1) {
    const store = usePlaylistMembershipStore.getState();
    const missing = targets.filter(
      playlist => store.getPlaylistSongIds(playlist.id, serverId) === undefined,
    );

    if (missing.length === 0) break;

    const expectedRevision = store.revision;
    const fetched = await fetchMembershipPass(
      missing,
      serverId,
      expectedRevision,
    );
    networkFetchCount += fetched.networkFetchCount;

    const accepted = usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIdsBatchIfRevision(fetched.entries, expectedRevision);

    if (accepted) {
      finalFailedPlaylistIds = fetched.failedPlaylistIds;
      break;
    }

    revisionRaceDetected = true;

    // Everything fetched in this pass is stale with respect to the membership
    // snapshot it started from. Do not preserve either successes or failures;
    // the next pass re-evaluates current cache truth from scratch.
    finalFailedPlaylistIds = new Set();

    if (pass === PLAYLIST_MEMBERSHIP_HYDRATION_MAX_PASSES - 1) {
      finalFailedPlaylistIds = fetched.failedPlaylistIds;
    }
  }

  const settledStore = usePlaylistMembershipStore.getState();
  const unresolvedPlaylistIds = targets
    .filter(
      playlist =>
        settledStore.getPlaylistSongIds(playlist.id, serverId) === undefined,
    )
    .map(playlist => playlist.id);

  const unresolved = new Set(unresolvedPlaylistIds);
  const failedPlaylistIds = targets
    .filter(
      playlist =>
        unresolved.has(playlist.id)
        && finalFailedPlaylistIds.has(playlist.id),
    )
    .map(playlist => playlist.id);

  return {
    status: unresolvedPlaylistIds.length === 0 ? 'complete' : 'partial',
    requestedCount: targets.length,
    networkFetchCount,
    failedPlaylistIds,
    unresolvedPlaylistIds,
    revisionRaceDetected,
  };
}
