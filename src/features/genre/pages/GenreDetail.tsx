import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, ListPlus, Loader2 } from 'lucide-react';
import { AlbumCard } from '@/features/album';
import { PagedSongList } from '@/features/search';
import { LongPressWaveOverlay } from '@/ui/LongPressWaveOverlay';
import InpageScrollSentinel from '@/ui/InpageScrollSentinel';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';
import { GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { albumGridWarmCovers } from '@/cover/layoutSizes';
import { type AlbumBrowseScrollSnapshot } from '@/features/album';
import { useGenreAlbumBrowse } from '@/features/album';
import { useAlbumBrowseScrollRestore } from '@/features/album';
import { useGenreDetailBrowse } from '@/features/genre/hooks/useGenreDetailBrowse';
import { useGenreTrackBrowse } from '@/features/genre/hooks/useGenreTrackBrowse';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import { useInpageScrollViewport } from '@/lib/hooks/useInpageScrollViewport';
import { useLongPressAction } from '@/lib/hooks/useLongPressAction';
import { useMainstageInpageHeaderTight } from '@/lib/hooks/useMainstageInpageHeaderTight';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import {
  fetchGenreAlbumCount,
  fetchGenreTracksForPlayback,
  lookupScopedGenreAlbumCount,
} from '@/features/playback/utils/playback/genreBrowsePlayback';
import { lookupGenreAlbumCount } from '@/lib/library/genreCatalogCountsCache';
import { libraryScopeCacheKeyForServer } from '@/lib/api/subsonicClient';
import {
  readAlbumBrowseRestore,
  readAlbumDetailReturnTo,
} from '@/lib/navigation/albumDetailNavigation';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';
import {
  runBulkEnqueue,
  runBulkPlayAll,
  runBulkShuffle,
} from '@/features/playback/utils/playback/runBulkPlay';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { useUnavailableServerIds } from '@/lib/network/serverReachability';
import { resolveGenreHeaderCount } from './genreHeaderCount';

type GenreDetailView = 'albums' | 'tracks';

function genreDetailView(search: string): GenreDetailView {
  return new URLSearchParams(search).get('view') === 'tracks'
    ? 'tracks'
    : 'albums';
}

export default function GenreDetail() {
  const { name } = useParams<{ name: string }>();
  const genre = decodeURIComponent(name ?? '');
  const { t } = useTranslation();
  const perfFlags = usePerfProbeFlags();
  const navigate = useNavigate();
  const location = useLocation();
  const view = genreDetailView(location.search);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const activeServerId = useAuthStore(s => s.activeServerId ?? '');
  const servers = useAuthStore(s => s.servers);
  const libraryBrowseServerIds = useAuthStore(s => s.libraryBrowseServerIds);
  const musicFoldersByServer = useAuthStore(s => s.musicFoldersByServer);
  const libraryBrowseSelectionByServer = useAuthStore(s => s.libraryBrowseSelectionByServer);
  const unavailableServerIds = useUnavailableServerIds();
  const browseScope = useMemo(
    () => deriveLibraryBrowseScope({
      servers,
      activeServerId: activeServerId || null,
      libraryBrowseServerIds,
      musicFoldersByServer,
      libraryBrowseSelectionByServer,
    }, unavailableServerIds),
    [
      activeServerId,
      libraryBrowseSelectionByServer,
      libraryBrowseServerIds,
      musicFoldersByServer,
      servers,
      unavailableServerIds,
    ],
  );
  const serverId = browseScope.anchorServerId ?? activeServerId;
  const indexEnabled = useLibraryIndexStore(s => s.isIndexEnabled(serverId));
  const playTrack = usePlayerStore(s => s.playTrack);
  const enqueue = usePlayerStore(s => s.enqueue);

  const albumScrollSnapshotRef = useRef<AlbumBrowseScrollSnapshot>({
    scrollTop: 0,
    displayCount: 0,
  });
  const trackScrollSnapshotRef = useRef<AlbumBrowseScrollSnapshot>({
    scrollTop: 0,
    displayCount: 0,
  });
  const activeScrollSnapshotRef =
    view === 'albums'
      ? albumScrollSnapshotRef
      : trackScrollSnapshotRef;
  const tabScrollSessionKey = JSON.stringify([
    serverId,
    genre,
    musicLibraryFilterVersion,
    browseScope.fingerprint,
  ]);
  const tabScrollSessionKeyRef = useRef(tabScrollSessionKey);
  const previousViewRef = useRef<GenreDetailView>(view);
  const pendingTabScrollRestoreRef = useRef<GenreDetailView | null>(null);

  const {
    sort,
    restoreDisplayCount,
    restoreView,
    restoreTabScrollSnapshots,
  } = useGenreDetailBrowse(
    serverId,
    genre,
    activeScrollSnapshotRef,
    albumScrollSnapshotRef,
    trackScrollSnapshotRef,
  );

  useLayoutEffect(() => {
    if (!restoreTabScrollSnapshots) return;
    albumScrollSnapshotRef.current = {
      ...restoreTabScrollSnapshots.albums,
    };
    trackScrollSnapshotRef.current = {
      ...restoreTabScrollSnapshots.tracks,
    };
  }, [restoreTabScrollSnapshots]);

  const {
    scrollBodyEl,
    bindScrollBody: bindGenreDetailScrollBody,
    getScrollRoot,
  } = useInpageScrollViewport();

  const albumSessionKey = JSON.stringify([
    serverId,
    genre,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope.fingerprint,
  ]);
  const [albumSession, setAlbumSession] = useState(() => ({
    key: albumSessionKey,
    started: view === 'albums',
  }));
  const albumSessionStarted =
    albumSession.key === albumSessionKey
      ? albumSession.started || view === 'albums'
      : view === 'albums';

  useEffect(() => {
    const nextStarted =
      albumSession.key === albumSessionKey
        ? albumSession.started || view === 'albums'
        : view === 'albums';

    if (
      albumSession.key === albumSessionKey &&
      albumSession.started === nextStarted
    ) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbumSession({
      key: albumSessionKey,
      started: nextStarted,
    });
  }, [
    albumSession.key,
    albumSession.started,
    albumSessionKey,
    view,
  ]);

  const albumGenre = albumSessionStarted ? genre : '';
  const {
    albums,
    loading: albumsLoading,
    loadingMore: albumsLoadingMore,
    hasMore: albumsHasMore,
    displayAlbums,
    bindLoadMoreSentinel,
    loadMore: loadMoreAlbums,
  } = useGenreAlbumBrowse(
    serverId,
    albumGenre,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope,
    getScrollRoot,
    scrollBodyEl,
    restoreTabScrollSnapshots?.albums.displayCount ??
      (restoreView === 'albums'
        ? restoreDisplayCount
        : undefined),
  );

  const {
    songs,
    total: trackCount,
    loading: tracksLoading,
    sessionReady: tracksSessionReady,
    loadingMore: tracksLoadingMore,
    hasMore: tracksHasMore,
    loadMore: loadMoreTracks,
  } = useGenreTrackBrowse(
    serverId,
    genre,
    indexEnabled,
    view === 'tracks',
    musicLibraryFilterVersion,
    browseScope,
  );

  const bindTrackLoadMoreSentinel = useInpageScrollSentinel({
    active: view === 'tracks' && tracksHasMore,
    getScrollRoot,
    scrollRootEl: scrollBodyEl,
    onIntersect: loadMoreTracks,
    rootMargin: '600px',
  });

  const activeDisplayCount =
    view === 'albums'
      ? displayAlbums.length
      : songs.length;
  const activeLoading =
    view === 'albums'
      ? albumsLoading
      : tracksLoading;
  const activeLoadingMore =
    view === 'albums'
      ? albumsLoadingMore
      : tracksLoadingMore;
  const activeSessionReady =
    view === 'albums'
      ? !albumsLoading
      : tracksSessionReady;
  const activeHasMore =
    view === 'albums'
      ? albumsHasMore
      : tracksHasMore;
  const activeLoadMore =
    view === 'albums'
      ? loadMoreAlbums
      : loadMoreTracks;

  // eslint-disable-next-line react-hooks/immutability
  useLayoutEffect(() => {
    if (!scrollBodyEl) return;

    if (tabScrollSessionKeyRef.current !== tabScrollSessionKey) {
      tabScrollSessionKeyRef.current = tabScrollSessionKey;
      albumScrollSnapshotRef.current = {
        scrollTop: 0,
        displayCount: 0,
      };
      trackScrollSnapshotRef.current = {
        scrollTop: 0,
        displayCount: 0,
      };
      previousViewRef.current = view;
      pendingTabScrollRestoreRef.current = null;
      // eslint-disable-next-line react-hooks/immutability
      scrollBodyEl.scrollTop = 0;
    } else if (previousViewRef.current !== view) {
      previousViewRef.current = view;
      pendingTabScrollRestoreRef.current = view;
    }

    const snapshotRef =
      view === 'albums'
        ? albumScrollSnapshotRef
        : trackScrollSnapshotRef;

    const syncScrollTop = () => {
      if (pendingTabScrollRestoreRef.current === view) return;
      snapshotRef.current.scrollTop = scrollBodyEl.scrollTop;
    };

    if (pendingTabScrollRestoreRef.current !== view) {
      syncScrollTop();
    }

    scrollBodyEl.addEventListener('scroll', syncScrollTop, {
      passive: true,
    });

    return () => {
      scrollBodyEl.removeEventListener('scroll', syncScrollTop);
    };
  }, [
    scrollBodyEl,
    tabScrollSessionKey,
    view,
  ]);

  useEffect(() => {
    if (pendingTabScrollRestoreRef.current === view) return;
    activeScrollSnapshotRef.current.displayCount = activeDisplayCount;
  }, [
    view,
    activeDisplayCount,
    activeScrollSnapshotRef,
  ]);

  // eslint-disable-next-line react-hooks/immutability
  useLayoutEffect(() => {
    if (
      !scrollBodyEl ||
      pendingTabScrollRestoreRef.current !== view ||
      !activeSessionReady ||
      activeLoading ||
      activeLoadingMore
    ) {
      return;
    }

    const snapshot = activeScrollSnapshotRef.current;

    if (
      activeDisplayCount < snapshot.displayCount &&
      activeHasMore
    ) {
      activeLoadMore();
      return;
    }

    // eslint-disable-next-line react-hooks/immutability
    scrollBodyEl.scrollTop = snapshot.scrollTop;
    snapshot.scrollTop = scrollBodyEl.scrollTop;
    pendingTabScrollRestoreRef.current = null;
  }, [
    view,
    scrollBodyEl,
    activeDisplayCount,
    activeSessionReady,
    activeLoading,
    activeLoadingMore,
    activeHasMore,
    activeLoadMore,
    activeScrollSnapshotRef,
  ]);

  const { isScrollRestorePending } = useAlbumBrowseScrollRestore({
    serverId,
    genreName: genre,
    scrollBodyEl,
    displayAlbumsLength: activeDisplayCount,
    loading: activeLoading,
    loadingMore: activeLoadingMore,
    hasMore: activeHasMore,
    loadMore: activeLoadMore,
  });

  useEffect(() => {
    if (
      isScrollRestorePending ||
      !readAlbumBrowseRestore(location.state)
    ) {
      return;
    }
    navigate(
      `${location.pathname}${location.search}${location.hash}`,
      { replace: true, state: null },
    );
  }, [
    view,
    isScrollRestorePending,
    location.pathname,
    location.search,
    location.hash,
    location.state,
    navigate,
  ]);

  const [albumCount, setAlbumCount] = useState<number | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    if (!genre || !serverId) return;
    const cached = lookupScopedGenreAlbumCount(browseScope, genre)
      ?? lookupGenreAlbumCount(serverId, genre, libraryScopeCacheKeyForServer(serverId));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbumCount(cached);
  }, [serverId, genre, musicLibraryFilterVersion, browseScope]);

  useEffect(() => {
    if (!genre || albumsLoading || !albumsHasMore) return;
    const cached = lookupScopedGenreAlbumCount(browseScope, genre)
      ?? lookupGenreAlbumCount(serverId, genre, libraryScopeCacheKeyForServer(serverId));
    if (cached != null && !browseScope.multiServer) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchGenreAlbumCount(serverId, genre, indexEnabled, sort, browseScope).then(count => {
        if (!cancelled) setAlbumCount(count);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    serverId,
    genre,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope,
    albumsLoading,
    albumsHasMore,
  ]);

  const fetchGenreTracks = useCallback(
    (shuffle?: boolean) => fetchGenreTracksForPlayback(serverId, genre, {
      shuffle,
      indexEnabled,
    }),
    [serverId, genre, indexEnabled],
  );

  const handlePlayAll = useCallback(
    () => runBulkPlayAll({
      fetchTracks: () => fetchGenreTracks(false),
      setLoading: setBulkLoading,
      playTrack,
    }),
    [fetchGenreTracks, playTrack],
  );
  const handleShuffleAll = useCallback(
    () => runBulkShuffle({
      fetchTracks: () => fetchGenreTracks(true),
      setLoading: setBulkLoading,
      playTrack,
    }),
    [fetchGenreTracks, playTrack],
  );
  const handleEnqueueAll = useCallback(
    () => runBulkEnqueue({
      fetchTracks: () => fetchGenreTracks(false),
      setLoading: setBulkLoading,
      enqueue,
    }),
    [fetchGenreTracks, enqueue],
  );

  const { isHolding, pressBind } = useLongPressAction({
    onShortPress: handlePlayAll,
    onLongPress: handleShuffleAll,
  });

  const handleBack = useCallback(() => {
    navigate(readAlbumDetailReturnTo(location.state) ?? '/genres');
  }, [navigate, location.state]);

  const selectView = useCallback(
    (next: GenreDetailView) => {
      const snapshotRef =
        view === 'albums'
          ? albumScrollSnapshotRef
          : trackScrollSnapshotRef;
      snapshotRef.current.displayCount = activeDisplayCount;
      if (scrollBodyEl) {
        snapshotRef.current.scrollTop = scrollBodyEl.scrollTop;
      }

      const params = new URLSearchParams(location.search);
      if (next === 'tracks') {
        params.set('view', 'tracks');
      } else {
        params.delete('view');
      }

      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        {
          replace: true,
          state: location.state,
        },
      );
    },
    [
      view,
      activeDisplayCount,
      scrollBodyEl,
      location.pathname,
      location.search,
      location.hash,
      location.state,
      navigate,
    ],
  );

  const onTabsKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = view === 'albums' ? 'tracks' : 'albums';
      selectView(next);
      window.setTimeout(() => {
        document.getElementById(`genre-detail-tab-${next}`)?.focus();
      }, 0);
    },
    [selectView, view],
  );

  const resolvedAlbumCount = useMemo(() => {
    return resolveGenreHeaderCount({
      loading: albumsLoading,
      hasMore: albumsHasMore,
      loadedAlbumCount: albums.length,
      albumCount,
    });
  }, [
    albumsLoading,
    albumsHasMore,
    albums.length,
    albumCount,
  ]);
  const resolvedTrackCount =
    trackCount ??
    (!tracksLoading && !tracksHasMore && view === 'tracks'
      ? songs.length
      : null);
  const showPlayback =
    !activeLoading &&
    (
      displayAlbums.length > 0 ||
      songs.length > 0 ||
      (albumCount ?? 0) > 0 ||
      (trackCount ?? 0) > 0
    );

  const mainstageHeaderTight = useMainstageInpageHeaderTight(
    scrollBodyEl,
    [genre, resolvedAlbumCount, resolvedTrackCount, bulkLoading, view],
  );

  return (
    <div className={`content-body animate-fade-in mainstage-inpage-split${mainstageHeaderTight ? ' mainstage-inpage--header-tight' : ''}`}>
      <div className="mainstage-inpage-toolbar">
        <div className="page-sticky-header mainstage-inpage-toolbar-row">
          <button
            className="btn btn-ghost"
            onClick={handleBack}
            aria-label={t('genres.back')}
            data-tooltip={t('genres.back')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '0.25rem' }}
          >
            <ArrowLeft size={16} />
            <span className="toolbar-btn-label">{t('genres.back')}</span>
          </button>

          <div className="psy-page-heading psy-page-heading--fill">
            <h1 className="page-title truncate" title={genre}>{genre}</h1>
            {(resolvedAlbumCount != null || resolvedTrackCount != null) && (
              <span className="psy-page-heading__count">
                <span aria-hidden="true">–</span>
                {resolvedAlbumCount != null &&
                  t('genres.albumCount', { count: resolvedAlbumCount })}
                {resolvedAlbumCount != null && resolvedTrackCount != null && (
                  <span aria-hidden="true"> • </span>
                )}
                {resolvedTrackCount != null &&
                  t('tracks.count', { count: resolvedTrackCount })}
              </span>
            )}
          </div>

          <div
            className="artist-tracks-tabs"
            role="tablist"
            aria-label={t('genres.viewTabsLabel')}
            onKeyDown={onTabsKeyDown}
          >
            <button
              type="button"
              role="tab"
              id="genre-detail-tab-albums"
              aria-selected={view === 'albums'}
              aria-controls="genre-detail-panel"
              tabIndex={view === 'albums' ? 0 : -1}
              className={`btn ${view === 'albums' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => selectView('albums')}
            >
              {t('common.albums')}
            </button>
            <button
              type="button"
              role="tab"
              id="genre-detail-tab-tracks"
              aria-selected={view === 'tracks'}
              aria-controls="genre-detail-panel"
              tabIndex={view === 'tracks' ? 0 : -1}
              className={`btn ${view === 'tracks' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => selectView('tracks')}
            >
              {t('tracks.title')}
            </button>
          </div>

          {showPlayback && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn btn-primary long-press-play-btn"
                {...pressBind}
                disabled={bulkLoading}
                aria-label={t('genres.playTooltip')}
                data-tooltip={t('genres.playTooltip')}
              >
                <LongPressWaveOverlay active={isHolding} size="compact" />
                <span className="long-press-play-btn__icon" style={{ gap: '0.35rem' }}>
                  {bulkLoading ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
                  <span className="toolbar-btn-label">{t('common.play')}</span>
                </span>
              </button>
              <button
                className="btn btn-surface"
                style={{ alignSelf: 'stretch' }}
                onClick={handleEnqueueAll}
                disabled={bulkLoading}
                aria-label={t('genres.addToQueue')}
                data-tooltip={t('genres.addToQueue')}
              >
                <ListPlus size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <OverlayScrollArea
        className="mainstage-inpage-scroll"
        viewportClassName="mainstage-inpage-scroll__viewport"
        viewportId={GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
        viewportRef={bindGenreDetailScrollBody}
        railInset="panel"
        measureDeps={[
          activeLoading,
          activeDisplayCount,
          activeHasMore,
          genre,
          view,
          perfFlags.disableMainstageVirtualLists,
        ]}
      >
        <div
          id="genre-detail-panel"
          role="tabpanel"
          aria-labelledby={`genre-detail-tab-${view}`}
        >
          {view === 'albums' ? (
            albumsLoading && albums.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                <div className="spinner" />
              </div>
            ) : !albumsLoading && displayAlbums.length === 0 ? (
              <p className="loading-text" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                {t('genres.albumsEmpty')}
              </p>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ visibility: isScrollRestorePending ? 'hidden' : 'visible' }}>
                  <VirtualCardGrid
                    items={displayAlbums}
                    itemKey={(album, _index) => album.id}
                    rowVariant="album"
                    disableVirtualization={perfFlags.disableMainstageVirtualLists}
                    layoutSignal={displayAlbums.length}
                    scrollRootId={GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
                    warmGridCovers={albumGridWarmCovers()}
                    renderItem={album => (
                      <AlbumCard
                        album={album}
                        observeScrollRootId={GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
                      />
                    )}
                  />
                  {albumsHasMore && (
                    <InpageScrollSentinel
                      bindSentinel={bindLoadMoreSentinel}
                      loading={albumsLoadingMore}
                      itemCount={displayAlbums.length}
                    />
                  )}
                </div>
                {isScrollRestorePending && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      justifyContent: 'center',
                      paddingTop: '3rem',
                      background: 'var(--bg-app)',
                    }}
                  >
                    <div className="spinner" />
                  </div>
                )}
              </div>
            )
          ) : tracksLoading && songs.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" />
            </div>
          ) : !tracksLoading && songs.length === 0 ? (
            <p className="loading-text" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
              {t('genres.tracksEmpty')}
            </p>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ visibility: isScrollRestorePending ? 'hidden' : 'visible' }}>
                <PagedSongList
                  songs={songs}
                  hasMore={false}
                  loadingMore={false}
                  onLoadMore={loadMoreTracks}
                />
                {tracksHasMore && (
                  <InpageScrollSentinel
                    bindSentinel={bindTrackLoadMoreSentinel}
                    loading={tracksLoadingMore}
                    itemCount={songs.length}
                    style={{ padding: '1rem', height: 'auto', margin: 0 }}
                  />
                )}
              </div>
              {isScrollRestorePending && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    paddingTop: '3rem',
                    background: 'var(--bg-app)',
                  }}
                >
                  <div className="spinner" />
                </div>
              )}
            </div>
          )}
        </div>
      </OverlayScrollArea>
    </div>
  );
}
