import { useEffect, useMemo, useState } from 'react';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import {
  buildTrackPlaylistMembershipIndex,
  unresolvedPlaylistMembershipsForServer,
  type TrackPlaylistMembershipIndex,
  type TrackPlaylistMembershipTruthState,
} from '@/store/playlistMembershipIndex';
import { hydratePlaylistMembershipsForServer } from '@/store/playlistMembershipHydration';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';

interface PlaylistMembershipHydrationOptions {
  readonly enabled: boolean;
  readonly serverId?: string | null;
}

export interface PlaylistMembershipHydrationView {
  readonly truthState: TrackPlaylistMembershipTruthState;
  readonly index: TrackPlaylistMembershipIndex;
}

interface HydrationRunState {
  readonly serverId?: string;
  readonly state: TrackPlaylistMembershipTruthState;
}

const EMPTY_PLAYLISTS: readonly SubsonicPlaylist[] = [];
const EMPTY_MEMBERSHIP_SONG_IDS: Readonly<Record<string, readonly string[]>> = {};
const EMPTY_INDEX: TrackPlaylistMembershipIndex = {
  playlistsByTrackKey: new Map(),
  unresolvedPlaylistsByServer: new Map(),
};

/**
 * Refresh playlist metadata for one owner, hydrate missing song memberships,
 * and expose a live reverse index for track-list consumers.
 *
 * Disabled means zero playlist metadata/membership network work and no
 * subscription to membership revisions. Once enabled, later cache invalidation
 * immediately downgrades a previously-ready view to partial rather than letting
 * the UI present an unresolved track as definitely belonging to no playlists.
 */
export function usePlaylistMembershipHydration({
  enabled,
  serverId,
}: PlaylistMembershipHydrationOptions): PlaylistMembershipHydrationView {
  const fetchPlaylistsForServer = usePlaylistStore(s => s.fetchPlaylistsForServer);
  const playlists = usePlaylistStore(
    s => (enabled && serverId ? s.playlists : EMPTY_PLAYLISTS),
  );
  const membershipSongIdsByCacheKey = usePlaylistMembershipStore(
    s => (enabled && serverId ? s.songIdsByCacheKey : EMPTY_MEMBERSHIP_SONG_IDS),
  );
  const [runState, setRunState] = useState<HydrationRunState>({
    state: 'unknown',
  });

  useEffect(() => {
    if (!enabled || !serverId) {
      // React Compiler set-state-in-effect rule: reset async state when the
      // externally-owned visibility/server gate is disabled.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunState({ state: 'unknown' });
      return;
    }

    let current = true;
    const isCurrent = () => current;

    // This marks the lifecycle boundary for the async metadata + membership
    // hydration request before the first awaited result can settle.
    setRunState({ serverId, state: 'loading' });

    void (async () => {
      try {
        const metadataApplied = await fetchPlaylistsForServer(serverId, isCurrent);
        if (!current) return;

        if (!metadataApplied) {
          setRunState({ serverId, state: 'partial' });
          return;
        }

        const ownedPlaylists = usePlaylistStore
          .getState()
          .playlists
          .filter(playlist => playlist.serverId === serverId);

        const result = await hydratePlaylistMembershipsForServer(
          ownedPlaylists,
          serverId,
        );
        if (!current) return;

        setRunState({
          serverId,
          state: result.status === 'complete' ? 'ready' : 'partial',
        });
      } catch {
        if (current) setRunState({ serverId, state: 'partial' });
      }
    })();

    return () => {
      current = false;
    };
  }, [enabled, fetchPlaylistsForServer, serverId]);

  const index = useMemo(() => {
    if (!enabled || !serverId) return EMPTY_INDEX;

    const ownedPlaylists = playlists.filter(
      playlist => playlist.serverId === serverId,
    );

    return buildTrackPlaylistMembershipIndex(
      ownedPlaylists,
      (playlistId, ownerServerId) =>
        membershipSongIdsByCacheKey[`${ownerServerId}:${playlistId}`],
    );
  }, [enabled, membershipSongIdsByCacheKey, playlists, serverId]);

  useEffect(() => {
    if (!enabled || !serverId) return;
    if (runState.serverId !== serverId || runState.state !== 'ready') return;
    if (unresolvedPlaylistMembershipsForServer(index, serverId).length === 0) return;

    const ownedPlaylists = playlists.filter(
      playlist => playlist.serverId === serverId,
    );

    // One cache change gets one repair attempt. If the repair remains partial
    // it does not mutate the cache, so this effect will not spin until a later
    // mutation changes membership truth again.
    void hydratePlaylistMembershipsForServer(ownedPlaylists, serverId);
  }, [
    enabled,
    index,
    playlists,
    runState.serverId,
    runState.state,
    serverId,
  ]);

  let truthState: TrackPlaylistMembershipTruthState;
  if (!enabled || !serverId) {
    truthState = 'unknown';
  } else if (runState.serverId !== serverId) {
    truthState = 'loading';
  } else {
    truthState = runState.state;
  }

  if (
    truthState === 'ready'
    && unresolvedPlaylistMembershipsForServer(index, serverId).length > 0
  ) {
    truthState = 'partial';
  }

  return { truthState, index };
}
