import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const ndLoginMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/generated/bindings', () => ({
  commands: { ndDeletePlaylist: vi.fn() },
}));
vi.mock('@/lib/api/navidromeAdmin', () => ({ ndLogin: ndLoginMock }));
vi.mock('@/lib/server/serverEndpoint', () => ({ getCachedConnectBaseUrl: () => null }));
vi.mock('@/lib/server/serverBaseUrl', () => ({ serverProfileBaseUrl: ({ url }: { url: string }) => url }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      activeServerId: 'a',
      servers: [
        { id: 'a', url: 'https://a.test', username: 'user-a', password: 'pass-a' },
        { id: 'b', url: 'https://b.test', username: 'user-b', password: 'pass-b' },
      ],
      getActiveServer: () => ({
        id: 'a', url: 'https://a.test', username: 'user-a', password: 'pass-a',
      }),
    }),
  },
}));

import {
  ndCreateSmartPlaylist,
  ndGetSmartPlaylist,
  ndGetPlaylistTrackIds,
  ndGetPlaylistTracks,
  ndGetSongPlaylists,
  ndGetSongSmartPlaylists,
  ndListPlaylists,
  ndPreviewSmartPlaylist,
  ndUpdatePlaylistMeta,
  ndUpdateSmartPlaylist,
} from '@/lib/api/navidromeSmart';

