import { ListMusic, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  canRemoveTrackFromPlaylistMembership,
  removeTrackFromPlaylistMembership,
} from '@/features/playlist';
import { showToast } from '@/lib/dom/toast';
import { buildPlaylistDetailPath } from '@/lib/navigation/detailServerScope';
import type { TrackPlaylistRef } from '@/store/playlistMembershipIndex';
import type { ContextMenuItemsProps } from '@/features/contextMenu/components/contextMenuItemTypes';

type PlaylistMembershipContextItem = TrackPlaylistRef & {
  songId: string;
};

export default function PlaylistMembershipContextItems(
  props: ContextMenuItemsProps,
) {
  const { item, handleAction, offlinePolicy } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const membership = item as PlaylistMembershipContextItem;
  const canRemove = (
    offlinePolicy.canEditPlaylist
    && canRemoveTrackFromPlaylistMembership(membership)
  );

  return (
    <>
      <div
        className="context-menu-item"
        onClick={() => handleAction(() => {
          navigate(buildPlaylistDetailPath(membership.id, {
            serverId: membership.serverId,
          }));
        })}
      >
        <ListMusic size={14} /> {t('contextMenu.openPlaylist')}
      </div>

      <div
        className={`context-menu-item${canRemove ? '' : ' is-disabled'}`}
        aria-disabled={!canRemove || undefined}
        style={canRemove ? { color: 'var(--danger)' } : undefined}
        onClick={canRemove
          ? () => handleAction(async () => {
            try {
              await removeTrackFromPlaylistMembership(
                membership,
                membership.songId,
              );
              showToast(t('playlists.removeSuccess'), 3000, 'info');
            } catch {
              showToast(t('playlists.removeError'), 4000, 'error');
            }
          })
          : undefined}
      >
        <Trash2 size={14} /> {t('contextMenu.removeFromPlaylist')}
      </div>
    </>
  );
}
