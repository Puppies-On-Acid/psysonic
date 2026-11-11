import type { TagAuditAlbum } from '@/lib/api/library';

export type TagAuditFilter =
  | 'all' | 'genreMissing' | 'genrePartial'
  | 'moodMissing' | 'moodPartial' | 'both';
export type TagAuditSort = 'album' | 'artist' | 'genreMissingTracks' | 'moodMissingTracks';

export function filterAndSortAuditAlbums(
  albums: readonly TagAuditAlbum[],
  filter: TagAuditFilter,
  search: string,
  sort: TagAuditSort,
): TagAuditAlbum[] {
  const query = search.trim().toLocaleLowerCase();
  const matching = albums.filter(album => {
    const selected = (() => {
      switch (filter) {
        case 'genreMissing': return album.genreStatus === 'missing';
        case 'genrePartial': return album.genreStatus === 'partial';
        case 'moodMissing': return album.moodStatus === 'missing';
        case 'moodPartial': return album.moodStatus === 'partial';
        case 'both':
          return album.genreStatus !== 'complete' && album.moodStatus !== 'complete';
        default: return true;
      }
    })();
    return selected && (!query || [album.name, album.artist ?? '', album.serverId, album.libraryId ?? '']
      .some(value => value.toLocaleLowerCase().includes(query)));
  });
  return matching.sort((a, b) => {
    if (sort === 'genreMissingTracks' || sort === 'moodMissingTracks') {
      const missing = (row: TagAuditAlbum) => row.trackCount
        - (sort === 'genreMissingTracks' ? row.genreTaggedTracks : row.moodTaggedTracks);
      const diff = missing(b) - missing(a);
      if (diff !== 0) return diff;
    }
    if (sort === 'artist') {
      const byArtist = (a.artist ?? '').localeCompare(b.artist ?? '', undefined, { sensitivity: 'base' });
      if (byArtist !== 0) return byArtist;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      || a.serverId.localeCompare(b.serverId)
      || a.albumId.localeCompare(b.albumId);
  });
}

/** Quote every field, and protect exported metadata from CSV formula injection. */
function csvCell(value: string | number | boolean | null): string {
  let text = String(value ?? '');
  if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function auditAlbumsCsv(albums: readonly TagAuditAlbum[]): string {
  const header = [
    'Server ID', 'Library ID', 'Album ID', 'Album', 'Artist',
    'Tracks', 'Genre-tagged tracks', 'Mood-tagged tracks',
    'Album-level genre', 'Genre status', 'Mood status',
  ];
  const rows: Array<Array<string | number | boolean | null>> = albums.map(album => [
    album.serverId, album.libraryId, album.albumId, album.name, album.artist,
    album.trackCount, album.genreTaggedTracks, album.moodTaggedTracks,
    album.albumGenreTagged, album.genreStatus, album.moodStatus,
  ]);
  return '\uFEFF' + [header, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n') + '\r\n';
}
