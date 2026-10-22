import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useLyricsStore } from '@/store/lyricsStore';
import type { Track } from '@/lib/media/trackTypes';
import { useLyrics } from '@/features/lyrics/hooks/useLyrics';

/**
 * A read-only lyrics view for any selected library song. The main LyricsPane
 * follows playback time; this dialog must not subscribe to or alter playback.
 */
export default function SongLyricsModal() {
  const track = useLyricsStore(s => s.dialogTrack);
  if (!track) return null;

  // Remount the hook when the song/server changes: never flash stale lyrics.
  return <SongLyricsDialog key={[track.serverId ?? '', track.id].join(':')} track={track} />;
}

function SongLyricsDialog({ track }: { track: Track }) {
  const { t } = useTranslation();
  const close = useLyricsStore(s => s.closeLyricsDialog);
  const sources = useAuthStore(s => s.lyricsSources);
  const { syncedLines, wordLines, plainLyrics, source, loading, refresh } = useLyrics(track);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lyricsDisabled = !sources.some(s => s.enabled);

  // Timed lyrics are still displayed as ordinary, selectable text. No progress
  // subscription, highlighting or automatic scrolling is used here.
  const lyricsText = syncedLines?.length
    ? syncedLines.map(line => line.text).join('\n')
    : wordLines?.length
      ? wordLines.map(line => line.text).join('\n')
      : plainLyrics;

  const sourceLabel = source === 'server'
    ? t('player.lyricsSourceServer')
    : source === 'lrclib'
      ? t('player.lyricsSourceLrclib')
      : source === 'netease'
        ? t('player.lyricsSourceNetease')
        : source === 'embedded'
          ? t('player.lyricsSourceEmbedded')
          : null;

  useEffect(() => {
    let restoreFocus: HTMLElement | null = null;
    // ContextMenu restores previous focus on the next animation frame. Focus
    // this modal afterward so that restoration cannot steal focus from it.
    const frame = requestAnimationFrame(() => {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      cancelAnimationFrame(frame);
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    };
  }, [close]);

  return createPortal(
    <>
      <div className="song-lyrics-backdrop" onClick={close} />
      <div
        ref={dialogRef}
        className="song-lyrics-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-lyrics-dialog-title"
      >
        <header className="song-lyrics-header">
          <h2 id="song-lyrics-dialog-title" className="song-lyrics-heading">
            {t('player.lyricsDialogTitle')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost song-lyrics-close"
            onClick={close}
            aria-label={t('player.closeTooltip')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="song-lyrics-track">
          <strong className="song-lyrics-track-title">{track.title}</strong>
          <span className="song-lyrics-track-subtitle">
            {[track.artist, track.album].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="song-lyrics-body">
          {lyricsDisabled ? (
            <p className="song-lyrics-status" role="status">{t('player.lyricsNoSources')}</p>
          ) : loading ? (
            <p className="song-lyrics-status" role="status">{t('player.lyricsLoading')}</p>
          ) : lyricsText?.trim() ? (
            <div data-testid="song-lyrics-text" className="song-lyrics-text">{lyricsText}</div>
          ) : (
            <p className="song-lyrics-status" role="status">{t('player.lyricsNotFound')}</p>
          )}
        </div>
        <footer className="song-lyrics-footer">
          <span className="song-lyrics-source">{!loading && !lyricsDisabled ? sourceLabel : null}</span>
          <button
            type="button"
            className="btn btn-ghost song-lyrics-refresh"
            onClick={refresh}
            disabled={loading || lyricsDisabled}
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t('player.lyricsRefresh')}</span>
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
