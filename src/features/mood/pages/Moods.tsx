import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import {
  libraryGetMoodAlbumCounts,
  type MoodAlbumCountRow,
} from '@/lib/api/library';
import { deriveLibraryBrowseIndexScopes } from '@/lib/library/libraryBrowseScope';
import { genreColor } from '@/lib/library/genreColor';
import { useAuthStore } from '@/store/authStore';
import { useLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import TagCatalogDiscoveryToolbar from '@/ui/TagCatalogDiscoveryToolbar';
import {
  consumeTagCatalogReturnState,
  filterAndSortTagCatalog,
  readTagCatalogSort,
  storeTagCatalogReturnState,
  writeTagCatalogSort,
  type TagCatalogSort,
} from '@/lib/library/tagCatalogDiscovery';

const RETURN_STATE_KEY = 'moods-return-state';
const SORT_KEY = 'moods-sort';

const FONT_MIN_REM = 0.78;
const FONT_MAX_REM = 1.7;

function mergeMoodCatalogs(
  catalogs: readonly MoodAlbumCountRow[][],
): MoodAlbumCountRow[] {
  const merged = new Map<string, MoodAlbumCountRow>();

  for (const catalog of catalogs) {
    for (const mood of catalog) {
      const value = mood.value.trim();
      if (!value) continue;

      const key = value.toLocaleLowerCase();
      const previous = merged.get(key);

      merged.set(key, {
        value: previous?.value ?? value,
        albumCount: (previous?.albumCount ?? 0) + mood.albumCount,
        songCount: (previous?.songCount ?? 0) + mood.songCount,
      });
    }
  }

  return [...merged.values()]
    .filter(mood => mood.albumCount > 0 || mood.songCount > 0)
    .sort(
      (a, b) =>
        b.albumCount - a.albumCount ||
        a.value.localeCompare(b.value),
    );
}

export default function Moods() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const musicLibraryFilterVersion = useAuthStore(
    s => s.musicLibraryFilterVersion,
  );

  const libraryBrowseScopeVersion = useAuthStore(
    s => s.libraryBrowseScopeVersion,
  );

  const librarySyncRevision = useLibrarySyncRevision();

  const [returnState] = useState(() => consumeTagCatalogReturnState(RETURN_STATE_KEY));
  const [search, setSearch] = useState(returnState?.search ?? '');
  const [sort, setSort] = useState<TagCatalogSort>(() => readTagCatalogSort(SORT_KEY));
  const [rawMoods, setRawMoods] = useState<MoodAlbumCountRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const scopes = deriveLibraryBrowseIndexScopes(
      useAuthStore.getState(),
    );

    // React Compiler set-state-in-effect rule: loading is intentionally reset
    // when the active library scope or local index revision changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    void Promise.allSettled(
      scopes.map(scope =>
        libraryGetMoodAlbumCounts({
          serverId: scope.serverId,
          libraryScopes:
            scope.libraryIds.length > 0
              ? scope.libraryIds
              : undefined,
        }),
      ),
    )
      .then(results => {
        if (cancelled) return;

        const catalogs = results.flatMap(result =>
          result.status === 'fulfilled'
            ? [result.value]
            : [],
        );

        setRawMoods(mergeMoodCatalogs(catalogs));
      })
      .catch(() => {
        if (!cancelled) {
          setRawMoods([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    musicLibraryFilterVersion,
    libraryBrowseScopeVersion,
    librarySyncRevision,
  ]);

  const moods = useMemo(
    () => filterAndSortTagCatalog(rawMoods, search, sort),
    [rawMoods, search, sort],
  );

  const maxLog = useMemo(() => {
    const maxAlbumCount = rawMoods.reduce(
      (max, mood) => Math.max(max, mood.albumCount),
      2,
    );
    return Math.log(maxAlbumCount);
  }, [rawMoods]);

  useEffect(() => {
    writeTagCatalogSort(SORT_KEY, sort);
  }, [sort]);

  useEffect(() => {
    if (loading || !returnState) return;

    requestAnimationFrame(() => {
      const el = document.getElementById(
        APP_MAIN_SCROLL_VIEWPORT_ID,
      );

      if (el) {
        el.scrollTop = returnState.scrollTop;
      }
    });
  }, [loading, returnState]);

  const handleMoodClick = (moodValue: string) => {
    const el = document.getElementById(
      APP_MAIN_SCROLL_VIEWPORT_ID,
    );

    storeTagCatalogReturnState(RETURN_STATE_KEY, {
      search,
      scrollTop: el?.scrollTop ?? 0,
    });

    navigate(
      `/moods/${encodeURIComponent(moodValue)}`,
      {
        state: {
          returnTo: '/moods',
        },
      },
    );
  };

  return (
    <div className="content-body animate-fade-in">
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1
          className="page-title truncate"
          title={t('moods.title', )}
        >
          {t('moods.title', )}
        </h1>

        {!loading && rawMoods.length > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>

            {search.trim()
              ? t('moods.filteredCount', { visible: moods.length, total: rawMoods.length })
              : `${rawMoods.length} ${t('moods.moodCount', { count: rawMoods.length })}`}
          </span>
        )}
      </div>

      {!loading && rawMoods.length > 0 && (
        <TagCatalogDiscoveryToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('moods.searchPlaceholder')}
          clearSearchLabel={t('moods.clearSearch')}
          sort={sort}
          onSortChange={setSort}
          popularityLabel={t('moods.sortPopularity')}
          alphabeticalLabel={t('moods.sortAlphabetical')}
          sortTooltip={t('moods.sortTooltip')}
        />
      )}

      {loading && (
        <p className="loading-text">
          {t('moods.loading', )}
        </p>
      )}

      {!loading && rawMoods.length === 0 && (
        <p className="loading-text">
          {t('moods.empty', )}
        </p>
      )}

      {!loading && rawMoods.length > 0 && moods.length === 0 && (
        <p className="loading-text">
          {t('moods.noSearchResults', { query: search.trim() })}
        </p>
      )}

      {!loading && moods.length > 0 && (
        <div className="genre-cloud">
          {moods.map(mood => {
            const ratio =
              Math.log(Math.max(2, mood.albumCount)) /
              maxLog;

            const fontRem =
              FONT_MIN_REM +
              ratio * (FONT_MAX_REM - FONT_MIN_REM);

            // The existing genre palette helper is actually just a
            // deterministic string-to-colour hash, so it works for moods too.
            const color = genreColor(mood.value);

            return (
              <button
                key={mood.value}
                type="button"
                className="genre-pill"
                style={
                  {
                    '--genre-color': color,
                    fontSize: `${fontRem.toFixed(3)}rem`,
                  } as React.CSSProperties
                }
                onClick={() =>
                  handleMoodClick(mood.value)
                }
                data-tooltip={t('moods.albumCount', {
                  count: mood.albumCount,
                })}
              >
                {mood.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
