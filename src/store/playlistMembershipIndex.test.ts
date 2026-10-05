import { describe, expect, it, vi } from 'vitest';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import {
  buildTrackPlaylistMembershipIndex,
  playlistMembershipsForTrack,
  unresolvedPlaylistMembershipsForServer,
  type PlaylistMembershipLookup,
} from '@/store/playlistMembershipIndex';

function playlist(
  id: string,
  name: string,
  serverId?: string,
): SubsonicPlaylist {
  return {
    id,
    name,
    serverId,
    songCount: 0,
    duration: 0,
    created: '2026-01-01T00:00:00Z',
    changed: '2026-01-01T00:00:00Z',
  };
}

function membershipLookup(
  memberships: Record<string, readonly string[]>,
): PlaylistMembershipLookup {
  return (playlistId, serverId) => memberships[`${serverId}:${playlistId}`];
}

describe('playlistMembershipIndex', () => {
  it('indexes every resolved playlist that contains a track', () => {
    const playlists = [
      playlist('road', 'Road Trip', 'srv-1'),
      playlist('favorites', 'Favorites', 'srv-1'),
      playlist('other', 'Other', 'srv-1'),
    ];

    const index = buildTrackPlaylistMembershipIndex(
      playlists,
      membershipLookup({
        'srv-1:road': ['song-1', 'song-2'],
        'srv-1:favorites': ['song-1'],
        'srv-1:other': ['song-3'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'favorites', serverId: 'srv-1', name: 'Favorites' },
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);

    expect(
      playlistMembershipsForTrack(index, { id: 'song-2', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
    ]);

    expect(index.unresolvedPlaylistsByServer.size).toBe(0);
  });

  it('carries smart and read-only metadata into membership refs', () => {
    const pl = {
      ...playlist('smart', 'Smart', 'srv-1'),
      smart: true,
      readonly: true,
      smartMetadataUnavailable: false,
    };

    const index = buildTrackPlaylistMembershipIndex(
      [pl],
      membershipLookup({
        'srv-1:smart': ['song-1'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, {
        id: 'song-1',
        serverId: 'srv-1',
      }),
    ).toEqual([
      {
        id: 'smart',
        serverId: 'srv-1',
        name: 'Smart',
        smart: true,
        readonly: true,
        smartMetadataUnavailable: false,
      },
    ]);
  });

  it('does not duplicate a playlist when the same song occurs several times', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [playlist('repeat', 'Repeat', 'srv-1')],
      membershipLookup({
        'srv-1:repeat': ['song-1', 'song-1', 'song-1'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'repeat', serverId: 'srv-1', name: 'Repeat' },
    ]);
  });

  it('keeps identical song ids isolated by owning server', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [
        playlist('one', 'Server One', 'srv-1'),
        playlist('two', 'Server Two', 'srv-2'),
      ],
      membershipLookup({
        'srv-1:one': ['same-song-id'],
        'srv-2:two': ['same-song-id'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, {
        id: 'same-song-id',
        serverId: 'srv-1',
      }),
    ).toEqual([
      { id: 'one', serverId: 'srv-1', name: 'Server One' },
    ]);

    expect(
      playlistMembershipsForTrack(index, {
        id: 'same-song-id',
        serverId: 'srv-2',
      }),
    ).toEqual([
      { id: 'two', serverId: 'srv-2', name: 'Server Two' },
    ]);
  });

  it('reports unresolved playlists without inventing membership', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [
        playlist('known', 'Known', 'srv-1'),
        playlist('unknown', 'Unknown', 'srv-1'),
      ],
      membershipLookup({
        'srv-1:known': ['song-1'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'known', serverId: 'srv-1', name: 'Known' },
    ]);

    expect(unresolvedPlaylistMembershipsForServer(index, 'srv-1')).toEqual([
        { id: 'unknown', serverId: 'srv-1', name: 'Unknown' },
    ]);
    });

  it('treats a hydrated empty playlist as resolved', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [playlist('empty', 'Empty', 'srv-1')],
      membershipLookup({
        'srv-1:empty': [],
      }),
    );

    expect(index.unresolvedPlaylistsByServer.size).toBe(0);
    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([]);
  });

  it('ignores ownerless playlists because membership cannot be safely scoped', () => {
    const lookup = vi.fn<PlaylistMembershipLookup>(() => ['song-1']);

    const index = buildTrackPlaylistMembershipIndex(
      [playlist('legacy', 'Legacy')],
      lookup,
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(index.playlistsByTrackKey.size).toBe(0);
    expect(index.unresolvedPlaylistsByServer.size).toBe(0);
  });

  it('ignores membership data belonging to playlists no longer in the current list', () => {
    const lookup = membershipLookup({
      'srv-1:current': ['song-1'],
      'srv-1:deleted': ['song-1'],
    });

    const index = buildTrackPlaylistMembershipIndex(
      [playlist('current', 'Current', 'srv-1')],
      lookup,
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'current', serverId: 'srv-1', name: 'Current' },
    ]);
  });

  it('uses deterministic playlist ordering rather than API input order', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [
        playlist('z', 'Zebra', 'srv-1'),
        playlist('a2', 'Alpha', 'srv-1'),
        playlist('a1', 'Alpha', 'srv-1'),
      ],
      membershipLookup({
        'srv-1:z': ['song-1'],
        'srv-1:a2': ['song-1'],
        'srv-1:a1': ['song-1'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1', serverId: 'srv-1' }),
    ).toEqual([
      { id: 'a1', serverId: 'srv-1', name: 'Alpha' },
      { id: 'a2', serverId: 'srv-1', name: 'Alpha' },
      { id: 'z', serverId: 'srv-1', name: 'Zebra' },
    ]);
  });

  it('returns no membership for an ownerless track', () => {
    const index = buildTrackPlaylistMembershipIndex(
      [playlist('road', 'Road Trip', 'srv-1')],
      membershipLookup({
        'srv-1:road': ['song-1'],
      }),
    );

    expect(
      playlistMembershipsForTrack(index, { id: 'song-1' }),
    ).toEqual([]);
  });

  it('scopes unresolved membership to the playlist owner server', () => {
    const index = buildTrackPlaylistMembershipIndex(
        [
        playlist('known', 'Known', 'srv-1'),
        playlist('unknown', 'Unknown', 'srv-2'),
        ],
        membershipLookup({
        'srv-1:known': ['same-song-id'],
        }),
    );

    expect(
        playlistMembershipsForTrack(index, {
        id: 'same-song-id',
        serverId: 'srv-1',
        }),
    ).toEqual([
        { id: 'known', serverId: 'srv-1', name: 'Known' },
    ]);

    expect(
        unresolvedPlaylistMembershipsForServer(index, 'srv-1'),
    ).toEqual([]);

    expect(
        unresolvedPlaylistMembershipsForServer(index, 'srv-2'),
    ).toEqual([
        { id: 'unknown', serverId: 'srv-2', name: 'Unknown' },
    ]);
  });
});