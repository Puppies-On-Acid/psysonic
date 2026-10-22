import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { TagExplorerView } from '@/features/tagExplorer/utils/tagExplorerQuery';
import {
  readTagExplorerScroll,
  writeTagExplorerScroll,
} from '@/features/tagExplorer/utils/tagExplorerScroll';

type PendingRestore = {
  contextKey: string;
  scrollTop: number;
  displayCount: number;
};

interface Args {
  pathname: string;
  search: string;
  view: TagExplorerView;
  valid: boolean;
  scrollBodyEl: HTMLElement | null;
  displayCount: number;
  ready: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Preserve independent Explorer tab scroll sessions. Capture the outgoing tab
 * before navigation, and delay restoration until the destination tab has
 * enough rows to reach its saved offset (including lazy pagination).
 */
export function useTagExplorerScrollRestore({
  pathname,
  search,
  view,
  valid,
  scrollBodyEl,
  displayCount,
  ready,
  loading,
  loadingMore,
  hasMore,
  loadMore,
}: Args) {
  const contextKey = JSON.stringify([pathname, search]);
  const activeContextRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingRestore | null>(null);

  const captureCurrentScroll = useCallback(() => {
    if (
      !valid ||
      !scrollBodyEl ||
      activeContextRef.current !== contextKey ||
      pendingRef.current !== null
    ) return;

    const saved = readTagExplorerScroll(pathname, search);
    const next = view === 'albums'
      ? {
          ...saved,
          albums: scrollBodyEl.scrollTop,
          albumDisplayCount: displayCount,
        }
      : {
          ...saved,
          tracks: scrollBodyEl.scrollTop,
          trackDisplayCount: displayCount,
        };

    writeTagExplorerScroll(pathname, search, next);
  }, [contextKey, displayCount, pathname, scrollBodyEl, search, valid, view]);

  const saveBeforeNavigation = useCallback(() => {
    captureCurrentScroll();
    // Invalidate the outgoing listener before the destination replaces its rows.
    activeContextRef.current = null;
  }, [captureCurrentScroll]);

  // Set up the target first, so the outgoing tab cannot overwrite it with a
  // browser-clamped scroll event when the list switches or becomes a spinner.
  // eslint-disable-next-line react-hooks/immutability
  useLayoutEffect(() => {
    if (!scrollBodyEl || !valid || activeContextRef.current === contextKey) return;

    activeContextRef.current = contextKey;
    const saved = readTagExplorerScroll(pathname, search);
    pendingRef.current = {
      contextKey,
      scrollTop: saved[view],
      displayCount: view === 'albums'
        ? saved.albumDisplayCount
        : saved.trackDisplayCount,
    };

    // The previous tab may have scrolled much farther than this tab can.
    // eslint-disable-next-line react-hooks/immutability
    scrollBodyEl.scrollTop = 0;
  }, [contextKey, pathname, scrollBodyEl, search, valid, view]);

  // eslint-disable-next-line react-hooks/immutability
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!scrollBodyEl || !valid || !pending || pending.contextKey !== contextKey) return;
    if (pending.scrollTop === 0) {
      // eslint-disable-next-line react-hooks/immutability
      scrollBodyEl.scrollTop = 0;
      pendingRef.current = null;
      return;
    }
    if (!ready || loading || loadingMore) return;

    // Defer measurements until layout has the new tab's rows. A query change
    // may invalidate previously ready rows during passive effects.
    const frame = window.requestAnimationFrame(() => {
      if (pendingRef.current !== pending) return;
      const availableScroll = Math.max(
        0,
        scrollBodyEl.scrollHeight - scrollBodyEl.clientHeight,
      );
      if (
        hasMore &&
        (displayCount < pending.displayCount || availableScroll < pending.scrollTop)
      ) {
        loadMore();
        return;
      }

      // eslint-disable-next-line react-hooks/immutability
      scrollBodyEl.scrollTop = pending.scrollTop;
      pendingRef.current = null;
      scrollBodyEl.dispatchEvent(new Event('scroll'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    contextKey,
    displayCount,
    hasMore,
    loadMore,
    loading,
    loadingMore,
    ready,
    scrollBodyEl,
    valid,
  ]);

  useEffect(() => {
    if (!scrollBodyEl || !valid) return;
    scrollBodyEl.addEventListener('scroll', captureCurrentScroll, { passive: true });
    return () => scrollBodyEl.removeEventListener('scroll', captureCurrentScroll);
  }, [captureCurrentScroll, scrollBodyEl, valid]);

  return { saveBeforeNavigation };
}
