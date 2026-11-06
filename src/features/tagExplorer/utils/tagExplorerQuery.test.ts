import { describe, expect, it } from 'vitest';

import {
  normalizeTagExplorerTags,
  parseTagExplorerSearch,
  serializeTagExplorerSearch,
  tagExplorerResultsPath,
} from './tagExplorerQuery';

describe('tagExplorerQuery', () => {
  it('round-trips mixed tags with spaces, punctuation, unicode, and colons', () => {
    const search = serializeTagExplorerSearch({
      tags: [
        { kind: 'genre', value: 'Progressive Rock' },
        { kind: 'mood', value: 'Dreamy / Nocturnal' },
        { kind: 'genre', value: '日本語: Rock' },
      ],
      mode: 'and',
      view: 'tracks',
    });

    expect(parseTagExplorerSearch(search)).toEqual({
      tags: [
        { kind: 'genre', value: 'Progressive Rock' },
        { kind: 'mood', value: 'Dreamy / Nocturnal' },
        { kind: 'genre', value: '日本語: Rock' },
      ],
      mode: 'and',
      view: 'tracks',
    });
  });

  it('deduplicates case-equivalent typed tags without merging different kinds', () => {
    expect(normalizeTagExplorerTags([
      { kind: 'genre', value: ' Rock ' },
      { kind: 'genre', value: 'rock' },
      { kind: 'mood', value: 'Rock' },
    ])).toEqual([
      { kind: 'genre', value: 'Rock' },
      { kind: 'mood', value: 'Rock' },
    ]);
  });

  it('defaults to OR and Albums and ignores malformed tag parameters', () => {
    expect(parseTagExplorerSearch(
      '?tag=genre%3ARock&tag=nope&tag=artist%3AFoo',
    )).toEqual({
      tags: [{ kind: 'genre', value: 'Rock' }],
      mode: 'or',
      view: 'albums',
    });
  });

  it('builds the approved origin-specific result route', () => {
    expect(tagExplorerResultsPath('moods', {
      tags: [
        { kind: 'mood', value: 'Dreamy' },
        { kind: 'genre', value: 'Rock' },
      ],
      mode: 'or',
      view: 'albums',
    })).toBe(
      '/moods/explore/results?tag=mood%3ADreamy&tag=genre%3ARock',
    );
  });
});
