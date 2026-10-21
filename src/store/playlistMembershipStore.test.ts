import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

describe('playlistMembershipStore', () => {
  beforeEach(() => {
    usePlaylistMembershipStore.setState({ songIdsByCacheKey: {}, revision: 0 });
  });

  it('stores and reads ids scoped to an explicit owner server', () => {
    usePlaylistMembershipStore.getState().setPlaylistSongIds('pl-1', ['a', 'b'], 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toEqual(['a', 'b']);
  });

  it('appends and removes by index', () => {
    const store = usePlaylistMembershipStore.getState();
    store.setPlaylistSongIds('pl-1', ['a', 'b', 'c'], 'srv-1');
    store.appendPlaylistSongIds('pl-1', ['d'], 'srv-1');
    store.removePlaylistSongIdsAtIndices('pl-1', [1], 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toEqual(['a', 'c', 'd']);
  });

  it('invalidate drops a single playlist; clearAll drops everything', () => {
    const store = usePlaylistMembershipStore.getState();
    store.setPlaylistSongIds('pl-1', ['a'], 'srv-1');
    store.setPlaylistSongIds('pl-2', ['b'], 'srv-1');
    store.invalidatePlaylistSongIds('pl-1', 'srv-1');
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1')).toBeUndefined();
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-2', 'srv-1')).toEqual(['b']);
    store.clearAllPlaylistSongIds();
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-2', 'srv-1')).toBeUndefined();
  });

  it('ignores ownerless cache writes', () => {
    usePlaylistMembershipStore.getState().setPlaylistSongIds('pl-1', ['a']);
    expect(usePlaylistMembershipStore.getState().songIdsByCacheKey).toEqual({});
  });

  it('commits several missing memberships in one revision', () => {
    const store = usePlaylistMembershipStore.getState();

    const accepted = store.setPlaylistSongIdsBatchIfRevision(
      [
        { playlistId: 'pl-1', serverId: 'srv-1', songIds: ['a', 'b'] },
        { playlistId: 'pl-2', serverId: 'srv-1', songIds: ['c'] },
        { playlistId: 'pl-3', serverId: 'srv-2', songIds: [] },
      ],
      0,
    );

    expect(accepted).toBe(true);
    expect(usePlaylistMembershipStore.getState().revision).toBe(1);
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-1', 'srv-1'))
      .toEqual(['a', 'b']);
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-2', 'srv-1'))
      .toEqual(['c']);
    expect(usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-3', 'srv-2'))
      .toEqual([]);
  });

  it('rejects the entire batch when membership changed after its snapshot', () => {
    const store = usePlaylistMembershipStore.getState();
    const snapshotRevision = store.revision;

    store.setPlaylistSongIds('pl-raced', ['new-server-truth'], 'srv-1');

    const accepted = store.setPlaylistSongIdsBatchIfRevision(
      [
        { playlistId: 'pl-raced', serverId: 'srv-1', songIds: ['stale-fetch'] },
        { playlistId: 'pl-other', serverId: 'srv-1', songIds: ['fetched'] },
      ],
      snapshotRevision,
    );

    expect(accepted).toBe(false);
    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-raced', 'srv-1'),
    ).toEqual(['new-server-truth']);
    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('pl-other', 'srv-1'),
    ).toBeUndefined();
    expect(usePlaylistMembershipStore.getState().revision).toBe(1);
  });

  it('preserves an existing membership while filling other missing entries', () => {
    const store = usePlaylistMembershipStore.getState();
    store.setPlaylistSongIds('existing', ['current'], 'srv-1');

    const revision = usePlaylistMembershipStore.getState().revision;

    const accepted = usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIdsBatchIfRevision(
        [
          { playlistId: 'existing', serverId: 'srv-1', songIds: ['wrong'] },
          { playlistId: 'missing', serverId: 'srv-1', songIds: ['new'] },
        ],
        revision,
      );

    expect(accepted).toBe(true);
    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('existing', 'srv-1'),
    ).toEqual(['current']);
    expect(
      usePlaylistMembershipStore.getState().getPlaylistSongIds('missing', 'srv-1'),
    ).toEqual(['new']);
    expect(usePlaylistMembershipStore.getState().revision).toBe(revision + 1);
  });

  it('still checks the revision when the batch is empty', () => {
    const store = usePlaylistMembershipStore.getState();
    const snapshotRevision = store.revision;

    store.invalidatePlaylistSongIds('unrelated', 'srv-1');

    const accepted = usePlaylistMembershipStore
      .getState()
      .setPlaylistSongIdsBatchIfRevision([], snapshotRevision);

    expect(accepted).toBe(false);
    expect(usePlaylistMembershipStore.getState().revision).toBe(1);
  });
});
