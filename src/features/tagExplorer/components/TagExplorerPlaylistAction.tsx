import { useMemo, useState } from 'react';
import { ListPlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AddToPlaylistSubmenu } from '@/features/contextMenu';
import type {
  LibraryTagFilter,
  LibraryTagMatchMode,
} from '@/lib/api/library';
import { libraryTagExplorerTrackRefs } from '@/lib/api/library';
import { PLAYLIST_SONG_ID_GET_BATCH } from '@/lib/api/subsonicPlaylists';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { showToast } from '@/lib/dom/toast';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import {
  tagExplorerTrackRefKey,
  type TagExplorerOwnedTrackRef,
} from '@/features/tagExplorer/hooks/useTagExplorerTrackSelection';

interface Props {
  serverId: string;
  browseScope: LibraryBrowseScope;
  tags: LibraryTagFilter[];
  mode: LibraryTagMatchMode;
  allMatching: boolean;
  exclusions: ReadonlySet<string>;
  explicitRefs: readonly TagExplorerOwnedTrackRef[];
  selectedCount: number;
  disabled?: boolean;
  onSuccess: () => void;
}

type PreparedSelection = {
  serverId: string;
  songIds: string[];
};

async function resolveCompleteSelection(
  serverId: string,
  browseScope: LibraryBrowseScope,
  tags: LibraryTagFilter[],
  mode: LibraryTagMatchMode,
  exclusions: ReadonlySet<string>,
): Promise<TagExplorerOwnedTrackRef[]> {
  const refs: TagExplorerOwnedTrackRef[] = [];
  let offset = 0;

  for (;;) {
    const page = await libraryTagExplorerTrackRefs({
      serverId,
      libraryScopes: browseScope.pairs,
      tags,
      mode,
      limit: 500,
      offset,
    });

    for (const track of page.tracks) {
      const ref = {
        serverId: track.serverId,
        trackId: track.trackId,
      };
      if (!exclusions.has(tagExplorerTrackRefKey(ref))) {
        refs.push(ref);
      }
    }

    offset += page.tracks.length;
    if (!page.hasMore || page.tracks.length === 0) break;
  }

  return refs;
}

export default function TagExplorerPlaylistAction({
  serverId,
  browseScope,
  tags,
  mode,
  allMatching,
  exclusions,
  explicitRefs,
  selectedCount,
  disabled = false,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedSelection | null>(null);

  const explicit = useMemo(
    () => [...explicitRefs],
    [explicitRefs],
  );

  const prepare = async () => {
    if (disabled || selectedCount <= 0 || preparing) return;

    if (
      allMatching &&
      selectedCount > PLAYLIST_SONG_ID_GET_BATCH
    ) {
      const accepted = await useConfirmModalStore
        .getState()
        .request({
          title: t('tagExplorer.largeAddTitle'),
          message: t('tagExplorer.largeAddMessage', {
            count: selectedCount,
          }),
          confirmLabel: t('tagExplorer.largeAddConfirm'),
          cancelLabel: t('common.cancel'),
        });
      if (!accepted) return;
    }

    setPreparing(true);
    try {
      const refs = allMatching
        ? await resolveCompleteSelection(
            serverId,
            browseScope,
            tags,
            mode,
            exclusions,
          )
        : explicit;

      const owners = [...new Set(refs.map(ref => ref.serverId))];
      if (owners.length !== 1) {
        showToast(
          t('tagExplorer.mixedServerPlaylist'),
          4000,
          'info',
        );
        return;
      }

      if (refs.length === 0) return;

      setPrepared({
        serverId: owners[0],
        songIds: refs.map(ref => ref.trackId),
      });
    } catch {
      showToast(
        t('tagExplorer.preparePlaylistError'),
        4000,
        'error',
      );
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="tag-explorer-playlist-action">
      <button
        type="button"
        className="btn btn-surface"
        disabled={disabled || selectedCount <= 0 || preparing}
        onClick={() => {
          if (prepared) setPrepared(null);
          else void prepare();
        }}
        aria-expanded={prepared != null}
      >
        {preparing
          ? <Loader2 size={15} className="spin" />
          : <ListPlus size={15} />}
        {t('tagExplorer.addToPlaylist')}
      </button>

      {prepared && (
        <AddToPlaylistSubmenu
          songIds={prepared.songIds}
          serverId={prepared.serverId}
          dropDown
          onSuccess={() => {
            onSuccess();
            setPrepared(null);
          }}
          onDone={() => setPrepared(null)}
        />
      )}
    </div>
  );
}
