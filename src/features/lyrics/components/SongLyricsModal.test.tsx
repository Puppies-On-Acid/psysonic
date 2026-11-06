import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseLyricsResult } from '@/features/lyrics/hooks/useLyrics';
import type { Track } from '@/lib/media/trackTypes';
import { useAuthStore } from '@/store/authStore';
import { useLyricsStore } from '@/store/lyricsStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetPlayerStore } from '@/test/helpers/storeReset';

const mockLyrics = vi.hoisted(() => ({
  current: null as UseLyricsResult | null,
  refresh: vi.fn(),
}));

vi.mock('@/features/lyrics/hooks/useLyrics', () => ({
  useLyrics: () => mockLyrics.current,
}));

import SongLyricsModal from './SongLyricsModal';

const track: Track = {
  id: 'song-1',
  serverId: 'srv-owner',
  title: 'Requested Track',
  artist: 'Artist',
  album: 'Album',
  albumId: 'album-1',
  duration: 180,
};

function lyrics(overrides: Partial<UseLyricsResult> = {}): UseLyricsResult {
  return {
    syncedLines: null,
    wordLines: null,
    plainLyrics: 'First verse\nSecond verse',
    pronunciationLines: null,
    pronunciationPlainLyrics: null,
    translations: [],
    source: 'server',
    loading: false,
    notFound: false,
    refresh: mockLyrics.refresh,
    ...overrides,
  };
}

beforeEach(() => {
  resetPlayerStore();
  mockLyrics.refresh.mockReset();
  mockLyrics.current = lyrics();
  useLyricsStore.setState({ dialogTrack: null });
  useAuthStore.setState({
    lyricsSources: [{ id: 'server', enabled: true }],
  });
});

describe('SongLyricsModal', () => {
  it('renders synced lyrics as static text without changing the playing track', () => {
    const playingTrack = { ...track, id: 'playing-track', title: 'Different Song' };
    usePlayerStore.setState({ currentTrack: playingTrack, isPlaying: true });
    mockLyrics.current = lyrics({
      syncedLines: [{ time: 1, text: 'Line one' }, { time: 3, text: 'Line two' }],
      plainLyrics: null,
    });
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);

    expect(screen.getByRole('dialog', { name: 'Song Lyrics' })).toBeInTheDocument();
    expect(screen.getByText('Requested Track')).toBeInTheDocument();
    expect(screen.getByTestId('song-lyrics-text').textContent).toBe('Line one\nLine two');
    expect(usePlayerStore.getState().currentTrack).toEqual(playingTrack);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('offers a retry when lyrics are unavailable', async () => {
    mockLyrics.current = lyrics({ plainLyrics: null, source: null, notFound: true });
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);

    expect(screen.getByText('No lyrics found for this track')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh lyrics' }));
    expect(mockLyrics.refresh).toHaveBeenCalledOnce();
  });

  it('does not offer retrieval when lyrics sources are disabled', () => {
    useAuthStore.setState({ lyricsSources: [] });
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);

    expect(screen.getByText(/No lyrics sources selected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh lyrics' })).toBeDisabled();
  });

  it('allows closing with Escape without interrupting the queue', async () => {
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);

    await userEvent.setup().keyboard('{Escape}');
    expect(useLyricsStore.getState().dialogTrack).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Song Lyrics' })).not.toBeInTheDocument();
  });

  it('replaces a selected track without retaining the previous title', () => {
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);
    expect(screen.getByText('Requested Track')).toBeInTheDocument();

    act(() => useLyricsStore.getState().openLyricsDialog({
      ...track,
      id: 'song-2',
      title: 'Next Requested Track',
    }));
    expect(screen.getByText('Next Requested Track')).toBeInTheDocument();
    expect(screen.queryByText('Requested Track')).not.toBeInTheDocument();
  });

  it('shows loading instead of stale lyrics during a refresh', () => {
    mockLyrics.current = lyrics({ loading: true });
    useLyricsStore.getState().openLyricsDialog(track);
    renderWithProviders(<SongLyricsModal />);

    expect(screen.getByText('Loading lyrics…')).toBeInTheDocument();
    expect(screen.queryByTestId('song-lyrics-text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh lyrics' })).toBeDisabled();
  });
});
