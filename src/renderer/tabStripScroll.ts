/**
 * Tab strip wheel handling.
 *
 * Extracted from `TabStrip` so the behaviour the unit tests describe is the
 * behaviour the component actually runs — the previous test suite modelled a
 * copy of the handler and had drifted from it (32 px lines vs 36 px, full page
 * vs 85 % page, no Shift multiplier).
 */
export const TAB_STRIP_LINE_PIXELS = 36;
export const TAB_STRIP_PAGE_RATIO = 0.85;
export const TAB_STRIP_SHIFT_MULTIPLIER = 3.5;
export const TAB_STRIP_CYCLE_THRESHOLD = 8;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export interface TabStripViewport {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

export interface TabStripWheelEvent {
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  preventDefault: () => void;
}

/** Wheel delta converted to horizontal pixels for the given viewport width. */
export function wheelDeltaPixels(event: TabStripWheelEvent, clientWidth: number): number {
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (delta === 0) return 0;
  const unit =
    event.deltaMode === DOM_DELTA_LINE
      ? TAB_STRIP_LINE_PIXELS
      : event.deltaMode === DOM_DELTA_PAGE
        ? clientWidth * TAB_STRIP_PAGE_RATIO
        : 1;
  return delta * unit * (event.shiftKey ? TAB_STRIP_SHIFT_MULTIPLIER : 1);
}

/** Scrolls an overflowing strip sideways. Returns true when the event was consumed. */
export function applyTabStripWheel(event: TabStripWheelEvent, viewport: TabStripViewport): boolean {
  if (event.ctrlKey) return false; // Ctrl+Wheel stays reserved for page zoom.
  if (viewport.scrollWidth <= viewport.clientWidth) return false;
  const delta = wheelDeltaPixels(event, viewport.clientWidth);
  if (delta === 0) return false;
  event.preventDefault();
  viewport.scrollLeft += delta;
  return true;
}

/** Alt+Wheel tab cycle direction: 1 = next, -1 = previous, 0 = ignore the event. */
export function wheelCycleDirection(event: TabStripWheelEvent): 1 | -1 | 0 {
  const delta = event.deltaY || event.deltaX;
  if (Math.abs(delta) < TAB_STRIP_CYCLE_THRESHOLD) return 0;
  return delta > 0 ? 1 : -1;
}

/** Wraps around both ends, like Ctrl+Tab, and falls back to the first tab. */
export function nextTabIndex(activeIndex: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  const start = activeIndex < 0 ? 0 : activeIndex;
  return (start + direction + count) % count;
}
