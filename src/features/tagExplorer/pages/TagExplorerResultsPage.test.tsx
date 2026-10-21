import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import {
  mainRouteInpageScrollViewportId,
  TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID,
} from '@/constants/appScroll';
import { readTagExplorerScroll } from '@/features/tagExplorer/utils/tagExplorerScroll';
import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

const hoisted = vi.hoisted(() => ({
  useBrowse: vi.fn(),
  useSelection: vi.fn(),
}));

vi.mock('@/features/tagExplorer/hooks/useTagExplorerBrowse', () => ({
  useTagExplorerBrowse: hoisted.useBrowse,
}));

vi.mock('@/features/tagExplorer/hooks/useTagExplorerTrackSelection', () => ({
  useTagExplorerTrackSelection: hoisted.useSelection,
}));

vi.mock('@/features/tagExplorer/components/TagExplorerPlaylistAction', () => ({
  default: () => <div>Playlist action</div>,
}));

vi.mock('@/features/album', () => ({
  AlbumCard: ({ album }: { album: { name: string } }) => (
    <div>{album.name}</div>
  ),
}));

vi.mock('@/features/search', () => ({
  PagedSongList: ({ songs }: { songs: Array<{ title: string }> }) => (
    <div>{songs.map(song => <span key={song.title}>{song.title}</span>)}</div>
  ),
}));

vi.mock('@/ui/VirtualCardGrid', () => ({
  VirtualCardGrid: ({
    items,
    renderItem,
    scrollRootId,
  }: {
    items: Array<{ id: string }>;
    renderItem: (item: { id: string; name: string }) => React.ReactNode;
    scrollRootId?: string;
  }) => (
    <div data-scroll-root-id={scrollRootId}>
      {items.map(item => <div key={item.id}>{renderItem(item as never)}</div>)}
    </div>
  ),
}));

import TagExplorerResultsPage from './TagExplorerResultsPage';

const emptySelection = {
  allMatching: false,
  exclusions: new Set<string>(),
  explicitRefs: [],
  hasSelection: false,
  isSelected: vi.fn(() => false),
  toggle: vi.fn(),
  selectAllMatching: vi.fn(),
  selectedCount: vi.fn(() => 0),
  clear: vi.fn(),
};

function browseResult(overrides: Record<string, unknown> = {}) {
  return {
    albums: [{ id: 'a1', serverId: 's1', name: 'Album One' }],
    albumHasMore: false,
    albumTotal: 1,
    albumsReady: true,
    albumsLoading: false,
    albumsLoadingMore: false,
    loadMoreAlbums: vi.fn(),
    songs: [],
    trackHasMore: false,
    trackTotal: null,
    tracksReady: false,
    tracksLoading: false,
    tracksLoadingMore: false,
    loadMoreTracks: vi.fn(),
    error: null,
    ...overrides,
  };
}

function renderPage(search: string, origin = 'genres') {
  return renderWithProviders(
    <Routes>
      <Route
        path={`/${origin}/explore/results`}
        element={<TagExplorerResultsPage />}
      />
      <Route
        path={`/${origin}`}
        element={<div>Catalog</div>}
      />
    </Routes>,
    {
      route: `/${origin}/explore/results${search}`,
    },
  );
}

