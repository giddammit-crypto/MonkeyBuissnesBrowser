import type { WebContents } from 'electron';
import type { PasswordStore } from '../persistence/PasswordStore';

export const CREDENTIAL_WORLD = 1007;
export interface PasswordFillResult { filled: boolean; reason?: string }

/** Credentials belong to one exact HTTPS origin, including its port. */
export function getCredentialOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname) ? url.origin : null;
  } catch { return null; }
}

interface PageFillInput {
  origin: string;
  credentials?: { username: string; password: string };
}

// Serialized into a dedicated isolated world. It neither receives Electron APIs
// nor exports an API into the site's main world. Only the intended fields receive
// credentials; return values and IPC replies contain no credentials.
function fillVisibleTopFrame(input: PageFillInput): PasswordFillResult & { eligible?: boolean } {
  if (window !== window.top || location.protocol !== 'https:' || location.origin !== input.origin || new URL(location.href).username || new URL(location.href).password) return { filled: false, reason: 'Адрес страницы изменился. Повторите заполнение.' };
  const visible = (element: HTMLElement): boolean => {
    if (!element.isConnected || element.ownerDocument !== document || element.hidden || element.matches(':disabled') || element.getAttribute('aria-hidden') === 'true') return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    if (right <= left || bottom <= top || !element.getClientRects().length) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === element || element.contains(hit)));
  };
  const candidates = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(field => !field.readOnly && visible(field));
  if (candidates.length !== 1) return { filled: false, reason: candidates.length ? 'На странице несколько полей пароля. Выберите обычную форму входа.' : 'В верхнем документе нет видимой формы входа. Прокрутите страницу к ней.' };
  const password = candidates[0];
  const form = password.form;
  if (!form || !(form instanceof HTMLFormElement) || password.autocomplete.toLowerCase().includes('new-password')) return { filled: false, reason: 'Поддерживается только видимая форма входа; формы регистрации и iframe не заполняются.' };
  let action: URL;
  try { action = new URL(form.action || location.href, location.href); } catch { return { filled: false, reason: 'У формы некорректный адрес отправки.' }; }
  if (action.protocol !== 'https:' || action.origin !== input.origin || action.username || action.password) return { filled: false, reason: 'Форма отправляет данные на другой адрес. Заполнение отклонено.' };
  const fields = [...form.querySelectorAll<HTMLInputElement>('input')].filter(field => field.form === form && field !== password && ['text', 'email', 'tel'].includes(field.type) && !field.readOnly && visible(field));
  const marked = fields.filter(field => /^(?:username|email)$/.test(field.autocomplete.toLowerCase()) || field.type === 'email' || /(?:user|login|email|логин|почт)/i.test(`${field.name} ${field.id}`));
  const users = marked.length ? marked : fields;
  if (users.length > 1) return { filled: false, reason: 'Не удалось однозначно выбрать поле логина.' };
  if (!input.credentials) return { filled: false, eligible: true };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter || !password.isConnected || location.origin !== input.origin) return { filled: false, reason: 'Форма изменилась. Повторите заполнение.' };
  // Set both native values before dispatching page-observable events. No submit,
  // click, requestSubmit, synthetic Enter or page-defined setters are invoked.
  if (users[0]) setter.call(users[0], input.credentials.username);
  setter.call(password, input.credentials.password);
  for (const field of [...users.slice(0, 1), password]) {
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  return { filled: true };
}

function pageScript(input: PageFillInput): string { return `(${fillVisibleTopFrame.toString()})(${JSON.stringify(input)})`; }

/** Main-process coordinator. It never returns a username or password to the shell. */
export async function fillSavedCredential(input: {
  contents: WebContents;
  passwordId: string;
  store: PasswordStore;
  isCurrent: () => boolean;
  confirm: (metadata: { origin: string; username: string }) => Promise<boolean>;
}): Promise<PasswordFillResult> {
  const { contents, store } = input;
  if (contents.isDestroyed() || !input.isCurrent()) throw new Error('Выберите открытую обычную HTTPS-вкладку.');
  const originalUrl = contents.getURL();
  const origin = getCredentialOrigin(originalUrl);
  if (!origin) throw new Error('Пароли заполняются только на HTTPS-сайтах без логина и пароля в адресе.');
  const summary = store.summaries().find(record => record.id === input.passwordId && getCredentialOrigin(record.origin) === origin);
  if (!summary) throw new Error('Для этого HTTPS-адреса нет выбранной записи.');
  const originalFrame = contents.mainFrame;
  let changed = false;
  const navigating = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => { if (details.isMainFrame) changed = true; };
  contents.on('did-start-navigation', navigating);
  const current = () => !changed && !contents.isDestroyed() && input.isCurrent() && contents.mainFrame === originalFrame && contents.getURL() === originalUrl && getCredentialOrigin(contents.getURL()) === origin;
  try {
    const probe = await contents.executeJavaScriptInIsolatedWorld(CREDENTIAL_WORLD, [{ code: pageScript({ origin }) }], true) as PasswordFillResult & { eligible?: boolean };
    if (!probe.eligible) return { filled: false, reason: probe.reason || 'На странице нет подходящей формы входа.' };
    if (!current()) throw new Error('Вкладка изменилась. Повторите заполнение.');
    const confirmed = await input.confirm({ origin, username: summary.username });
    if (!confirmed) return { filled: false, reason: 'Заполнение отменено.' };
    if (!current()) throw new Error('После подтверждения адрес или вкладка изменились. Пароль не передан.');
    const credentials = store.getForOrigin(input.passwordId, origin);
    if (!credentials) throw new Error('Запись пароля удалена или недоступна.');
    if (!current()) throw new Error('Вкладка изменилась. Пароль не передан.');
    try {
      let result: PasswordFillResult;
      try { result = await contents.executeJavaScriptInIsolatedWorld(CREDENTIAL_WORLD, [{ code: pageScript({ origin, credentials }) }], true) as PasswordFillResult; }
      catch { throw new Error('Не удалось заполнить форму. Повторите действие на видимой форме входа.'); }
      return result?.filled === true ? { filled: true } : { filled: false, reason: result?.reason || 'Форма изменилась. Повторите заполнение.' };
    } finally { credentials.password = ''; }
  } finally { if (!contents.isDestroyed()) contents.removeListener('did-start-navigation', navigating); }
}
