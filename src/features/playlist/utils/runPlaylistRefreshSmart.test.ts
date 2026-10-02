import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { runPlaylistRefreshSmart } from './runPlaylistRefreshSmart';

const ndGetPlaylistTrackIdsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/navidromeSmart', () => ({
  ndGetPlaylistTrackIds: ndGetPlaylistTrackIdsMock,
}));

describe('runPlaylistRefreshSmart', () => {
  beforeEach(() => {
    ndGetPlaylistTrackIdsMock.mockReset().mockResolvedValue(['fresh']);
    usePlaylistMembershipStore.getState().clearAllPlaylistSongIds();
  });

  it('keeps cached membership when the server refresh trigger fails', async () => {
    ndGetPlaylistTrackIdsMock.mockRejectedValueOnce(new Error('refresh failed'));
    const reload = vi.fn().mockResolvedValue(undefined);
    usePlaylistMembershipStore.getState().setPlaylistSongIds(
      'smart-1',
      ['old'],
      'server-a',
    );

    await expect(runPlaylistRefreshSmart({
      id: 'smart-1',
      serverId: 'server-a',
      reload,
    })).rejects.toThrow('refresh failed');

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('smart-1', 'server-a'),
    ).toEqual(['old']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps freshly evaluated membership when detail reload fails afterward', async () => {
    const reload = vi.fn().mockRejectedValue(new Error('reload failed'));
    usePlaylistMembershipStore.getState().setPlaylistSongIds(
      'smart-1',
      ['old'],
      'server-a',
    );

    await expect(runPlaylistRefreshSmart({
      id: 'smart-1',
      serverId: 'server-a',
      reload,
    })).rejects.toThrow('reload failed');

    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds('smart-1', 'server-a'),
    ).toEqual(['fresh']);
  });

  it('forces evaluation, replaces membership, and reloads the detail', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    usePlaylistMembershipStore.getState().setPlaylistSongIds('smart-1', ['old'], 'server-a');

    await runPlaylistRefreshSmart({
      id: 'smart-1',
      serverId: 'server-a',
      reload,
    });

    expect(ndGetPlaylistTrackIdsMock).toHaveBeenCalledWith(
      'smart-1',
      'server-a',
    );
    expect(usePlaylistMembershipStore.getState()
      .getPlaylistSongIds('smart-1', 'server-a')).toEqual(['fresh']);
    expect(reload).toHaveBeenCalledOnce();
  });
});
