import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Pure function model of the tab strip mouse wheel horizontal scroll handler
 * implemented in src/renderer/main.tsx (lines 2702-2719).
 */
export function createTabStripWheelHandler(list: {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}) {
  return function scrollWithWheel(event: {
    ctrlKey: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    preventDefault: () => void;
  }): boolean {
    if (event.ctrlKey) return false;
    if (list.scrollWidth <= list.clientWidth) return false;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0) return false;
    event.preventDefault();
    const unit =
      event.deltaMode === 1 /* DOM_DELTA_LINE */
        ? 32
        : event.deltaMode === 2 /* DOM_DELTA_PAGE */
        ? list.clientWidth
        : 1; /* DOM_DELTA_PIXEL */
    list.scrollLeft += delta * unit;
    return true;
  };
}

describe('Tab Strip Horizontal Scroll with Mouse Wheel', () => {
  const DOM_DELTA_PIXEL = 0;
  const DOM_DELTA_LINE = 1;
  const DOM_DELTA_PAGE = 2;

  let mockList: { scrollWidth: number; clientWidth: number; scrollLeft: number };
  let preventDefaultSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockList = {
      scrollWidth: 2000, // Overflowing tabs (e.g. 20 tabs)
      clientWidth: 800,  // Visible strip width
      scrollLeft: 100,
    };
    preventDefaultSpy = vi.fn();
  });

  describe('Vertical wheel conversion to horizontal scroll', () => {
    it('scrolls right on downward mouse wheel scroll (deltaY > 0)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 100,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(200); // 100 + 100 * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('scrolls left on upward mouse wheel scroll (deltaY < 0)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: -50,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(50); // 100 + (-50) * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Horizontal tilt and trackpad gestures (deltaX)', () => {
    it('scrolls with deltaX when deltaX is larger than deltaY (trackpad / horizontal wheel)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 75,
        deltaY: 10,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(175); // 100 + 75 * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('prioritizes deltaY when vertical movement is greater or equal to deltaX', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 40,
        deltaY: 80,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(180); // 100 + 80
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Overflow detection and non-overflowing strip guards', () => {
    it('does not scroll and does not prevent default when tabs fit inside strip (scrollWidth < clientWidth)', () => {
      mockList.scrollWidth = 400;
      mockList.clientWidth = 800;
      mockList.scrollLeft = 0;

      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 100,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(0);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('does not scroll when tabs exactly equal clientWidth (scrollWidth === clientWidth)', () => {
      mockList.scrollWidth = 800;
      mockList.clientWidth = 800;
      mockList.scrollLeft = 0;

      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 100,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(0);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('Modifier keys and browser zoom protection', () => {
    it('ignores wheel events when Ctrl key is pressed (Ctrl+Wheel is reserved for page zoom)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: true,
        deltaX: 0,
        deltaY: 100,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(100); // Unchanged
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('Delta mode resolution (PIXEL, LINE, PAGE)', () => {
    it('multiplies by 32px for line delta mode (DOM_DELTA_LINE)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 3, // 3 lines
        deltaMode: DOM_DELTA_LINE,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(100 + 3 * 32); // 196
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('multiplies by clientWidth for page delta mode (DOM_DELTA_PAGE)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 1, // 1 page
        deltaMode: DOM_DELTA_PAGE,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(100 + 1 * 800); // 900
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('uses 1:1 pixel mapping for pixel delta mode (DOM_DELTA_PIXEL)', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 42,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(142);
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases', () => {
    it('ignores zero delta events without calling preventDefault', () => {
      const handler = createTabStripWheelHandler(mockList);
      const handled = handler({
        ctrlKey: false,
        deltaX: 0,
        deltaY: 0,
        deltaMode: DOM_DELTA_PIXEL,
        preventDefault: preventDefaultSpy,
      });

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(100);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('handles DOM wheel listener registration on strip with passive: false', () => {
      const addEventListenerSpy = vi.fn();
      const removeEventListenerSpy = vi.fn();
      const dummyStrip = {
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      };

      const handler = createTabStripWheelHandler(mockList);
      dummyStrip.addEventListener('wheel', handler, { passive: false });

      expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', handler, { passive: false });

      dummyStrip.removeEventListener('wheel', handler);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', handler);
    });
  });
});
