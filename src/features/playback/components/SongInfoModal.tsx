import { getSong, getSongForServer } from '@/lib/api/subsonicLibrary';
import { libraryGetFacts } from '@/lib/api/library';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { ndGetSongPath } from '@/lib/api/navidromeAdmin';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard } from '@/lib/server/serverMagicString';
import { showToast } from '@/lib/dom/toast';
import { formatTrackTime } from '@/lib/format/formatDuration';
import { formatLastSeen } from '@/lib/format/userMgmtHelpers';
import { genreTagsFor } from '@/lib/library/genreTags';
import { moodsLabel } from '@/lib/format/playlistDetailHelpers';
import { libraryIsReady } from '@/lib/library/libraryReady';
import {
  formatQueueMoodLabels,
  parseTrackEnrichmentFacts,
  resolveQueueBpm,
  type ParsedTrackEnrichment,
} from '@/lib/library/trackEnrichment';
import i18n from '@/lib/i18n';
import { ndGetSongPlaylists } from '@/lib/api/navidromeSmart';
import {
  resolveSongSmartPlaylistMemberships,
  usePlaylistStore,
} from '@/features/playlist';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import { playlistDisplayName } from '@/lib/format/playlistClassification';
import { buildPlaylistDetailPath } from '@/lib/navigation/detailServerScope';
import type { TrackPlaylistRef } from '@/store/playlistMembershipIndex';

function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <tr>
      <td className="song-info-label">{label}</td>
      <td className="song-info-value">{value}</td>
    </tr>
  );
}

/** Title / Artist / Album: double-click the value cell to copy plain text. */
function CopyableFieldRow({ label, text }: { label: string; text: string | null | undefined }) {
  const { t } = useTranslation();
  if (!text || text === '—') return null;
  const onDoubleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(text);
    if (ok) showToast(t('orbit.tooltipCopied'), 2000, 'info');
    else showToast(t('contextMenu.shareCopyFailed'), 3500, 'error');
  };
  return (
    <tr>
      <td className="song-info-label">{label}</td>
      <td className="song-info-value song-info-value--no-select" onDoubleClick={onDoubleClick}>
        {text}
      </td>
    </tr>
  );
}

function Divider() {
  return <tr><td colSpan={2} className="song-info-divider" /></tr>;
}

function cachedPlaylistRefsForSong(
  songId: string,
  serverId: string,
): TrackPlaylistRef[] {
  const membership = usePlaylistMembershipStore.getState();
  return usePlaylistStore
    .getState()
    .playlists
    .filter(playlist => playlist.serverId === serverId)
    .filter(playlist =>
      membership.getPlaylistSongIds(playlist.id, serverId)?.includes(songId)
    )
    .map(playlist => ({
      id: playlist.id,
      serverId,
      name: playlist.name,
    }))
    .sort((left, right) =>
      playlistDisplayName(left).localeCompare(playlistDisplayName(right))
    );
}

