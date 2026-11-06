import {
  ndGetPlaylistTracks,
  ndListPlaylists,
  type NdSmartPlaylist,
  type NdSongPlaylistRef,
} from '@/lib/api/navidromeSmart';
import { hasNavidromeSmartRules } from '@/lib/format/playlistClassification';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';

const DEFAULT_SMART_REFRESH_DELAY_MS = 5000;
const MAX_DELAYED_RETRY_MS = 6000;
const RETRY_PADDING_MS = 125;

function parseDurationMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const source = value.trim();
  const token = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let consumed = '';
  let total = 0;
  for (const match of source.matchAll(token)) {
    consumed += match[0];
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 'ms'
      ? 1
      : unit === 's'
        ? 1000
        : unit === 'm'
          ? 60_000
          : 3_600_000;
    total += amount * multiplier;
  }
  return consumed === source && Number.isFinite(total) ? total : null;
}

function remainingRefreshWindowMs(playlist: NdSmartPlaylist): number {
  if (!playlist.evaluatedAt) return 0;
  const evaluatedAt = Date.parse(playlist.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) return 0;
  const configured = parseDurationMs(playlist.rules?.refreshDelay);
  const refreshDelay = configured ?? DEFAULT_SMART_REFRESH_DELAY_MS;
  const remaining = evaluatedAt + refreshDelay - Date.now();
  if (remaining <= 0 || remaining > MAX_DELAYED_RETRY_MS) return 0;
  return Math.ceil(remaining + RETRY_PADDING_MS);
}

function rowMediaFileId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { mediaFileId?: unknown }).mediaFileId;
  if (typeof raw === 'string' && raw) return canonicalNavidromeId(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return canonicalNavidromeId(String(raw));
  }
  return null;
}

function playlistRef(playlist: NdSmartPlaylist): NdSongPlaylistRef {
  return {
    id: canonicalNavidromeId(playlist.id),
    name: playlist.name,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

/**
 * Resolve one song against Navidrome smart playlists.
 *
 * Existing membership cache wins when it can answer safely. Cold or incomplete
 * playlists use an exact-song probe that returns at most one track. If Navidrome
 * reports the playlist was evaluated inside its refresh-delay window, one delayed
 * exact-song retry runs after that window so a skipped smart refresh cannot become
 * a false negative.
 */
export async function resolveSongSmartPlaylistMemberships(
  songId: string,
  serverId: string,
  isCurrent: () => boolean = () => true,
): Promise<NdSongPlaylistRef[]> {
  const targetSongId = canonicalNavidromeId(songId);
  const smartPlaylists = (await ndListPlaylists(serverId))
    .filter(playlist => hasNavidromeSmartRules(playlist.rules));
  if (!isCurrent()) return [];

  const membership = usePlaylistMembershipStore.getState();
  const matches: NdSongPlaylistRef[] = [];
  const delayed: Array<{ playlist: NdSmartPlaylist; dueAt: number }> = [];

  const probe = async (playlist: NdSmartPlaylist): Promise<boolean | null> => {
    try {
      const rows = await ndGetPlaylistTracks(playlist.id, serverId, {
        start: 0,
        end: 1,
        mediaFileId: songId,
      });
      return rows.some(row => rowMediaFileId(row) === targetSongId);
    } catch {
      return null;
    }
  };

  for (const playlist of smartPlaylists) {
    if (!isCurrent()) return matches;
    const cacheId = canonicalNavidromeId(playlist.id);
    const cached = membership.getPlaylistSongIds(cacheId, serverId);

    // A positive cached membership is safe even if the cached list is not known
    // complete. A negative is safe only when its size still matches server
    // metadata; otherwise verify this song directly.
    if (cached?.includes(targetSongId)) {
      matches.push(playlistRef(playlist));
      continue;
    }
    if (cached !== undefined && cached.length === playlist.songCount) {
      continue;
    }

    const matched = await probe(playlist);
    if (!isCurrent()) return matches;
    if (matched) {
      matches.push(playlistRef(playlist));
      continue;
    }

    // Navidrome 0.64 skips smart evaluation while evaluatedAt is inside the
    // playlist refresh-delay window. A successful negative probe in that window
    // is therefore not final. Retry the same one-song query once the window
    // expires; never download the whole Smart Playlist just for Song Info.
    const remaining = remainingRefreshWindowMs(playlist);
    if (remaining > 0) {
      delayed.push({ playlist, dueAt: Date.now() + remaining });
    }
  }

  // Serial retries avoid concurrent SQLite smart-playlist rebuilds on
  // Navidrome 0.64. Each response is still capped at one matching track.
  for (const retry of delayed) {
    if (!isCurrent()) return matches;
    const wait = retry.dueAt - Date.now();
    if (wait > 0) await sleep(wait);
    if (!isCurrent()) return matches;

    const matched = await probe(retry.playlist);
    if (!isCurrent()) return matches;
    const cacheId = canonicalNavidromeId(retry.playlist.id);
    if (
      matched
      && !matches.some(item => item.id === cacheId)
    ) {
      matches.push(playlistRef(retry.playlist));
    }
  }

  return matches.sort((left, right) => left.name.localeCompare(right.name));
}
