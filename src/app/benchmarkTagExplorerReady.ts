/**
 * Match the query being benchmarked to the data that has actually finished
 * loading. The benchmark marker on the page is backed by the completed browse
 * key, not simply by the route's current tag controls.
 */
type ExplorerView = 'albums' | 'tracks';
type ExplorerMode = 'or' | 'and';

const BASE_URL = 'http://benchmark.invalid';

function explorerState(url: URL) {
  return {
    tags: JSON.stringify(url.searchParams.getAll('tag')),
    view: url.searchParams.get('view') === 'tracks' ? 'tracks' : 'albums',
    mode: url.searchParams.get('mode') === 'and' ? 'and' : 'or',
  };
}

export function tagExplorerBenchmarkTarget(
  route: string,
  view: ExplorerView,
  mode: ExplorerMode,
): string {
  const target = new URL(route, BASE_URL);
  target.searchParams.delete('benchmarkTags');
  target.searchParams.delete('view');
  target.searchParams.delete('mode');
  if (mode === 'and') target.searchParams.set('mode', 'and');
  if (view === 'tracks') target.searchParams.set('view', 'tracks');
  return `${target.pathname}${target.search}`;
}

export function benchmarkTagExplorerReady(
  route: string,
  root: Element | null,
  location?: Pick<Location, 'pathname' | 'search'>,
): boolean {
  if (!root) return false;
  const target = new URL(route, BASE_URL);
  if (
    target.pathname !== '/genres/explore/results'
    && target.pathname !== '/moods/explore/results'
  ) return false;

  const expected = explorerState(target);
  if (target.searchParams.getAll('tag').length < 2) return false;
  if (location) {
    const actual = new URL(`${location.pathname}${location.search}`, BASE_URL);
    const current = explorerState(actual);
    if (
      actual.pathname !== target.pathname
      || current.tags !== expected.tags
      || current.view !== expected.view
      || current.mode !== expected.mode
    ) return false;
  }

  return root.getAttribute('data-benchmark-tag-explorer-tags') === expected.tags
    && root.getAttribute('data-benchmark-tag-explorer-view') === expected.view
    && root.getAttribute('data-benchmark-tag-explorer-mode') === expected.mode
    && root.getAttribute('data-benchmark-loading') === 'false'
    && root.getAttribute('data-benchmark-query-ready') === 'true'
    && root.getAttribute('data-benchmark-query-error') !== 'true';
}
