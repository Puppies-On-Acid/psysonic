import type React from 'react';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { usePlaylistStore } from '@/features/playlist/store/playlistStore';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

const deleteOwnedPlaylistMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/playlist/utils/playlistOwnedMutation', () => ({
  deleteOwnedPlaylist: deleteOwnedPlaylistMock,
}));
vi.mock('@/lib/dom/toast', () => ({
  showToast: showToastMock,
}));
vi.mock('@/lib/api/subsonicPlaylists', () => ({
  addSongsToPlaylist: vi.fn(),
  getPlaylistsForServer: vi.fn(),
  getPlaylistsForServersSettled: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock('@/features/offline', () => ({
  isOfflineBrowseActive: () => false,
  fetchOfflineBrowsablePlaylists: vi.fn(),
}));

import {
  runPlaylistDelete,
  runPlaylistDeleteSelected,
} from './runPlaylistsActions';

function playlist(
  id: string,
  name: string,
  serverId: string,
): SubsonicPlaylist {
  return {
    id,
    name,
    serverId,
    songCount: 0,
    duration: 0,
    created: '',
    changed: '',
  };
}

function confirmedDeleteEvent(): React.MouseEvent {
  return {
    stopPropagation: vi.fn(),
    currentTarget: document.createElement('button'),
  } as unknown as React.MouseEvent;
}

const t = ((key: string) => key) as TFunction;

describe('playlist delete membership coherence', () => {
  beforeEach(() => {
    deleteOwnedPlaylistMock.mockReset().mockResolvedValue(undefined);
    showToastMock.mockReset();
    usePlaylistStore.setState({
      playlists: [],
      recentIds: [],
      lastModified: {},
      playlistsLoading: false,
    });
    usePlaylistMembershipStore.setState({
      songIdsByCacheKey: {},
      revision: 0,
    });
  });

  it('removes metadata and membership only after a confirmed server delete', async () => {
    const pl = playlist('pl-1', 'Delete me', 'srv-a');
    usePlaylistStore.setState({ playlists: [pl] });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds(pl.id, ['song-1'], pl.serverId);

    const setDeleteConfirmId = vi.fn();
    await runPlaylistDelete({
      e: confirmedDeleteEvent(),
      pl,
      deleteConfirmId: ownedEntityKey(pl),
      setDeleteConfirmId,
      removeId: usePlaylistStore.getState().removeId,
      t,
    });

    expect(deleteOwnedPlaylistMock).toHaveBeenCalledWith(pl);
    expect(usePlaylistStore.getState().playlists).toEqual([]);
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds(pl.id, pl.serverId),
    ).toBeUndefined();
    expect(setDeleteConfirmId).toHaveBeenCalledWith(null);
  });

  it('preserves metadata and membership when the server delete fails', async () => {
    const pl = playlist('pl-1', 'Keep me', 'srv-a');
    usePlaylistStore.setState({ playlists: [pl] });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds(pl.id, ['song-1'], pl.serverId);
    deleteOwnedPlaylistMock.mockRejectedValueOnce(new Error('delete failed'));

    await runPlaylistDelete({
      e: confirmedDeleteEvent(),
      pl,
      deleteConfirmId: ownedEntityKey(pl),
      setDeleteConfirmId: vi.fn(),
      removeId: usePlaylistStore.getState().removeId,
      t,
    });

    expect(usePlaylistStore.getState().playlists).toEqual([pl]);
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds(pl.id, pl.serverId),
    ).toEqual(['song-1']);
  });

  it('keeps failed members intact during a partially successful multi-delete', async () => {
    const deleted = playlist('delete', 'Delete', 'srv-a');
    const failed = playlist('keep', 'Keep', 'srv-a');
    usePlaylistStore.setState({ playlists: [deleted, failed] });
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds(deleted.id, ['song-a'], deleted.serverId);
    usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIds(failed.id, ['song-b'], failed.serverId);
    deleteOwnedPlaylistMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('delete failed'));

    const clearSelection = vi.fn();
    await runPlaylistDeleteSelected({
      selectedPlaylists: [deleted, failed],
      isPlaylistDeletable: () => true,
      removeId: usePlaylistStore.getState().removeId,
      clearSelection,
      t,
    });

    expect(usePlaylistStore.getState().playlists).toEqual([failed]);
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds(deleted.id, deleted.serverId),
    ).toBeUndefined();
    expect(
      usePlaylistMembershipStore
        .getState()
        .getPlaylistSongIds(failed.id, failed.serverId),
    ).toEqual(['song-b']);
    expect(clearSelection).toHaveBeenCalledOnce();
  });
});
