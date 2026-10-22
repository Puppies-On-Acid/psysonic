import type { SubsonicAlbum, SubsonicArtist, SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import {
  libraryGetGenreAlbumCounts,
  libraryGetMoodAlbumCounts,
  type GenreAlbumCountRow,
  type MoodAlbumCountRow,
} from '@/lib/api/library';
import {
  libraryScopeListAlbums,
  libraryScopeListArtists,
  libraryScopeListComposers,
  type LibraryScopePair,
} from '@/lib/api/library/scopeReads';
import { libraryScopePairsForServer } from '@/lib/api/subsonicClient';
import { albumToAlbum, artistToArtist } from '@/lib/library/advancedSearchLocal';
import { filterArtistsWithRoleAlbumCredits } from '@/lib/library/composerBrowse';
import {
  browseScopeLibraryIdsForServer,
  deriveLibraryBrowseScope,
  type LibraryBrowseScope,
} from '@/lib/library/libraryBrowseScope';
import {
  buildAlbumDetailPath,
  buildArtistDetailPath,
  buildComposerDetailPath,
} from '@/lib/navigation/detailServerScope';
import { shouldAttemptSubsonicForServer } from '@/lib/network/subsonicNetworkGuard';
import { useAuthStore } from '@/store/authStore';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import { playlistDetailPath } from '@/features/playlist/utils/playlistServer';
import type { BenchmarkSkippedRoute } from '@/lib/perf/benchmark';

const CORE_ROUTES = ['/', '/albums', '/artists', '/tracks', '/favorites'] as const;

const ALL_STATIC_ROUTES = [
  '/', '/albums', '/artists', '/composers', '/tracks', '/favorites',
  '/new-releases', '/genres', '/moods', '/playlists', '/most-played',
  '/lossless-albums', '/folders', '/statistics', '/player-stats', '/help',
  '/settings', '/whats-new', '/offline', '/radio', '/random',
  '/random/albums', '/random/mix', '/search', '/search/advanced',
  '/now-playing', '/device-sync', '/shared',
] as const;

const TAG_EXPLORER_BENCHMARK_SIZES = [2, 5, 10] as const;

const DYNAMIC_ROUTE_TEMPLATES = [
  '/album/:id',
  '/artist/:id',
  '/composer/:id',
  '/label/:name',
  '/genres/:name',
  '/playlists/:id',
] as const;

interface BenchmarkTagCandidate {
  kind: 'genre' | 'mood';
  value: string;
  weight: number;
}

export function buildTagExplorerBenchmarkRoutes(
  genreRows: readonly GenreAlbumCountRow[],
  moodRows: readonly MoodAlbumCountRow[],
): Pick<BenchmarkRouteResolution, 'routes' | 'skippedRoutes'> {
  const byKey = new Map<string, BenchmarkTagCandidate>();
  const add = (
    kind: BenchmarkTagCandidate['kind'],
    rows: readonly (GenreAlbumCountRow | MoodAlbumCountRow)[],
  ) => {
    for (const row of rows) {
      const value = row.value.trim();
      if (!value) continue;
      const key = `${kind}:\u001f${value.toLocaleLowerCase()}`;
      const weight = Math.max(
        Number(row.songCount) || 0,
        Number(row.albumCount) || 0,
      );
      const previous = byKey.get(key);
      if (previous) {
        previous.weight += weight;
      } else {
        byKey.set(key, { kind, value, weight });
      }
    }
  };

  add('genre', genreRows);
  add('mood', moodRows);

  const genres = [...byKey.values()]
    .filter(row => row.kind === 'genre')
    .sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));
  const moods = [...byKey.values()]
    .filter(row => row.kind === 'mood')
    .sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));

  const ordered: BenchmarkTagCandidate[] = [];
  let genreIndex = 0;
  let moodIndex = 0;
  while (genreIndex < genres.length || moodIndex < moods.length) {
    if (genreIndex < genres.length) ordered.push(genres[genreIndex++]);
    if (moodIndex < moods.length) ordered.push(moods[moodIndex++]);
  }

  const routes: string[] = [];
  const skippedRoutes: BenchmarkSkippedRoute[] = [];

  for (const size of TAG_EXPLORER_BENCHMARK_SIZES) {
    if (ordered.length < size) {
      skippedRoutes.push({
        route: `/genres/explore/results (: ${size} tags)`,
        reason: `only ${ordered.length} distinct indexed genre/mood tags available`,
      });
      continue;
    }

    const params = new URLSearchParams();
    for (const tag of ordered.slice(0, size)) {
      params.append('tag', `${tag.kind}:${tag.value}`);
    }
    params.set('benchmarkTags', String(size));
    routes.push(
      `/genres/explore/results?${params.toString()}`,
    );
  }

  return { routes, skippedRoutes };
}

