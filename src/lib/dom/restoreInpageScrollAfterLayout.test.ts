import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreInpageScrollAfterLayout } from './restoreInpageScrollAfterLayout';

describe('restoreInpageScrollAfterLayout', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let frameId: number;

  const advanceFrame = () => {
    const ready = [...callbacks.values()];
    callbacks.clear();
    for (const callback of ready) callback(0);
  };

  beforeEach(() => {
    callbacks = new Map();
    frameId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++frameId;
      callbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      callbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeViewport() {
    const element = document.createElement('div');
    let contentHeight = 500;
    let scrollTop = 0;
    Object.defineProperties(element, {
      clientHeight: { get: () => 500 },
      scrollHeight: { get: () => contentHeight },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(
            Math.max(0, value),
            Math.max(0, contentHeight - 500),
          );
        },
      },
    });
    return {
      element,
      growTo: (height: number) => { contentHeight = height; },
    };
  }

  it('waits for a virtual album grid to gain height before restoring', () => {
    const { element, growTo } = makeViewport();
    const loadMore = vi.fn();
    const onRestored = vi.fn();
    restoreInpageScrollAfterLayout(element, {
      scrollTop: 1200,
      hasMore: false,
      loadMore,
      onRestored,
    });

    advanceFrame();
    expect(element.scrollTop).toBe(0);
    expect(onRestored).not.toHaveBeenCalled();

    growTo(2500);
    advanceFrame();
    expect(element.scrollTop).toBe(1200);
    expect(onRestored).not.toHaveBeenCalled();

    advanceFrame();
    expect(onRestored).toHaveBeenCalledWith(1200);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('requests pagination if the offset remains unreachable after settling', () => {
    const { element } = makeViewport();
    const loadMore = vi.fn();
    const onRestored = vi.fn();
    restoreInpageScrollAfterLayout(element, {
      scrollTop: 1600,
      hasMore: true,
      loadMore,
      onRestored,
    });

    for (let i = 0; i < 9; i += 1) advanceFrame();

    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('cancels an outdated restore before navigation to another tab', () => {
    const { element } = makeViewport();
    const onRestored = vi.fn();
    const cancel = restoreInpageScrollAfterLayout(element, {
      scrollTop: 900,
      hasMore: false,
      loadMore: vi.fn(),
      onRestored,
    });
    cancel();
    advanceFrame();
    expect(onRestored).not.toHaveBeenCalled();
  });
});
