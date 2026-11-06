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

interface Options {
  readonly enabled: boolean;
  readonly serverIds: readonly string[];
}

export interface PlaylistMembershipMultiServerHydrationView {
  readonly truthStateByServer: Readonly<Record<string, TrackPlaylistMembershipTruthState>>;
  readonly index: TrackPlaylistMembershipIndex;
}

const EMPTY_PLAYLISTS: readonly SubsonicPlaylist[] = [];
const EMPTY_MEMBERSHIP_SONG_IDS: Readonly<Record<string, readonly string[]>> = {};
const EMPTY_INDEX: TrackPlaylistMembershipIndex = {
  playlistsByTrackKey: new Map(),
  unresolvedPlaylistsByServer: new Map(),
};

export function usePlaylistMembershipHydrationForServers({
  enabled,
  serverIds,
}: Options): PlaylistMembershipMultiServerHydrationView {
  const fetchPlaylistsForServer = usePlaylistStore(s => s.fetchPlaylistsForServer);
  const playlists = usePlaylistStore(
    s => (enabled && serverIds.length > 0 ? s.playlists : EMPTY_PLAYLISTS),
  );
  const membershipSongIdsByCacheKey = usePlaylistMembershipStore(
    s => (enabled && serverIds.length > 0 ? s.songIdsByCacheKey : EMPTY_MEMBERSHIP_SONG_IDS),
  );

  const serverKey = JSON.stringify([...new Set(serverIds.filter(Boolean))].sort());
  const normalizedServerIds = useMemo(
    () => JSON.parse(serverKey) as string[],
    [serverKey],
  );
  const [runStateByServer, setRunStateByServer] = useState<
    Record<string, TrackPlaylistMembershipTruthState>
  >({});

  useEffect(() => {
    if (!enabled || normalizedServerIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunStateByServer({});
      return;
    }

    let current = true;
    const isCurrent = () => current;
    setRunStateByServer(Object.fromEntries(
      normalizedServerIds.map(serverId => [serverId, 'loading' as const]),
    ));

    void (async () => {
      const metadataResults = await Promise.all(
        normalizedServerIds.map(async serverId => {
          try {
            return [
              serverId,
              await fetchPlaylistsForServer(serverId, isCurrent),
            ] as const;
          } catch {
            return [serverId, false] as const;
          }
        }),
      );
      if (!current) return;

      // Membership commits use one global revision counter. Hydrate owners
      // serially so several perfectly valid server batches cannot invalidate
      // each other and exhaust the bounded race retry budget.
      for (const [serverId, metadataApplied] of metadataResults) {
        let state: TrackPlaylistMembershipTruthState = 'partial';

        if (metadataApplied) {
          try {
            const ownedPlaylists = usePlaylistStore
              .getState()
              .playlists
              .filter(playlist => playlist.serverId === serverId);
            const result = await hydratePlaylistMembershipsForServer(
              ownedPlaylists,
              serverId,
            );
            if (!current) return;
            state = result.status === 'complete' ? 'ready' : 'partial';
          } catch {
            state = 'partial';
          }
        }

        if (current) {
          setRunStateByServer(previous => ({
            ...previous,
            [serverId]: state,
          }));
        }
      }
    })();

    return () => {
      current = false;
    };
  }, [enabled, fetchPlaylistsForServer, normalizedServerIds]);

  const index = useMemo(() => {
    if (!enabled || normalizedServerIds.length === 0) return EMPTY_INDEX;
    const owners = new Set(normalizedServerIds);
    const ownedPlaylists = playlists.filter(
      playlist => playlist.serverId && owners.has(playlist.serverId),
    );
    return buildTrackPlaylistMembershipIndex(
      ownedPlaylists,
      (playlistId, ownerServerId) =>
        membershipSongIdsByCacheKey[`${ownerServerId}:${playlistId}`],
    );
  }, [
    enabled,
    membershipSongIdsByCacheKey,
    normalizedServerIds,
    playlists,
  ]);

  useEffect(() => {
    if (!enabled) return;
    let current = true;

    void (async () => {
      for (const serverId of normalizedServerIds) {
        if (!current) return;
        if (runStateByServer[serverId] !== 'ready') continue;
        if (unresolvedPlaylistMembershipsForServer(index, serverId).length === 0) continue;
        const ownedPlaylists = playlists.filter(
          playlist => playlist.serverId === serverId,
        );
        await hydratePlaylistMembershipsForServer(ownedPlaylists, serverId);
      }
    })();

    return () => {
      current = false;
    };
  }, [
    enabled,
    index,
    normalizedServerIds,
    playlists,
    runStateByServer,
  ]);

  const truthStateByServer = useMemo(() => {
    if (!enabled) return {};
    return Object.fromEntries(normalizedServerIds.map(serverId => {
      let state = runStateByServer[serverId] ?? 'loading';
      if (
        state === 'ready'
        && unresolvedPlaylistMembershipsForServer(index, serverId).length > 0
      ) {
        state = 'partial';
      }
      return [serverId, state];
    }));
  }, [enabled, index, normalizedServerIds, runStateByServer]);

  return { truthStateByServer, index };
}
