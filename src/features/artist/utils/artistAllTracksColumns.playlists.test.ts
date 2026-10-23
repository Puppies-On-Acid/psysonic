import { describe, expect, it } from 'vitest';
import {
  ARTIST_ALL_TRACKS_COLUMNS,
  ARTIST_ALL_TRACKS_SORTABLE,
} from './artistAllTracksColumns';

describe('Artist All Tracks playlist column', () => {
  it('is optional, default-hidden, and not sortable', () => {
    const playlists = ARTIST_ALL_TRACKS_COLUMNS.find(column => column.key === 'playlists');

    expect(playlists).toEqual(expect.objectContaining({
      key: 'playlists',
      i18nKey: 'trackPlaylists',
      required: false,
      defaultHidden: true,
    }));
    expect(ARTIST_ALL_TRACKS_SORTABLE.has('playlists')).toBe(false);
  });
});
