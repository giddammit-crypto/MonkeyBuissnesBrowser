export const browserPalettes = {
  parchment: { label: 'Пергамент', scheme: 'light' },
  'arctic-glass': { label: 'Арктическое стекло', scheme: 'light' },
  'pine-forest': { label: 'Хвойный лес', scheme: 'dark' },
  'deep-ocean': { label: 'Глубокий океан', scheme: 'dark' },
  'copper-night': { label: 'Медная ночь', scheme: 'dark' },
} as const;

export type BrowserPalette = keyof typeof browserPalettes;
export type BrowserTheme = 'system' | 'light' | 'dark' | 'graphite' | BrowserPalette;

export function isBrowserPalette(value: unknown): value is BrowserPalette {
  return typeof value === 'string' && Object.hasOwn(browserPalettes, value);
}

export function isBrowserTheme(value: unknown): value is BrowserTheme {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'graphite' || isBrowserPalette(value);
}

export function nativeBrowserTheme(theme: BrowserTheme): 'system' | 'light' | 'dark' {
  if (isBrowserPalette(theme)) return browserPalettes[theme].scheme;
  return theme === 'graphite' ? 'dark' : theme;
}
