export const DEFAULT_CONTEXT_WINDOW_TOKENS = 250_000;
export const COMPLETION_OUTPUT_TOKENS = 4096;

/** Model-independent estimate, not the provider's tokenizer or a capability claim. */
export function estimateTokenUnits(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (!serialized) return 0;
  let ascii = 0;
  let other = 0;
  for (let index = 0; index < serialized.length; index++) {
    if (serialized.charCodeAt(index) < 128) ascii++;
    else other++;
  }
  return ascii + other * 3;
}

export function estimateTokens(value: unknown): number {
  return Math.ceil(estimateTokenUnits(value) / 3);
}

export function requestedContextWindow(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(8192, Math.min(DEFAULT_CONTEXT_WINDOW_TOKENS, Math.floor(value))) : DEFAULT_CONTEXT_WINDOW_TOKENS;
}
