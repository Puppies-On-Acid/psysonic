import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  libraryListTracksByGenre: vi.fn(),
  readyLibraryServerKeys: vi.fn(),
}));

vi.mock('@/lib/api/library', () => ({
  libraryListTracksByGenre: hoisted.libraryListTracksByGenre,
}));

vi.mock('@/lib/api/subsonicClient', () => ({
  libraryScopeForServer: vi.fn(() => null),
  libraryScopePairsForServer: vi.fn(() => []),
}));

vi.mock('./libraryReady', () => ({
  readyLibraryServerKeys: hoisted.readyLibraryServerKeys,
}));

vi.mock('./trackDtoMapping', () => ({
  trackToSong: (track: unknown) => track,
}));

import { fetchGenreTrackPage } from './genreTrackBrowse';

describe('fetchGenreTrackPage', () => {
  beforeEach(() => {
    hoisted.libraryListTracksByGenre.mockReset();
    hoisted.readyLibraryServerKeys.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a temporary library readiness failure before browsing', async () => {
    vi.useFakeTimers();
    hoisted.readyLibraryServerKeys
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(['srv-1']);
    hoisted.libraryListTracksByGenre.mockResolvedValueOnce({
      tracks: [{ id: 'track-1', title: 'Track 1' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const request = fetchGenreTrackPage(
      'srv-1',
      'Progressive Rock',
      true,
      0,
      100,
      undefined,
      true,
    );

    await vi.runAllTimersAsync();
    const result = await request;

    expect(hoisted.readyLibraryServerKeys).toHaveBeenCalledTimes(2);
    expect(hoisted.libraryListTracksByGenre).toHaveBeenCalledTimes(1);
    expect(result?.songs).toHaveLength(1);
    expect(result?.total).toBe(1);
  });
});
