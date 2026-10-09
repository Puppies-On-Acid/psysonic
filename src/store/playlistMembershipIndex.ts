import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { playlistDisplayName } from '@/lib/format/playlistClassification';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Minimal playlist identity needed by track-membership consumers.
 *
 * Membership is always server-owned. An ownerless playlist cannot safely be
 * associated with a track in a multi-server library and is therefore ignored.
 */
export interface TrackPlaylistRef {
  readonly id: string;
  readonly serverId: string;
  readonly name: string;
  readonly smart?: boolean;
  readonly smartMetadataUnavailable?: boolean;
  readonly?: boolean;
}

export type TrackPlaylistMembershipTruthState =
  | 'unknown'
  | 'loading'
  | 'ready'
  | 'partial';

/**
 * Return the known full server-side song membership for one playlist.
 *
 * `undefined` means the playlist has not been hydrated yet. An empty array
 * means it has been hydrated and genuinely contains no songs.
 */
export type PlaylistMembershipLookup = (
  playlistId: string,
  serverId: string,
) => readonly string[] | undefined;

export interface TrackPlaylistMembershipIndex {
  /**
   * Reverse index keyed by the server-owned track key (`serverId:trackId`).
   *
   * A playlist appears at most once for a track even when the playlist itself
   * contains duplicate occurrences of that song.
   */
  readonly playlistsByTrackKey: ReadonlyMap<string, readonly TrackPlaylistRef[]>;

  /**
   * Playlists whose membership is not known yet, grouped by owning server.
   *
   * Completeness is server-scoped: an unresolved playlist on srv-2 must not make
   * membership for a track on srv-1 appear incomplete.
   */
  readonly unresolvedPlaylistsByServer: ReadonlyMap<string, readonly TrackPlaylistRef[]>;
}

function comparePlaylistRefs(a: TrackPlaylistRef, b: TrackPlaylistRef): number {
  const byName = playlistDisplayName(a).localeCompare(playlistDisplayName(b));
  if (byName !== 0) return byName;

  const byServer = a.serverId.localeCompare(b.serverId);
  if (byServer !== 0) return byServer;

  return a.id.localeCompare(b.id);
}

/**
 * Build the reverse view of Psysonic's existing playlist-membership cache:
 *
 *   playlist -> song ids
 *
 * becomes:
 *
 *   server-owned song -> playlists
 *
 * This function is deliberately pure. It performs no fetches, mutates no
 * stores, and treats the supplied playlist list as authoritative so stale
 * cache entries for deleted playlists cannot leak into the result.
 */
export function buildTrackPlaylistMembershipIndex(
  playlists: readonly SubsonicPlaylist[],
  getPlaylistSongIds: PlaylistMembershipLookup,
): TrackPlaylistMembershipIndex {
  const playlistsByTrackKey = new Map<string, TrackPlaylistRef[]>();
  const unresolvedPlaylistsByServer = new Map<string, TrackPlaylistRef[]>();

  for (const playlist of playlists) {
    const serverId = playlist.serverId;
    if (!serverId) continue;

    const ref: TrackPlaylistRef = {
      id: playlist.id,
      serverId,
      name: playlist.name,
      ...(playlist.smart !== undefined ? { smart: playlist.smart } : {}),
      ...(playlist.smartMetadataUnavailable !== undefined
        ? { smartMetadataUnavailable: playlist.smartMetadataUnavailable }
        : {}),
      ...(playlist.readonly !== undefined ? { readonly: playlist.readonly } : {}),
    };

    const songIds = getPlaylistSongIds(playlist.id, serverId);
    if (songIds === undefined) {
      const unresolved = unresolvedPlaylistsByServer.get(serverId);
      if (unresolved) {
        unresolved.push(ref);
      } else {
        unresolvedPlaylistsByServer.set(serverId, [ref]);
      }
      continue;
    }

    // A Subsonic playlist may legitimately contain the same song more than
    // once. Membership is boolean: that playlist should still appear once.
    for (const songId of new Set(songIds)) {
      const trackKey = ownedEntityKey({ id: songId, serverId });
      const existing = playlistsByTrackKey.get(trackKey);

      if (existing) {
        existing.push(ref);
      } else {
        playlistsByTrackKey.set(trackKey, [ref]);
      }
    }
  }

  // The server/API ordering of playlists is not a useful UI contract.
  // Keep reverse-membership results stable regardless of input order.
  for (const refs of playlistsByTrackKey.values()) {
    refs.sort(comparePlaylistRefs);
  }
  for (const refs of unresolvedPlaylistsByServer.values()) {
    refs.sort(comparePlaylistRefs);
  }

  return {
    playlistsByTrackKey,
    unresolvedPlaylistsByServer,
  };
}

/**
 * Read the resolved memberships for one server-owned track.
 *
 * Returning [] here does NOT by itself mean membership is complete; callers
 * must also account for unresolved playlists before presenting "none".
 */
export function playlistMembershipsForTrack(
  index: TrackPlaylistMembershipIndex,
  track: { id: string; serverId?: string | null },
): readonly TrackPlaylistRef[] {
  if (!track.serverId) return [];
  return index.playlistsByTrackKey.get(ownedEntityKey(track)) ?? [];
}

export function unresolvedPlaylistMembershipsForServer(
  index: TrackPlaylistMembershipIndex,
  serverId?: string | null,
): readonly TrackPlaylistRef[] {
  if (!serverId) return [];
  return index.unresolvedPlaylistsByServer.get(serverId) ?? [];
}