describe('Navidrome smart playlist owner routing', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue({ id: 'smart', name: 'Smart', songCount: 0 });
    ndLoginMock.mockReset().mockResolvedValue({ token: 'token-b' });
  });

  it('uses the requested server instead of the mutable active server', async () => {
    await ndCreateSmartPlaylist('Smart', { all: [] }, true, 'b');
    await ndUpdateSmartPlaylist('smart', 'Smart', { all: [] }, true, 'b');

    expect(ndLoginMock).toHaveBeenCalledWith('https://b.test', 'user-b', 'pass-b');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'nd_create_playlist', expect.objectContaining({
      serverUrl: 'https://b.test', token: 'token-b',
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'nd_update_playlist', expect.objectContaining({
      serverUrl: 'https://b.test', token: 'token-b', id: 'smart',
    }));
  });

  it('omits the smart query when listing native playlist metadata', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 'regular', name: 'Regular', songCount: 1, rules: null },
      { id: 'smart', name: 'Native smart', songCount: 2, rules: { any: [] } },
    ]);

    await expect(ndListPlaylists('b')).resolves.toEqual([
      expect.objectContaining({ id: 'regular', rules: undefined }),
      expect.objectContaining({ id: 'smart', rules: { any: [] } }),
    ]);
    expect(invokeMock).toHaveBeenCalledWith('nd_list_playlists', {
      serverUrl: 'https://b.test',
      token: 'token-b',
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty('smart');
  });

  it('parses native playlist comments and ownerName metadata', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'smart',
      name: 'Commented mix',
      songCount: 0,
      comment: 'Existing comment',
      ownerName: 'jalen',
      rules: { all: [] },
    });

    await expect(ndGetSmartPlaylist('smart', 'b')).resolves.toEqual(expect.objectContaining({
      comment: 'Existing comment',
      owner: 'jalen',
    }));
  });

  it('resends existing rules with a native metadata update', async () => {
    invokeMock
      .mockResolvedValueOnce({
        id: 'smart',
        name: 'Smart',
        songCount: 0,
        rules: { all: [{ contains: { title: 'live' } }] },
      })
      .mockResolvedValueOnce({ id: 'smart', name: 'Renamed', songCount: 0 });

    await ndUpdatePlaylistMeta('smart', { name: 'Renamed', comment: 'Hi', public: false }, 'b');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'nd_get_playlist', {
      serverUrl: 'https://b.test',
      token: 'token-b',
      id: 'smart',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'nd_update_playlist', {
      serverUrl: 'https://b.test',
      token: 'token-b',
      id: 'smart',
      body: {
        name: 'Renamed',
        comment: 'Hi',
        public: false,
        rules: { all: [{ contains: { title: 'live' } }] },
      },
    });
    const body = invokeMock.mock.calls[1]?.[1]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('sync');
  });

  it('does not issue a destructive metadata PUT when rules are unavailable', async () => {
    invokeMock.mockResolvedValueOnce({ id: 'smart', name: 'Smart', songCount: 0 });

    await expect(ndUpdatePlaylistMeta('smart', { name: 'Renamed' }, 'b'))
      .rejects.toThrow('Smart playlist rules unavailable');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('nd_get_playlist', expect.objectContaining({ id: 'smart' }));
  });

  it('omits sync on REST create unless explicitly requested', async () => {
    await ndCreateSmartPlaylist('Smart', { all: [{ contains: { title: 'a' } }] }, { serverId: 'b' });

    expect(invokeMock).toHaveBeenCalledWith('nd_create_playlist', expect.objectContaining({
      body: { name: 'Smart', rules: { all: [{ contains: { title: 'a' } }] } },
    }));
    expect(invokeMock.mock.calls[0]?.[1].body).not.toHaveProperty('sync');
  });

  it('looks up playlists containing one song through the native route', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Road Trip' },
    ]);

    await expect(ndGetSongPlaylists('track-1', 'b')).resolves.toEqual([
      { id: '7rke2SAWaicSeSYzkhww6R', name: 'Road Trip' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      'nd_get_song_playlists',
      expect.objectContaining({
        serverUrl: 'https://b.test',
        token: 'token-b',
        id: 'track-1',
      }),
    );
  });

  it('probes smart playlists for one song with filtered serial requests', async () => {
    invokeMock
      .mockResolvedValueOnce([
        { id: 'regular', name: 'Regular', songCount: 1, rules: null },
        { id: 'smart-1', name: 'Smart One', songCount: 0, rules: { all: [] } },
        { id: 'smart-2', name: 'Smart Two', songCount: 0, rules: { any: [] } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: '1', mediaFileId: 'track-1' },
      ]);

    await expect(
      ndGetSongSmartPlaylists('track-1', 'b'),
    ).resolves.toEqual([
      { id: 'smart-2', name: 'Smart Two' },
    ]);

    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'nd_get_playlist_tracks',
      expect.objectContaining({
        id: 'smart-1',
        start: 0,
        end: 1,
        mediaFileId: 'track-1',
      }),
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      'nd_get_playlist_tracks',
      expect.objectContaining({
        id: 'smart-2',
        start: 0,
        end: 1,
        mediaFileId: 'track-1',
      }),
    );
  });

  it('collects native smart membership ids from the evaluated tracks endpoint', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', mediaFileId: 't1', title: 'One' },
      { id: '2', mediaFileId: 't2', title: 'Two' },
    ]);

    await expect(ndGetPlaylistTrackIds('smart', 'b')).resolves.toEqual([
      't1',
      't2',
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      'nd_get_playlist_tracks',
      expect.objectContaining({
        id: 'smart',
        start: 0,
        end: 500,
      }),
    );
  });

  it('canonicalizes legacy native track ids before membership caching', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: '17',
        mediaFileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      },
    ]);

    await expect(ndGetPlaylistTrackIds('smart', 'b')).resolves.toEqual([
      '7rke2SAWaicSeSYzkhww6R',
    ]);
  });

  it('fails closed instead of caching incomplete native membership when mediaFileId is missing', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', mediaFileId: 't1' },
      { id: '2', title: 'Missing media file id' },
    ]);

    await expect(ndGetPlaylistTrackIds('smart', 'b'))
      .rejects.toThrow('Navidrome playlist track is missing a mediaFileId');
  });

  it('previews existing playlists via tracks and unsaved rules via a temporary playlist', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 't1', title: 'One' }]);
    await expect(ndGetPlaylistTracks('pl-1', 'b', { start: 0, end: 50 })).resolves.toEqual([
      { id: 't1', title: 'One' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith('nd_get_playlist_tracks', expect.objectContaining({
      id: 'pl-1',
      start: 0,
      end: 50,
    }));

    invokeMock.mockResolvedValueOnce([{ id: 't2', title: 'Two' }]);
    await expect(ndPreviewSmartPlaylist({
      owner: 'user-b',
      rules: { all: [{ contains: { title: 'a' } }] },
    }, 'b')).resolves.toEqual([{ id: 't2', title: 'Two' }]);
    expect(invokeMock).toHaveBeenCalledWith('nd_preview_playlist', expect.objectContaining({
      body: expect.objectContaining({
        owner: 'user-b',
        rules: { all: [{ contains: { title: 'a' } }] },
        public: false,
      }),
    }));
  });
});
