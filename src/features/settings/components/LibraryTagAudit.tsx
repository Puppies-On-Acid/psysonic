import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigateToAlbum } from '@/features/album/hooks/useNavigateToAlbum';
import { useAuthStore } from '@/store/authStore';
import { libraryTagAudit, type TagAuditAlbum, type TagAuditResponse, type TagAuditStatus } from '@/lib/api/library/tagAudit';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { auditAlbumsCsv, filterAndSortAuditAlbums, type TagAuditFilter, type TagAuditSort } from './tagAuditPresentation';

interface Snapshot {
  result: TagAuditResponse;
  scopedServers: string[];
  scopeFingerprint: string;
  finishedAt: number;
}

// Session-only result: survives navigating away from Settings, but is never
// written to localStorage and never refreshed without another Run Audit click.
let lastSnapshot: Snapshot | null = null;

const PAGE_SIZE = 50;


function Status({ value }: { value: TagAuditStatus }) {
  const { t } = useTranslation();
  return <span>{t('settings.tagAuditStatus_' + value)}</span>;
}

export default function LibraryTagAudit() {
  const { t } = useTranslation();
  const openAlbum = useNavigateToAlbum();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(lastSnapshot);
  const [isRunning, setIsRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TagAuditFilter>('all');
  const [sort, setSort] = useState<TagAuditSort>('album');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const servers = useAuthStore(s => s.servers);
  const activeServerId = useAuthStore(s => s.activeServerId);
  const libraryBrowseServerIds = useAuthStore(s => s.libraryBrowseServerIds);
  const musicFoldersByServer = useAuthStore(s => s.musicFoldersByServer);
  const libraryBrowseSelectionByServer = useAuthStore(s => s.libraryBrowseSelectionByServer);
  const currentScope = useMemo(() => deriveLibraryBrowseScope({
    servers, activeServerId, libraryBrowseServerIds,
    musicFoldersByServer, libraryBrowseSelectionByServer,
  }, new Set()), [
    servers, activeServerId, libraryBrowseServerIds,
    musicFoldersByServer, libraryBrowseSelectionByServer,
  ]);

  const results = useMemo(() => snapshot
    ? filterAndSortAuditAlbums(snapshot.result.albums, filter, search, sort)
    : [], [snapshot, filter, search, sort]);
  const pageCount = Math.ceil(results.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(pageCount - 1, 0));
  const shown = results.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const serverName = (id: string) => servers.find(server => server.id === id)?.name || id;

  const run = async () => {
    if (isRunning) return;
    const scope = currentScope;
    if (scope.pairs.length === 0) {
      setError(t('settings.tagAuditNoScope'));
      return;
    }
    setError(null);
    setIsRunning(true);
    try {
      const result = await libraryTagAudit(scope.pairs);
      const next: Snapshot = {
        result,
        scopedServers: scope.serverIds,
        scopeFingerprint: scope.fingerprint,
        finishedAt: Date.now(),
      };
      lastSnapshot = next;
      setSnapshot(next);
      setShowResults(false);
      setFilter('all');
      setSort('album');
      setSearch('');
      setPage(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Preserve a prior successful snapshot when a new audit fails.
    } finally {
      setIsRunning(false);
    }
  };

  const exportCsv = () => {
    if (!snapshot) return;
    const csv = auditAlbumsCsv(results);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'psysonic-library-tag-audit.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="settings-card">
      <div className="settings-group" style={{ padding: '1rem' }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
          {t('settings.tagAuditDescription')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-surface" disabled={isRunning} onClick={() => void run()}>
            {isRunning ? t('settings.tagAuditRunning') : t('settings.tagAuditRun')}
          </button>
          <button type="button" className="btn btn-ghost"
            disabled={!snapshot || isRunning}
            onClick={() => setShowResults(value => !value)}>
            {t('settings.tagAuditViewResults')}
          </button>
          {snapshot && <button type="button" className="btn btn-ghost"
            disabled={isRunning} onClick={exportCsv}>
            {t('settings.tagAuditExport')}
          </button>}
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger, var(--text-primary))', fontSize: 13 }}>{error}</p>}
        {!snapshot && !isRunning && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.tagAuditNotRun')}</p>}
        {snapshot && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.tagAuditLastRun', { date: new Date(snapshot.finishedAt).toLocaleString() })}
            {' · '}
            {t('settings.tagAuditScope', { servers: snapshot.scopedServers.map(serverName).join(', ') })}
            {currentScope.fingerprint !== snapshot.scopeFingerprint && (
              <> · {t('settings.tagAuditScopeChanged')}</>
            )}
          </p>
        )}
        {snapshot && showResults && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: 13, marginBottom: '0.75rem' }}>
              <span>{t('settings.tagAuditAlbumsChecked', { count: snapshot.result.summary.albumsChecked })}</span>
              <span>{t('settings.tagAuditGenreMissing', { count: snapshot.result.summary.genreMissing })}</span>
              <span>{t('settings.tagAuditGenrePartial', { count: snapshot.result.summary.genrePartial })}</span>
              <span>{t('settings.tagAuditMoodMissing', { count: snapshot.result.summary.moodMissing })}</span>
              <span>{t('settings.tagAuditMoodPartial', { count: snapshot.result.summary.moodPartial })}</span>
              <span>{t('settings.tagAuditBoth', { count: snapshot.result.summary.missingBoth })}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.tagAuditIndexNote')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <input className="input" type="search" aria-label={t('settings.tagAuditSearch')}
                placeholder={t('settings.tagAuditSearch')} value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }} />
              <select className="input" aria-label={t('settings.tagAuditFilter')} value={filter}
                onChange={e => { setFilter(e.target.value as TagAuditFilter); setPage(0); }}>
                {(['all', 'genreMissing', 'genrePartial', 'moodMissing', 'moodPartial', 'both'] as const).map(key => (
                  <option key={key} value={key}>{t('settings.tagAuditFilter_' + key)}</option>
                ))}
              </select>
              <select className="input" aria-label={t('settings.tagAuditSort')} value={sort}
                onChange={e => { setSort(e.target.value as TagAuditSort); setPage(0); }}>
                {(['album', 'artist', 'genreMissingTracks', 'moodMissingTracks'] as const).map(key => (
                  <option key={key} value={key}>{t('settings.tagAuditSort_' + key)}</option>
                ))}
              </select>
            </div>
            {results.length === 0 ? <p role="status">{t('settings.tagAuditNoResults')}</p> : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', textAlign: 'left', fontSize: 13, borderSpacing: '0 0.5rem' }}>
                    <thead>
                      <tr>
                        <th scope="col">{t('settings.tagAuditAlbum')}</th>
                        <th scope="col">{t('settings.tagAuditLibrary')}</th>
                        <th scope="col">{t('settings.tagAuditGenre')}</th>
                        <th scope="col">{t('settings.tagAuditMood')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((album: TagAuditAlbum) => (
                        <tr key={album.serverId + '\u001f' + (album.libraryId ?? '') + '\u001f' + album.albumId}>
                          <td>
                            <button type="button" className="btn btn-ghost" style={{ textAlign: 'left' }}
                              onClick={() => openAlbum(album.albumId, { serverId: album.serverId })}>
                              {album.name}
                            </button>
                            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{album.artist}</div>
                          </td>
                          <td>{serverName(album.serverId)}{album.libraryId ? ' / ' + album.libraryId : ''}</td>
                          <td><Status value={album.genreStatus} /> ({album.genreTaggedTracks}/{album.trackCount})</td>
                          <td><Status value={album.moodStatus} /> ({album.moodTaggedTracks}/{album.trackCount})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pageCount > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost"
                      disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                      {t('settings.tagAuditPrevious')}
                    </button>
                    <span>{t('settings.tagAuditPage', { page: safePage + 1, pages: pageCount })}</span>
                    <button type="button" className="btn btn-ghost"
                      disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                      {t('settings.tagAuditNext')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
