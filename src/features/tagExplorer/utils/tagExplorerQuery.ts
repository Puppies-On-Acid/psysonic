import type {
  LibraryTagFilter,
  LibraryTagMatchMode,
} from '@/lib/api/library';

export type TagExplorerOrigin = 'genres' | 'moods';
export type TagExplorerView = 'albums' | 'tracks';

export interface TagExplorerQueryState {
  tags: LibraryTagFilter[];
  mode: LibraryTagMatchMode;
  view: TagExplorerView;
}

export function tagExplorerTagKey(tag: LibraryTagFilter): string {
  return `${tag.kind}:\u001f${tag.value.trim().toLocaleLowerCase()}`;
}

export function normalizeTagExplorerTags(
  tags: readonly LibraryTagFilter[],
): LibraryTagFilter[] {
  const seen = new Set<string>();
  const normalized: LibraryTagFilter[] = [];

  for (const tag of tags) {
    const value = tag.value.trim();
    if (!value) continue;
    if (tag.kind !== 'genre' && tag.kind !== 'mood') continue;
    const next = { kind: tag.kind, value } satisfies LibraryTagFilter;
    const key = tagExplorerTagKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

export function parseTagExplorerSearch(search: string): TagExplorerQueryState {
  const params = new URLSearchParams(search);
  const tags = normalizeTagExplorerTags(
    params.getAll('tag').flatMap(raw => {
      const split = raw.indexOf(':');
      if (split <= 0) return [];
      const kind = raw.slice(0, split);
      const value = raw.slice(split + 1);
      if (kind !== 'genre' && kind !== 'mood') return [];
      return [{ kind, value } satisfies LibraryTagFilter];
    }),
  );

  return {
    tags,
    mode: params.get('mode') === 'and' ? 'and' : 'or',
    view: params.get('view') === 'tracks' ? 'tracks' : 'albums',
  };
}

export function serializeTagExplorerSearch(
  state: TagExplorerQueryState,
): string {
  const params = new URLSearchParams();

  for (const tag of normalizeTagExplorerTags(state.tags)) {
    params.append('tag', `${tag.kind}:${tag.value}`);
  }

  if (state.mode === 'and') params.set('mode', 'and');
  if (state.view === 'tracks') params.set('view', 'tracks');

  const value = params.toString();
  return value ? `?${value}` : '';
}

export function tagExplorerResultsPath(
  origin: TagExplorerOrigin,
  state: TagExplorerQueryState,
): string {
  return `/${origin}/explore/results${serializeTagExplorerSearch(state)}`;
}
