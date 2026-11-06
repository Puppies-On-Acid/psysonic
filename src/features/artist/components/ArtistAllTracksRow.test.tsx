import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import ArtistAllTracksRow, {
  type ArtistAllTracksRowCallbacks,
} from './ArtistAllTracksRow';
import { usePlayerStore } from '@/features/playback';

const playlistColumn: ColDef[] = [{
  key: 'playlists',
  i18nKey: 'trackPlaylists',
  minWidth: 100,
  defaultWidth: 180,
  required: false,
  defaultHidden: true,
}];

function callbacks(): ArtistAllTracksRowCallbacks {
  return {
    activate: vi.fn(),
    doubleClick: vi.fn(),
    context: vi.fn(),
    mouseDownRow: vi.fn(),
    play: vi.fn(),
    startPreview: vi.fn(),
    navArtist: vi.fn(),
    navAlbum: vi.fn(),
  };
}

describe('ArtistAllTracksRow playlist controls', () => {
  afterEach(() => {
    usePlayerStore.getState().closeContextMenu();
  });
  it('does not open the row context menu from a playlist link', () => {
    const cb = callbacks();
    const song = makeSubsonicSong({
      id: 'song-1',
      serverId: 'srv-1',
      title: 'Song',
    });
    const view = renderWithProviders(
      <ArtistAllTracksRow
        song={song}
        index={0}
        visibleCols={playlistColumn}
        gridStyle={{}}
        showBitrate={false}
        isActive={false}
        showEq={false}
        isPreviewing={false}
        previewStarted={false}
        doubleClickActive={false}
        playlistMemberships={[
          { id: 'focus', serverId: 'srv-1', name: 'Focus' },
        ]}
        playlistMembershipTruthState="ready"
        cb={cb}
      />,
    );

    fireEvent.contextMenu(
      view.container.querySelector<HTMLButtonElement>('.track-playlist-link')!,
      { clientX: 14, clientY: 29 },
    );

    expect(cb.context).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().contextMenu).toMatchObject({
      isOpen: true,
      type: 'playlist-membership',
      x: 14,
      y: 29,
      item: {
        id: 'focus',
        serverId: 'srv-1',
        songId: 'song-1',
      },
    });
  });
});
