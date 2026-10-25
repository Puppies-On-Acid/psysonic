import { act, renderHook, waitFor } from '@testing-library/react';
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
      { initialProps: { activeView: 'albums' as 'albums' | 'tracks' } },
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
      { initialProps: { activeView: 'albums' as 'albums' | 'tracks' } },
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

  it('does not restart requests for equivalent tag and scope values', async () => {
    hoisted.albums.mockResolvedValue({
      albums: [{ id: 'a-stable', serverId: 's1', name: 'Stable Album' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const { result, rerender } = renderHook(() =>
      useTagExplorerBrowse(
        's1',
        [
          { kind: 'genre', value: 'Stable Genre' },
          { kind: 'mood', value: 'Stable Mood' },
        ],
        'or',
        'albums',
        201,
        {
          ...scope,
          serverIds: ['s1'],
          pairs: [{ serverId: 's1', libraryId: null }],
        },
      ),
    );

    await waitFor(() => expect(result.current.albumsReady).toBe(true));
    rerender();
    rerender();
    expect(hoisted.albums).toHaveBeenCalledTimes(1);
    expect(result.current.albums[0]?.id).toBe('a-stable');
  });

  it('refetches when inline tag values change', async () => {
    hoisted.tracks.mockImplementation(
      ({ tags: requested }: { tags: typeof tags }) => Promise.resolve({
        tracks: [{ id: requested[0].value, serverId: 's1', title: 'Track' }],
        hasMore: false,
        total: 1,
        source: 'local',
      }),
    );

    const { result, rerender } = renderHook(
      ({ genre }: { genre: string }) =>
        useTagExplorerBrowse(
          's1',
          [
            { kind: 'genre', value: genre },
            { kind: 'mood', value: 'Changing Mood' },
          ],
          'or',
          'tracks',
          202,
          scope,
        ),
      { initialProps: { genre: 'Rock' } },
    );

    await waitFor(() => expect(result.current.songs[0]?.id).toBe('Rock'));
    rerender({ genre: 'Jazz' });
    await waitFor(() => expect(result.current.songs[0]?.id).toBe('Jazz'));
    expect(hoisted.tracks).toHaveBeenCalledTimes(2);
  });

  it('does not report stale Albums as query-ready while a new tag query loads', async () => {
    let finishNewQuery: ((value: {
      albums: Array<{ id: string; serverId: string; name: string }>;
      hasMore: boolean;
      total: number;
      source: string;
    }) => void) | undefined;
    hoisted.albums
      .mockResolvedValueOnce({
        albums: [{ id: 'old', serverId: 's1', name: 'Old' }],
        hasMore: false,
        total: 1,
        source: 'local',
      })
      .mockImplementationOnce(() => new Promise(resolve => {
        finishNewQuery = resolve;
      }));

    const { result, rerender } = renderHook(
      ({ genre }: { genre: string }) => useTagExplorerBrowse(
        's1',
        [{ kind: 'genre', value: genre }, { kind: 'mood', value: 'Dreamy' }],
        'or',
        'albums',
        305,
        scope,
      ),
      { initialProps: { genre: 'Old genre' } },
    );
    await waitFor(() => expect(result.current.activeQueryReady).toBe(true));
    rerender({ genre: 'New genre' });
    await waitFor(() => expect(hoisted.albums).toHaveBeenCalledTimes(2));
    expect(result.current.activeQueryReady).toBe(false);

    await act(async () => {
      finishNewQuery?.({
        albums: [{ id: 'new', serverId: 's1', name: 'New' }],
        hasMore: false,
        total: 1,
        source: 'local',
      });
    });
    await waitFor(() => expect(result.current.activeQueryReady).toBe(true));
    expect(result.current.albums[0].id).toBe('new');
  });

  it('refetches when the selected library folder changes', async () => {
    hoisted.albums.mockResolvedValue({
      albums: [],
      hasMore: false,
      total: 0,
      source: 'local',
    });

    const { rerender } = renderHook(
      ({ libraryId }: { libraryId: string | null }) =>
        useTagExplorerBrowse(
          's1',
          tags,
          'or',
          'albums',
          203,
          {
            ...scope,
            pairs: [{ serverId: 's1', libraryId }],
            fingerprint: JSON.stringify([['s1', [libraryId]]]),
          },
        ),
      { initialProps: { libraryId: null as string | null } },
    );

    await waitFor(() => expect(hoisted.albums).toHaveBeenCalledTimes(1));
    rerender({ libraryId: 'music-1' });
    await waitFor(() => expect(hoisted.albums).toHaveBeenCalledTimes(2));
    expect(hoisted.albums.mock.calls[1]?.[0].libraryScopes).toEqual([
      { serverId: 's1', libraryId: 'music-1' },
    ]);
  });

});
