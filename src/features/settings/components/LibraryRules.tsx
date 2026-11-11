import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { showToast } from '@/lib/dom/toast';
import { navigateToAlbumDetail } from '@/lib/navigation/albumDetailNavigation';
import { libraryRulesEvaluate } from '@/lib/api/library';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { useAuthStore } from '@/store/authStore';
import {
  builtInMissingMetadataRule,
  validateLibraryRuleDocument,
  type LibraryRuleDocument,
} from '../utils/libraryRuleModel';
import {
  cacheLibraryRulesSession,
  readLibraryRulesSession,
  type LibraryRulesQueryContext,
  type LibraryRulesSnapshot,
} from '../utils/libraryRulesSession';
import LibraryRuleBuilder from './LibraryRuleBuilder';
import {
  collectLibraryRulesCsv,
  LibraryRulesCsvCancelled,
} from '../utils/libraryRulesCsv';
import { saveLibraryRulesCsv } from './libraryRulesCsvSave';

const PAGE_SIZE = 50;
type ExportPhase = 'collecting' | 'saving' | null;

/**
 * Local-only, explicitly triggered rule evaluation. View Results and editing
 * never call the evaluator. A single bounded result page plus the editor draft
 * survive Settings navigation in volatile app memory, not persisted templates.
 * Stage 2 owns named-template persistence; Stage 3 owns sync-triggered tracking.
 */
