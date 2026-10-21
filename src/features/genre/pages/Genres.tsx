import type { SubsonicGenre } from '@/lib/api/subsonicTypes';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import {
  fetchGenreCatalog,
  fetchScopedGenreCatalog,
  filterGenresWithContent,
  peekScopedGenreCatalog,
} from '@/features/playback/utils/playback/genreBrowsePlayback';
import { libraryScopeCacheKeyForServer } from '@/lib/api/subsonicClient';
import { peekGenreCatalogCache } from '@/lib/library/genreCatalogCountsCache';
import { genreColor } from '@/lib/library/genreColor';
import { useOfflineBrowseContext, offlineLocalBrowseEnabled } from '@/features/offline';
import { useOfflineLocalBrowseReloadKey } from '@/store/localPlaybackBrowseRevision';
import { useLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import { useLocalPlaybackStore } from '@/store/localPlaybackStore';
import { deriveLibraryBrowseIndexScopes } from '@/lib/library/libraryBrowseScope';
import TagCatalogDiscoveryToolbar from '@/ui/TagCatalogDiscoveryToolbar';
import {
  consumeTagCatalogReturnState,
  filterAndSortTagCatalog,
  readTagCatalogSort,
  storeTagCatalogReturnState,
  writeTagCatalogSort,
  type TagCatalogSort,
} from '@/lib/library/tagCatalogDiscovery';

const RETURN_STATE_KEY = 'genres-return-state';
const SORT_KEY = 'genres-sort';
const FONT_MIN_REM = 0.78;
const FONT_MAX_REM = 1.7;

export default function Genres() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const indexEnabled = useLibraryIndexStore(s => s.isIndexEnabled(serverId));
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const libraryBrowseScopeVersion = useAuthStore(s => s.libraryBrowseScopeVersion);
  const selectedIndexScopes = deriveLibraryBrowseIndexScopes(useAuthStore.getState());
  const libraryScopeKey = libraryScopeCacheKeyForServer(serverId);
  const offlineBrowseActive = useOfflineBrowseContext().active;
  const localPlaybackEntries = useLocalPlaybackStore(s => s.entries);
  const librarySyncRevision = useLibrarySyncRevision();
  const offlineLocalBrowseReloadKey = useOfflineLocalBrowseReloadKey(
    serverId,
    offlineBrowseActive,
  );
  const skipGenreCatalogCache = offlineBrowseActive
    && offlineLocalBrowseEnabled(serverId, localPlaybackEntries);
  const [returnState] = useState(() => consumeTagCatalogReturnState(RETURN_STATE_KEY));
  const [search, setSearch] = useState(returnState?.search ?? '');
  const [sort, setSort] = useState<TagCatalogSort>(() => readTagCatalogSort(SORT_KEY));
  const cachedGenres = !offlineBrowseActive
    ? peekScopedGenreCatalog(selectedIndexScopes, true)
    : serverId && !skipGenreCatalogCache
      ? peekGenreCatalogCache(serverId, libraryScopeKey, true)
      : null;
  const [rawGenres, setRawGenres] = useState<SubsonicGenre[]>(cachedGenres ?? []);
  const [loading, setLoading] = useState(!cachedGenres);

  useEffect(() => {
    let cancelled = false;
    const scopeKey = libraryScopeCacheKeyForServer(serverId);
    const scopes = deriveLibraryBrowseIndexScopes(useAuthStore.getState());
    const useSelectedIndexCounts = scopes.length > 0 && !offlineBrowseActive;
    const cached = useSelectedIndexCounts
      ? peekScopedGenreCatalog(scopes, true)
      : serverId && !skipGenreCatalogCache
        ? peekGenreCatalogCache(serverId, scopeKey, true)
        : null;
    if (cached) {
      // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRawGenres(cached);
      setLoading(false);
    } else {
      setRawGenres([]);
      setLoading(true);
    }
    const load = useSelectedIndexCounts
      ? fetchScopedGenreCatalog(scopes)
      : fetchGenreCatalog(serverId, indexEnabled);
    void load
      .then(data => {
        if (!cancelled) setRawGenres(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    serverId,
    indexEnabled,
    musicLibraryFilterVersion,
    libraryBrowseScopeVersion,
    offlineBrowseActive,
    skipGenreCatalogCache,
    librarySyncRevision,
    offlineLocalBrowseReloadKey,
  ]);

  const catalogGenres = useMemo(
    () => filterGenresWithContent([...rawGenres]),
    [rawGenres],
  );
  const genres = useMemo(
    () => filterAndSortTagCatalog(catalogGenres, search, sort),
    [catalogGenres, search, sort],
  );

  // Keep pill size tied to library prevalence even when the visible order is
  // alphabetical or a search narrows the cloud.
  const maxLog = useMemo(() => {
    const maxAlbumCount = catalogGenres.reduce(
      (max, genre) => Math.max(max, genre.albumCount),
      2,
    );
    return Math.log(maxAlbumCount);
  }, [catalogGenres]);

  useEffect(() => {
    writeTagCatalogSort(SORT_KEY, sort);
  }, [sort]);

  useEffect(() => {
    if (loading || !returnState) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (el) el.scrollTop = returnState.scrollTop;
    });
  }, [loading, returnState]);

  const handleGenreClick = (genreValue: string) => {
    const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    storeTagCatalogReturnState(RETURN_STATE_KEY, {
      search,
      scrollTop: el?.scrollTop ?? 0,
    });
    navigate(`/genres/${encodeURIComponent(genreValue)}`, { state: { returnTo: '/genres' } });
  };

  return (
    <div className="content-body animate-fade-in">
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1 className="page-title truncate" title={t('genres.title')}>{t('genres.title')}</h1>
        {!loading && catalogGenres.length > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>
            {search.trim()
              ? t('genres.filteredCount', { visible: genres.length, total: catalogGenres.length })
              : `${catalogGenres.length} ${t('genres.genreCount')}`}
          </span>
        )}
      </div>

      {!loading && catalogGenres.length > 0 && (
        <TagCatalogDiscoveryToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('genres.searchPlaceholder')}
          clearSearchLabel={t('genres.clearSearch')}
          sort={sort}
          onSortChange={setSort}
          popularityLabel={t('genres.sortPopularity')}
          alphabeticalLabel={t('genres.sortAlphabetical')}
          sortTooltip={t('genres.sortTooltip')}
        />
      )}

      {loading && <p className="loading-text">{t('genres.loading')}</p>}
      {!loading && catalogGenres.length === 0 && <p className="loading-text">{t('genres.empty')}</p>}
      {!loading && catalogGenres.length > 0 && genres.length === 0 && (
        <p className="loading-text">{t('genres.noSearchResults', { query: search.trim() })}</p>
      )}

      {!loading && genres.length > 0 && (
        <div className="genre-cloud">
          {genres.map(genre => {
            const ratio = Math.log(Math.max(2, genre.albumCount)) / maxLog;
            const fontRem = FONT_MIN_REM + ratio * (FONT_MAX_REM - FONT_MIN_REM);
            const color = genreColor(genre.value);
            return (
              <button
                key={genre.value}
                type="button"
                className="genre-pill"
                style={{
                  '--genre-color': color,
                  fontSize: `${fontRem.toFixed(3)}rem`,
                } as React.CSSProperties}
                onClick={() => handleGenreClick(genre.value)}
                data-tooltip={t('genres.albumCount', { count: genre.albumCount })}
              >
                {genre.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
