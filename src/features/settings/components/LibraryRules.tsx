import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { navigateToAlbumDetail } from '@/lib/navigation/albumDetailNavigation';
import { libraryRulesEvaluate, type LibraryScopePair, type RulePage } from '@/lib/api/library';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { useAuthStore } from '@/store/authStore';
import {
  builtInMissingMetadataRule,
  validateLibraryRuleDocument,
  type LibraryRuleDocument,
  type LibraryRuleEntity,
} from '../utils/libraryRuleModel';
import LibraryRuleBuilder from './LibraryRuleBuilder';

const PAGE_SIZE = 50;

interface QueryContext {
  ruleJson: string;
  entity: LibraryRuleEntity;
  scopes: LibraryScopePair[];
  scopeFingerprint: string;
  scopedServers: string[];
}

interface Snapshot extends QueryContext {
  page: RulePage;
  pageIndex: number;
  finishedAt: number;
}

/**
 * Local-only, explicitly triggered rule evaluation. View Results and editing
 * never call the evaluator. Only one bounded page is retained in memory.
 * Stage 2 owns named-template persistence; Stage 3 owns sync-triggered tracking.
 */
export default function LibraryRules() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [document, setDocument] = useState<LibraryRuleDocument>(() =>
    builtInMissingMetadataRule('album'));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadPage = async (index: number, context: QueryContext) => {
    if (isRunning) return;
    setError(null);
    setIsRunning(true);
    try {
      const page = await libraryRulesEvaluate(
        context.ruleJson, context.scopes, PAGE_SIZE, index * PAGE_SIZE);
      setSnapshot({ ...context, page, pageIndex: index, finishedAt: Date.now() });
      if (index !== 0) setShowResults(true);
      else setShowResults(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // Keep the previous successful snapshot, clearly labelled with its scope.
    } finally {
      setIsRunning(false);
    }
  };

  const run = () => {
    if (isRunning) return;
    if (currentScope.pairs.length === 0) {
      setError(t('settings.libraryRulesNoScope'));
      return;
    }
    if (issues.length > 0) {
      setError(t('settings.libraryRulesInvalid', { count: issues.length }));
      return;
    }
    const context: QueryContext = {
      ruleJson,
      entity: document.entity,
      scopes: currentScope.pairs.map(scope => ({ ...scope })),
      scopeFingerprint: currentScope.fingerprint,
      scopedServers: [...currentScope.serverIds],
    };
    void loadPage(0, context);
  };

  const showPage = (index: number) => {
    if (!snapshot || isRunning || isStale || index < 0 ||
        index > snapshot.pageIndex + 1 ||
        (index > snapshot.pageIndex && !snapshot.page.hasMore)) return;
    void loadPage(index, snapshot);
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
          disabled={isRunning}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button
            type="button" className="btn btn-ghost" disabled={isRunning}
            onClick={() => setDocument(builtInMissingMetadataRule(document.entity))}
          >
            {t('settings.libraryRulesResetPreset')}
          </button>
          <button
            type="button" className="btn btn-surface"
            disabled={isRunning || issues.length > 0 || currentScope.pairs.length === 0}
            onClick={run}
          >
            {isRunning ? t('settings.libraryRulesRunning') : t('settings.libraryRulesRun')}
          </button>
          <button
            type="button" className="btn btn-ghost"
            disabled={!snapshot || isRunning}
            onClick={() => setShowResults(value => !value)}
          >
            {t('settings.libraryRulesViewResults')}
          </button>
        </div>
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
                disabled={isRunning || isStale || snapshot.pageIndex === 0}
                onClick={() => showPage(snapshot.pageIndex - 1)}
              >
                {t('settings.libraryRulesPrevious')}
              </button>
              <span>
                {t('settings.libraryRulesPage', { page: snapshot.pageIndex + 1 })}
              </span>
              <button
                type="button" className="btn btn-ghost"
                disabled={isRunning || isStale || !snapshot.page.hasMore}
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
