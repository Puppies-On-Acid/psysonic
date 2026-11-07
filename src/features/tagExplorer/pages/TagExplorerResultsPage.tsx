import { useCallback, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { albumGridWarmCovers } from '@/cover/layoutSizes';
import { AlbumCard } from '@/features/album';
import TagExplorerPlaylistAction from '@/features/tagExplorer/components/TagExplorerPlaylistAction';
import { useTagExplorerBrowse } from '@/features/tagExplorer/hooks/useTagExplorerBrowse';
import { useTagExplorerTrackSelection } from '@/features/tagExplorer/hooks/useTagExplorerTrackSelection';
import {
  parseTagExplorerSearch,
  serializeTagExplorerSearch,
  type TagExplorerView,
} from '@/features/tagExplorer/utils/tagExplorerQuery';
import { useTagExplorerScrollRestore } from '@/features/tagExplorer/hooks/useTagExplorerScrollRestore';
import { PagedSongList } from '@/features/search';
import { TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import { useInpageScrollViewport } from '@/lib/hooks/useInpageScrollViewport';
import { useMainstageInpageHeaderTight } from '@/lib/hooks/useMainstageInpageHeaderTight';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { genreColor } from '@/lib/library/genreColor';
import { useUnavailableServerIds } from '@/lib/network/serverReachability';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useAuthStore } from '@/store/authStore';
import InpageScrollSentinel from '@/ui/InpageScrollSentinel';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';

function formatCount(
  count: number | null,
  fallback: number,
  ready: boolean,
  hasMore: boolean,
): number | null {
  if (count != null) return count;
  if (ready && !hasMore) return fallback;
  return null;
}

export default function TagExplorerResultsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const perfFlags = usePerfProbeFlags();
  const unavailableServerIds = useUnavailableServerIds();

  const origin = location.pathname.startsWith('/moods/')
    ? 'moods' as const
    : 'genres' as const;
  const state = useMemo(
    () => parseTagExplorerSearch(location.search),
    [location.search],
  );
  const valid = state.tags.length >= 2;

  const activeServerId = useAuthStore(s => s.activeServerId ?? '');
  const servers = useAuthStore(s => s.servers);
  const libraryBrowseServerIds = useAuthStore(s => s.libraryBrowseServerIds);
  const musicFoldersByServer = useAuthStore(s => s.musicFoldersByServer);
  const libraryBrowseSelectionByServer = useAuthStore(
    s => s.libraryBrowseSelectionByServer,
  );
  const musicLibraryFilterVersion = useAuthStore(
    s => s.musicLibraryFilterVersion,
  );

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

  const {
    albums,
    albumHasMore,
    albumTotal,
    albumsReady,
    activeQueryReady,
    albumsLoading,
    albumsLoadingMore,
    loadMoreAlbums,
    songs,
    trackHasMore,
    trackTotal,
    tracksReady,
    tracksLoading,
    tracksLoadingMore,
    loadMoreTracks,
    albumError,
    trackError,
  } = useTagExplorerBrowse(
    serverId,
    state.tags,
    state.mode,
    state.view,
    musicLibraryFilterVersion,
    browseScope,
  );

  const selectionQueryKey = useMemo(
    () => JSON.stringify([
      state.tags.map(tag => [tag.kind, tag.value.toLocaleLowerCase()]),
      state.mode,
      browseScope.fingerprint,
    ]),
    [state.tags, state.mode, browseScope.fingerprint],
  );
  const trackSelection = useTagExplorerTrackSelection(
    selectionQueryKey,
  );

  const resolvedAlbumTotal = formatCount(
    albumTotal,
    albums.length,
    albumsReady,
    albumHasMore,
  );
  const resolvedTrackTotal = formatCount(
    trackTotal,
    songs.length,
    tracksReady,
    trackHasMore,
  );
  const selectedTrackCount = trackSelection.selectedCount(
    resolvedTrackTotal,
  );

  const { scrollBodyEl, bindScrollBody, getScrollRoot } = useInpageScrollViewport();
  const { saveBeforeNavigation } = useTagExplorerScrollRestore({
    pathname: location.pathname,
    search: location.search,
    view: state.view,
    valid,
    scrollBodyEl,
    displayCount: state.view === 'albums' ? albums.length : songs.length,
    ready: state.view === 'albums'
      ? albumsReady || albumError !== null
      : tracksReady || trackError !== null,
    loading: state.view === 'albums' ? albumsLoading : tracksLoading,
    loadingMore: state.view === 'albums' ? albumsLoadingMore : tracksLoadingMore,
    // Avoid a retry loop if loading another page fails during restoration.
    hasMore: state.view === 'albums'
      ? albumHasMore && albumError === null
      : trackHasMore && trackError === null,
    loadMore: state.view === 'albums' ? loadMoreAlbums : loadMoreTracks,
  });

  const updateQuery = useCallback((
    patch: Partial<{
      mode: 'or' | 'and';
      view: TagExplorerView;
    }>,
  ) => {
    const search = serializeTagExplorerSearch({
      tags: state.tags,
      mode: patch.mode ?? state.mode,
      view: patch.view ?? state.view,
    });
    if (search !== location.search) saveBeforeNavigation();
    navigate({
      pathname: location.pathname,
      search,
      hash: location.hash,
    }, {
      replace: true,
      state: location.state,
    });
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    saveBeforeNavigation,
    state.mode,
    state.tags,
    state.view,
  ]);

  const headerTight = useMainstageInpageHeaderTight(
    scrollBodyEl,
    [location.pathname, location.search],
  );
  const bindAlbumLoadMore = useInpageScrollSentinel({
    active: state.view === 'albums' && albumHasMore,
    getScrollRoot,
    scrollRootEl: scrollBodyEl,
    onIntersect: loadMoreAlbums,
    rootMargin: '600px',
  });
  const bindTrackLoadMore = useInpageScrollSentinel({
    active: state.view === 'tracks' && trackHasMore,
    getScrollRoot,
    scrollRootEl: scrollBodyEl,
    onIntersect: loadMoreTracks,
    rootMargin: '600px',
  });

  const error = state.view === 'albums'
    ? albumError
    : trackError;

  const currentEmpty =
    state.view === 'albums'
      ? albumsReady && !albumsLoading && albums.length === 0
      : tracksReady && !tracksLoading && songs.length === 0;

  if (!valid) {
    return (
      <div className="content-body animate-fade-in mainstage-inpage-split tag-explorer-results">
        <div className="mainstage-inpage-toolbar">
          <div className="page-sticky-header mainstage-inpage-toolbar-row tag-explorer-page-header">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(`/${origin}`)}
            >
              <ArrowLeft size={16} />
              {t('tagExplorer.back')}
            </button>
            <h1 className="page-title">{t('tagExplorer.title')}</h1>
          </div>
        </div>
        <OverlayScrollArea
          className="mainstage-inpage-scroll"
          viewportClassName="mainstage-inpage-scroll__viewport"
          viewportId={TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID}
          viewportRef={bindScrollBody}
          railInset="panel"
        >
          <div className="empty-state">
            <h2>{t('tagExplorer.invalidTitle')}</h2>
            <p>{t('tagExplorer.invalidMessage')}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/${origin}`)}
            >
              {t('tagExplorer.chooseTags')}
            </button>
          </div>
        </OverlayScrollArea>
      </div>
    );
  }

  return (
    <div
      className={`content-body animate-fade-in mainstage-inpage-split tag-explorer-results${headerTight
        ? ' mainstage-inpage--header-tight'
        : ''}`}
      data-benchmark-tag-explorer-view={state.view}
      data-benchmark-tag-explorer-mode={state.mode}
      data-benchmark-tag-explorer-tags={JSON.stringify(
        state.tags.map(tag => `${tag.kind}:${tag.value}`),
      )}
      data-benchmark-query-ready={activeQueryReady ? 'true' : 'false'}
      data-benchmark-query-error={error != null ? 'true' : 'false'}
      data-benchmark-loading={
        (state.view === 'albums' ? albumsLoading : tracksLoading)
          ? 'true'
          : 'false'
      }
      data-benchmark-result-count={
        state.view === 'albums' ? albums.length : songs.length
      }
    >
      <div className="mainstage-inpage-toolbar">
        <div className="page-sticky-header mainstage-inpage-toolbar-row tag-explorer-page-header">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              saveBeforeNavigation();
              navigate(`/${origin}`);
            }}
          >
            <ArrowLeft size={16} />
            {t('tagExplorer.back')}
          </button>
          <div className="tag-explorer-page-heading">
            <h1 className="page-title">{t('tagExplorer.title')}</h1>
            <p className="loading-text">
              {t('tagExplorer.subtitle')}
            </p>
          </div>
        </div>

        <div className="tag-explorer-query-bar">
          <div className="tag-explorer-query-tags">
            {state.tags.map(tag => (
              <span
                key={`${tag.kind}:${tag.value.toLocaleLowerCase()}`}
                className="tag-explorer-query-tag"
                style={{
                  '--genre-color': genreColor(tag.value),
                } as React.CSSProperties}
              >
                <span className="tag-explorer-query-tag__kind">
                  {tag.kind === 'genre'
                    ? t('tagExplorer.genre')
                    : t('tagExplorer.mood')}
                </span>
                {tag.value}
              </span>
            ))}
          </div>

          <div
            className="tag-explorer-mode-toggle"
            role="group"
            aria-label={t('tagExplorer.matchMode')}
          >
            <button
              type="button"
              className={`btn ${state.mode === 'or' ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={state.mode === 'or'}
              data-benchmark-tag-explorer-mode-control="or"
              onClick={() => updateQuery({ mode: 'or' })}
            >
              {t('tagExplorer.matchAny')}
            </button>
            <button
              type="button"
              className={`btn ${state.mode === 'and' ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={state.mode === 'and'}
              data-benchmark-tag-explorer-mode-control="and"
              onClick={() => updateQuery({ mode: 'and' })}
            >
              {t('tagExplorer.matchAll')}
            </button>
          </div>
        </div>

        <div className="tag-explorer-results-toolbar">
          <div
            className="artist-tracks-tabs"
            role="tablist"
            aria-label={t('tagExplorer.resultTabs')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={state.view === 'albums'}
              data-benchmark-tag-explorer-view-control="albums"
              className={`btn ${state.view === 'albums' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => updateQuery({ view: 'albums' })}
            >
              {t('common.albums')}
              {resolvedAlbumTotal != null && (
                <span className="tag-explorer-tab-count">
                  {resolvedAlbumTotal}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={state.view === 'tracks'}
              data-benchmark-tag-explorer-view-control="tracks"
              className={`btn ${state.view === 'tracks' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => updateQuery({ view: 'tracks' })}
            >
              {t('tracks.title')}
              {resolvedTrackTotal != null && (
                <span className="tag-explorer-tab-count">
                  {resolvedTrackTotal}
                </span>
              )}
            </button>
          </div>

          {state.view === 'tracks' && tracksReady && resolvedTrackTotal != null && (
            <div className="tag-explorer-track-actions">
              <span className="bulk-action-count">
                {t('tagExplorer.selectedTracks', {
                  count: selectedTrackCount,
                })}
              </span>
              <button
                type="button"
                className="btn btn-surface"
                disabled={resolvedTrackTotal === 0}
                onClick={() => {
                  if (trackSelection.allMatching) trackSelection.clear();
                  else trackSelection.selectAllMatching();
                }}
              >
                {trackSelection.allMatching
                  ? t('tagExplorer.clearTrackSelection')
                  : t('tagExplorer.selectAllMatching', {
                      count: resolvedTrackTotal,
                    })}
              </button>
              <TagExplorerPlaylistAction
                serverId={serverId}
                browseScope={browseScope}
                tags={state.tags}
                mode={state.mode}
                allMatching={trackSelection.allMatching}
                exclusions={trackSelection.exclusions}
                explicitRefs={trackSelection.explicitRefs}
                selectedCount={selectedTrackCount}
                disabled={!trackSelection.hasSelection}
                onSuccess={trackSelection.clear}
              />
            </div>
          )}
        </div>
      </div>

      <OverlayScrollArea
        className="mainstage-inpage-scroll"
        viewportClassName="mainstage-inpage-scroll__viewport"
        viewportId={TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID}
        viewportRef={bindScrollBody}
        railInset="panel"
        measureDeps={[
          state.view,
          state.mode,
          albums.length,
          songs.length,
          albumHasMore,
          trackHasMore,
          albumsLoading,
          tracksLoading,
          albumsLoadingMore,
          tracksLoadingMore,
          selectedTrackCount,
          perfFlags.disableMainstageVirtualLists,
        ]}
      >
        <div className="tag-explorer-results-body">
          {error && (
            <div className="empty-state">
              <h2>{t('tagExplorer.unavailableTitle')}</h2>
              <p>{t('tagExplorer.unavailableMessage')}</p>
            </div>
          )}

          {!error && state.view === 'albums' && (
            albumsLoading && albums.length === 0 ? (
              <div className="tag-explorer-loading">
                <div className="spinner" />
              </div>
            ) : albums.length === 0 ? (
              <div className="empty-state">
                <p>{t('tagExplorer.noAlbums')}</p>
                {state.mode === 'and' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => updateQuery({ mode: 'or' })}
                  >
                    {t('tagExplorer.switchToOr')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <VirtualCardGrid
                  items={albums}
                  itemKey={album => ownedEntityKey(album)}
                  rowVariant="album"
                  disableVirtualization={perfFlags.disableMainstageVirtualLists}
                  layoutSignal={albums.length}
                  scrollRootId={TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID}
                  warmGridCovers={albumGridWarmCovers()}
                  renderItem={album => (
                    <AlbumCard
                      album={album}
                      observeScrollRootId={TAG_EXPLORER_INPAGE_SCROLL_VIEWPORT_ID}
                    />
                  )}
                />
                {albumHasMore && (
                  <InpageScrollSentinel
                    bindSentinel={bindAlbumLoadMore}
                    loading={albumsLoadingMore}
                    itemCount={albums.length}
                  />
                )}
              </>
            )
          )}

          {!error && state.view === 'tracks' && (
            tracksLoading && songs.length === 0 ? (
              <div className="tag-explorer-loading">
                <div className="spinner" />
              </div>
            ) : songs.length === 0 ? (
              <div className="empty-state">
                <p>{t('tagExplorer.noTracks')}</p>
                {state.mode === 'and' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => updateQuery({ mode: 'or' })}
                  >
                    {t('tagExplorer.switchToOr')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <PagedSongList
                  songs={songs}
                  hasMore={false}
                  loadingMore={false}
                  onLoadMore={loadMoreTracks}
                  selection={{
                    isSelected: trackSelection.isSelected,
                    onToggle: (_song, rowIndex, shift) =>
                      trackSelection.toggle(songs, rowIndex, shift),
                    label: (song, selected) =>
                      t(
                        selected
                          ? 'tagExplorer.deselectTrack'
                          : 'tagExplorer.selectTrack',
                        { title: song.title },
                      ),
                  }}
                />
                {trackHasMore && (
                  <InpageScrollSentinel
                    bindSentinel={bindTrackLoadMore}
                    loading={tracksLoadingMore}
                    itemCount={songs.length}
                    style={{ padding: '1rem', height: 'auto', margin: 0 }}
                  />
                )}
              </>
            )
          )}

          {currentEmpty && state.mode === 'or' && (
            <span className="sr-only">
              {t('tagExplorer.noResults')}
            </span>
          )}
        </div>
      </OverlayScrollArea>
    </div>
  );
}
