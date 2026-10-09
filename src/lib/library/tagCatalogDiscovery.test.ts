import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeTagCatalogReturnState,
  filterAndSortTagCatalog,
  readTagCatalogSort,
  storeTagCatalogReturnState,
  writeTagCatalogSort,
} from './tagCatalogDiscovery';

const rows = [
  { value: 'Progressive Rock', albumCount: 40 },
  { value: 'Ambient', albumCount: 12 },
  { value: 'Progressive Metal', albumCount: 40 },
  { value: 'Dream Pop', albumCount: 3 },
];

describe('filterAndSortTagCatalog', () => {
  it('filters with a trimmed case-insensitive substring', () => {
    expect(
      filterAndSortTagCatalog(rows, '  PROGRESSIVE ', 'popularity')
        .map(row => row.value),
    ).toEqual(['Progressive Metal', 'Progressive Rock']);
  });

  it('sorts popularity by album count with an alphabetical tie-break', () => {
    expect(
      filterAndSortTagCatalog(rows, '', 'popularity')
        .map(row => row.value),
    ).toEqual([
      'Progressive Metal',
      'Progressive Rock',
      'Ambient',
      'Dream Pop',
    ]);
  });

  it('sorts alphabetically without mutating the input', () => {
    const before = rows.map(row => row.value);

    expect(
      filterAndSortTagCatalog(rows, '', 'alphabetical')
        .map(row => row.value),
    ).toEqual([
      'Ambient',
      'Dream Pop',
      'Progressive Metal',
      'Progressive Rock',
    ]);
    expect(rows.map(row => row.value)).toEqual(before);
  });
});

describe('tag catalog session state', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('defaults sort to popularity and persists alphabetical for the session', () => {
    expect(readTagCatalogSort('sort')).toBe('popularity');
    writeTagCatalogSort('sort', 'alphabetical');
    expect(readTagCatalogSort('sort')).toBe('alphabetical');
  });

  it('consumes return state exactly once', () => {
    storeTagCatalogReturnState('return', {
      search: 'prog',
      scrollTop: 321,
    });

    expect(consumeTagCatalogReturnState('return')).toEqual({
      search: 'prog',
      scrollTop: 321,
    });
    expect(consumeTagCatalogReturnState('return')).toBeNull();
  });

  it('drops malformed return state', () => {
    sessionStorage.setItem('return', JSON.stringify({
      search: 42,
      scrollTop: 'bad',
    }));

    expect(consumeTagCatalogReturnState('return')).toBeNull();
  });
});
