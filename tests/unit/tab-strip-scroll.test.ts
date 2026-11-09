import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  applyTabStripWheel,
  nextTabIndex,
  wheelCycleDirection,
  TAB_STRIP_LINE_PIXELS,
  TAB_STRIP_PAGE_RATIO,
  TAB_STRIP_SHIFT_MULTIPLIER,
} from '../../src/renderer/tabStripScroll';

/**
 * These cases exercise the shipped tab-strip wheel logic
 * (`src/renderer/tabStripScroll.ts`), which `TabStrip` imports at runtime, so
 * the suite can no longer drift from the component.
 */
describe('Tab Strip Horizontal Scroll with Mouse Wheel', () => {
  const DOM_DELTA_PIXEL = 0;
  const DOM_DELTA_LINE = 1;
  const DOM_DELTA_PAGE = 2;

  let mockList: { scrollWidth: number; clientWidth: number; scrollLeft: number };
  let preventDefaultSpy: ReturnType<typeof vi.fn>;

  const wheel = (overrides: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
  }> = {}) => ({
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    deltaX: 0,
    deltaY: 0,
    deltaMode: DOM_DELTA_PIXEL,
    preventDefault: preventDefaultSpy,
    ...overrides,
  });

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
      const handled = applyTabStripWheel(wheel({ deltaY: 100 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(200); // 100 + 100 * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('scrolls left on upward mouse wheel scroll (deltaY < 0)', () => {
      const handled = applyTabStripWheel(wheel({ deltaY: -50 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(50); // 100 + (-50) * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Horizontal tilt and trackpad gestures (deltaX)', () => {
    it('scrolls with deltaX when deltaX is larger than deltaY (trackpad / horizontal wheel)', () => {
      const handled = applyTabStripWheel(wheel({ deltaX: 75, deltaY: 10 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(175); // 100 + 75 * 1
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('prioritizes deltaY when vertical movement is greater or equal to deltaX', () => {
      const handled = applyTabStripWheel(wheel({ deltaX: 40, deltaY: 80 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(180); // 100 + 80
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Overflow detection and non-overflowing strip guards', () => {
    it('does not scroll and does not prevent default when tabs fit inside strip', () => {
      mockList.scrollWidth = 400;
      mockList.scrollLeft = 0;

      const handled = applyTabStripWheel(wheel({ deltaY: 100 }), mockList);

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(0);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('does not scroll when tabs exactly equal clientWidth', () => {
      mockList.scrollWidth = 800;
      mockList.scrollLeft = 0;

      const handled = applyTabStripWheel(wheel({ deltaY: 100 }), mockList);

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(0);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('Modifier keys and browser zoom protection', () => {
    it('ignores wheel events when Ctrl is pressed (Ctrl+Wheel is reserved for page zoom)', () => {
      const handled = applyTabStripWheel(wheel({ ctrlKey: true, deltaY: 100 }), mockList);

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(100); // Unchanged
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('triples the step with Shift held', () => {
      const handled = applyTabStripWheel(wheel({ shiftKey: true, deltaY: 10 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(100 + 10 * TAB_STRIP_SHIFT_MULTIPLIER);
    });
  });

  describe('Delta mode resolution (PIXEL, LINE, PAGE)', () => {
    it('multiplies line deltas by the shared line height', () => {
      const handled = applyTabStripWheel(wheel({ deltaY: 3, deltaMode: DOM_DELTA_LINE }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(100 + 3 * TAB_STRIP_LINE_PIXELS);
    });

    it('multiplies page deltas by the shared page ratio', () => {
      const handled = applyTabStripWheel(wheel({ deltaY: 1, deltaMode: DOM_DELTA_PAGE }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(100 + 1 * 800 * TAB_STRIP_PAGE_RATIO);
    });

    it('uses 1:1 pixel mapping for pixel delta mode', () => {
      const handled = applyTabStripWheel(wheel({ deltaY: 42 }), mockList);

      expect(handled).toBe(true);
      expect(mockList.scrollLeft).toBe(142);
      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases', () => {
    it('ignores zero delta events without calling preventDefault', () => {
      const handled = applyTabStripWheel(wheel(), mockList);

      expect(handled).toBe(false);
      expect(mockList.scrollLeft).toBe(100);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});

describe('Alt+Wheel tab cycling', () => {
  const event = (deltaY: number, deltaX = 0) => ({
    ctrlKey: false,
    altKey: true,
    deltaX,
    deltaY,
    deltaMode: 0,
    preventDefault: vi.fn(),
  });

  it('reports the direction of a wheel gesture', () => {
    expect(wheelCycleDirection(event(120))).toBe(1);
    expect(wheelCycleDirection(event(-120))).toBe(-1);
    expect(wheelCycleDirection(event(0, 90))).toBe(1);
    expect(wheelCycleDirection(event(0, -90))).toBe(-1);
  });

  it('ignores trackpad jitter below the threshold', () => {
    expect(wheelCycleDirection(event(2))).toBe(0);
    expect(wheelCycleDirection(event(-4, 3))).toBe(0);
  });

  it('wraps around both ends like Ctrl+Tab', () => {
    expect(nextTabIndex(0, 4, -1)).toBe(3);
    expect(nextTabIndex(3, 4, 1)).toBe(0);
    expect(nextTabIndex(1, 4, 1)).toBe(2);
    expect(nextTabIndex(2, 4, -1)).toBe(1);
  });

  it('falls back to the first tab when no tab is active yet', () => {
    expect(nextTabIndex(-1, 5, 1)).toBe(1);
    expect(nextTabIndex(-1, 5, -1)).toBe(4);
  });

  it('returns -1 for an empty strip so callers never index into nothing', () => {
    expect(nextTabIndex(0, 0, 1)).toBe(-1);
    expect(nextTabIndex(-1, 0, -1)).toBe(-1);
  });
});
