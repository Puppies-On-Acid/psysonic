import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowKind = 'main' | 'mini';

// A Tauri window's label is immutable for its lifetime. Keep the exact label,
// not just its UI kind: an unexpected label may render the main shell, but must
// never gain main-window privileges such as writing the persisted play queue.
// null means no Tauri window was available (e.g. browser preview / tests).
let cachedWindowLabel: string | null | undefined;

function getWindowLabel(): string | null {
  if (cachedWindowLabel !== undefined) return cachedWindowLabel;
  try {
    cachedWindowLabel = getCurrentWindow().label;
  } catch {
    cachedWindowLabel = null;
  }
  return cachedWindowLabel;
}

/**
 * Choose the main or mini UI. Retains the original main fallback for unknown
 * labels and non-Tauri environments.
 */
export function getWindowKind(): WindowKind {
  return getWindowLabel() === 'mini' ? 'mini' : 'main';
}

/**
 * Check main-window privileges using the exact (cached) Tauri label.
 * The player store opts into the non-Tauri fallback so browser previews
 * and tests can still persist local state; the mini bridge does not.
 */
export function isMainWindow(allowNonTauri = false): boolean {
  const label = getWindowLabel();
  return label === 'main' || (allowNonTauri && label === null);
}

/** Test-only: clear the cached label between synthetic window scenarios. */
export function _resetWindowKindCacheForTest(): void {
  cachedWindowLabel = undefined;
}
