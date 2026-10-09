import { libraryListTracksByGenre } from '@/lib/api/library';
import {
  libraryScopeForServer,
  libraryScopePairsForServer,
} from '@/lib/api/subsonicClient';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { LibraryBrowseScope } from './libraryBrowseScope';
import { readyLibraryServerKeys } from './libraryReady';
import { trackToSong } from './trackDtoMapping';

export const GENRE_TRACK_PAGE_SIZE = 100;

export interface GenreTrackPageResult {
  songs: SubsonicSong[];
  hasMore: boolean;
  total: number | null;
}

const GENRE_TRACK_READINESS_RETRY_DELAY_MS = 250;
const GENRE_TRACK_READINESS_RETRY_LIMIT = 20;

const inflight = new Map<string, Promise<GenreTrackPageResult | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function waitForGenreTrackLibraryReady(
  serverIds: readonly string[],
): Promise<boolean> {
  if (await readyLibraryServerKeys(serverIds)) return true;

  for (
    let attempt = 0;
    attempt < GENRE_TRACK_READINESS_RETRY_LIMIT;
    attempt += 1
  ) {
    await sleep(GENRE_TRACK_READINESS_RETRY_DELAY_MS);
    if (await readyLibraryServerKeys(serverIds)) return true;
  }

  return false;
}

async function fetchLocalGenreTrackPage(
  serverId: string,
  genre: string,
  offset: number,
  pageSize: number,
  browseScope?: LibraryBrowseScope,
  includeTotal = false,
): Promise<GenreTrackPageResult | null> {
  const scope = browseScope
    ? undefined
    : libraryScopeForServer(serverId) ?? undefined;
  const libraryScopes = browseScope?.pairs.length
    ? browseScope.pairs
    : libraryScopePairsForServer(serverId);
  const serverIds = browseScope?.serverIds.length
    ? browseScope.serverIds
    : [serverId];

  if (!(await waitForGenreTrackLibraryReady(serverIds))) {
    return null;
  }

  const requestKey = JSON.stringify({
    serverId,
    genre,
    offset,
    pageSize,
    scope,
    libraryScopes,
    includeTotal,
  });
  const existing = inflight.get(requestKey);
  if (existing) return existing;

  const request = (async (): Promise<GenreTrackPageResult | null> => {
    try {
      const response = await libraryListTracksByGenre({
        serverId,
        genre,
        libraryScope: scope,
        libraryScopes,
        limit: pageSize,
        offset,
        includeTotal,
      });

      if (response.source !== 'local') return null;

      return {
        songs: response.tracks.map(trackToSong),
        hasMore: response.hasMore,
        total: response.total ?? null,
      };
    } catch {
      return null;
    }
  })();

  inflight.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (inflight.get(requestKey) === request) {
      inflight.delete(requestKey);
    }
  }
}

export async function fetchGenreTrackPage(
  serverId: string,
  genre: string,
  indexEnabled: boolean,
  offset: number,
  pageSize = GENRE_TRACK_PAGE_SIZE,
  browseScope?: LibraryBrowseScope,
  includeTotal = false,
): Promise<GenreTrackPageResult | null> {
  if (!serverId || !genre.trim() || !indexEnabled) {
    return null;
  }

  return fetchLocalGenreTrackPage(
    serverId,
    genre,
    offset,
    pageSize,
    browseScope,
    includeTotal,
  );
}
