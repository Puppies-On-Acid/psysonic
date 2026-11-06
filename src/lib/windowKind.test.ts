/**
 * Tests for the cached Tauri window-kind detector.
 *
 * The cache is module-scoped, so each test must reset it via the
 * `_resetWindowKindCacheForTest()` escape hatch — otherwise the first call
 * locks the value for the rest of the file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
}));

import { getCurrentWindow } from '@tauri-apps/api/window';
import { _resetWindowKindCacheForTest, getWindowKind, isMainWindow } from './windowKind';

beforeEach(() => {
  _resetWindowKindCacheForTest();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetWindowKindCacheForTest();
});

describe('getWindowKind', () => {
  it('returns "main" when the current window label is "main"', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'main' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('main');
  });

  it('returns "mini" when the current window label is "mini"', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'mini' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('mini');
  });

  it('falls back to "main" for any other label', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'something-else' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('main');
  });

  it('falls back to "main" when getCurrentWindow throws (non-Tauri runtime)', () => {
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error('not in tauri');
    });
    expect(getWindowKind()).toBe('main');
  });

  it('caches the first result and does not call getCurrentWindow again', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'mini' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('mini');
    expect(getWindowKind()).toBe('mini');
    expect(getWindowKind()).toBe('mini');
    expect(getCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the cache is reset', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'main' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('main');

    _resetWindowKindCacheForTest();
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'mini' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('mini');
    expect(getCurrentWindow).toHaveBeenCalledTimes(2);
  });

  it('shares one cached label between both main-window helpers', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'main' } as ReturnType<typeof getCurrentWindow>);
    expect(getWindowKind()).toBe('main');
    for (let i = 0; i < 100; i += 1) {
      expect(isMainWindow()).toBe(true);
      expect(isMainWindow(true)).toBe(true);
      expect(getWindowKind()).toBe('main');
    }
    expect(getCurrentWindow).toHaveBeenCalledOnce();
  });

  it('does not grant main-window privileges to the mini or an unknown label', () => {
    for (const label of ['mini', 'another-window']) {
      _resetWindowKindCacheForTest();
      vi.mocked(getCurrentWindow).mockReturnValue({ label } as ReturnType<typeof getCurrentWindow>);
      expect(isMainWindow()).toBe(false);
      expect(isMainWindow(true)).toBe(false);
      expect(getWindowKind()).toBe(label === 'mini' ? 'mini' : 'main');
    }
  });

  it('only allows the browser fallback when explicitly requested', () => {
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error('not in tauri');
    });
    expect(getWindowKind()).toBe('main');
    expect(isMainWindow()).toBe(false);
    expect(isMainWindow(true)).toBe(true);
    expect(getCurrentWindow).toHaveBeenCalledOnce();
  });

  it('keeps the first label until reset rather than adopting another window', () => {
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'main' } as ReturnType<typeof getCurrentWindow>);
    expect(isMainWindow()).toBe(true);
    vi.mocked(getCurrentWindow).mockReturnValue({ label: 'mini' } as ReturnType<typeof getCurrentWindow>);
    expect(isMainWindow()).toBe(true);
    expect(getCurrentWindow).toHaveBeenCalledOnce();
    _resetWindowKindCacheForTest();
    expect(isMainWindow()).toBe(false);
    expect(getCurrentWindow).toHaveBeenCalledTimes(2);
  });
});
