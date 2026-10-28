import { create } from 'zustand';

export interface PlaylistMembershipBatchEntry {
  readonly playlistId: string;
  readonly serverId: string;
  readonly songIds: readonly string[];
}

/**
 * In-memory playlist song-id membership cache, keyed by `serverId:playlistId`.
 *
 * Lives in the core store layer (not the playlist feature) so `offline`, `orbit`,
 * `contextMenu` and `playlist` can all read/write it directly without a cross-feature
 * barrel dependency — the membership cache is the one piece those features genuinely
 * share, and routing it through `@/features/playlist` created import cycles.
 *
 * Not persisted: playlist membership must reflect the live server, so it is rebuilt
 * from `getPlaylist`/`runPlaylistLoad` on demand and dropped on `fetchPlaylists`.
 */
interface PlaylistMembershipStore {
  /** Song-id lists keyed by `serverId:playlistId`. */
  songIdsByCacheKey: Record<string, readonly string[]>;
  revision: number;
  getPlaylistSongIds: (playlistId: string, serverId?: string) => readonly string[] | undefined;
  setPlaylistSongIds: (playlistId: string, songIds: readonly string[], serverId?: string) => void;
  setPlaylistSongIdsBatchIfRevision: (
    entries: readonly PlaylistMembershipBatchEntry[],
    expectedRevision: number,
  ) => boolean;
  appendPlaylistSongIds: (playlistId: string, songIds: readonly string[], serverId?: string) => void;
  replacePlaylistSongIds: (playlistId: string, songIds: readonly string[], serverId?: string) => void;
  removePlaylistSongIdsAtIndices: (playlistId: string, indices: readonly number[], serverId?: string) => void;
  invalidatePlaylistSongIds: (playlistId: string, serverId?: string) => void;
  clearAllPlaylistSongIds: () => void;
}

function cacheKey(playlistId: string, serverId?: string): string | undefined {
  return serverId ? `${serverId}:${playlistId}` : undefined;
}

export const usePlaylistMembershipStore = create<PlaylistMembershipStore>()((set, get) => ({
  songIdsByCacheKey: {},
  revision: 0,
  getPlaylistSongIds: (playlistId, serverId) => {
    const key = cacheKey(playlistId, serverId);
    return key ? get().songIdsByCacheKey[key] : undefined;
  },
  setPlaylistSongIds: (playlistId, songIds, serverId) => {
    const key = cacheKey(playlistId, serverId);
    if (!key) return;
    set((s) => ({
      songIdsByCacheKey: { ...s.songIdsByCacheKey, [key]: [...songIds] },
      revision: (s.revision ?? 0) + 1,
    }));
  },
  setPlaylistSongIdsBatchIfRevision: (entries, expectedRevision) => {
    let accepted = false;

    set((s) => {
      if (s.revision !== expectedRevision) return s;

      accepted = true;
      let next = s.songIdsByCacheKey;
      let changed = false;

      for (const entry of entries) {
        const key = cacheKey(entry.playlistId, entry.serverId);
        if (!key || key in next) continue;

        if (!changed) {
          next = { ...next };
          changed = true;
        }

        next[key] = [...entry.songIds];
      }

      if (!changed) return s;

      return {
        songIdsByCacheKey: next,
        revision: (s.revision ?? 0) + 1,
      };
    });

    return accepted;
  },
  appendPlaylistSongIds: (playlistId, songIds, serverId) => {
    if (songIds.length === 0) return;
    set((s) => {
      const key = cacheKey(playlistId, serverId);
      if (!key) return s;
      const prev = s.songIdsByCacheKey[key] ?? [];
      return {
        songIdsByCacheKey: { ...s.songIdsByCacheKey, [key]: [...prev, ...songIds] },
        revision: (s.revision ?? 0) + 1,
      };
    });
  },
  replacePlaylistSongIds: (playlistId, songIds, serverId) => get().setPlaylistSongIds(playlistId, songIds, serverId),
  removePlaylistSongIdsAtIndices: (playlistId, indices, serverId) => {
    if (indices.length === 0) return;
    set((s) => {
      const key = cacheKey(playlistId, serverId);
      if (!key) return s;
      const prev = s.songIdsByCacheKey[key];
      if (!prev) return s;
      const remove = new Set(indices);
      return {
        songIdsByCacheKey: { ...s.songIdsByCacheKey, [key]: prev.filter((_, i) => !remove.has(i)) },
        revision: (s.revision ?? 0) + 1,
      };
    });
  },
  invalidatePlaylistSongIds: (playlistId, serverId) =>
    set((s) => {
      const key = cacheKey(playlistId, serverId);
      if (!key) return s;
      if (!(key in s.songIdsByCacheKey)) {
        return { revision: (s.revision ?? 0) + 1 };
      }
      const { [key]: _removed, ...rest } = s.songIdsByCacheKey;
      return { songIdsByCacheKey: rest, revision: (s.revision ?? 0) + 1 };
    }),
  clearAllPlaylistSongIds: () => set(s => ({
    songIdsByCacheKey: {},
    revision: (s.revision ?? 0) + 1,
  })),
}));
