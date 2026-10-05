import { ndGetPlaylistTrackIds } from '@/lib/api/navidromeSmart';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

interface RunPlaylistRefreshSmartDeps {
  id: string;
  serverId: string;
  reload: () => Promise<void>;
}

/** Force Navidrome to re-evaluate one smart playlist, then refetch tracks in place. */
export async function runPlaylistRefreshSmart({
  id,
  serverId,
  reload,
}: RunPlaylistRefreshSmartDeps): Promise<void> {
  // Starting the native tracks read at zero performs the smart evaluation.
  // Capture that exact result so album membership does not depend on the
  // potentially lagging Subsonic projection.
  const songIds = await ndGetPlaylistTrackIds(id, serverId);
  usePlaylistMembershipStore.getState().setPlaylistSongIds(id, songIds, serverId);
  await reload();
}
