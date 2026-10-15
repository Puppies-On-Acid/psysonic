import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  albums: vi.fn(),
  tracks: vi.fn(),
  ready: vi.fn(),
  syncRevision: vi.fn(() => 0),
}));

vi.mock('@/lib/api/library', () => ({
  libraryTagExplorerAlbums: hoisted.albums,
  libraryTagExplorerTracks: hoisted.tracks,
}));

vi.mock('@/lib/library/libraryReady', () => ({
  readyLibraryServerKeys: hoisted.ready,
}));

vi.mock('@/store/offlineLocalLibrarySyncRevision', () => ({
  useLibraryScopeSyncRevision: hoisted.syncRevision,
}));

vi.mock('@/lib/library/advancedSearchLocal', () => ({
  albumToAlbum: (album: unknown) => album,
}));

vi.mock('@/lib/library/trackDtoMapping', () => ({
  trackToSong: (track: unknown) => track,
}));

import { useTagExplorerBrowse } from './useTagExplorerBrowse';

const scope = {
  anchorServerId: 's1',
  serverIds: ['s1'],
  pairs: [{ serverId: 's1', libraryId: null }],
  fingerprint: 'scope',
  multiServer: false,
};

const tags = [
  { kind: 'genre' as const, value: 'Progressive Rock' },
  { kind: 'mood' as const, value: 'Dreamy' },
];

describe('useTagExplorerBrowse', () => {
  beforeEach(() => {
    hoisted.albums.mockReset();
    hoisted.tracks.mockReset();
    hoisted.ready.mockReset();
    hoisted.ready.mockResolvedValue(['s1']);
    hoisted.syncRevision.mockReturnValue(0);
  });

  it('loads Albums first and keeps Tracks lazy until opened', async () => {
    hoisted.albums.mockResolvedValue({
      albums: [{ id: 'a1', serverId: 's1', name: 'Album One' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });
    hoisted.tracks.mockResolvedValue({
      tracks: [{ id: 't1', serverId: 's1', title: 'Track One' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const { result, rerender } = renderHook(
      ({ activeView }: { activeView: 'albums' | 'tracks' }) =>
        useTagExplorerBrowse(
          's1',
          tags,
          'or',
          activeView,
          101,
          scope,
        ),
      { initialProps: { activeView: 'albums' as const } },
    );

    await waitFor(() =>
      expect(result.current.albumsReady).toBe(true),
    );
    expect(hoisted.albums).toHaveBeenCalledTimes(1);
    expect(hoisted.tracks).not.toHaveBeenCalled();

    rerender({ activeView: 'tracks' as const });

    await waitFor(() =>
      expect(result.current.tracksReady).toBe(true),
    );
    expect(hoisted.tracks).toHaveBeenCalledTimes(1);
    expect(result.current.trackTotal).toBe(1);
  });

  it('does not start Albums for a direct Tracks view', async () => {
    hoisted.tracks.mockResolvedValue({
      tracks: [{ id: 't-direct', serverId: 's1', title: 'Direct Track' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const { result } = renderHook(() =>
      useTagExplorerBrowse(
        's1',
        [
          { kind: 'genre', value: 'Direct Genre' },
          { kind: 'mood', value: 'Direct Mood' },
        ],
        'or',
        'tracks',
        103,
        scope,
      ),
    );

    await waitFor(() =>
      expect(result.current.tracksReady).toBe(true),
    );
    expect(hoisted.albums).not.toHaveBeenCalled();
  });

  it('preserves a loaded tab session when switching away and back', async () => {
    hoisted.albums.mockResolvedValue({
      albums: [{ id: 'a-cache', serverId: 's1', name: 'Album' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });
    hoisted.tracks.mockResolvedValue({
      tracks: [{ id: 't-cache', serverId: 's1', title: 'Track' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const { result, rerender } = renderHook(
      ({ activeView }: { activeView: 'albums' | 'tracks' }) =>
        useTagExplorerBrowse(
          's1',
          [
            { kind: 'genre', value: 'Cache Genre' },
            { kind: 'mood', value: 'Cache Mood' },
          ],
          'or',
          activeView,
          104,
          scope,
        ),
      { initialProps: { activeView: 'albums' as const } },
    );

    await waitFor(() =>
      expect(result.current.albumsReady).toBe(true),
    );
    rerender({ activeView: 'tracks' as const });
    await waitFor(() =>
      expect(result.current.tracksReady).toBe(true),
    );
    rerender({ activeView: 'albums' as const });
    await waitFor(() =>
      expect(result.current.albumsReady).toBe(true),
    );

    expect(hoisted.albums).toHaveBeenCalledTimes(1);
    expect(hoisted.tracks).toHaveBeenCalledTimes(1);
  });

});