async function resolveTagExplorerBenchmarkCatalog(
  scope: LibraryBrowseScope,
): Promise<{
  genres: GenreAlbumCountRow[];
  moods: MoodAlbumCountRow[];
}> {
  const genres: GenreAlbumCountRow[] = [];
  const moods: MoodAlbumCountRow[] = [];

  await Promise.all(scope.serverIds.map(async serverId => {
    const libraryIds = browseScopeLibraryIdsForServer(
      scope.pairs,
      serverId,
    );
    const scoped = libraryIds.length > 0
      ? { libraryScopes: libraryIds }
      : {};

    const [serverGenres, serverMoods] = await Promise.all([
      libraryGetGenreAlbumCounts({
        serverId,
        ...scoped,
      }).catch(() => [] as GenreAlbumCountRow[]),
      libraryGetMoodAlbumCounts({
        serverId,
        ...scoped,
      }).catch(() => [] as MoodAlbumCountRow[]),
    ]);

    genres.push(...serverGenres);
    moods.push(...serverMoods);
  }));

  return { genres, moods };
}

interface DynamicRouteCandidates {
  albums: SubsonicAlbum[];
  artists: SubsonicArtist[];
  composers: SubsonicArtist[];
  playlists: SubsonicPlaylist[];
  activeServerId: string | null;
  configuredServerIds: ReadonlySet<string>;
  networkAllowedServerIds: ReadonlySet<string>;
}

export interface BenchmarkRouteResolution {
  routes: string[];
  skippedRoutes: BenchmarkSkippedRoute[];
  searchQuery: string | null;
}

function ownedEntity<T extends { serverId?: string }>(
  rows: readonly T[],
  configuredServerIds: ReadonlySet<string>,
): T | undefined {
  return rows.find(row => !!row.serverId && configuredServerIds.has(row.serverId));
}

export function buildDynamicBenchmarkRoutes(
  candidates: DynamicRouteCandidates,
): BenchmarkRouteResolution {
  const routes: string[] = [];
  const skippedRoutes: BenchmarkSkippedRoute[] = [];
  const add = (template: typeof DYNAMIC_ROUTE_TEMPLATES[number], route: string | null, reason: string) => {
    if (route) routes.push(route);
    else skippedRoutes.push({ route: template, reason });
  };

  const album = ownedEntity(candidates.albums, candidates.configuredServerIds);
  add(
    '/album/:id',
    album ? buildAlbumDetailPath(album.id, { serverId: album.serverId }) : null,
    'no owned indexed album available',
  );

  const artist = ownedEntity(candidates.artists, candidates.configuredServerIds);
  add(
    '/artist/:id',
    artist ? buildArtistDetailPath(artist.id, { serverId: artist.serverId }) : null,
    'no owned indexed artist available',
  );

  const composer = ownedEntity(candidates.composers, candidates.configuredServerIds);
  add(
    '/composer/:id',
    composer ? buildComposerDetailPath(composer.id, { serverId: composer.serverId }) : null,
    'no owned indexed composer available',
  );

  const labelAlbum = candidates.albums.find(candidate => (
    !!candidate.serverId
      && candidates.configuredServerIds.has(candidate.serverId)
      && !!candidate.recordLabel?.trim()
      && candidates.networkAllowedServerIds.has(candidate.serverId)
  ));
  add(
    '/label/:name',
    labelAlbum
      ? `/label/${encodeURIComponent(labelAlbum.recordLabel!.trim())}?server=${encodeURIComponent(labelAlbum.serverId!)}`
      : null,
    'no reachable owned album with a record label available',
  );

  const genreAlbum = candidates.albums.find(candidate => (
    candidate.serverId === candidates.activeServerId && !!candidate.genre?.trim()
  ));
  add(
    '/genres/:name',
    genreAlbum ? `/genres/${encodeURIComponent(genreAlbum.genre!.trim())}` : null,
    'no indexed genre available for the active server',
  );

  const playlist = ownedEntity(candidates.playlists, candidates.configuredServerIds);
  add(
    '/playlists/:id',
    playlist ? playlistDetailPath(playlist) : null,
    'no owned playlist available',
  );

  return {
    routes,
    skippedRoutes,
    searchQuery: benchmarkSearchQueryFromCandidates(candidates.artists, candidates.albums),
  };
}

