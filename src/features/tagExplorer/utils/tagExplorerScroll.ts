export interface TagExplorerScrollState {
  albums: number;
  tracks: number;
  albumDisplayCount: number;
  trackDisplayCount: number;
}

const PREFIX = 'tag-explorer-scroll:';

function key(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('view');
  return `${PREFIX}${pathname}?${params.toString()}`;
}

export function readTagExplorerScroll(
  pathname: string,
  search: string,
): TagExplorerScrollState {
  try {
    const raw = sessionStorage.getItem(key(pathname, search));
    if (!raw) return { albums: 0, tracks: 0, albumDisplayCount: 0, trackDisplayCount: 0 };
    const parsed = JSON.parse(raw) as Partial<TagExplorerScrollState>;
    return {
      albums: typeof parsed.albums === 'number' && Number.isFinite(parsed.albums)
        ? Math.max(0, parsed.albums)
        : 0,
      tracks: typeof parsed.tracks === 'number' && Number.isFinite(parsed.tracks)
        ? Math.max(0, parsed.tracks)
        : 0,
      albumDisplayCount: typeof parsed.albumDisplayCount === 'number' && Number.isFinite(parsed.albumDisplayCount)
        ? Math.max(0, Math.floor(parsed.albumDisplayCount))
        : 0,
      trackDisplayCount: typeof parsed.trackDisplayCount === 'number' && Number.isFinite(parsed.trackDisplayCount)
        ? Math.max(0, Math.floor(parsed.trackDisplayCount))
        : 0,
    };
  } catch {
    return { albums: 0, tracks: 0, albumDisplayCount: 0, trackDisplayCount: 0 };
  }
}

export function writeTagExplorerScroll(
  pathname: string,
  search: string,
  state: TagExplorerScrollState,
): void {
  sessionStorage.setItem(
    key(pathname, search),
    JSON.stringify({
      albums: Math.max(0, state.albums),
      tracks: Math.max(0, state.tracks),
      albumDisplayCount: Math.max(0, Math.floor(state.albumDisplayCount)),
      trackDisplayCount: Math.max(0, Math.floor(state.trackDisplayCount)),
    }),
  );
}

export function clearTagExplorerScroll(
  pathname: string,
  search: string,
): void {
  sessionStorage.removeItem(key(pathname, search));
}
