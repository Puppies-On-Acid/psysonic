import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import {
  fetchGenreTrackPage,
  GENRE_TRACK_PAGE_SIZE,
} from '@/lib/library/genreTrackBrowse';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useLibraryScopeSyncRevision } from '@/store/offlineLocalLibrarySyncRevision';

type GenreTrackBrowseCacheEntry = {
  songs: SubsonicSong[];
  hasMore: boolean;
  total: number | null;
};

const GENRE_TRACK_BROWSE_CACHE_MAX = 2;
const genreTrackBrowseCache = new Map<string, GenreTrackBrowseCacheEntry>();

function genreTrackBrowseCacheKey(
  serverId: string,
  genre: string,
  indexEnabled: boolean,
  musicLibraryFilterVersion: number,
  librarySyncRevision: number,
  browseScope: LibraryBrowseScope,
): string {
  return JSON.stringify([
    serverId,
    genre.trim().toLowerCase(),
    indexEnabled,
    musicLibraryFilterVersion,
    librarySyncRevision,
    browseScope.fingerprint,
  ]);
}

function peekGenreTrackBrowseCache(
  key: string,
): GenreTrackBrowseCacheEntry | null {
  return genreTrackBrowseCache.get(key) ?? null;
}

function readGenreTrackBrowseCache(
  key: string,
): GenreTrackBrowseCacheEntry | null {
  const cached = genreTrackBrowseCache.get(key);
  if (!cached) return null;
  genreTrackBrowseCache.delete(key);
  genreTrackBrowseCache.set(key, cached);
  return cached;
}

function writeGenreTrackBrowseCache(
  key: string,
  entry: GenreTrackBrowseCacheEntry,
): void {
  genreTrackBrowseCache.delete(key);
  genreTrackBrowseCache.set(key, entry);

  while (genreTrackBrowseCache.size > GENRE_TRACK_BROWSE_CACHE_MAX) {
    const oldestKey = genreTrackBrowseCache.keys().next().value;
    if (oldestKey == null) break;
    genreTrackBrowseCache.delete(oldestKey);
  }
}

export function useGenreTrackBrowse(
  serverId: string,
  genre: string,
  indexEnabled: boolean,
  enabled: boolean,
  musicLibraryFilterVersion: number,
  browseScope: LibraryBrowseScope,
) {
  const syncServerIds = browseScope.serverIds.length > 0
    ? browseScope.serverIds
    : serverId
      ? [serverId]
      : [];
  const librarySyncRevision = useLibraryScopeSyncRevision(syncServerIds);
  const cacheKey = genreTrackBrowseCacheKey(
    serverId,
    genre,
    indexEnabled,
    musicLibraryFilterVersion,
    librarySyncRevision,
    browseScope,
  );
  const cachedForKey = peekGenreTrackBrowseCache(cacheKey);
  const initialCached = enabled ? cachedForKey : null;

  const [songs, setSongs] = useState<SubsonicSong[]>(
    () => initialCached?.songs ?? [],
  );
  const [total, setTotal] = useState<number | null>(
    () => cachedForKey?.total ?? null,
  );
  const [loading, setLoading] = useState(
    () =>
      enabled &&
      !!serverId &&
      !!genre.trim() &&
      indexEnabled &&
      !initialCached,
  );
  const [sessionReady, setSessionReady] = useState(
    () => initialCached !== null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(
    () => initialCached?.hasMore ?? false,
  );

  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!serverId || !genre.trim() || !indexEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSongs([]);
      setHasMore(false);
      setTotal(peekGenreTrackBrowseCache(cacheKey)?.total ?? null);
      setLoading(false);
      setSessionReady(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    if (!enabled) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    const cached = readGenreTrackBrowseCache(cacheKey);

    if (cached) {
      setSongs(cached.songs);
      setHasMore(cached.hasMore);
      setTotal(cached.total);
      setLoading(false);
      setSessionReady(true);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return () => {
        generationRef.current += 1;
      };
    }

    setSongs([]);
    setHasMore(false);
    setTotal(null);
    setLoading(true);
    setSessionReady(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;

    void fetchGenreTrackPage(
      serverId,
      genre,
      indexEnabled,
      0,
      GENRE_TRACK_PAGE_SIZE,
      browseScope,
      true,
    ).then(page => {
      if (generation !== generationRef.current || !page) return;
      setSongs(page.songs);
      setHasMore(page.hasMore);
      setTotal(page.total);
      setSessionReady(true);
      writeGenreTrackBrowseCache(cacheKey, {
        songs: page.songs,
        hasMore: page.hasMore,
        total: page.total,
      });
    }).finally(() => {
      if (generation === generationRef.current) {
        setLoading(false);
      }
    });

    return () => {
      generationRef.current += 1;
    };
  }, [
    serverId,
    genre,
    indexEnabled,
    enabled,
    musicLibraryFilterVersion,
    librarySyncRevision,
    browseScope,
    cacheKey,
  ]);

  const loadMore = useCallback(() => {
    if (
      !enabled ||
      loadingMoreRef.current ||
      !hasMore ||
      !serverId ||
      !genre.trim()
    ) {
      return;
    }

    const generation = generationRef.current;
    const offset = songs.length;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    void fetchGenreTrackPage(
      serverId,
      genre,
      indexEnabled,
      offset,
      GENRE_TRACK_PAGE_SIZE,
      browseScope,
      false,
    ).then(page => {
      if (generation !== generationRef.current || !page) return;
      setSongs(previous => {
        const merged = [...previous, ...page.songs];
        const seen = new Set<string>();
        const deduped = merged.filter(song => {
          const key = ownedEntityKey(song);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        writeGenreTrackBrowseCache(cacheKey, {
          songs: deduped,
          hasMore: page.hasMore,
          total,
        });

        return deduped;
      });
      setHasMore(page.hasMore);
    }).finally(() => {
      if (generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    });
  }, [
    enabled,
    hasMore,
    serverId,
    genre,
    songs.length,
    indexEnabled,
    browseScope,
    cacheKey,
    total,
  ]);

  return {
    songs,
    total,
    loading,
    sessionReady,
    loadingMore,
    hasMore,
    loadMore,
  };
}
