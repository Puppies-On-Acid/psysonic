import { create } from 'zustand';
import type { Track } from '@/lib/media/trackTypes';

type SidebarTab = 'queue' | 'lyrics' | 'info';

interface LyricsState {
  activeTab: SidebarTab;
  setTab: (tab: SidebarTab) => void;
  showLyrics: () => void;
  showQueue: () => void;
  showInfo: () => void;
  dialogTrack: Track | null;
  openLyricsDialog: (track: Track) => void;
  closeLyricsDialog: () => void;
}

export const useLyricsStore = create<LyricsState>()((set) => ({
  activeTab: 'queue',
  setTab: (tab) => set({ activeTab: tab }),
  showLyrics: () => set({ activeTab: 'lyrics' }),
  showQueue: () => set({ activeTab: 'queue' }),
  showInfo: () => set({ activeTab: 'info' }),
  dialogTrack: null,
  openLyricsDialog: (track) => set({ dialogTrack: track }),
  closeLyricsDialog: () => set({ dialogTrack: null }),
}));
