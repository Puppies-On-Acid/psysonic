/**
 * Restore an in-page scroll position after the DOM and any virtualized grid
 * have had time to measure. A newly-mounted album grid can briefly expose an
 * empty scroll range; treating that temporary clamp as the restored position
 * permanently loses the previous Albums tab offset.
 *
 * If additional result pages are available and the saved position still does
 * not fit after layout settles, request another page instead of clamping.
 */
const LAYOUT_SETTLE_FRAMES = 8;

interface ScrollRestoreRequest {
  scrollTop: number;
  hasMore: boolean;
  loadMore: () => void;
  onRestored: (actualScrollTop: number) => void;
}

export function restoreInpageScrollAfterLayout(
  viewport: HTMLElement,
  request: ScrollRestoreRequest,
): () => void {
  const target = Math.max(0, request.scrollTop);
  let frame = 0;
  let waitFrames = 0;
  let applied = false;

  function attempt() {
    const maxScroll = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight,
    );
    // An unmeasured viewport (e.g. in tests) cannot supply a scroll range.
    const measured = viewport.clientHeight > 0;

    if (measured && maxScroll + 1 < target) {
      if (waitFrames < LAYOUT_SETTLE_FRAMES) {
        waitFrames += 1;
        frame = window.requestAnimationFrame(attempt);
        return;
      }
      if (request.hasMore) {
        request.loadMore();
        return;
      }
    }

    viewport.scrollTop = target;
    if (!applied) {
      // Allow the virtualizer to react to the new viewport position.
      applied = true;
      frame = window.requestAnimationFrame(attempt);
      return;
    }
    request.onRestored(viewport.scrollTop);
  }

  frame = window.requestAnimationFrame(attempt);
  return () => window.cancelAnimationFrame(frame);
}
