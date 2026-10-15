import { describe, expect, it } from 'vitest';
import type { SubsonicAlbum, SubsonicArtist, SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import {
  benchmarkRouteMatchesLocation,
  buildTagExplorerBenchmarkRoutes,
  benchmarkSearchQueryFromCandidates,
  benchmarkStaticRoutesForScenario,
  buildDynamicBenchmarkRoutes,
} from './benchmarkRoutes';

describe('benchmark routes', () => {
  it('includes every distinct static page in all-pages', () => {
    expect(benchmarkStaticRoutesForScenario('all-pages')).toEqual(expect.arrayContaining([
      '/random',
      '/random/albums',
      '/random/mix',
      '/search',
      '/search/advanced',
      '/player-stats',
      '/genres',
      '/now-playing',
      '/device-sync',
      '/shared',
      '/moods',
    ]));
  });

  it('builds 2/5/10-tag Explorer routes from real catalog rows', () => {
    const genres = Array.from({ length: 6 }, (_, index) => ({
      value: `Genre ${index + 1}`,
      albumCount: 10 - index,
      songCount: 100 - index,
    }));
    const moods = Array.from({ length: 6 }, (_, index) => ({
      value: `Mood ${index + 1}`,
      albumCount: 8 - index,
      songCount: 80 - index,
    }));

    const result = buildTagExplorerBenchmarkRoutes(
      genres,
      moods,
    );

    expect(result.skippedRoutes).toEqual([]);
    expect(result.routes).toHaveLength(3);

    const sizes = result.routes.map(route => {
      const url = new URL(route, 'http://localhost');
      expect(url.pathname).toBe('/genres/explore/results');
      return {
        size: url.searchParams.getAll('tag').length,
        marker: url.searchParams.get('benchmarkTags'),
      };
    });

    expect(sizes).toEqual([
      { size: 2, marker: '2' },
      { size: 5, marker: '5' },
      { size: 10, marker: '10' },
    ]);
  });

  it('reports unavailable Explorer benchmark sizes as skipped', () => {
    const result = buildTagExplorerBenchmarkRoutes(
      [{
        value: 'Rock',
        albumCount: 1,
        songCount: 1,
      }],
      [{
        value: 'Dreamy',
        albumCount: 1,
        songCount: 1,
      }],
    );

    expect(result.routes).toHaveLength(1);
    expect(
      new URL(result.routes[0], 'http://localhost')
        .searchParams.getAll('tag'),
    ).toHaveLength(2);
    expect(result.skippedRoutes).toHaveLength(2);
  });

  it('deduplicates case-equivalent catalog values by tag kind', () => {
    const result = buildTagExplorerBenchmarkRoutes(
      [
        { value: 'Rock', albumCount: 2, songCount: 4 },
        { value: ' rock ', albumCount: 3, songCount: 5 },
      ],
      [
        { value: 'Rock', albumCount: 1, songCount: 2 },
      ],
    );

    const tags = new URL(
      result.routes[0],
      'http://localhost',
    ).searchParams.getAll('tag');

    expect(tags).toEqual(
      expect.arrayContaining(['genre:Rock', 'mood:Rock']),
    );
    expect(tags).toHaveLength(2);
  });

  it('builds owner-qualified detail routes and encodes names', () => {
    const albums = [{
      id: 'album-1',
      serverId: 'srv-1',
      name: 'Album',
      artist: 'Artist',
      songCount: 1,
      duration: 1,
      recordLabel: 'A & B',
      genre: 'Rock & Roll',
    }] as SubsonicAlbum[];
    const artists = [{ id: 'artist-1', serverId: 'srv-1', name: 'Artist' }] as SubsonicArtist[];
    const composers = [{ id: 'composer-1', serverId: 'srv-1', name: 'Composer' }] as SubsonicArtist[];
    const playlists = [{ id: 'playlist-1', serverId: 'srv-1', name: 'Playlist' }] as SubsonicPlaylist[];

    const result = buildDynamicBenchmarkRoutes({
      albums,
      artists,
      composers,
      playlists,
      activeServerId: 'srv-1',
      configuredServerIds: new Set(['srv-1']),
      networkAllowedServerIds: new Set(['srv-1']),
    });

    expect(result.skippedRoutes).toEqual([]);
    expect(result.routes).toEqual([
      '/album/album-1?server=srv-1',
      '/artist/artist-1?server=srv-1',
      '/composer/composer-1?server=srv-1',
      '/label/A%20%26%20B?server=srv-1',
      '/genres/Rock%20%26%20Roll',
      '/playlists/playlist-1?server=srv-1',
    ]);
  });

  it('reports dynamic pages that cannot be resolved safely', () => {
    const result = buildDynamicBenchmarkRoutes({
      albums: [],
      artists: [],
      composers: [],
      playlists: [],
      activeServerId: null,
      configuredServerIds: new Set(),
      networkAllowedServerIds: new Set(),
    });

    expect(result.routes).toEqual([]);
    expect(result.skippedRoutes.map(row => row.route)).toEqual([
      '/album/:id',
      '/artist/:id',
      '/composer/:id',
      '/label/:name',
      '/genres/:name',
      '/playlists/:id',
    ]);
  });

  it('matches owner-qualified routes against the full browser location', () => {
    const location = {
      origin: 'http://localhost:1420',
      pathname: '/album/album-1',
      search: '?server=srv-1',
      hash: '',
    };
    expect(benchmarkRouteMatchesLocation('/album/album-1?server=srv-1', location)).toBe(true);
    expect(benchmarkRouteMatchesLocation('/album/album-1?server=srv-2', location)).toBe(false);
  });

  it('uses a real indexed artist or album name for search interactions', () => {
    expect(benchmarkSearchQueryFromCandidates(
      [{ name: '  Real Artist  ' }],
      [{ name: 'Real Album' }],
    )).toBe('Real Artist');
    expect(benchmarkSearchQueryFromCandidates([], [{ name: '  Real Album  ' }])).toBe('Real Album');
    expect(benchmarkSearchQueryFromCandidates([{ name: '   ' }], [])).toBeNull();
  });
});
