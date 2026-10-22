import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import {
  libraryTagExplorerAlbums,
  libraryTagExplorerTracks,
  type LibraryTagFilter,
  type LibraryTagMatchMode,
} from '@/lib/api/library';
import { albumToAlbum } from '@/lib/library/advancedSearchLocal';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { readyLibraryServerKeys } from '@/lib/library/libraryReady';
import { trackToSong } from '@/lib/library/trackDtoMapping';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useLibraryScopeSyncRevision } from '@/store/offlineLocalLibrarySyncRevision';

export const TAG_EXPLORER_ALBUM_PAGE_SIZE = 50;
export const TAG_EXPLORER_TRACK_PAGE_SIZE = 100;

type ExplorerView = 'albums' | 'tracks';

type CachedExplorer = {
  albums: SubsonicAlbum[];
  albumHasMore: boolean;
  albumTotal: number | null;
  albumsReady: boolean;
  songs: SubsonicSong[];
  trackHasMore: boolean;
  trackTotal: number | null;
  tracksReady: boolean;
};

const CACHE_MAX = 2;
const cache = new Map<string, CachedExplorer>();

function emptyCache(): CachedExplorer {
  return {
    albums: [],
    albumHasMore: false,
    albumTotal: null,
    albumsReady: false,
    songs: [],
    trackHasMore: false,
    trackTotal: null,
    tracksReady: false,
  };
}

function cloneCache(value: CachedExplorer): CachedExplorer {
  return {
    ...value,
    albums: [...value.albums],
    songs: [...value.songs],
  };
}

function peekCache(key: string): CachedExplorer | null {
  const value = cache.get(key);
  return value ? cloneCache(value) : null;
}

function readCache(key: string): CachedExplorer | null {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return cloneCache(value);
}

function writeCache(key: string, value: CachedExplorer): void {
  cache.delete(key);
  cache.set(key, cloneCache(value));
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function patchCache(
  key: string,
  patch: Partial<CachedExplorer>,
): void {
  writeCache(key, {
    ...(cache.get(key) ?? emptyCache()),
    ...patch,
  });
}

function queryKey(
  serverId: string,
  tags: readonly LibraryTagFilter[],
  mode: LibraryTagMatchMode,
  filterVersion: number,
  syncRevision: number,
  scope: LibraryBrowseScope,
): string {
  return JSON.stringify([
    serverId,
    tags.map(tag => [
      tag.kind,
      tag.value.trim().toLocaleLowerCase(),
    ]),
    mode,
    filterVersion,
    syncRevision,
    scope.fingerprint,
  ]);
}

function dedupeOwned<T extends {
  id: string;
  serverId?: string;
}>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = ownedEntityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function waitForReady(
  scope: LibraryBrowseScope,
  serverId: string,
): Promise<boolean> {
  const serverIds = scope.serverIds.length > 0
    ? scope.serverIds
    : [serverId];

  if (await readyLibraryServerKeys(serverIds)) return true;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, 250);
    });
    if (await readyLibraryServerKeys(serverIds)) return true;
  }

  return false;
}

