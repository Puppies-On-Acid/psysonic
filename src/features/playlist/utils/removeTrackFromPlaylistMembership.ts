import {
  getPlaylistForServer,
  removePlaylistSongsAtIndices,
} from '@/lib/api/subsonicPlaylists';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import type { TrackPlaylistRef } from '@/store/playlistMembershipIndex';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import { playlistTracksAreReadOnly } from '@/features/playlist/utils/playlistSmartUx';

export function canRemoveTrackFromPlaylistMembership(
  playlist: TrackPlaylistRef,
): boolean {
  return playlist.readonly !== true && !playlistTracksAreReadOnly(playlist);
}

/**
 * Remove every occurrence of one track from a manual playlist.
 *
 * Membership UI is boolean ("this song is in this playlist"), so leaving a
 * duplicate occurrence behind would make a successful-looking removal appear
 * to do nothing. Fetch current server order first, remove matching indices
 * high-to-low through the Subsonic API, then replace the local membership cache
 * only after the server mutation succeeds.
 */
export async function removeTrackFromPlaylistMembership(
  playlist: TrackPlaylistRef,
  songId: string,
): Promise<number> {
  if (!canRemoveTrackFromPlaylistMembership(playlist)) {
    throw new Error('Playlist membership is read-only');
  }

  const targetId = canonicalNavidromeId(songId);
  const { songs } = await getPlaylistForServer(playlist.serverId, playlist.id);
  const indices: number[] = [];

  songs.forEach((song, index) => {
    if (canonicalNavidromeId(song.id) === targetId) indices.push(index);
  });

  const membership = usePlaylistMembershipStore.getState();

  if (indices.length === 0) {
    // The column was stale; the detail response is authoritative and already
    // satisfies the requested end state.
    membership.replacePlaylistSongIds(
      playlist.id,
      songs.map(song => song.id),
      playlist.serverId,
    );
    usePlaylistStore.setState(state => ({
      playlists: state.playlists.map(item => (
        item.id === playlist.id && item.serverId === playlist.serverId
          ? { ...item, songCount: songs.length }
          : item
      )),
    }));
    return 0;
  }

  try {
    await removePlaylistSongsAtIndices(
      playlist.id,
      indices,
      playlist.serverId,
    );
  } catch (error) {
    // Batched index removal can partially succeed before a later request fails.
    // Drop local truth so the next membership view re-reads the server.
    membership.invalidatePlaylistSongIds(playlist.id, playlist.serverId);
    throw error;
  }

  const removed = new Set(indices);
  const remainingIds = songs
    .filter((_song, index) => !removed.has(index))
    .map(song => song.id);

  membership.replacePlaylistSongIds(
    playlist.id,
    remainingIds,
    playlist.serverId,
  );
  usePlaylistStore.setState(state => ({
    playlists: state.playlists.map(item => (
      item.id === playlist.id && item.serverId === playlist.serverId
        ? { ...item, songCount: remainingIds.length }
        : item
    )),
  }));
  usePlaylistStore.getState().touchPlaylist(playlist.id, playlist.serverId);

  return indices.length;
}
