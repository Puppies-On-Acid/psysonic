import { describe, expect, it } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { moodTagsFor, moodsLabel } from './playlistDetailHelpers';

describe('file mood name normalization', () => {
  it('preserves tag order and spelling while trimming and removing case-insensitive duplicates', () => {
    const song = { moods: [' Atmospheric ', 'Melancholic', 'atmospheric', '', '  ', 'Dreamy'] };
    expect(moodTagsFor(song)).toEqual(['Atmospheric', 'Melancholic', 'Dreamy']);
    expect(moodsLabel(song as SubsonicSong)).toBe('Atmospheric · Melancholic · Dreamy');
  });

  it('ignores malformed, absent, and empty mood values without generating links', () => {
    expect(moodTagsFor({ moods: undefined })).toEqual([]);
    expect(moodTagsFor({ moods: [] })).toEqual([]);
    expect(moodTagsFor({ moods: 'not-an-array' as unknown as string[] })).toEqual([]);
    expect(moodTagsFor({ moods: [null, 12, '  '] as unknown as string[] })).toEqual([]);
  });
});