export default function LibraryRules() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [document, setDocument] = useState<LibraryRuleDocument>(() =>
    readLibraryRulesSession()?.document ?? builtInMissingMetadataRule('album'));
  const [snapshot, setSnapshot] = useState<LibraryRulesSnapshot | null>(() =>
    readLibraryRulesSession()?.snapshot ?? null);
  const [showResults, setShowResults] = useState(() =>
    readLibraryRulesSession()?.showResults ?? false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPhase, setExportPhase] = useState<ExportPhase>(null);
  const [exportRows, setExportRows] = useState(0);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const isExporting = exportPhase !== null;

  useEffect(() => () => {
    // Navigating away must never open a native Save picker later.
    exportAbortRef.current?.abort();
  }, []);

  // Session-only restoration after album navigation. This effect only caches
  // UI state; it never invokes the evaluator or touches persistent storage.
  useEffect(() => {
    cacheLibraryRulesSession({ document, snapshot, showResults });
  }, [document, snapshot, showResults]);

  const servers = useAuthStore(state => state.servers);
  const activeServerId = useAuthStore(state => state.activeServerId);
  const libraryBrowseServerIds = useAuthStore(state => state.libraryBrowseServerIds);
  const musicFoldersByServer = useAuthStore(state => state.musicFoldersByServer);
  const libraryBrowseSelectionByServer = useAuthStore(state => state.libraryBrowseSelectionByServer);
  const currentScope = useMemo(() => deriveLibraryBrowseScope({
    servers, activeServerId, libraryBrowseServerIds,
    musicFoldersByServer, libraryBrowseSelectionByServer,
  }, new Set()), [
    servers, activeServerId, libraryBrowseServerIds,
    musicFoldersByServer, libraryBrowseSelectionByServer,
  ]);

  const ruleJson = JSON.stringify(document);
  const issues = validateLibraryRuleDocument(document);
  const isStale = snapshot !== null &&
    (snapshot.ruleJson !== ruleJson || snapshot.scopeFingerprint !== currentScope.fingerprint);
  const serverName = (id: string) => servers.find(server => server.id === id)?.name || id;

  // A new Run returns to the explicit View Results state. Pagination must
  // preserve visibility even when returning to page zero.
  const loadPage = async (
    index: number,
    context: LibraryRulesQueryContext,
    showAfterLoad: boolean,
  ) => {
    if (isRunning || isExporting) return;
    setError(null);
    setIsRunning(true);
    try {
      const page = await libraryRulesEvaluate(
        context.ruleJson, context.scopes, PAGE_SIZE, index * PAGE_SIZE);
      setSnapshot({ ...context, page, pageIndex: index, finishedAt: Date.now() });
      setShowResults(showAfterLoad);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // Keep the previous successful snapshot, clearly labelled with its scope.
    } finally {
      setIsRunning(false);
    }
  };

  const run = () => {
    if (isRunning || isExporting) return;
    if (currentScope.pairs.length === 0) {
      setError(t('settings.libraryRulesNoScope'));
      return;
    }
    if (issues.length > 0) {
      setError(t('settings.libraryRulesInvalid', { count: issues.length }));
      return;
    }
    const context: LibraryRulesQueryContext = {
      ruleJson,
      entity: document.entity,
      scopes: currentScope.pairs.map(scope => ({ ...scope })),
      scopeFingerprint: currentScope.fingerprint,
      scopedServers: [...currentScope.serverIds],
    };
    void loadPage(0, context, false);
  };

  const showPage = (index: number) => {
    if (!snapshot || isRunning || isExporting || isStale || index < 0 ||
        index > snapshot.pageIndex + 1 ||
        (index > snapshot.pageIndex && !snapshot.page.hasMore)) return;
    void loadPage(index, snapshot, true);
  };

  const currentFingerprint = (): string => {
    const state = useAuthStore.getState();
    return deriveLibraryBrowseScope({
      servers: state.servers,
      activeServerId: state.activeServerId,
      libraryBrowseServerIds: state.libraryBrowseServerIds,
      musicFoldersByServer: state.musicFoldersByServer,
      libraryBrowseSelectionByServer: state.libraryBrowseSelectionByServer,
    }, new Set()).fingerprint;
  };

  const exportAll = async () => {
    if (!snapshot || isStale || isRunning || isExporting) return;
    const captured = snapshot;
    const abort = new AbortController();
    exportAbortRef.current = abort;
    setExportRows(0);
    setExportMessage(null);
    setError(null);
    setExportPhase('collecting');

    const checkScope = () => {
      if (currentFingerprint() !== captured.scopeFingerprint) {
        throw new Error(t('settings.libraryRulesExportScopeChanged'));
      }
    };

    try {
      // Do not use the 50-row preview as the first export page. Every batch
      // comes from the same captured AST/scopes, starting at offset zero.
      const collected = await collectLibraryRulesCsv({
        entity: captured.entity,
        ruleJson: captured.ruleJson,
        scopes: captured.scopes,
        signal: abort.signal,
        readPage: async (ruleJson, scopes, limit, offset) => {
          checkScope();
          const page = await libraryRulesEvaluate(ruleJson, scopes, limit, offset);
          checkScope();
          return page;
        },
        onProgress: setExportRows,
      });
      checkScope();
      if (abort.signal.aborted) throw new LibraryRulesCsvCancelled();
      setExportPhase('saving');
      const result = await saveLibraryRulesCsv(
        collected.bytes, captured.entity, t('settings.libraryRulesExportDialogTitle'));
      if (result === 'saved') {
        showToast(t('settings.libraryRulesExportSuccess', { count: collected.rows }), 2800, 'success');
        setExportMessage(t('settings.libraryRulesExportSuccess', { count: collected.rows }));
      } else {
        setExportMessage(t('settings.libraryRulesExportCancelled'));
      }
    } catch (reason) {
      if (abort.signal.aborted || reason instanceof LibraryRulesCsvCancelled) {
        setExportMessage(t('settings.libraryRulesExportCancelled'));
      } else {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(t('settings.libraryRulesExportFailed', { message }));
        showToast(t('settings.libraryRulesExportFailedToast'), 4000, 'error');
      }
    } finally {
      if (exportAbortRef.current === abort) exportAbortRef.current = null;
      setExportPhase(null);
    }
  };

  const openAlbum = (albumId: string, serverId: string) => {
    navigateToAlbumDetail(navigate, location, albumId, { serverId });
  };

  return (
    <div className="settings-card">
      <div className="settings-group" style={{ padding: '1rem' }}>
        <LibraryRuleBuilder
          document={document}
          onChange={setDocument}
          disabled={isRunning || isExporting}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button
            type="button" className="btn btn-ghost" disabled={isRunning || isExporting}
            onClick={() => setDocument(builtInMissingMetadataRule(document.entity))}
          >
            {t('settings.libraryRulesResetPreset')}
          </button>
          <button
            type="button" className="btn btn-surface"
            disabled={isRunning || isExporting || issues.length > 0 || currentScope.pairs.length === 0}
            onClick={run}
          >
            {isRunning ? t('settings.libraryRulesRunning') : t('settings.libraryRulesRun')}
          </button>
          <button
            type="button" className="btn btn-ghost"
            disabled={!snapshot || isRunning || isExporting}
            onClick={() => setShowResults(value => !value)}
          >
            {t('settings.libraryRulesViewResults')}
          </button>
          {snapshot && (
            <button
              type="button" className="btn btn-ghost"
              disabled={isRunning || isExporting || isStale}
              onClick={() => void exportAll()}
            >
              {t('settings.libraryRulesExportAll')}
            </button>
          )}
          {exportPhase === 'collecting' && (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => exportAbortRef.current?.abort()}
            >
              {t('settings.libraryRulesExportCancel')}
            </button>
          )}
        </div>
        {exportPhase && (
          <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {exportPhase === 'collecting'
              ? t('settings.libraryRulesExportProgress', { count: exportRows })
              : t('settings.libraryRulesExportSaving')}
          </p>
        )}
        {!exportPhase && exportMessage && (
          <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {exportMessage}
          </p>
        )}
        {snapshot && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.libraryRulesExportNote')}
          </p>
        )}
        {currentScope.pairs.length === 0 && (
          <p role="status">{t('settings.libraryRulesNoScope')}</p>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger, var(--text-primary))', fontSize: 13 }}>
            {error}
          </p>
        )}
        {!snapshot && !isRunning && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.libraryRulesNotRun')}
          </p>
        )}
        {snapshot && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.libraryRulesLastRun', {
              date: new Date(snapshot.finishedAt).toLocaleString(),
            })}
            {' · '}
            {t('settings.libraryRulesScope', {
              servers: snapshot.scopedServers.map(serverName).join(', '),
            })}
          </p>
        )}
        {snapshot && isStale && (
          <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.libraryRulesStale')}
          </p>
        )}

        {snapshot && showResults && (
          <section aria-label={t('settings.libraryRulesResults')} style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('settings.libraryRulesResultsNote')}
            </p>
            {snapshot.page.items.length === 0 ? (
              <p role="status">{t('settings.libraryRulesNoMatches')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', textAlign: 'left', fontSize: 13, borderSpacing: '0 0.5rem',
                }}>
                  <thead>
                    <tr>
                      <th scope="col">{snapshot.entity === 'album'
                        ? t('settings.libraryRulesAlbum')
                        : t('settings.libraryRulesTrack')}</th>
                      <th scope="col">{t('settings.libraryRulesArtist')}</th>
                      <th scope="col">{t('settings.libraryRulesLibrary')}</th>
                      {snapshot.entity === 'track' && (
                        <th scope="col">{t('settings.libraryRulesAlbum')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.page.items.map(item => (
                      <tr key={[item.serverId, item.libraryId ?? '', item.itemId].join('\u001f')}>
                        <td>
                          {snapshot.entity === 'album' ? (
                            <button
                              type="button" className="btn btn-ghost"
                              style={{ textAlign: 'left' }}
                              onClick={() => openAlbum(item.itemId, item.serverId)}
                            >
                              {item.name}
                            </button>
                          ) : item.name}
                        </td>
                        <td>{item.artist ?? '—'}</td>
                        <td>{serverName(item.serverId)}{item.libraryId
                          ? ' / ' + item.libraryId : ''}</td>
                        {snapshot.entity === 'track' && (
                          <td>
                            {item.albumId ? (
                              <button
                                type="button" className="btn btn-ghost"
                                onClick={() => openAlbum(item.albumId as string, item.serverId)}
                              >
                                {t('settings.libraryRulesOpenAlbum')}
                              </button>
                            ) : t('settings.libraryRulesNoAlbum')}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button" className="btn btn-ghost"
                disabled={isRunning || isExporting || isStale || snapshot.pageIndex === 0}
                onClick={() => showPage(snapshot.pageIndex - 1)}
              >
                {t('settings.libraryRulesPrevious')}
              </button>
              <span>
                {t('settings.libraryRulesPage', { page: snapshot.pageIndex + 1 })}
              </span>
              <button
                type="button" className="btn btn-ghost"
                disabled={isRunning || isExporting || isStale || !snapshot.page.hasMore}
                onClick={() => showPage(snapshot.pageIndex + 1)}
              >
                {t('settings.libraryRulesNext')}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
