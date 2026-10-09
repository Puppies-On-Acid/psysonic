import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchGenreTrackPage: vi.fn(),
  useLibraryScopeSyncRevision: vi.fn(() => 0),
}));

vi.mock('@/lib/library/genreTrackBrowse', () => ({
  fetchGenreTrackPage: hoisted.fetchGenreTrackPage,
  GENRE_TRACK_PAGE_SIZE: 100,
}));

vi.mock('@/store/offlineLocalLibrarySyncRevision', () => ({
  useLibraryScopeSyncRevision: hoisted.useLibraryScopeSyncRevision,
}));

import { useGenreTrackBrowse } from './useGenreTrackBrowse';

const browseScope = {
  anchorServerId: 'srv-1',
  serverIds: ['srv-1'],
  pairs: [{ serverId: 'srv-1', libraryId: null }],
  fingerprint: 'scope',
  multiServer: false,
};

function songs(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${offset + index}`,
    title: `Track ${offset + index}`,
    artist: 'Artist',
    album: 'Album',
    albumId: 'album-1',
    duration: 180,
  }));
}

describe('useGenreTrackBrowse', () => {
  beforeEach(() => {
    hoisted.fetchGenreTrackPage.mockReset();
    hoisted.useLibraryScopeSyncRevision.mockReset();
    hoisted.useLibraryScopeSyncRevision.mockReturnValue(0);
  });

  it('does not load tracks until the view is enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useGenreTrackBrowse(
          'srv-1',
          'Progressive Rock',
          true,
          enabled,
          0,
          browseScope,
        ),
      {
        initialProps: { enabled: false },
      },
    );

    expect(hoisted.fetchGenreTrackPage).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    hoisted.fetchGenreTrackPage.mockResolvedValueOnce({
      songs: songs(0, 2),
      hasMore: false,
      total: 2,
    });

    rerender({ enabled: true });

    await waitFor(() =>
      expect(hoisted.fetchGenreTrackPage).toHaveBeenCalledTimes(1),
    );

    expect(hoisted.fetchGenreTrackPage).toHaveBeenCalledWith(
      'srv-1',
      'Progressive Rock',
      true,
      0,
      100,
      browseScope,
      true,
    );

    await waitFor(() => expect(result.current.total).toBe(2));
  });

  it('keeps a loaded track session while the Tracks tab is inactive', async () => {
    hoisted.fetchGenreTrackPage.mockResolvedValueOnce({
      songs: songs(0, 2),
      hasMore: false,
      total: 2,
    });

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useGenreTrackBrowse(
          'srv-1',
          'Tab Session',
          true,
          enabled,
          9,
          browseScope,
        ),
      {
        initialProps: { enabled: true },
      },
    );

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(2),
    );
    expect(result.current.sessionReady).toBe(true);

    rerender({ enabled: false });

    await waitFor(() =>
      expect(result.current.loading).toBe(false),
    );
    expect(result.current.songs).toHaveLength(2);
    expect(result.current.total).toBe(2);

    rerender({ enabled: true });

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(2),
    );
    expect(hoisted.fetchGenreTrackPage).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached track session after a library sync', async () => {
    hoisted.fetchGenreTrackPage
      .mockResolvedValueOnce({
        songs: songs(0, 2),
        hasMore: false,
        total: 2,
      })
      .mockResolvedValueOnce({
        songs: songs(0, 3),
        hasMore: false,
        total: 3,
      });

    const first = renderHook(() =>
      useGenreTrackBrowse(
        'srv-1',
        'Sync Cache Refresh',
        true,
        true,
        13,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(first.result.current.songs).toHaveLength(2),
    );
    first.unmount();

    hoisted.useLibraryScopeSyncRevision.mockReturnValue(1);

    const second = renderHook(() =>
      useGenreTrackBrowse(
        'srv-1',
        'Sync Cache Refresh',
        true,
        true,
        13,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(second.result.current.songs).toHaveLength(3),
    );
    expect(second.result.current.total).toBe(3);
    expect(hoisted.fetchGenreTrackPage).toHaveBeenCalledTimes(2);
  });

  it('appends the next page and deduplicates track ids', async () => {
    hoisted.fetchGenreTrackPage
      .mockResolvedValueOnce({
        songs: songs(0, 100),
        hasMore: true,
        total: 102,
      })
      .mockResolvedValueOnce({
        songs: [
          songs(99, 1)[0],
          ...songs(100, 2),
        ],
        hasMore: false,
        total: null,
      });

    const { result } = renderHook(() =>
      useGenreTrackBrowse(
        'srv-1',
        'Rock',
        true,
        true,
        0,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(100),
    );

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(102),
    );

    expect(result.current.hasMore).toBe(false);
    expect(result.current.total).toBe(102);
    expect(hoisted.fetchGenreTrackPage).toHaveBeenLastCalledWith(
      'srv-1',
      'Rock',
      true,
      100,
      100,
      browseScope,
      false,
    );
  });
});
