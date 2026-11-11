import { describe, expect, it } from 'vitest';
import type { TagAuditAlbum } from '@/lib/api/library';
import { auditAlbumsCsv, filterAndSortAuditAlbums } from './tagAuditPresentation';

const create = (overrides: Partial<TagAuditAlbum>): TagAuditAlbum => ({
  serverId: 's1', libraryId: 'l1', albumId: 'a', name: 'Album', artist: 'Artist',
  trackCount: 3, genreTaggedTracks: 0, moodTaggedTracks: 0,
  albumGenreTagged: false, genreStatus: 'missing', moodStatus: 'missing',
  ...overrides,
});

describe('Library Tag Audit result presentation', () => {
  const albums = [
    create({ albumId: 'a', name: 'Missing both' }),
    create({ albumId: 'b', name: 'Partial genre', genreStatus: 'partial', genreTaggedTracks: 2, moodStatus: 'complete', moodTaggedTracks: 3 }),
    create({ albumId: 'c', name: 'Partial mood', genreStatus: 'complete', genreTaggedTracks: 3, moodStatus: 'partial', moodTaggedTracks: 1 }),
  ];

  it('separately filters fully and partially missing genre and mood coverage', () => {
    expect(filterAndSortAuditAlbums(albums, 'genreMissing', '', 'album').map(a => a.albumId)).toEqual(['a']);
    expect(filterAndSortAuditAlbums(albums, 'genrePartial', '', 'album').map(a => a.albumId)).toEqual(['b']);
    expect(filterAndSortAuditAlbums(albums, 'moodPartial', '', 'album').map(a => a.albumId)).toEqual(['c']);
    expect(filterAndSortAuditAlbums(albums, 'both', '', 'album').map(a => a.albumId)).toEqual(['a']);
  });

  it('searches and sorts by missing track count without mutating a snapshot', () => {
    const initial = [...albums];
    expect(filterAndSortAuditAlbums(albums, 'all', 'partial', 'album').map(a => a.albumId)).toEqual(['b', 'c']);
    expect(filterAndSortAuditAlbums(albums, 'all', '', 'moodMissingTracks').map(a => a.albumId)).toEqual(['a', 'c', 'b']);
    expect(albums).toEqual(initial);
  });

  it('exports quoted UTF-8 CSV, safely escaping formulas and embedded fields', () => {
    const csv = auditAlbumsCsv([
      create({ name: '=IMPORTDATA("host")', artist: 'Artist, "Quoted"', libraryId: null }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=IMPORTDATA(""host"")"');
    expect(csv).toContain('"Artist, ""Quoted"""');
    expect(csv).toContain('"missing"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
