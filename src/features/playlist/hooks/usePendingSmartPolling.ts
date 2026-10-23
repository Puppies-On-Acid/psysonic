import { useEffect, useRef } from 'react';
import type React from 'react';
import { getPlaylistForServer } from '@/lib/api/subsonicPlaylists';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import type { PendingSmartPlaylist } from '@/features/playlist/utils/playlistsSmart';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Poll Navidrome every 10 s for each pending smart playlist until its
 * rules finish processing on the server. We stop polling for an item when
 * (a) it has at least one song AND (b) its cover-art id has changed from
 * the placeholder we first saw — or after ~3 minutes as a fallback.
 *
 * Side-effects:
 *   - rehydrates the playlist store with fresh detail-endpoint metadata
 *     (cover, song count) as soon as it's available
 *   - shrinks `pendingSmart` as items finish
 */
export function usePendingSmartPolling(
  pendingSmart: PendingSmartPlaylist[],
  setPendingSmart: React.Dispatch<React.SetStateAction<PendingSmartPlaylist[]>>,
): void {
  const pollingGenerationRef = useRef(0);
  useEffect(() => {
    if (pendingSmart.length === 0) return;
    const generation = ++pollingGenerationRef.current;
    let inFlight = false;
    const interval = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const ownerServerIds = [...new Set(
          pendingSmart.map(item => item.serverId).filter(Boolean),
        )];
        await Promise.all(ownerServerIds.map(serverId =>
          usePlaylistStore
            .getState()
            .fetchPlaylistsForServer(
              serverId,
              () => pollingGenerationRef.current === generation,
            )
        ));
        if (pollingGenerationRef.current !== generation) return;
        const listNow = usePlaylistStore.getState().playlists;
        const hydrated = pendingSmart.map(item => {
          if (item.id) return item;
          const found = listNow.find(p => p.serverId === item.serverId && p.name === item.name);
          return found ? { ...item, id: found.id } : item;
        });
        // Detail endpoint tends to reflect fresh metadata earlier than list endpoint.
        const details = await Promise.all(
          hydrated.filter(item => item.id).map(async (item) => {
            try {
              const { playlist, songs } = await getPlaylistForServer(item.serverId, item.id!);
              return {
                playlist: { ...playlist, serverId: item.serverId },
                songIds: songs.map(song => song.id),
              };
            } catch {
              return null;
            }
          }),
        );
        if (pollingGenerationRef.current !== generation) return;
        const freshById = new Map(
          details
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .map(detail => [ownedEntityKey(detail.playlist), detail]),
        );
        if (freshById.size > 0) {
          usePlaylistStore.setState((s) => ({
            playlists: s.playlists.map((p) => {
              const fresh = freshById.get(ownedEntityKey(p));
              return fresh ? { ...p, ...fresh.playlist } : p;
            }),
          }));
        }
        const current = usePlaylistStore.getState().playlists;
        const membership = usePlaylistMembershipStore.getState();
        const next: PendingSmartPlaylist[] = [];

        for (const item of hydrated) {
          const pl = item.id
            ? current.find(p => p.serverId === item.serverId && p.id === item.id)
            : current.find(p => p.serverId === item.serverId && p.name === item.name);
          if (!pl) {
            next.push({ ...item, attempts: item.attempts + 1 });
            continue;
          }
          const songCount = pl.songCount ?? 0;
          const currentCover = pl.coverArt;
          const firstCover = item.firstSeenCoverArt ?? currentCover;
          const placeholderStillThere = Boolean(firstCover) && currentCover === firstCover;
          // Wait until we see actual content and cover changed from the first placeholder-ish cover.
          // Fallback timeout keeps UI from waiting forever on servers that never update cover id.
          const hardTimeoutReached = item.attempts >= 18; // ~3 minutes (18 * 10s)
          const emptySettled = songCount === 0 && item.attempts >= 3; // ~30s — valid empty result
          const ready =
            hardTimeoutReached
            || emptySettled
            || (songCount > 0 && (!placeholderStillThere || hardTimeoutReached));

          if (ready && item.id) {
            const fresh = freshById.get(
              ownedEntityKey({ id: item.id, serverId: item.serverId }),
            );
            if (
              fresh
              && membership.getPlaylistSongIds(item.id, item.serverId) === undefined
            ) {
              membership.setPlaylistSongIds(
                item.id,
                fresh.songIds,
                item.serverId,
              );
            }
          }

          if (!ready) {
            next.push({
              ...item,
              id: pl.id,
              firstSeenCoverArt: firstCover,
              attempts: item.attempts + 1,
            });
          }
        }

        setPendingSmart(next);
      } finally {
        inFlight = false;
      }
    }, 10000);
    return () => {
      pollingGenerationRef.current += 1;
      window.clearInterval(interval);
    };
  }, [pendingSmart, setPendingSmart]);
}
