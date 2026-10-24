import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureTagExplorerBenchmarkState,
  routeSupportsScrollPagination,
} from './benchmarkInteractions';
import {
  benchmarkTagExplorerReady,
  tagExplorerBenchmarkTarget,
} from './benchmarkTagExplorerReady';

describe('routeSupportsScrollPagination', () => {
  it('covers shared sentinel routes including dynamic genre pages', () => {
    expect(routeSupportsScrollPagination('/albums')).toBe(true);
    expect(routeSupportsScrollPagination('/search/advanced')).toBe(true);
    expect(routeSupportsScrollPagination('/genres/Rock%20%26%20Roll')).toBe(true);
    expect(
      routeSupportsScrollPagination(
        '/genres/explore/results?tag=genre%3ARock&tag=mood%3ADreamy',
      ),
    ).toBe(false);
  });

  it('does not treat button-based or fixed-size pages as scroll pagination', () => {
    expect(routeSupportsScrollPagination('/most-played')).toBe(false);
    expect(routeSupportsScrollPagination('/random/albums')).toBe(false);
    expect(routeSupportsScrollPagination('/settings')).toBe(false);
  });
});

describe('Explorer benchmark query readiness', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it.each([2, 5, 10])('rejects stale data when navigating a %i-tag Explorer query', tagCount => {
    const tags = Array.from({ length: tagCount }, (_, i) => `tag=genre%3AGenre${i}`);
    const route = `/genres/explore/results?${tags.join('&')}&benchmarkTags=${tagCount}`;
    const root = document.createElement('div');
    root.setAttribute('data-benchmark-tag-explorer-tags', JSON.stringify(
      Array.from({ length: tagCount }, (_, i) => `genre:Genre${i}`),
    ));
    root.setAttribute('data-benchmark-tag-explorer-view', 'albums');
    root.setAttribute('data-benchmark-tag-explorer-mode', 'or');
    root.setAttribute('data-benchmark-query-ready', 'true');
    root.setAttribute('data-benchmark-query-error', 'false');
    root.setAttribute('data-benchmark-loading', 'false');

    window.history.replaceState(null, '', route);
    expect(benchmarkTagExplorerReady(route, root, window.location)).toBe(true);

    const trackAnd = tagExplorerBenchmarkTarget(route, 'tracks', 'and');
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(false);

    root.setAttribute('data-benchmark-tag-explorer-view', 'tracks');
    root.setAttribute('data-benchmark-tag-explorer-mode', 'and');
    window.history.replaceState(null, '', trackAnd);
    // Even with the new controls committed, no query-specific result is ready.
    root.setAttribute('data-benchmark-query-ready', 'false');
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(false);
    root.setAttribute('data-benchmark-query-ready', 'true');
    root.setAttribute('data-benchmark-loading', 'true');
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(false);
    root.setAttribute('data-benchmark-loading', 'false');
    root.setAttribute('data-benchmark-query-error', 'true');
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(false);
    root.setAttribute('data-benchmark-query-error', 'false');
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(true);

    root.setAttribute('data-benchmark-tag-explorer-tags', JSON.stringify(
      Array.from({ length: tagCount }, (_, i) => `genre:Other${i}`),
    ));
    expect(benchmarkTagExplorerReady(trackAnd, root, window.location)).toBe(false);
  });

  it.each([2, 5, 10])('serializes the %i-tag mode/view transitions and restores OR Albums', async tagCount => {
    const tags = Array.from({ length: tagCount }, (_, i) => `tag=genre%3AGenre${i}`);
    const route = `/genres/explore/results?${tags.join('&')}&benchmarkTags=${tagCount}`;
    const root = document.createElement('div');
    root.setAttribute('data-benchmark-tag-explorer-view', 'albums');
    root.setAttribute('data-benchmark-tag-explorer-mode', 'or');
    root.setAttribute('data-benchmark-tag-explorer-tags', JSON.stringify(
      Array.from({ length: tagCount }, (_, i) => `genre:Genre${i}`),
    ));
    root.setAttribute('data-benchmark-loading', 'false');
    root.setAttribute('data-benchmark-query-ready', 'true');
    root.setAttribute('data-benchmark-query-error', 'false');
    document.body.append(root);
    window.history.replaceState(null, '', route);

    const commits: string[] = [];
    const add = (kind: 'view' | 'mode', value: 'albums' | 'tracks' | 'or' | 'and') => {
      const control = document.createElement('button');
      control.setAttribute(
        kind === 'mode'
          ? 'data-benchmark-tag-explorer-mode-control'
          : 'data-benchmark-tag-explorer-view-control',
        value,
      );
      control.addEventListener('click', () => {
        // Simulate a deferred React navigation which captures the old state.
        // Simultaneous clicks would both derive their targets from that state.
        const previousView = root.getAttribute('data-benchmark-tag-explorer-view') as 'albums' | 'tracks';
        const previousMode = root.getAttribute('data-benchmark-tag-explorer-mode') as 'or' | 'and';
        const newView = kind === 'view' ? value as 'albums' | 'tracks' : previousView;
        const newMode = kind === 'mode' ? value as 'or' | 'and' : previousMode;
        root.setAttribute('data-benchmark-query-ready', 'false');
        window.setTimeout(() => {
          window.history.replaceState(null, '', tagExplorerBenchmarkTarget(route, newView, newMode));
          root.setAttribute('data-benchmark-tag-explorer-view', newView);
          root.setAttribute('data-benchmark-tag-explorer-mode', newMode);
          commits.push(`${newView}/${newMode}`);
          // The URL/controls commit before the indexed results finish loading.
          window.setTimeout(() => {
            root.setAttribute('data-benchmark-query-ready', 'true');
          }, 30);
        }, 5);
      });
      document.body.append(control);
    };
    add('mode', 'or');
    add('mode', 'and');
    add('view', 'albums');
    add('view', 'tracks');

    expect(await ensureTagExplorerBenchmarkState(route, 'tracks', 'and')).toBe(true);
    expect(await ensureTagExplorerBenchmarkState(route, 'albums', 'or')).toBe(true);
    expect(commits).toEqual([
      'albums/and',
      'tracks/and',
      'tracks/or',
      'albums/or',
    ]);
    expect(benchmarkTagExplorerReady(
      tagExplorerBenchmarkTarget(route, 'albums', 'or'),
      root,
      window.location,
    )).toBe(true);
  });
});
