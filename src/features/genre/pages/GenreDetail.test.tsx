import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

const hoisted = vi.hoisted(() => ({
  useGenreAlbumBrowse: vi.fn(),
  useGenreTrackBrowse: vi.fn(),
  fetchGenreAlbumCount: vi.fn(),
  fetchGenreTracksForPlayback: vi.fn(),
  lookupScopedGenreAlbumCount: vi.fn(),
  lookupGenreAlbumCount: vi.fn(),
}));

vi.mock('@/features/album', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/features/album')
    >('@/features/album');

  return {
    ...actual,
    useGenreAlbumBrowse: hoisted.useGenreAlbumBrowse,
    AlbumCard: ({
      album,
    }: {
      album: { name: string };
    }) => <div>{album.name}</div>,
  };
});

vi.mock('../hooks/useGenreTrackBrowse', () => ({
  useGenreTrackBrowse: hoisted.useGenreTrackBrowse,
}));

vi.mock('@/features/playback/utils/playback/genreBrowsePlayback', () => ({
  fetchGenreAlbumCount: hoisted.fetchGenreAlbumCount,
  fetchGenreTracksForPlayback: hoisted.fetchGenreTracksForPlayback,
  lookupScopedGenreAlbumCount: hoisted.lookupScopedGenreAlbumCount,
}));

vi.mock('@/lib/library/genreCatalogCountsCache', () => ({
  lookupGenreAlbumCount: hoisted.lookupGenreAlbumCount,
}));

vi.mock('@/ui/VirtualCardGrid', () => ({
  VirtualCardGrid: ({
    items,
    renderItem,
  }: {
    items: Array<{ id: string }>;
    renderItem: (
      item: { id: string },
      index: number,
    ) => React.ReactNode;
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={item.id}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/features/search/components/PagedSongList', () => ({
  default: ({
    songs,
  }: {
    songs: Array<{ id: string; title: string }>;
  }) => (
    <div>
      {songs.map(song => (
        <div key={song.id}>{song.title}</div>
      ))}
    </div>
  ),
}));

import GenreDetail from './GenreDetail';

const emptyAlbumBrowseResult = {
  albums: [],
  displayAlbums: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  bindLoadMoreSentinel: vi.fn(),
};

const emptyTrackBrowseResult = {
  songs: [],
  total: null,
  loading: false,
  sessionReady: true,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
};

function renderGenreDetail(
  genre = 'Progressive Rock',
  search = '',
) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/genres/:name"
        element={<GenreDetail />}
      />
      <Route
        path="/genres"
        element={<div>Genres page</div>}
      />
    </Routes>,
    {
      route: `/genres/${encodeURIComponent(genre)}${search}`,
    },
  );
}

describe('GenreDetail', () => {
  beforeEach(() => {
    resetAuthStore();

    const server = makeServer({
      id: 's1',
    });

    useAuthStore.setState({
      servers: [server],
      activeServerId: server.id,
    });

    hoisted.useGenreAlbumBrowse.mockReset();
    hoisted.useGenreTrackBrowse.mockReset();
    hoisted.fetchGenreAlbumCount.mockReset();
    hoisted.fetchGenreTracksForPlayback.mockReset();
    hoisted.lookupScopedGenreAlbumCount.mockReset();
    hoisted.lookupGenreAlbumCount.mockReset();

    hoisted.useGenreAlbumBrowse.mockReturnValue(
      emptyAlbumBrowseResult,
    );
    hoisted.useGenreTrackBrowse.mockReturnValue(
      emptyTrackBrowseResult,
    );
    hoisted.fetchGenreAlbumCount.mockResolvedValue(null);
    hoisted.fetchGenreTracksForPlayback.mockResolvedValue([]);
    hoisted.lookupScopedGenreAlbumCount.mockReturnValue(null);
    hoisted.lookupGenreAlbumCount.mockReturnValue(null);
  });

  it('defaults to Albums without loading the Tracks view', () => {
    hoisted.useGenreAlbumBrowse.mockReturnValue({
      ...emptyAlbumBrowseResult,
      albums: [
        { id: 'album-1', name: 'Signals' },
      ],
      displayAlbums: [
        { id: 'album-1', name: 'Signals' },
      ],
    });

    renderGenreDetail('Progressive Rock');

    expect(
      screen.getByRole('tab', {
        name: 'Albums',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Signals')).toBeInTheDocument();

    const calls = hoisted.useGenreTrackBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[3]).toBe(false);
  });

  it('switches to Tracks and renders matching tracks', async () => {
    const user = userEvent.setup();

    hoisted.useGenreTrackBrowse.mockImplementation((...args) => (
      args[3]
        ? {
            ...emptyTrackBrowseResult,
            songs: [
              { id: 'track-1', title: 'Opening Move' },
              { id: 'track-2', title: 'Finale' },
            ],
            total: 2,
          }
        : emptyTrackBrowseResult
    ));

    renderGenreDetail('Progressive Rock');

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    expect(
      await screen.findByText('Opening Move'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/2 tracks/)).toBeInTheDocument();
  });

  it('keeps Albums active after switching to Tracks', async () => {
    const user = userEvent.setup();

    renderGenreDetail('Progressive Rock');

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    const calls = hoisted.useGenreAlbumBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[1]).toBe('Progressive Rock');
  });

  it('does not start Albums in the background on a direct Tracks view', () => {
    renderGenreDetail('Progressive Rock', '?view=tracks');

    const calls = hoisted.useGenreAlbumBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[1]).toBe('');
  });

  it('restores independent scroll positions when switching tabs', async () => {
    const user = userEvent.setup();

    hoisted.useGenreAlbumBrowse.mockReturnValue({
      ...emptyAlbumBrowseResult,
      albums: [
        { id: 'album-1', name: 'Album One' },
        { id: 'album-2', name: 'Album Two' },
      ],
      displayAlbums: [
        { id: 'album-1', name: 'Album One' },
        { id: 'album-2', name: 'Album Two' },
      ],
    });
    hoisted.useGenreTrackBrowse.mockReturnValue({
      ...emptyTrackBrowseResult,
      songs: [
        { id: 'track-1', title: 'Track One' },
        { id: 'track-2', title: 'Track Two' },
      ],
      total: 2,
    });

    renderGenreDetail('Progressive Rock');

    const viewport =
      document.getElementById(
        'genre-detail-inpage-scroll-viewport',
      );
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    viewport.scrollTop = 320;
    fireEvent.scroll(viewport);

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(0);
    });

    viewport.scrollTop = 740;
    fireEvent.scroll(viewport);

    await user.click(
      screen.getByRole('tab', {
        name: 'Albums',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(320);
    });

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(740);
    });
  });

  it('supports direct Tracks URLs and returns to Genres', async () => {
    const user = userEvent.setup();

    hoisted.useGenreTrackBrowse.mockReturnValue({
      ...emptyTrackBrowseResult,
      songs: [
        { id: 'track-1', title: 'Direct Track' },
      ],
      total: 1,
    });

    renderGenreDetail('Progressive Rock', '?view=tracks');

    expect(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Direct Track')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Back',
      }),
    );

    expect(
      await screen.findByText('Genres page'),
    ).toBeInTheDocument();
  });

  it('shows the track empty state in Tracks view', () => {
    renderGenreDetail('Sparse', '?view=tracks');

    expect(
      screen.getByText('No tracks found for this genre.'),
    ).toBeInTheDocument();
  });
});
