import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { useThemeStore } from '@/store/themeStore';
import type {
  TrackPlaylistMembershipTruthState,
  TrackPlaylistRef,
} from '@/store/playlistMembershipIndex';
import { TrackRow } from './TrackRow';

const columns: ColDef[] = [
  { key: 'num', i18nKey: null, minWidth: 60, defaultWidth: 60, required: true },
  { key: 'title', i18nKey: 'trackTitle', minWidth: 80, defaultWidth: 180, required: true },
];

function renderRow(
  onDoubleClickSong?: (song: ReturnType<typeof makeSubsonicSong>) => void,
  onCursorClick?: (song: ReturnType<typeof makeSubsonicSong>) => void,
  visibleCols: ColDef[] = columns,
  playlistMembershipTruthState: TrackPlaylistMembershipTruthState = 'unknown',
  playlistMemberships: readonly TrackPlaylistRef[] = [],
) {
  const song = makeSubsonicSong({ id: 'album-song-1', title: 'Album song' });
  const onPlaySong = vi.fn();
  const onDragStart = vi.fn();
  const onContextMenu = vi.fn();
  const { container } = renderWithProviders(
    <TrackRow
      song={song}
      globalIdx={0}
      visibleCols={visibleCols}
      gridStyle={{}}
      currentTrack={null}
      isPlaying={false}
      ratingValue={0}
      isStarred={false}
      inSelectMode={false}
      isContextMenuSong={false}
      onPlaySong={onPlaySong}
      onDoubleClickSong={onDoubleClickSong}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={onContextMenu}
      onToggleSelect={vi.fn()}
      onDragStart={onDragStart}
      setContextMenuSongKey={vi.fn()}
      onCursorClick={onCursorClick}
      playlistMembershipTruthState={playlistMembershipTruthState}
      playlistMemberships={playlistMemberships}
    />,
  );
  const row = container.querySelector<HTMLElement>('.track-row')!;
  const playButton = container.querySelector<HTMLButtonElement>('.track-row button')!;
  return { song, onPlaySong, onDragStart, onContextMenu, row, playButton };
}

describe('TrackRow row click to play', () => {
  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
  });

  it('plays on a single click by default', () => {
    const { song, onPlaySong, row } = renderRow();
    fireEvent.click(row);
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('plays only on a double click in double-click mode', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { song, onPlaySong, row } = renderRow();

    fireEvent.click(row);
    expect(onPlaySong).not.toHaveBeenCalled();

    fireEvent.doubleClick(row);
    expect(onPlaySong).toHaveBeenCalledOnce();
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('keeps the play button on a single click and does not replay on its double click', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { onPlaySong, playButton } = renderRow();

    fireEvent.click(playButton);
    expect(onPlaySong).toHaveBeenCalledOnce();

    fireEvent.doubleClick(playButton);
    expect(onPlaySong).toHaveBeenCalledOnce();
  });

  it('hands the double click to Orbit when an Orbit handler is set', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const onDoubleClickSong = vi.fn();
    const { song, onPlaySong, row } = renderRow(onDoubleClickSong);

    fireEvent.doubleClick(row);
    expect(onDoubleClickSong).toHaveBeenCalledWith(song);
    expect(onPlaySong).not.toHaveBeenCalled();

    // The single click still reaches the page, which shows the Orbit hint there.
    fireEvent.click(row);
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('moves the list cursor on a plain click in both modes, but not from the play button', () => {
    const onCursorClick = vi.fn();
    const { song, row, playButton } = renderRow(undefined, onCursorClick);
    fireEvent.click(row);
    expect(onCursorClick).toHaveBeenCalledWith(song, expect.anything());

    useThemeStore.setState({ trackRowPlayClick: 'double' });
    fireEvent.click(row);
    expect(onCursorClick).toHaveBeenCalledTimes(2);

    fireEvent.click(playButton);
    expect(onCursorClick).toHaveBeenCalledTimes(2);
  });

  it('leaves the cursor alone when a click toggles the multi-selection', () => {
    const onCursorClick = vi.fn();
    const { row } = renderRow(undefined, onCursorClick);
    fireEvent.click(row, { ctrlKey: true });
    expect(onCursorClick).not.toHaveBeenCalled();
  });

  describe('Playlists column truth states', () => {
    const playlistColumns: ColDef[] = [
      ...columns,
      {
        key: 'playlists',
        i18nKey: 'trackPlaylists',
        minWidth: 100,
        defaultWidth: 180,
        required: false,
        defaultHidden: true,
      },
    ];
    const memberships: readonly TrackPlaylistRef[] = [
      {
        id: 'focus',
        serverId: 'srv-1',
        name: 'psy-smart-Focus',
      },
      {
        id: 'road',
        serverId: 'srv-1',
        name: 'Road Trip',
      },
    ];

    it('renders one direct playlist and a [+N] control when membership is ready', () => {
      const { row } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'ready',
        memberships,
      );

      expect(row.children).toHaveLength(3);
      expect(row.querySelector('.track-playlist-link')).toHaveTextContent('Focus');
      expect(row.querySelector('.track-playlist-more')).toHaveTextContent('[+1]');
    });

    it('does not play the row when the direct playlist or [+N] control is clicked', () => {
      const { onPlaySong } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'ready',
        memberships,
      );

      fireEvent.click(document.querySelector<HTMLButtonElement>('.track-playlist-link')!);
      expect(onPlaySong).not.toHaveBeenCalled();

      fireEvent.click(document.querySelector<HTMLButtonElement>('.track-playlist-more')!);
      expect(onPlaySong).not.toHaveBeenCalled();
    });

    it('does not open the row context menu from playlist controls', () => {
      const { onContextMenu } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'ready',
        memberships,
      );

      fireEvent.contextMenu(
        document.querySelector<HTMLButtonElement>('.track-playlist-link')!,
      );
      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('does not arm a row drag from playlist controls', () => {
      const { onDragStart } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'ready',
        memberships,
      );
      const more = document.querySelector<HTMLButtonElement>('.track-playlist-more')!;

      fireEvent.mouseDown(more, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(document, { clientX: 30, clientY: 10 });
      fireEvent.mouseUp(document);

      expect(onDragStart).not.toHaveBeenCalled();
    });

    it('uses an em dash only for a checked, genuinely empty result', () => {
      const { row } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'ready',
      );

      expect(row.querySelector('.track-playlists-cell')).toHaveTextContent('—');
    });

    it('never presents loading or partial membership as definitely empty', () => {
      const loading = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'loading',
      ).row;
      expect(loading.querySelector('.track-playlists-cell')).toHaveTextContent('…');

      const partial = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'partial',
        memberships.slice(0, 1),
      ).row;
      expect(partial.querySelector('.track-playlist-link')).toHaveTextContent('Focus');
      expect(partial.querySelector('.track-playlist-partial')).toHaveTextContent('…');
    });

    it('leaves unknown membership blank', () => {
      const { row } = renderRow(
        undefined,
        undefined,
        playlistColumns,
        'unknown',
      );

      expect(row.querySelector('.track-playlists-cell')).toHaveTextContent('');
    });
  });
});
