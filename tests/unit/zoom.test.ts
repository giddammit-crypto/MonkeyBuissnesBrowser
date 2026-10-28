import { describe, expect, it, vi } from 'vitest';
import { CHROME_ZOOM_LEVELS, getNextZoomFactor } from '../../src/shared/zoom';

describe('Chrome Zoom Utility', () => {
  it('contains standard Chrome zoom factors', () => {
    expect(CHROME_ZOOM_LEVELS).toEqual([
      0.25, 0.33, 0.50, 0.67, 0.75, 0.80, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 5.00
    ]);
  });

  it('steps up zoom factor on zoom-in', () => {
    expect(getNextZoomFactor(1.00, 'zoom-in')).toBe(1.10);
    expect(getNextZoomFactor(1.10, 'zoom-in')).toBe(1.25);
    expect(getNextZoomFactor(1.25, 'zoom-in')).toBe(1.50);
    expect(getNextZoomFactor(1.50, 'zoom-in')).toBe(1.75);
    expect(getNextZoomFactor(1.75, 'zoom-in')).toBe(2.00);
    expect(getNextZoomFactor(2.00, 'zoom-in')).toBe(2.50);
    expect(getNextZoomFactor(4.00, 'zoom-in')).toBe(5.00);
    expect(getNextZoomFactor(5.00, 'zoom-in')).toBe(5.00);
  });

  it('steps down zoom factor on zoom-out', () => {
    expect(getNextZoomFactor(1.00, 'zoom-out')).toBe(0.90);
    expect(getNextZoomFactor(0.90, 'zoom-out')).toBe(0.80);
    expect(getNextZoomFactor(0.80, 'zoom-out')).toBe(0.75);
    expect(getNextZoomFactor(0.75, 'zoom-out')).toBe(0.67);
    expect(getNextZoomFactor(0.67, 'zoom-out')).toBe(0.50);
    expect(getNextZoomFactor(0.50, 'zoom-out')).toBe(0.33);
    expect(getNextZoomFactor(0.33, 'zoom-out')).toBe(0.25);
    expect(getNextZoomFactor(0.25, 'zoom-out')).toBe(0.25);
  });

  it('resets zoom factor to 1.00 on zoom-reset', () => {
    expect(getNextZoomFactor(0.25, 'zoom-reset')).toBe(1.00);
    expect(getNextZoomFactor(2.50, 'zoom-reset')).toBe(1.00);
    expect(getNextZoomFactor(1.00, 'zoom-reset')).toBe(1.00);
  });

  it('handles arbitrary zoom levels gracefully', () => {
    // Zoom in from 1.15 -> next higher standard is 1.25
    expect(getNextZoomFactor(1.15, 'zoom-in')).toBe(1.25);
    // Zoom out from 1.15 -> next lower standard is 1.10
    expect(getNextZoomFactor(1.15, 'zoom-out')).toBe(1.10);
    // Handle floating point imprecision
    expect(getNextZoomFactor(0.33000000000000007, 'zoom-in')).toBe(0.50);
    expect(getNextZoomFactor(0.33000000000000007, 'zoom-out')).toBe(0.25);
  });

  it('handles default or zero values gracefully', () => {
    expect(getNextZoomFactor(0, 'zoom-in')).toBe(1.10);
    expect(getNextZoomFactor(0, 'zoom-out')).toBe(0.90);
  });
});