function mergePlaylistRefs(
  ...groups: readonly (readonly TrackPlaylistRef[])[]
): TrackPlaylistRef[] {
  const byKey = new Map<string, TrackPlaylistRef>();
  for (const group of groups) {
    for (const playlist of group) {
      byKey.set(`${playlist.serverId}:${playlist.id}`, playlist);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    playlistDisplayName(left).localeCompare(playlistDisplayName(right))
  );
}

export default function SongInfoModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { songInfoModal, closeSongInfo } = usePlayerStore(
    useShallow(s => ({ songInfoModal: s.songInfoModal, closeSongInfo: s.closeSongInfo }))
  );
  const [song, setSong] = useState<SubsonicSong | null>(null);
  const [enrichment, setEnrichment] = useState<ParsedTrackEnrichment | null>(null);
  const [loading, setLoading] = useState(false);
  const [playlistMemberships, setPlaylistMemberships] = useState<TrackPlaylistRef[]>([]);
  const [playlistMembershipLoading, setPlaylistMembershipLoading] = useState(false);
  // Absolute filesystem path resolved via Navidrome's native API in parallel
  // with the Subsonic getSong call. Subsonic only ever returns a relative
  // path (or none on Navidrome); the native endpoint is what Feishin and the
  // Navidrome web client use to surface the full server-side location.
  const [absolutePath, setAbsolutePath] = useState<string | null>(null);

  useEffect(() => {
    if (!songInfoModal.isOpen || !songInfoModal.songId) {
      // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSong(null);
      setEnrichment(null);
      setAbsolutePath(null);
      setPlaylistMemberships([]);
      setPlaylistMembershipLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEnrichment(null);
    setAbsolutePath(null);
    setPlaylistMemberships([]);
    setPlaylistMembershipLoading(false);
    const songId = songInfoModal.songId;
    const ownerServerId = songInfoModal.serverId;
    const auth = useAuthStore.getState();
    const sid = ownerServerId ?? auth.activeServerId;
    void (async () => {
      const s = ownerServerId
        ? await getSongForServer(ownerServerId, songId)
        : await getSong(songId);
      if (cancelled) return;
      setSong(s);
      setLoading(false);
      if (!s) {
        setEnrichment(null);
        return;
      }
      const indexEnabled = sid ? useLibraryIndexStore.getState().isIndexEnabled(sid) : false;
      if (sid && indexEnabled && await libraryIsReady(sid)) {
        try {
          const facts = await libraryGetFacts(sid, songId);
          if (!cancelled) {
            setEnrichment(parseTrackEnrichmentFacts(facts, s.bpm ?? null));
          }
        } catch {
          if (!cancelled) setEnrichment(null);
        }
      } else if (!cancelled) {
        setEnrichment(null);
      }
    })();
    // Try the native API in parallel; only when the active server is Navidrome
    // and we have credentials. Failures are silent — modal falls back to
    // whatever the Subsonic `path` field carried (typically nothing).
    const profile = sid ? auth.servers.find(p => p.id === sid) : null;
    const identity = sid ? auth.subsonicServerIdentityByServer[sid] : undefined;
    const isNavidrome = identity?.type?.trim().toLowerCase() === 'navidrome';
    if (sid) {
      setPlaylistMemberships(cachedPlaylistRefsForSong(songId, sid));
    }
    if (isNavidrome && sid) {
      setPlaylistMembershipLoading(true);
      let pendingPlaylistLookups = 2;
      const finishPlaylistLookup = () => {
        pendingPlaylistLookups -= 1;
        if (!cancelled && pendingPlaylistLookups === 0) {
          setPlaylistMembershipLoading(false);
        }
      };
      const mergeNativePlaylists = (playlists: readonly { id: string; name: string }[]) => {
        if (cancelled) return;
        const refs: TrackPlaylistRef[] = playlists.map(playlist => ({
          id: playlist.id,
          serverId: sid,
          name: playlist.name,
        }));
        setPlaylistMemberships(previous => mergePlaylistRefs(
          previous,
          refs,
          cachedPlaylistRefsForSong(songId, sid),
        ));
      };

      // Fast path: materialized/manual playlist membership.
      ndGetSongPlaylists(songId, sid)
        .then(mergeNativePlaylists)
        .catch(() => {
          // Keep whatever complete playlist memberships were already cached.
        })
        .finally(finishPlaylistLookup);

      // Smart path: exact one-song probes. This is intentionally independent
      // so regular playlist names do not wait for smart evaluation.
      resolveSongSmartPlaylistMemberships(songId, sid, () => !cancelled)
        .then(mergeNativePlaylists)
        .catch(() => {
          // Preserve the fast/native and cached results if smart probing fails.
        })
        .finally(finishPlaylistLookup);
    }
    if (isNavidrome && profile?.url && profile.username && profile.password) {
      const serverUrl = (profile.url.startsWith('http') ? profile.url : `http://${profile.url}`).replace(/\/$/, '');
      ndGetSongPath(serverUrl, profile.username, profile.password, songId).then(p => {
        if (!cancelled && p) setAbsolutePath(p);
      });
    }
    return () => { cancelled = true; };
  }, [songInfoModal.isOpen, songInfoModal.songId, songInfoModal.serverId]);

  useEffect(() => {
    if (!songInfoModal.isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSongInfo(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [songInfoModal.isOpen, closeSongInfo]);

  if (!songInfoModal.isOpen) return null;

  const channels = song?.channelCount === 1
    ? t('songInfo.mono')
    : song?.channelCount === 2
      ? t('songInfo.stereo')
      : song?.channelCount
        ? `${song.channelCount} ch`
        : null;

  const trackLabel = song?.discNumber && song.discNumber > 1
    ? `${song.discNumber} – ${song.track}`
    : song?.track != null
      ? String(song.track)
      : null;

  const hasReplayGain = song?.replayGain &&
    (song.replayGain.trackGain !== undefined || song.replayGain.albumGain !== undefined);

  const displayBpm = song
    ? resolveQueueBpm(
      enrichment ?? {
        serverBpm: song.bpm != null && song.bpm > 0 ? song.bpm : null,
        measuredBpm: null,
        moodLabels: [],
      },
    )
    : null;
  // The file's own MOOD/TMOO tags win over the ones the analysis derives: they
  // are what the tagger wrote, while the analysis labels come from a fixed
  // vocabulary the app translates. Tracks with neither keep the row hidden.
  const fileMoods = song ? moodsLabel(song) : '';
  const displayMood = fileMoods
    || (enrichment ? formatQueueMoodLabels(enrichment.moodLabels, t) : null);

  // `genre` carries one name even where the file has several — servers put the
  // full set in OpenSubsonic's `genres`, which is what the album chips and genre
  // browse already read. Same separator as the mood row above.
  const genreTags = song ? genreTagsFor(song) : [];
  const playlistValue = playlistMemberships.length > 0 ? (
    <span className="song-info-playlists">
      {playlistMemberships.map((playlist, index) => (
        <React.Fragment key={`${playlist.serverId}:${playlist.id}`}>
          {index > 0 && <span className="song-info-playlist-sep">·</span>}
          <button
            type="button"
            className="track-playlist-link song-info-playlist-link"
            onClick={() => {
              closeSongInfo();
              navigate(buildPlaylistDetailPath(playlist.id, {
                serverId: playlist.serverId,
              }));
            }}
          >
            {playlistDisplayName(playlist)}
          </button>
        </React.Fragment>
      ))}
    </span>
  ) : playlistMembershipLoading ? t('common.loading') : null;

  return createPortal(
    <>
      <div className="song-info-backdrop" onClick={closeSongInfo} />
      <div className="song-info-modal" role="dialog" aria-modal="true" aria-label={t('songInfo.title')}>
        <div className="song-info-header">
          <span className="song-info-title">{t('songInfo.title')}</span>
          <button className="btn btn-ghost song-info-close" onClick={closeSongInfo} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="song-info-body">
          {loading && <div className="song-info-loading">{t('common.loading')}</div>}

          {!loading && song && (
            <table className="song-info-table">
              <tbody>
                <CopyableFieldRow label={t('songInfo.songTitle')} text={song.title} />
                <CopyableFieldRow label={t('songInfo.artist')} text={song.artist} />
                <CopyableFieldRow label={t('songInfo.album')} text={song.album} />
                {song.albumArtist && song.albumArtist !== song.artist && (
                  <Row label={t('songInfo.albumArtist')} value={song.albumArtist} />
                )}
                <Row label={t('songInfo.year')} value={song.year} />
                <Row
                  label={t(genreTags.length > 1 ? 'songInfo.genres' : 'songInfo.genre')}
                  value={genreTags.join(' · ') || null}
                />
                <Row label={t('songInfo.duration')} value={formatTrackTime(song.duration)} />
                <Row label={t('songInfo.track')} value={trackLabel} />
                <Row label={t('songInfo.bpm')} value={displayBpm} />
                <Row label={t('songInfo.mood')} value={displayMood} />
                <Row label={t('albumDetail.trackPlaylists')} value={playlistValue} />
                <Row label={t('songInfo.playCount')} value={song.playCount} />
                <Row label={t('songInfo.lastPlayed')} value={song.played ? formatLastSeen(song.played, i18n.language, '—') : null} />

                <Divider />

                <Row label={t('songInfo.format')} value={[song.suffix?.toUpperCase(), song.contentType].filter(Boolean).join(' · ') || null} />
                <Row label={t('songInfo.bitrate')} value={song.bitRate ? `${song.bitRate} kbps` : null} />
                <Row label={t('songInfo.sampleRate')} value={song.samplingRate ? `${(song.samplingRate / 1000).toFixed(1)} kHz` : null} />
                <Row label={t('songInfo.bitDepth')} value={song.bitDepth ? `${song.bitDepth} bit` : null} />
                <Row label={t('songInfo.channels')} value={channels} />
                <Row label={t('songInfo.fileSize')} value={formatSize(song.size)} />

                {(absolutePath || song.path) && (
                  <>
                    <Divider />
                    <Row label={t('songInfo.path')} value={<span className="song-info-path">{absolutePath ?? song.path}</span>} />
                  </>
                )}

                {hasReplayGain && (
                  <>
                    <Divider />
                    {song.replayGain!.trackGain !== undefined && (
                      <Row label={t('songInfo.replayGainTrack')} value={`${song.replayGain!.trackGain >= 0 ? '+' : ''}${song.replayGain!.trackGain.toFixed(2)} dB`} />
                    )}
                    {song.replayGain!.albumGain !== undefined && (
                      <Row label={t('songInfo.replayGainAlbum')} value={`${song.replayGain!.albumGain >= 0 ? '+' : ''}${song.replayGain!.albumGain.toFixed(2)} dB`} />
                    )}
                    {song.replayGain!.trackPeak !== undefined && (
                      <Row label={t('songInfo.replayGainPeak')} value={song.replayGain!.trackPeak.toFixed(6)} />
                    )}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
