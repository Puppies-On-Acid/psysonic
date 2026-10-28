import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addTracksToPlaylistWithDedup } from '@/features/playlist/utils/addTracksToPlaylistWithDedup';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

const addSongsToPlaylistMock = vi.fn(async (_id: string, _ids: string[], _serverId?: string) => {});
const getPlaylistForServerMock = vi.fn(async (_serverId: string, _id: string) => ({
  playlist: { id: 'pl-1' },
  songs: [{ id: 'remote-a' }],
}));
const confirmMock = vi.fn(async () => false);

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  addSongsToPlaylist: (id: string, ids: string[], serverId?: string) => addSongsToPlaylistMock(id, ids, serverId),
  getPlaylistForServer: (serverId: string, id: string) => getPlaylistForServerMock(serverId, id),
}));

vi.mock('@/store/confirmModalStore', () => ({
  useConfirmModalStore: {
    getState: () => ({ request: () => confirmMock() }),
  },
}));

describe('addTracksToPlaylistWithDedup', () => {
  beforeEach(() => {
    addSongsToPlaylistMock.mockClear();
    getPlaylistForServerMock.mockReset().mockResolvedValue({
      playlist: { id: 'pl-1' },
      songs: [{ id: 'remote-a' }],
    });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
    usePlaylistMembershipStore.setState({
      songIdsByCacheKey: { 'srv-1:pl-1': ['a', 'b'] },
      revision: 0,
    });
  });

  it('dedupes against cached ids without getPlaylist', async () => {
    const result = await addTracksToPlaylistWithDedup('pl-1', 'Mix', ['b', 'c'], k => k, 'srv-1');
    expect(result).toMatchObject({ outcome: 'partial', addedCount: 1, skippedCount: 1 });
    expect(getPlaylistForServerMock).not.toHaveBeenCalled();
    expect(addSongsToPlaylistMock).toHaveBeenCalledWith('pl-1', ['c'], 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toEqual(['a', 'b', 'c']);
  });

  it('fetches membership once on cold cache and dedupes', async () => {
    usePlaylistMembershipStore.setState({ songIdsByCacheKey: {}, revision: 0 });
    getPlaylistForServerMock.mockResolvedValue({
      playlist: { id: 'pl-2' },
      songs: [{ id: 'x' }],
    });
    const result = await addTracksToPlaylistWithDedup('pl-2', 'Cold', ['x', 'y'], k => k, 'srv-1');
    expect(result).toMatchObject({ outcome: 'partial', addedCount: 1, skippedCount: 1 });
    expect(getPlaylistForServerMock).toHaveBeenCalledTimes(1);
    expect(addSongsToPlaylistMock).toHaveBeenCalledWith('pl-2', ['y'], 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-2', 'srv-1')).toEqual(['x', 'y']);
  });

  it('dedupes repeated ids inside the same add payload', async () => {
    const result = await addTracksToPlaylistWithDedup(
      'pl-1',
      'Mix',
      ['c', 'c', 'd', 'd'],
      k => k,
      'srv-1',
    );

    expect(result).toMatchObject({
      outcome: 'partial',
      addedCount: 2,
      skippedCount: 2,
    });
    expect(addSongsToPlaylistMock).toHaveBeenCalledWith('pl-1', ['c', 'd'], 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1'))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('invalidates cache when the write fails', async () => {
    addSongsToPlaylistMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      addTracksToPlaylistWithDedup('pl-1', 'Mix', ['c'], k => k, 'srv-1'),
    ).rejects.toThrow('boom');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toBeUndefined();
  });

  it('keeps same-id membership isolated by owner server', async () => {
    usePlaylistMembershipStore.setState({ songIdsByCacheKey: {}, revision: 0 });

    const result = await addTracksToPlaylistWithDedup(
      'pl-1', 'Remote', ['remote-a', 'remote-b'], k => k, 'srv-2',
    );

    expect(result).toMatchObject({ outcome: 'partial', addedCount: 1 });
    expect(getPlaylistForServerMock).toHaveBeenCalledWith('srv-2', 'pl-1');
    expect(addSongsToPlaylistMock).toHaveBeenCalledWith('pl-1', ['remote-b'], 'srv-2');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-2'))
      .toEqual(['remote-a', 'remote-b']);
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toBeUndefined();
  });

  it('does not let a slower cold-cache fill overwrite newer membership', async () => {
    usePlaylistMembershipStore.setState({ songIdsByCacheKey: {}, revision: 0 });
    let resolveFirst!: (value: { playlist: { id: string }; songs: Array<{ id: string }> }) => void;
    let resolveSecond!: (value: { playlist: { id: string }; songs: Array<{ id: string }> }) => void;
    getPlaylistForServerMock
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));

    const first = addTracksToPlaylistWithDedup('pl-1', 'Mix', ['b'], k => k, 'srv-1');
    const second = addTracksToPlaylistWithDedup('pl-1', 'Mix', ['c'], k => k, 'srv-1');
    resolveFirst({ playlist: { id: 'pl-1' }, songs: [{ id: 'a' }] });
    await first;
    resolveSecond({ playlist: { id: 'pl-1' }, songs: [{ id: 'a' }] });
    await second;

    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1'))
      .toEqual(['a', 'b', 'c']);
  });

  it('retries a cold fill when an older request was invalidated by a failed write', async () => {
    usePlaylistMembershipStore.setState({ songIdsByCacheKey: {}, revision: 0 });
    let resolveFirst!: (value: { playlist: { id: string }; songs: Array<{ id: string }> }) => void;
    let resolveSecond!: (value: { playlist: { id: string }; songs: Array<{ id: string }> }) => void;
    getPlaylistForServerMock
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }))
      .mockResolvedValueOnce({ playlist: { id: 'pl-1' }, songs: [{ id: 'a' }, { id: 'b' }] });
    addSongsToPlaylistMock.mockRejectedValueOnce(new Error('partial write'));

    const first = addTracksToPlaylistWithDedup('pl-1', 'Mix', ['b'], k => k, 'srv-1');
    const second = addTracksToPlaylistWithDedup('pl-1', 'Mix', ['c'], k => k, 'srv-1');
    resolveFirst({ playlist: { id: 'pl-1' }, songs: [{ id: 'a' }] });
    await expect(first).rejects.toThrow('partial write');
    resolveSecond({ playlist: { id: 'pl-1' }, songs: [{ id: 'a' }] });
    await second;

    expect(getPlaylistForServerMock).toHaveBeenCalledTimes(3);
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1'))
      .toEqual(['a', 'b', 'c']);
  });
});
