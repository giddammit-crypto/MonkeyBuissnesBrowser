export interface SplitBounds { x: number; y: number; width: number; height: number }

export function normalizeSplitRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0.25, Math.min(0.75, ratio)) : 0.5;
}

export function getSplitViewBounds(bounds: SplitBounds, ratio = 0.5): { primary: SplitBounds; secondary: SplitBounds; orientation: 'horizontal' | 'vertical' } {
  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  const horizontal = width >= 720;
  const extent = horizontal ? width : height;
  const gap = Math.min(6, extent);
  const first = Math.floor((extent - gap) * normalizeSplitRatio(ratio));
  const second = Math.max(0, extent - gap - first);
  return horizontal ? {
    orientation: 'horizontal',
    primary: { x: bounds.x, y: bounds.y, width: first, height },
    secondary: { x: bounds.x + first + gap, y: bounds.y, width: second, height },
  } : {
    orientation: 'vertical',
    primary: { x: bounds.x, y: bounds.y, width, height: first },
    secondary: { x: bounds.x, y: bounds.y + first + gap, width, height: second },
  };
}
