import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearGenreDetailReturnStash,
  clearGenreDetailTabScrollSnapshots,
  peekGenreDetailReturnStash,
  peekGenreDetailTabScrollSnapshots,
  stashGenreDetailTabScrollSnapshots,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';

import { useGenreDetailBrowse } from './useGenreDetailBrowse';

function RouterWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return <BrowserRouter>{children}</BrowserRouter>;
}

describe('useGenreDetailBrowse', () => {
  beforeEach(() => {
    clearGenreDetailReturnStash(
      'srv-1',
      'Progressive Rock',
    );
    clearGenreDetailTabScrollSnapshots(
      'srv-1',
      'Progressive Rock',
    );
    window.history.replaceState(
      {},
      '',
      '/genres/Progressive%20Rock?view=tracks',
    );
  });

  afterEach(() => {
    clearGenreDetailReturnStash(
      'srv-1',
      'Progressive Rock',
    );
    clearGenreDetailTabScrollSnapshots(
      'srv-1',
      'Progressive Rock',
    );
    window.history.replaceState({}, '', '/');
  });

  it('records Tracks as the owner of the restore display count', () => {
    const scrollSnapshotRef = {
      current: {
        scrollTop: 0,
        displayCount: 0,
      },
    };

    const { result } = renderHook(
      () =>
        useGenreDetailBrowse(
          'srv-1',
          'Progressive Rock',
          scrollSnapshotRef,
        ),
      { wrapper: RouterWrapper },
    );

    expect(result.current.restoreView).toBe(
      'tracks',
    );
  });

  it('stashes both tab scroll snapshots when leaving for artist detail', () => {
    const albumScrollSnapshotRef: {
      current: AlbumBrowseScrollSnapshot;
    } = {
      current: {
        scrollTop: 320,
        displayCount: 120,
      },
    };
    const trackScrollSnapshotRef: {
      current: AlbumBrowseScrollSnapshot;
    } = {
      current: {
        scrollTop: 640,
        displayCount: 275,
      },
    };

    const { unmount } = renderHook(
      () =>
        useGenreDetailBrowse(
          'srv-1',
          'Progressive Rock',
          trackScrollSnapshotRef,
          albumScrollSnapshotRef,
          trackScrollSnapshotRef,
        ),
      { wrapper: RouterWrapper },
    );

    window.history.pushState(
      {},
      '',
      '/artist/artist-1',
    );

    unmount();

    expect(
      peekGenreDetailReturnStash(
        'srv-1',
        'Progressive Rock',
      ),
    ).toMatchObject({
      scrollTop: 640,
      displayCount: 275,
    });
    expect(
      peekGenreDetailTabScrollSnapshots(
        'srv-1',
        'Progressive Rock',
      ),
    ).toEqual({
      albums: {
        scrollTop: 320,
        displayCount: 120,
      },
      tracks: {
        scrollTop: 640,
        displayCount: 275,
      },
    });
  });

  it('restores both tab snapshots for the returned genre session', () => {
    stashGenreDetailTabScrollSnapshots(
      'srv-1',
      'Progressive Rock',
      {
        albums: {
          scrollTop: 410,
          displayCount: 180,
        },
        tracks: {
          scrollTop: 880,
          displayCount: 360,
        },
      },
    );

    const { result } = renderHook(
      () =>
        useGenreDetailBrowse(
          'srv-1',
          'Progressive Rock',
        ),
      { wrapper: RouterWrapper },
    );

    expect(
      result.current.restoreTabScrollSnapshots,
    ).toEqual({
      albums: {
        scrollTop: 410,
        displayCount: 180,
      },
      tracks: {
        scrollTop: 880,
        displayCount: 360,
      },
    });
  });
});
