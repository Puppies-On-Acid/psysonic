import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import {
  useLocation,
  useNavigationType,
} from 'react-router';

import {
  GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
  readInpageScrollTop,
} from '@/constants/appScroll';
import {
  DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
  albumBrowseSortForServer,
  clearGenreDetailReturnStash,
  clearGenreDetailTabScrollSnapshots,
  genreDetailGenreFromPath,
  isAlbumDetailPath,
  isArtistDetailPath,
  isGenreDetailPath,
  peekGenreDetailScrollRestore,
  peekGenreDetailTabScrollSnapshots,
  stashGenreDetailReturnFilters,
  stashGenreDetailTabScrollSnapshots,
  useAlbumBrowseSessionStore,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';
import {
  shouldRestoreAlbumBrowseSession,
} from '@/lib/navigation/albumDetailNavigation';

/** Genre detail: locked genre filter + per-tab leave/restore session. */
export function useGenreDetailBrowse(
  serverId: string,
  genreName: string,
  scrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
  albumScrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
  trackScrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
) {
  const navigationType = useNavigationType();
  const location = useLocation();
  const sort = useAlbumBrowseSessionStore(state =>
    albumBrowseSortForServer(state.sortByServer, serverId),
  );
  const restoredFromStashRef = useRef(false);

  const restoreTabScrollSnapshots = useMemo(
    () => peekGenreDetailTabScrollSnapshots(serverId, genreName),
    [serverId, genreName],
  );

  const restoreSnapshot = useMemo(
    () => ({
      displayCount:
        peekGenreDetailScrollRestore(serverId, genreName)?.displayCount,
      view:
        new URLSearchParams(location.search).get('view') === 'tracks'
          ? 'tracks' as const
          : 'albums' as const,
    }),
    [serverId, genreName, location.search],
  );

  useEffect(() => {
    restoredFromStashRef.current = false;
  }, [serverId, genreName]);

  useEffect(() => {
    if (!serverId || !genreName) return;

    if (
      shouldRestoreAlbumBrowseSession(
        navigationType,
        location.state,
      )
    ) {
      restoredFromStashRef.current = true;
      return;
    }

    if (restoredFromStashRef.current) return;

    clearGenreDetailReturnStash(serverId, genreName);
    clearGenreDetailTabScrollSnapshots(serverId, genreName);
  }, [
    serverId,
    genreName,
    navigationType,
    location.state,
  ]);

  useEffect(() => {
    const snapshot = scrollSnapshotRef?.current;
    const albumSnapshot = albumScrollSnapshotRef?.current;
    const trackSnapshot = trackScrollSnapshotRef?.current;

    return () => {
      if (!serverId || !genreName) return;

      const path = window.location.pathname;

      if (
        isAlbumDetailPath(path) ||
        isArtistDetailPath(path)
      ) {
        const scrollTop = Math.max(
          readInpageScrollTop(
            GENRE_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
          ),
          snapshot?.scrollTop ?? 0,
        );
        const activeView =
          new URLSearchParams(location.search).get('view') === 'tracks'
            ? 'tracks'
            : 'albums';
        const activeDisplayCount = snapshot?.displayCount ?? 0;

        stashGenreDetailTabScrollSnapshots(
          serverId,
          genreName,
          {
            albums: {
              scrollTop:
                activeView === 'albums'
                  ? scrollTop
                  : albumSnapshot?.scrollTop ?? 0,
              displayCount:
                activeView === 'albums'
                  ? activeDisplayCount
                  : albumSnapshot?.displayCount ?? 0,
            },
            tracks: {
              scrollTop:
                activeView === 'tracks'
                  ? scrollTop
                  : trackSnapshot?.scrollTop ?? 0,
              displayCount:
                activeView === 'tracks'
                  ? activeDisplayCount
                  : trackSnapshot?.displayCount ?? 0,
            },
          },
        );

        stashGenreDetailReturnFilters(
          serverId,
          genreName,
          {
            ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
            selectedGenres: [genreName],
            scrollTop,
            displayCount: activeDisplayCount,
          },
        );
      } else if (
        !isGenreDetailPath(path) ||
        genreDetailGenreFromPath(path) !== genreName
      ) {
        clearGenreDetailReturnStash(serverId, genreName);
        clearGenreDetailTabScrollSnapshots(serverId, genreName);
      }
    };
  }, [
    serverId,
    genreName,
    location.search,
    scrollSnapshotRef,
    albumScrollSnapshotRef,
    trackScrollSnapshotRef,
  ]);

  return {
    sort,
    restoreDisplayCount: restoreSnapshot.displayCount,
    restoreView: restoreSnapshot.view,
    restoreTabScrollSnapshots,
  };
}