export function useTagExplorerBrowse(
  serverId: string,
  tags: readonly LibraryTagFilter[],
  mode: LibraryTagMatchMode,
  activeView: ExplorerView,
  musicLibraryFilterVersion: number,
  browseScope: LibraryBrowseScope,
) {
  const syncServerIds = browseScope.serverIds.length > 0
    ? browseScope.serverIds
    : serverId
      ? [serverId]
      : [];
  const syncRevision = useLibraryScopeSyncRevision(syncServerIds);
  const key = useMemo(
    () => queryKey(
      serverId,
      tags,
      mode,
      musicLibraryFilterVersion,
      syncRevision,
      browseScope,
    ),
    [
      serverId,
      tags,
      mode,
      musicLibraryFilterVersion,
      syncRevision,
      browseScope,
    ],
  );

  const initial = useMemo(
    () => peekCache(key) ?? emptyCache(),
    [key],
  );

  const [albums, setAlbums] = useState(initial.albums);
  const [albumHasMore, setAlbumHasMore] = useState(initial.albumHasMore);
  const [albumTotal, setAlbumTotal] = useState<number | null>(initial.albumTotal);
  const [albumsReady, setAlbumsReady] = useState(initial.albumsReady);
  const [albumsLoading, setAlbumsLoading] = useState(
    activeView === 'albums' && !initial.albumsReady,
  );
  const [albumsLoadingMore, setAlbumsLoadingMore] = useState(false);
  const [albumError, setAlbumError] = useState<string | null>(null);

  const [songs, setSongs] = useState(initial.songs);
  const [trackHasMore, setTrackHasMore] = useState(initial.trackHasMore);
  const [trackTotal, setTrackTotal] = useState<number | null>(initial.trackTotal);
  const [tracksReady, setTracksReady] = useState(initial.tracksReady);
  const [tracksLoading, setTracksLoading] = useState(
    activeView === 'tracks' && !initial.tracksReady,
  );
  const [tracksLoadingMore, setTracksLoadingMore] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  const keyRef = useRef(key);
  const generationRef = useRef(0);
  const albumsLoadingMoreRef = useRef(false);
  const tracksLoadingMoreRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const keyChanged = keyRef.current !== key;

    if (keyChanged) {
      keyRef.current = key;
      generationRef.current += 1;
      const cached = readCache(key) ?? emptyCache();

      setAlbums(cached.albums);
      setAlbumHasMore(cached.albumHasMore);
      setAlbumTotal(cached.albumTotal);
      setAlbumsReady(cached.albumsReady);
      setAlbumsLoading(false);
      setAlbumsLoadingMore(false);
      albumsLoadingMoreRef.current = false;
      setAlbumError(null);

      setSongs(cached.songs);
      setTrackHasMore(cached.trackHasMore);
      setTrackTotal(cached.trackTotal);
      setTracksReady(cached.tracksReady);
      setTracksLoading(false);
      setTracksLoadingMore(false);
      tracksLoadingMoreRef.current = false;
      setTrackError(null);
    }

    if (!serverId || tags.length < 2) {
      // An invalid query must clear stale loading state immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAlbumsLoading(false);
      setTracksLoading(false);
      return;
    }

    const generation = generationRef.current;
    const cached = readCache(key) ?? emptyCache();

    if (activeView === 'albums') {
      setTracksLoading(false);
      if (cached.albumsReady) {
        setAlbums(cached.albums);
        setAlbumHasMore(cached.albumHasMore);
        setAlbumTotal(cached.albumTotal);
        setAlbumsReady(true);
        setAlbumsLoading(false);
        setAlbumError(null);
        return;
      }

      setAlbumsLoading(true);
      setAlbumError(null);

      void (async () => {
        if (!(await waitForReady(browseScope, serverId))) {
          throw new Error('library index is not ready');
        }
        const response = await libraryTagExplorerAlbums({
          serverId,
          libraryScopes: browseScope.pairs,
          tags: [...tags],
          mode,
          limit: TAG_EXPLORER_ALBUM_PAGE_SIZE,
          offset: 0,
          includeTotal: true,
        });
        if (cancelled || generation !== generationRef.current) return;

        const nextAlbums = response.albums.map(albumToAlbum);
        setAlbums(nextAlbums);
        setAlbumHasMore(response.hasMore);
        setAlbumTotal(response.total ?? null);
        setAlbumsReady(true);
        patchCache(key, {
          albums: nextAlbums,
          albumHasMore: response.hasMore,
          albumTotal: response.total ?? null,
          albumsReady: true,
        });
      })().catch(error => {
        if (!cancelled && generation === generationRef.current) {
          setAlbumError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }).finally(() => {
        if (!cancelled && generation === generationRef.current) {
          setAlbumsLoading(false);
        }
      });
    } else {
      setAlbumsLoading(false);
      if (cached.tracksReady) {
        setSongs(cached.songs);
        setTrackHasMore(cached.trackHasMore);
        setTrackTotal(cached.trackTotal);
        setTracksReady(true);
        setTracksLoading(false);
        setTrackError(null);
        return;
      }

      setTracksLoading(true);
      setTrackError(null);

      void (async () => {
        if (!(await waitForReady(browseScope, serverId))) {
          throw new Error('library index is not ready');
        }
        const response = await libraryTagExplorerTracks({
          serverId,
          libraryScopes: browseScope.pairs,
          tags: [...tags],
          mode,
          limit: TAG_EXPLORER_TRACK_PAGE_SIZE,
          offset: 0,
          includeTotal: true,
        });
        if (cancelled || generation !== generationRef.current) return;

        const nextSongs = response.tracks.map(trackToSong);
        setSongs(nextSongs);
        setTrackHasMore(response.hasMore);
        setTrackTotal(response.total ?? null);
        setTracksReady(true);
        patchCache(key, {
          songs: nextSongs,
          trackHasMore: response.hasMore,
          trackTotal: response.total ?? null,
          tracksReady: true,
        });
      })().catch(error => {
        if (!cancelled && generation === generationRef.current) {
          setTrackError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }).finally(() => {
        if (!cancelled && generation === generationRef.current) {
          setTracksLoading(false);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    browseScope,
    key,
    mode,
    serverId,
    tags,
  ]);

  const loadMoreAlbums = useCallback(() => {
    if (
      !albumsReady ||
      !albumHasMore ||
      albumsLoadingMoreRef.current ||
      !serverId
    ) return;

    const generation = generationRef.current;
    const offset = albums.length;
    albumsLoadingMoreRef.current = true;
    setAlbumsLoadingMore(true);

    void libraryTagExplorerAlbums({
      serverId,
      libraryScopes: browseScope.pairs,
      tags: [...tags],
      mode,
      limit: TAG_EXPLORER_ALBUM_PAGE_SIZE,
      offset,
      includeTotal: false,
    }).then(response => {
      if (generation !== generationRef.current) return;
      setAlbums(previous => {
        const merged = dedupeOwned([
          ...previous,
          ...response.albums.map(albumToAlbum),
        ]);
        patchCache(key, {
          albums: merged,
          albumHasMore: response.hasMore,
        });
        return merged;
      });
      setAlbumHasMore(response.hasMore);
    }).catch(error => {
      if (generation === generationRef.current) {
        setAlbumError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }).finally(() => {
      if (generation === generationRef.current) {
        albumsLoadingMoreRef.current = false;
        setAlbumsLoadingMore(false);
      }
    });
  }, [
    albumHasMore,
    albums.length,
    albumsReady,
    browseScope,
    key,
    mode,
    serverId,
    tags,
  ]);

  const loadMoreTracks = useCallback(() => {
    if (
      !tracksReady ||
      !trackHasMore ||
      tracksLoadingMoreRef.current ||
      !serverId
    ) return;

    const generation = generationRef.current;
    const offset = songs.length;
    tracksLoadingMoreRef.current = true;
    setTracksLoadingMore(true);

    void libraryTagExplorerTracks({
      serverId,
      libraryScopes: browseScope.pairs,
      tags: [...tags],
      mode,
      limit: TAG_EXPLORER_TRACK_PAGE_SIZE,
      offset,
      includeTotal: false,
    }).then(response => {
      if (generation !== generationRef.current) return;
      setSongs(previous => {
        const merged = dedupeOwned([
          ...previous,
          ...response.tracks.map(trackToSong),
        ]);
        patchCache(key, {
          songs: merged,
          trackHasMore: response.hasMore,
        });
        return merged;
      });
      setTrackHasMore(response.hasMore);
    }).catch(error => {
      if (generation === generationRef.current) {
        setTrackError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }).finally(() => {
      if (generation === generationRef.current) {
        tracksLoadingMoreRef.current = false;
        setTracksLoadingMore(false);
      }
    });
  }, [
    browseScope,
    key,
    mode,
    serverId,
    songs.length,
    tags,
    trackHasMore,
    tracksReady,
  ]);

  return {
    albums,
    albumHasMore,
    albumTotal,
    albumsReady,
    albumsLoading,
    albumsLoadingMore,
    albumError,
    loadMoreAlbums,
    songs,
    trackHasMore,
    trackTotal,
    tracksReady,
    tracksLoading,
    tracksLoadingMore,
    trackError,
    loadMoreTracks,
  };
}
