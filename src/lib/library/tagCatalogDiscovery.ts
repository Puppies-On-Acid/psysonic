export type TagCatalogSort = 'popularity' | 'alphabetical';

export interface TagCatalogRow {
  value: string;
  albumCount: number;
}

export interface TagCatalogReturnState {
  search: string;
  scrollTop: number;
}

export function filterAndSortTagCatalog<T extends TagCatalogRow>(
  rows: readonly T[],
  search: string,
  sort: TagCatalogSort,
): T[] {
  const query = search.trim().toLocaleLowerCase();
  const filtered = query
    ? rows.filter(row => row.value.toLocaleLowerCase().includes(query))
    : [...rows];

  return filtered.sort((a, b) => {
    if (sort === 'alphabetical') {
      return a.value.localeCompare(b.value);
    }

    return (
      b.albumCount - a.albumCount ||
      a.value.localeCompare(b.value)
    );
  });
}

export function readTagCatalogSort(storageKey: string): TagCatalogSort {
  if (typeof window === 'undefined') return 'popularity';
  return sessionStorage.getItem(storageKey) === 'alphabetical'
    ? 'alphabetical'
    : 'popularity';
}

export function writeTagCatalogSort(
  storageKey: string,
  sort: TagCatalogSort,
): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(storageKey, sort);
}

export function consumeTagCatalogReturnState(
  storageKey: string,
): TagCatalogReturnState | null {
  if (typeof window === 'undefined') return null;

  const raw = sessionStorage.getItem(storageKey);
  sessionStorage.removeItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TagCatalogReturnState>;
    if (
      typeof parsed.search !== 'string' ||
      typeof parsed.scrollTop !== 'number' ||
      !Number.isFinite(parsed.scrollTop)
    ) {
      return null;
    }

    return {
      search: parsed.search,
      scrollTop: Math.max(0, parsed.scrollTop),
    };
  } catch {
    return null;
  }
}

export function storeTagCatalogReturnState(
  storageKey: string,
  state: TagCatalogReturnState,
): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(storageKey, JSON.stringify(state));
}