describe('TagExplorerResultsPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetAuthStore();
    const server = makeServer({ id: 's1' });
    useAuthStore.setState({
      servers: [server],
      activeServerId: server.id,
    });
    hoisted.useBrowse.mockReset();
    hoisted.useBrowse.mockReturnValue(browseResult());
    hoisted.useSelection.mockReset();
    hoisted.useSelection.mockReturnValue(emptySelection);
  });

  it('opens on Albums and does not enable the Tracks query', () => {
    renderPage(
      '?tag=genre%3AProgressive+Rock&tag=mood%3ADreamy',
    );

    expect(
      screen.getByRole('tab', { name: /Albums/ }),
    ).toHaveAttribute('aria-selected', 'true');
    const calls = hoisted.useBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[3]).toBe('albums');
    expect(screen.getByText('Album One')).toBeInTheDocument();
  });

  it('enables Tracks only after the Tracks tab is opened', async () => {
    const user = userEvent.setup();
    hoisted.useBrowse.mockImplementation((...args) =>
      args[3] === 'tracks'
        ? browseResult({
            songs: [{ id: 't1', serverId: 's1', title: 'Track One' }],
            trackTotal: 1,
            tracksReady: true,
          })
        : browseResult(),
    );

    renderPage(
      '?tag=genre%3AProgressive+Rock&tag=mood%3ADreamy',
    );

    await user.click(
      screen.getByRole('tab', { name: /Tracks/ }),
    );

    expect(await screen.findByText('Track One')).toBeInTheDocument();
    const calls = hoisted.useBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[3]).toBe('tracks');
  });

  it('offers OR recovery for an empty AND result', async () => {
    const user = userEvent.setup();
    hoisted.useBrowse.mockReturnValue(
      browseResult({
        albums: [],
        albumTotal: 0,
      }),
    );

    renderPage(
      '?tag=genre%3ARock&tag=mood%3ADreamy&mode=and',
    );

    await user.click(
      screen.getByRole('button', { name: 'Switch to OR' }),
    );

    const calls = hoisted.useBrowse.mock.calls;
    expect(calls[calls.length - 1]?.[2]).toBe('or');
  });

  it('rejects direct result URLs with fewer than two distinct tags', () => {
    renderPage('?tag=genre%3ARock');

    const message = screen.getByText('Choose at least two tags');
    expect(message).toBeInTheDocument();
    expect(document.getElementById(TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID))
      .toContainElement(message);
  });
  it('keeps Explorer controls outside the results scroller', () => {
    renderPage('?tag=genre%3ARock&tag=mood%3ADreamy');

    const scrollViewport = document.getElementById(TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID);
    expect(scrollViewport).not.toBeNull();
    const albumLabel = within(scrollViewport!).getByText('Album One');
    expect(albumLabel).toBeInTheDocument();
    expect(albumLabel.closest('[data-scroll-root-id]')).toHaveAttribute(
      'data-scroll-root-id',
      TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID,
    );

    const toolbar = document.querySelector<HTMLElement>(
      '.tag-explorer-results > .mainstage-inpage-toolbar',
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Back' }));
    expect(toolbar).toContainElement(screen.getByRole('tab', { name: /Albums/i }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'All (AND)' }));
    expect(scrollViewport).not.toContainElement(toolbar);
  });

  it('routes both Explorer origins to the new in-page scroller', () => {
    expect(mainRouteInpageScrollViewportId('/genres/explore/results')).toBe(
      TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID,
    );
    expect(mainRouteInpageScrollViewportId('/moods/explore/results')).toBe(
      TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID,
    );
    expect(mainRouteInpageScrollViewportId('/genres/Rock')).not.toBe(
      TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID,
    );
  });

  it('keeps playlist controls above the scrolling tracks', () => {
    hoisted.useBrowse.mockReturnValue(browseResult({
      albums: [],
      songs: [{ id: 't1', serverId: 's1', title: 'Track One' }],
      trackTotal: 1,
      tracksReady: true,
    }));
    renderPage('?tag=genre%3ARock&tag=mood%3ADreamy&view=tracks');

    const toolbar = document.querySelector<HTMLElement>(
      '.tag-explorer-results > .mainstage-inpage-toolbar',
    );
    expect(toolbar).toContainElement(
      screen.getByRole('button', { name: /Select all 1 matching tracks/i }),
    );
    expect(toolbar).toContainElement(screen.getByText('Playlist action'));
    const scrollViewport = document.getElementById(TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID);
    expect(within(scrollViewport!).getByText('Track One')).toBeInTheDocument();
    expect(scrollViewport).not.toContainElement(toolbar);
  });

  it('restores independent Albums and Tracks positions after switching views', async () => {
    const user = userEvent.setup();
    hoisted.useBrowse.mockImplementation(() => browseResult({
      songs: [{ id: 't-scroll', serverId: 's1', title: 'Scroll Track' }],
      trackTotal: 1,
      tracksReady: true,
    }));

    const search = '?tag=genre%3ARock&tag=mood%3ADreamy';
    renderPage(search);
    const viewport = document.getElementById(TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID)!;

    fireEvent.scroll(Object.assign(viewport, { scrollTop: 420 }));
    await user.click(screen.getByRole('tab', { name: /Tracks/i }));
    fireEvent.scroll(Object.assign(viewport, { scrollTop: 760 }));
    await user.click(screen.getByRole('tab', { name: /Albums/i }));
    expect(await screen.findByText('Album One')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Tracks/i }));

    expect(await screen.findByText('Scroll Track')).toBeInTheDocument();
    await waitFor(() => expect(viewport.scrollTop).toBe(760));
    const snapshots = readTagExplorerScroll('/genres/explore/results', search);
    expect(snapshots.albums).toBe(420);
    expect(snapshots.tracks).toBe(760);
  });

});
