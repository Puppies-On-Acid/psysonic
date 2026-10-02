import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { COLUMNS } from '@/features/album/utils/albumTrackListHelpers';
import { useSelectionStore } from '@/store/selectionStore';

const {
  trackRowMock,
  usePlaylistMembershipHydrationMock,
} = vi.hoisted(() => ({
  trackRowMock: vi.fn(() => null),
  usePlaylistMembershipHydrationMock: vi.fn(),
}));

vi.mock('@/features/playlist', () => ({
  usePlaylistMembershipHydration: usePlaylistMembershipHydrationMock,
}));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/ui/TracklistColumnPicker', () => ({ TracklistColumnPicker: () => null }));
vi.mock('@/features/album/components/TracklistHeaderRow', () => ({ TracklistHeaderRow: () => null }));
vi.mock('@/features/album/components/DiscHeaderCover', () => ({ DiscHeaderCover: () => null }));
vi.mock('@/features/album/components/TrackRow', () => ({ TrackRow: trackRowMock }));

import AlbumTrackList from './AlbumTrackList';

const STORAGE_KEY = 'psysonic_tracklist_columns';
const EMPTY_INDEX = {
  playlistsByTrackKey: new Map(),
  unresolvedPlaylistsByServer: new Map(),
};
const SONGS: SubsonicSong[] = [
  {
    id: 's1',
    serverId: 'srv-1',
    title: 'One',
    artist: 'A',
    album: 'Rec',
    albumId: 'al',
    duration: 60,
    track: 1,
  },
];

function persistPlaylistsColumnVisible(): void {
  const widths = Object.fromEntries(COLUMNS.map(column => [column.key, column.defaultWidth]));
  const visible = COLUMNS
    .filter(column => !column.defaultHidden)
    .map(column => column.key);
  visible.push('playlists');

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    widths,
    visible,
    known: COLUMNS.map(column => column.key),
  }));
}

function renderList(
  hydrationEnabled = true,
  songs: SubsonicSong[] = SONGS,
  playlistMembershipServerId = 'srv-1',
) {
  return renderWithProviders(
    <AlbumTrackList
      songs={songs}
      hasVariousArtists={false}
      currentTrack={null}
      isPlaying={false}
      ratings={{}}
      userRatingOverrides={{}}
      starredSongs={new Set()}
      onPlaySong={vi.fn()}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={vi.fn()}
      playlistMembershipServerId={playlistMembershipServerId}
      playlistMembershipHydrationEnabled={hydrationEnabled}
    />,
  );
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  usePlaylistMembershipHydrationMock.mockReset();
  usePlaylistMembershipHydrationMock.mockReturnValue({
    truthState: 'unknown',
    index: EMPTY_INDEX,
  });
  trackRowMock.mockClear();
  useSelectionStore.getState().clearAll();
});

describe('AlbumTrackList playlist membership hydration gate', () => {
  it('keeps membership hydration disabled while Playlists is hidden by default', () => {
    renderList();

    expect(usePlaylistMembershipHydrationMock).toHaveBeenLastCalledWith({
      serverId: 'srv-1',
      enabled: false,
    });
  });

  it('enables membership hydration when the persisted Playlists column is visible', () => {
    persistPlaylistsColumnVisible();

    renderList();

    expect(usePlaylistMembershipHydrationMock).toHaveBeenLastCalledWith({
      serverId: 'srv-1',
      enabled: true,
    });
  });

  it('keeps membership hydration disabled when the page is offline', () => {
    persistPlaylistsColumnVisible();

    renderList(false);

    expect(usePlaylistMembershipHydrationMock).toHaveBeenLastCalledWith({
      serverId: 'srv-1',
      enabled: false,
    });
  });

  it('uses the album owner as membership fallback for songs without an explicit owner', () => {
    persistPlaylistsColumnVisible();
    usePlaylistMembershipHydrationMock.mockReturnValue({
      truthState: 'ready',
      index: {
        playlistsByTrackKey: new Map([
          ['srv-1:s1', [
            { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
          ]],
        ]),
        unresolvedPlaylistsByServer: new Map(),
      },
    });
    const ownerlessSong: SubsonicSong = {
      ...SONGS[0],
      serverId: undefined,
    };

    renderList(true, [ownerlessSong], 'srv-1');

    expect(trackRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistMembershipTruthState: 'ready',
        playlistMemberships: [
          { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
        ],
      }),
      undefined,
    );
  });

  it('does not borrow album-owner membership for a song explicitly owned by another server', () => {
    persistPlaylistsColumnVisible();
    usePlaylistMembershipHydrationMock.mockReturnValue({
      truthState: 'ready',
      index: {
        playlistsByTrackKey: new Map([
          ['srv-1:s1', [
            { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
          ]],
        ]),
        unresolvedPlaylistsByServer: new Map(),
      },
    });
    const foreignSong: SubsonicSong = {
      ...SONGS[0],
      serverId: 'srv-2',
    };

    renderList(true, [foreignSong], 'srv-1');

    expect(trackRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistMembershipTruthState: 'unknown',
        playlistMemberships: [],
      }),
      undefined,
    );
  });

  it('passes server-owned memberships and truth state into each row', () => {
    persistPlaylistsColumnVisible();
    usePlaylistMembershipHydrationMock.mockReturnValue({
      truthState: 'ready',
      index: {
        playlistsByTrackKey: new Map([
          ['srv-1:s1', [
            { id: 'favorites', serverId: 'srv-1', name: 'Favorites' },
            { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
          ]],
        ]),
        unresolvedPlaylistsByServer: new Map(),
      },
    });

    renderList();

    expect(trackRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistMembershipTruthState: 'ready',
        playlistMemberships: [
          { id: 'favorites', serverId: 'srv-1', name: 'Favorites' },
          { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
        ],
      }),
      undefined,
    );
  });
});
