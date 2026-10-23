import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TagExplorerView } from '@/features/tagExplorer/utils/tagExplorerQuery';
import {
  readTagExplorerScroll,
  writeTagExplorerScroll,
} from '@/features/tagExplorer/utils/tagExplorerScroll';

import { useTagExplorerScrollRestore } from './useTagExplorerScrollRestore';

const pathname = '/genres/explore/results';
const albumSearch = '?tag=genre%3ARock&tag=mood%3ADreamy';
const trackSearch = `${albumSearch}&view=tracks`;

function makeScrollBody() {
  const element = document.createElement('div');
  let contentHeight = 5000;
  let scrollTop = 0;
  const viewportHeight = 500;
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => contentHeight },
    clientHeight: { configurable: true, get: () => viewportHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, contentHeight - viewportHeight));
      },
    },
  });
  return {
    element,
    setContentHeight(height: number) {
      contentHeight = height;
      scrollTop = Math.min(scrollTop, Math.max(0, contentHeight - viewportHeight));
    },
  };
}

describe('useTagExplorerScrollRestore', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('keeps each tab position independent across switches', async () => {
    const { element } = makeScrollBody();
    const loadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ view, search, displayCount }: {
        view: TagExplorerView;
        search: string;
        displayCount: number;
      }) => useTagExplorerScrollRestore({
        pathname,
        search,
        view,
        valid: true,
        scrollBodyEl: element,
        displayCount,
        ready: true,
        loading: false,
        loadingMore: false,
        hasMore: false,
        loadMore,
      }),
      {
        initialProps: {
          view: 'albums' as TagExplorerView,
          search: albumSearch,
          displayCount: 60,
        },
      },
    );

    act(() => {
      element.scrollTop = 450;
      fireEvent.scroll(element);
      result.current.saveBeforeNavigation();
    });
    rerender({ view: 'tracks', search: trackSearch, displayCount: 180 });

    act(() => {
      element.scrollTop = 950;
      fireEvent.scroll(element);
      result.current.saveBeforeNavigation();
      // Switching to the shorter Albums layout can clamp the outgoing viewport.
      element.scrollTop = 0;
      fireEvent.scroll(element);
    });
    expect(readTagExplorerScroll(pathname, trackSearch).tracks).toBe(950);
    rerender({ view: 'albums', search: albumSearch, displayCount: 60 });
    await waitFor(() => expect(element.scrollTop).toBe(450));

    act(() => result.current.saveBeforeNavigation());
    rerender({ view: 'tracks', search: trackSearch, displayCount: 180 });
    await waitFor(() => expect(element.scrollTop).toBe(950));

    const saved = readTagExplorerScroll(pathname, albumSearch);
    expect(saved.albums).toBe(450);
    expect(saved.tracks).toBe(950);
    expect(saved.albumDisplayCount).toBe(60);
    expect(saved.trackDisplayCount).toBe(180);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('does not lose the saved Tracks offset while rows are loading', async () => {
    writeTagExplorerScroll(pathname, trackSearch, {
      albums: 380,
      tracks: 1600,
      albumDisplayCount: 60,
      trackDisplayCount: 240,
    });
    const { element, setContentHeight } = makeScrollBody();
    setContentHeight(500);
    const loadMore = vi.fn();

    const { rerender } = renderHook(
      ({ displayCount, ready, loading, hasMore }: {
        displayCount: number;
        ready: boolean;
        loading: boolean;
        hasMore: boolean;
      }) => useTagExplorerScrollRestore({
        pathname,
        search: trackSearch,
        view: 'tracks',
        valid: true,
        scrollBodyEl: element,
        displayCount,
        ready,
        loading,
        loadingMore: false,
        hasMore,
        loadMore,
      }),
      {
        initialProps: { displayCount: 0, ready: false, loading: true, hasMore: true },
      },
    );

    expect(element.scrollTop).toBe(0);
    expect(loadMore).not.toHaveBeenCalled();

    setContentHeight(1000);
    rerender({ displayCount: 100, ready: true, loading: false, hasMore: true });
    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));

    // A browser clamp/scroll event while the tab is short must not erase 1600.
    act(() => fireEvent.scroll(element));
    expect(readTagExplorerScroll(pathname, trackSearch).tracks).toBe(1600);

    setContentHeight(1300);
    rerender({ displayCount: 200, ready: true, loading: false, hasMore: true });
    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(2));

    setContentHeight(3500);
    rerender({ displayCount: 250, ready: true, loading: false, hasMore: false });
    await waitFor(() => expect(element.scrollTop).toBe(1600));
    expect(readTagExplorerScroll(pathname, trackSearch).tracks).toBe(1600);
  });

  it('reads older scroll snapshots without result counts', () => {
    writeTagExplorerScroll(pathname, albumSearch, {
      albums: 400,
      tracks: 0,
      albumDisplayCount: 25,
      trackDisplayCount: 0,
    });
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, JSON.stringify({ albums: 400, tracks: 100 }));
    const value = readTagExplorerScroll(pathname, albumSearch);
    expect(value).toEqual({
      albums: 400,
      tracks: 100,
      albumDisplayCount: 0,
      trackDisplayCount: 0,
    });
  });
});