export function benchmarkSearchQueryFromCandidates(
  artists: readonly Pick<SubsonicArtist, 'name'>[],
  albums: readonly Pick<SubsonicAlbum, 'name'>[],
): string | null {
  const candidate = [...artists, ...albums]
    .map(row => row.name.trim())
    .find(name => name.length > 0);
  return candidate ?? null;
}

async function resolveScopeRows<T>(
  anchorServerId: string,
  scopes: LibraryScopePair[],
  limit: number,
  load: (serverId: string, request: { scopes: LibraryScopePair[]; sort: string; limit: number }) => Promise<T[]>,
): Promise<T[]> {
  try {
    return await load(anchorServerId, { scopes, sort: 'name', limit });
  } catch {
    return [];
  }
}

export async function resolveBenchmarkRoutes(scenario: string): Promise<BenchmarkRouteResolution> {
  const staticRoutes = benchmarkStaticRoutesForScenario(scenario);
  const auth = useAuthStore.getState();
  const scope = deriveLibraryBrowseScope(auth, new Set());
  const anchorServerId = scope.anchorServerId;
  if (!anchorServerId) {
    return {
      routes: staticRoutes,
      skippedRoutes: scenario === 'all-pages'
        ? DYNAMIC_ROUTE_TEMPLATES.map(route => ({
            route,
            reason: 'no active library scope available',
          }))
        : [],
      searchQuery: null,
    };
  }

  const scopes = scope.pairs.length > 0 ? scope.pairs : libraryScopePairsForServer(anchorServerId);
  const rowLimit = scenario === 'all-pages' ? 200 : 20;
  const [albumRows, artistRows, composerRows] = await Promise.all([
    resolveScopeRows(anchorServerId, scopes, rowLimit, libraryScopeListAlbums),
    resolveScopeRows(anchorServerId, scopes, rowLimit, libraryScopeListArtists),
    scenario === 'all-pages'
      ? resolveScopeRows(anchorServerId, scopes, rowLimit, libraryScopeListComposers)
      : Promise.resolve([]),
  ]);
  const searchQuery = benchmarkSearchQueryFromCandidates(
    artistRows.map(artistToArtist),
    albumRows.map(albumToAlbum),
  );
  if (scenario !== 'all-pages') {
    return { routes: staticRoutes, skippedRoutes: [], searchQuery };
  }

  let playlists = usePlaylistStore.getState().playlists;
  if (!ownedEntity(playlists, new Set(auth.servers.map(server => server.id)))) {
    await usePlaylistStore.getState().fetchPlaylists();
    playlists = usePlaylistStore.getState().playlists;
  }

  const explorerCatalog = await resolveTagExplorerBenchmarkCatalog(scope);
  const explorer = buildTagExplorerBenchmarkRoutes(
    explorerCatalog.genres,
    explorerCatalog.moods,
  );

  const dynamic = buildDynamicBenchmarkRoutes({
    albums: albumRows.map(albumToAlbum),
    artists: artistRows.map(artistToArtist),
    composers: filterArtistsWithRoleAlbumCredits(composerRows.map(artistToArtist)),
    playlists,
    activeServerId: auth.activeServerId,
    configuredServerIds: new Set(auth.servers.map(server => server.id)),
    networkAllowedServerIds: new Set(
      auth.servers.filter(server => shouldAttemptSubsonicForServer(server.id)).map(server => server.id),
    ),
  });

  return {
    routes: [
      ...staticRoutes,
      ...dynamic.routes,
      ...explorer.routes,
    ],
    skippedRoutes: [
      ...dynamic.skippedRoutes,
      ...explorer.skippedRoutes,
    ],
    searchQuery,
  };
}

export function benchmarkStaticRoutesForScenario(scenario: string): string[] {
  return scenario === 'all-pages' ? [...ALL_STATIC_ROUTES] : [...CORE_ROUTES];
}

export function benchmarkRouteMatchesLocation(
  route: string,
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>,
): boolean {
  const target = new URL(route, location.origin);
  return location.pathname === target.pathname
    && location.search === target.search
    && location.hash === target.hash;
}
