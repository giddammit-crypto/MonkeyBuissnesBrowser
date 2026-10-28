import type { VoodooActionExecution, VoodooChatMessage } from './types';
import { estimateTokens, DEFAULT_CONTEXT_WINDOW_TOKENS } from './voodooContext';

export const VOODOO_SESSION_HISTORY_LIMIT = 1_000_000;
const BODY_KEYS = /^(content|html|outerHTML|innerHTML|code|script|text|body|data|base64|screenshot)$/i;
const IDENTIFIER_KEYS = /^(path|filename|directory|url|href|title|tab_?id|id|next_?start|total_?length|has_?more|success|error|bytes|size|truncated)$/i;

/** Keep reusable source identifiers ahead of bodies, with a strict total budget. */
function compactEvidence(value: unknown, maxChars: number): unknown {
  let remaining = maxChars;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number, body = false): unknown => {
    if (remaining <= 0) return '[сокращено]';
    if (typeof item === 'string') {
      const limit = Math.min(remaining, body ? 300 : 1600);
      const shortened = item.length > limit ? `${item.slice(0, limit)}… [сокращено]` : item;
      remaining -= shortened.length;
      return shortened;
    }
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item;
    if (typeof item !== 'object') return String(item).slice(0, 100);
    if (seen.has(item)) return '[повторная ссылка]';
    if (depth > 3) return '[вложенные данные сокращены]';
    seen.add(item);
    if (Array.isArray(item)) {
      const entries = item.slice(0, 12).map((entry) => visit(entry, depth + 1));
      if (item.length > 12) entries.push(`[ещё элементов: ${item.length - 12}]`);
      return entries;
    }
    const result: Record<string, unknown> = {};
    const entries = Object.entries(item).sort(([left], [right]) => Number(IDENTIFIER_KEYS.test(right)) - Number(IDENTIFIER_KEYS.test(left)));
    for (const [key, entry] of entries.slice(0, 30)) {
      if (remaining <= 0) { result._truncated = true; break; }
      remaining -= key.length + 4;
      result[key.slice(0, 100)] = visit(entry, depth + 1, BODY_KEYS.test(key));
    }
    return result;
  };
  return visit(value, 0);
}

export function compactVoodooMessage(message: VoodooChatMessage): VoodooChatMessage {
  const actions = message.executedActions?.slice(-48).map((action): VoodooActionExecution => ({
    tool: action.tool,
    args: compactEvidence(action.args, 1800) as Record<string, unknown>,
    result: action.result === undefined ? undefined : compactEvidence(action.result, 3600),
    error: action.error?.slice(0, 2000),
    summary: action.summary?.slice(0, 2000) || action.tool,
  }));
  const total = message.executedActionCount ?? message.executedActions?.length;
  return { ...message, executedActions: actions, executedActionCount: total,
    actionsTruncated: message.actionsTruncated || (total !== undefined && total > (actions?.length ?? 0)) };
}

const tokenSizes = new WeakMap<VoodooChatMessage, number>();
function messageTokens(message: VoodooChatMessage): number {
  let size = tokenSizes.get(message);
  if (size === undefined) {
    size = estimateTokens(message);
    tokenSizes.set(message, size);
  }
  return size;
}

/** Retain complete recent turns, never a fixed tiny message count. */
export function boundVoodooHistory(messages: VoodooChatMessage[], maxTokens: number): VoodooChatMessage[] {
  let size = 0;
  let start = messages.length;
  let latestUser = messages.length - 1;
  while (latestUser >= 0 && messages[latestUser].role !== 'user') latestUser--;
  for (let index = messages.length - 1; index >= 0; index--) {
    const length = messageTokens(messages[index]);
    // Preserve the complete latest request/response even if the backend must
    // report an input-limit error. Never silently cut the latest user's input.
    if (start < messages.length && size + length > maxTokens && (latestUser < 0 || index < latestUser)) break;
    size += length;
    start = index;
  }
  return start === 0 ? messages : messages.slice(start);
}

export function serializeVoodooHistory(messages: VoodooChatMessage[]): string {
  const suffix: VoodooChatMessage[] = [];
  let size = 2;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const length = JSON.stringify(message).length + 1;
    if (size + length > VOODOO_SESSION_HISTORY_LIMIT) break;
    suffix.push(message);
    size += length;
  }
  return JSON.stringify(suffix.reverse());
}

export function restoreVoodooHistory(serialized: string | null): VoodooChatMessage[] {
  if (!serialized || serialized.length > VOODOO_SESSION_HISTORY_LIMIT * 2) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return boundVoodooHistory(parsed.filter((message): message is VoodooChatMessage => Boolean(
      message && typeof message === 'object' && typeof message.id === 'string'
      && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
      && Number.isFinite(message.timestamp)
    )).map((message) => compactVoodooMessage({
      id: message.id, role: message.role, content: message.content, timestamp: message.timestamp,
      executedActionCount: typeof message.executedActionCount === 'number' ? message.executedActionCount : undefined,
      actionsTruncated: message.actionsTruncated === true,
      contextUsage: message.contextUsage && typeof message.contextUsage === 'object' ? message.contextUsage : undefined,
      error: typeof message.error === 'string' ? message.error : undefined,
      analyzedContext: typeof message.analyzedContext === 'string' ? message.analyzedContext : undefined,
      suggestedReplies: Array.isArray(message.suggestedReplies) ? message.suggestedReplies.filter((reply): reply is string => typeof reply === 'string').slice(0, 8) : undefined,
      executedActions: Array.isArray(message.executedActions) ? message.executedActions.filter((action) => action && typeof action.tool === 'string' && typeof action.summary === 'string' && action.args && typeof action.args === 'object') : undefined,
    })), DEFAULT_CONTEXT_WINDOW_TOKENS);
  } catch { return []; }
}
