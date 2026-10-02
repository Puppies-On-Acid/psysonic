import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { playlistDisplayName } from '@/lib/format/playlistClassification';
import { buildPlaylistDetailPath } from '@/lib/navigation/detailServerScope';
import type {
  TrackPlaylistMembershipTruthState,
  TrackPlaylistRef,
} from '@/store/playlistMembershipIndex';

interface Props {
  memberships: readonly TrackPlaylistRef[];
  truthState: TrackPlaylistMembershipTruthState;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

export function TrackPlaylistMembershipCell({
  memberships,
  truthState,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: -9999,
    left: -9999,
  });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const primary = memberships[0];
  const remaining = memberships.slice(1);

  const goToPlaylist = (playlist: TrackPlaylistRef) => {
    setOpen(false);
    navigate(buildPlaylistDetailPath(playlist.id, {
      serverId: playlist.serverId,
    }));
  };

  const updatePopoverPosition = () => {
    const button = moreButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const popoverHeight = popoverRef.current?.offsetHeight ?? 220;
    const popoverWidth = popoverRef.current?.offsetWidth
      || Math.min(240, Math.max(160, window.innerWidth - VIEWPORT_MARGIN * 2));
    const left = Math.min(
      Math.max(rect.right - popoverWidth, VIEWPORT_MARGIN),
      window.innerWidth - popoverWidth - VIEWPORT_MARGIN,
    );
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const openAbove = spaceBelow < popoverHeight && spaceAbove > spaceBelow;

    setPopoverStyle({
      position: 'fixed',
      left,
      zIndex: 10050,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + ANCHOR_GAP }
        : { top: rect.bottom + ANCHOR_GAP }),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const reposition = () => updatePopoverPosition();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        moreButtonRef.current?.contains(target)
        || popoverRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      moreButtonRef.current?.focus();
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popoverRef.current
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus();
  }, [open]);

  if (truthState === 'unknown') {
    return (
      <div
        className="track-playlists-cell"
        data-playlist-membership-state={truthState}
      />
    );
  }

  if (truthState === 'loading') {
    return (
      <div
        className="track-playlists-cell"
        data-playlist-membership-state={truthState}
      >
        <span className="track-playlist-state">…</span>
      </div>
    );
  }

  if (!primary) {
    return (
      <div
        className="track-playlists-cell"
        data-playlist-membership-state={truthState}
      >
        <span className="track-playlist-state">
          {truthState === 'ready' ? '—' : '…'}
        </span>
      </div>
    );
  }

  return (
    <div
      className="track-playlists-cell"
      data-playlist-membership-state={truthState}
    >
      <button
        type="button"
        className="track-playlist-link"
        onMouseDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          goToPlaylist(primary);
        }}
        title={playlistDisplayName(primary)}
      >
        {playlistDisplayName(primary)}
      </button>

      {remaining.length > 0 && (
        <button
          ref={moreButtonRef}
          type="button"
          className="track-playlist-more"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${t('albumDetail.trackPlaylists')}: +${remaining.length}`}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            setOpen(value => !value);
          }}
        >
          [+{remaining.length}]
        </button>
      )}

      {truthState === 'partial' && (
        <span className="track-playlist-partial" aria-label="…">…</span>
      )}

      {open && remaining.length > 0 && createPortal(
        <div
          ref={popoverRef}
          className="track-playlist-popover"
          style={popoverStyle}
          role="dialog"
          aria-label={t('albumDetail.trackPlaylists')}
        >
          {remaining.map(playlist => (
            <button
              key={`${playlist.serverId}:${playlist.id}`}
              type="button"
              className="track-playlist-popover-item"
              onClick={() => goToPlaylist(playlist)}
            >
              {playlistDisplayName(playlist)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
