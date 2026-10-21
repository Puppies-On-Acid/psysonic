import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ndGetPlaylistTracks,
  ndListPlaylists,
} from '@/lib/api/navidromeSmart';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { resolveSongSmartPlaylistMemberships } from './resolveSongSmartPlaylistMemberships';

vi.mock('@/lib/api/navidromeSmart', () => ({
  ndListPlaylists: vi.fn(),
  ndGetPlaylistTracks: vi.fn(),
}));

const ndListPlaylistsMock = vi.mocked(ndListPlaylists);
const ndGetPlaylistTracksMock = vi.mocked(ndGetPlaylistTracks);

function smartPlaylist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'smart-1',
    name: 'Focus',
    songCount: 20,
    rules: { all: [{ is: { genre: 'Jazz' } }] },
    ...overrides,
  };
}

describe('resolveSongSmartPlaylistMemberships', () => {
  beforeEach(() => {
    ndListPlaylistsMock.mockReset();
    ndGetPlaylistTracksMock.mockReset();
    usePlaylistMembershipStore.setState({
      songIdsByCacheKey: {},
      revision: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('trusts complete cached smart membership without probing tracks', async () => {
    ndListPlaylistsMock.mockResolvedValue([smartPlaylist({ songCount: 1 })]);
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('smart-1', ['song-1'], 'srv-1');

    await expect(
      resolveSongSmartPlaylistMemberships('song-1', 'srv-1'),
    ).resolves.toEqual([{ id: 'smart-1', name: 'Focus' }]);

    expect(ndGetPlaylistTracksMock).not.toHaveBeenCalled();
  });

  it('trusts a positive cached membership even when the cache is incomplete', async () => {
    ndListPlaylistsMock.mockResolvedValue([smartPlaylist({ songCount: 3 })]);
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds('smart-1', ['song-1'], 'srv-1');

    await expect(
      resolveSongSmartPlaylistMemberships('song-1', 'srv-1'),
    ).resolves.toEqual([{ id: 'smart-1', name: 'Focus' }]);

    expect(ndGetPlaylistTracksMock).not.toHaveBeenCalled();
  });

  it('uses an exact-song probe for cold smart membership', async () => {
    ndListPlaylistsMock.mockResolvedValue([smartPlaylist()]);
    ndGetPlaylistTracksMock.mockResolvedValue([
      { id: '7', mediaFileId: 'song-1' },
    ]);

    await expect(
      resolveSongSmartPlaylistMemberships('song-1', 'srv-1'),
    ).resolves.toEqual([{ id: 'smart-1', name: 'Focus' }]);

    expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(1);
    expect(ndGetPlaylistTracksMock).toHaveBeenCalledWith(
      'smart-1',
      'srv-1',
      { start: 0, end: 1, mediaFileId: 'song-1' },
    );
  });

  it('retries the one-song probe after Navidrome refresh delay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T07:00:00.000Z'));
    ndListPlaylistsMock.mockResolvedValue([
      smartPlaylist({
        evaluatedAt: '2026-10-02T06:59:59.000Z',
      }),
    ]);
    ndGetPlaylistTracksMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '8', mediaFileId: 'song-1' }]);

    const pending = resolveSongSmartPlaylistMemberships('song-1', 'srv-1');

    await vi.waitFor(() => {
      expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(4200);

    await expect(pending).resolves.toEqual([
      { id: 'smart-1', name: 'Focus' },
    ]);
    expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(2);
  });

  it('does not issue the delayed retry after the caller becomes stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T07:00:00.000Z'));
    ndListPlaylistsMock.mockResolvedValue([
      smartPlaylist({
        evaluatedAt: '2026-10-02T06:59:59.000Z',
      }),
    ]);
    ndGetPlaylistTracksMock.mockResolvedValue([]);

    let current = true;
    const pending = resolveSongSmartPlaylistMemberships(
      'song-1',
      'srv-1',
      () => current,
    );

    await vi.waitFor(() => {
      expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(1);
    });
    current = false;
    await vi.advanceTimersByTimeAsync(4200);

    await expect(pending).resolves.toEqual([]);
    expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(1);
  });

  it('does not download full membership for a definitive cold negative', async () => {
    ndListPlaylistsMock.mockResolvedValue([
      smartPlaylist({ evaluatedAt: '2026-10-02T06:59:00.000Z' }),
    ]);
    ndGetPlaylistTracksMock.mockResolvedValue([]);

    await expect(
      resolveSongSmartPlaylistMemberships('song-1', 'srv-1'),
    ).resolves.toEqual([]);

    expect(ndGetPlaylistTracksMock).toHaveBeenCalledTimes(1);
  });
});
