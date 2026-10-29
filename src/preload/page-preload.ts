import { ipcRenderer, webFrame } from 'electron';
import type { ReaderArticle } from '../shared/types';

/** A disabled/unavailable main-process policy must leave the site's DOM alone. */
export function createYouTubeAdBlockPolicyGate(start: () => (() => void) | undefined) {
  let enabled = false;
  let cleanup: (() => void) | undefined;
  return (policy: unknown) => {
    const next = policy === true;
    if (next === enabled) return;
    enabled = next;
    if (next) cleanup = start();
    else {
      const stop = cleanup;
      cleanup = undefined;
      stop?.();
    }
  };
}

// Chromium 134 native Chrome stealth injection for sandboxed preloads
const STEALTH_SCRIPT = `(function() {
  try {
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => false,
        configurable: true,
        enumerable: true,
      });
    } catch {}
    try {
      if (typeof navigator !== 'undefined') {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true,
          enumerable: true,
        });
      }
    } catch {}

    const isWin = navigator.platform && navigator.platform.toLowerCase().includes('win');
    const isMac = navigator.platform && navigator.platform.toLowerCase().includes('mac');
    const ua = isWin
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
      : isMac
        ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    const appVer = ua.replace(/^Mozilla\\//, '');
    const plat = isWin ? 'Win32' : isMac ? 'MacIntel' : 'Linux x86_64';
    const brandPlatform = isWin ? 'Windows' : isMac ? 'macOS' : 'Linux';
    const platformVersion = isWin ? '10.0.0' : isMac ? '15.0.0' : '6.6.0';

    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => ua,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => appVer,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => plat,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: () => 'Google Inc.',
      configurable: true,
      enumerable: true,
    });

    const brands = [
      { brand: 'Chromium', version: '134' },
      { brand: 'Google Chrome', version: '134' },
      { brand: 'Not:A-Brand', version: '24' },
    ];
    const fullVersionList = [
      { brand: 'Chromium', version: '134.0.0.0' },
      { brand: 'Google Chrome', version: '134.0.0.0' },
      { brand: 'Not:A-Brand', version: '24.0.0.0' },
    ];

    class NavigatorUAData {
      get brands() { return brands; }
      get mobile() { return false; }
      get platform() { return brandPlatform; }
      getHighEntropyValues(hints) {
        const result = {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
        if (!Array.isArray(hints)) return Promise.resolve(result);
        if (hints.includes('architecture')) result.architecture = 'x86';
        if (hints.includes('bitness')) result.bitness = '64';
        if (hints.includes('model')) result.model = '';
        if (hints.includes('platformVersion')) result.platformVersion = platformVersion;
        if (hints.includes('uaFullVersion')) result.uaFullVersion = '134.0.0.0';
        if (hints.includes('fullVersionList')) result.fullVersionList = fullVersionList;
        return Promise.resolve(result);
      }
      toJSON() {
        return {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
      }
    }

    try {
      Object.defineProperty(NavigatorUAData.prototype, Symbol.toStringTag, {
        value: 'NavigatorUAData',
        configurable: true,
      });
    } catch {}

    const uaDataInstance = new NavigatorUAData();
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaDataInstance,
      configurable: true,
      enumerable: true,
    });

    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null; },
        getIsInstalled: function() { return false; },
        installState: function(cb) { if (typeof cb === 'function') cb('not_installed'); },
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: performance.timeOrigin,
          onloadT: performance.timeOrigin,
          pageT: performance.now(),
          tran: 15,
        };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          requestTime: performance.timeOrigin / 1000,
          startLoadTime: performance.timeOrigin / 1000,
          commitLoadTime: performance.timeOrigin / 1000,
          finishDocumentLoadTime: performance.timeOrigin / 1000,
          firstPaintTime: performance.timeOrigin / 1000,
          finishLoadTime: performance.timeOrigin / 1000,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }
  } catch {}
})();`;

// Apply Chromium stealth injection in main world before page scripts run
try {
  if (typeof webFrame !== 'undefined' && typeof webFrame.executeJavaScript === 'function') {
    void webFrame.executeJavaScript(STEALTH_SCRIPT);
  }
} catch {
  // Environments without webFrame (e.g. unit tests) gracefully ignore this
}

// No bridge is exposed to websites. A dirty form conservatively prevents discarding
// No bridge is exposed to websites. A dirty form conservatively prevents discarding
// unsaved input; a completed main-frame navigation resets this in the controller.
let dirty = false;

const isInput = (el: unknown): el is HTMLInputElement => {
  if (!el || typeof el !== 'object') return false;
  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) return true;
  return 'type' in el && 'value' in el;
};

const isTextualInput = (el: Element): el is HTMLInputElement => {
  if (!isInput(el)) return false;
  if (
    el.type === 'password' ||
    el.type === 'hidden' ||
    el.type === 'submit' ||
    el.type === 'button' ||
    el.type === 'reset' ||
    el.type === 'checkbox' ||
    el.type === 'radio' ||
    el.type === 'file' ||
    el.type === 'image'
  ) {
    return false;
  }
  const rawType = (typeof el.getAttribute === 'function' ? el.getAttribute('type') : (el as any).type) || '';
  const lower = rawType.toLowerCase();
  return !lower || lower === 'text' || lower === 'email' || lower === 'tel';
};

const matchesUsernameHeuristics = (input: HTMLInputElement): boolean => {
  const autocomplete = (typeof input.getAttribute === 'function' ? input.getAttribute('autocomplete') : '') || '';
  const autoLower = autocomplete.toLowerCase();
  if (autoLower === 'username' || autoLower === 'email') {
    return true;
  }
  const name = (typeof input.getAttribute === 'function' ? input.getAttribute('name') : (input as any).name) || '';
  const id = (typeof input.getAttribute === 'function' ? input.getAttribute('id') : (input as any).id) || '';
  const placeholder = (typeof input.getAttribute === 'function' ? input.getAttribute('placeholder') : '') || '';
  const ariaLabel = (typeof input.getAttribute === 'function' ? input.getAttribute('aria-label') : '') || '';

  const str = `${name} ${id} ${placeholder} ${ariaLabel}`.toLowerCase();
  const keywords = ['user', 'login', 'email', 'телефон', 'логин', 'phone', 'account'];
  return keywords.some(k => str.includes(k));
};

// Состояние пользовательского ввода (для двухэтапной авторизации и SPA)
let lastTypedUsername = '';
let lastTypedPassword = '';
let lastSubmitAttemptTime = 0;

const trackInputActivity = (event: Event) => {
  try {
    const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
    if (!target || !isInput(target)) return;
    if (target.type === 'password') {
      if (target.value) {
        lastTypedPassword = target.value;
      }
    } else if (isTextualInput(target)) {
      if (target.value && target.value.trim().length > 0) {
        if (matchesUsernameHeuristics(target) || !lastTypedUsername) {
          lastTypedUsername = target.value.trim();
        }
      }
    }
  } catch {}
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const protectUnsavedInput = (event: Event) => {
    trackInputActivity(event);
    if (!event.isTrusted || dirty) return;
    // Shadow DOM retargets event.target to the host; composedPath preserves
    // the actual editable control for open shadow roots.
    const target = event.composedPath?.()[0] ?? event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (typeof HTMLSelectElement !== 'undefined' && target instanceof HTMLSelectElement) || (target instanceof HTMLElement && target.isContentEditable)) {
      dirty = true;
      ipcRenderer.send('page:form-state', true);
    }
  };
  window.addEventListener('input', protectUnsavedInput, true);
  window.addEventListener('change', protectUnsavedInput, true);
  window.addEventListener('blur', trackInputActivity, true);

  window.addEventListener('wheel', (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      // deltaY < 0: от себя (wheel up / forward) -> увеличение масштаба (zoom-in)
      // deltaY > 0: на себя (wheel down / backward) -> уменьшение масштаба (zoom-out)
      const direction = event.deltaY < 0 ? 'zoom-in' : 'zoom-out';
      ipcRenderer.send('page:zoom-wheel', { direction });
    }
  }, { passive: false, capture: true });

  // =========================================================================
  // Chromium Password Manager: Interception & Autofill Engine
  // =========================================================================

  const isInputVisible = (input: HTMLElement): boolean => {
    if (!input.isConnected) return false;
    if (input instanceof HTMLInputElement && input.type === 'hidden') return false;
    const rects = input.getClientRects();
    if (input.offsetWidth === 0 && input.offsetHeight === 0 && rects.length === 0) {
      return false;
    }
    try {
      const style = window.getComputedStyle(input);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
    } catch {
      // ignore
    }
    return true;
  };

  let lastSubmitted = { origin: '', username: '', password: '', time: 0 };

  const notifyPasswordSubmitted = (username: string, password: string) => {
    if (password && username && window.location.protocol.startsWith('http')) {
      const trimmedUser = username.trim();
      if (!trimmedUser || !password) return;
      const now = Date.now();
      if (
        lastSubmitted.origin === window.location.origin &&
        lastSubmitted.username === trimmedUser &&
        lastSubmitted.password === password &&
        now - lastSubmitted.time < 2000
      ) {
        return;
      }
      lastSubmitted = {
        origin: window.location.origin,
        username: trimmedUser,
        password: password,
        time: now,
      };
      ipcRenderer.send('page:password-form-submitted', {
        origin: window.location.origin,
        url: window.location.href,
        username: trimmedUser,
        password: password,
      });
    }
  };

  const extractCredentials = (form?: HTMLFormElement | null, targetPasswordInput?: HTMLInputElement | null) => {
    try {
      let passwordInput: HTMLInputElement | null = targetPasswordInput ?? null;

      if (!passwordInput) {
        if (form) {
          const pwInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]'));
          passwordInput = pwInputs.find(input => isInputVisible(input) && Boolean(input.value) && input.value.length >= 1) ?? null;
          if (!passwordInput) {
            passwordInput = pwInputs.find(input => Boolean(input.value) && input.value.length >= 1) ?? null;
          }
        } else {
          const pwInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
          passwordInput = pwInputs.find(input => isInputVisible(input) && Boolean(input.value) && input.value.length >= 1) ?? null;
          if (!passwordInput) {
            passwordInput = pwInputs.find(input => Boolean(input.value) && input.value.length >= 1) ?? null;
          }
        }
      }

      let password = passwordInput?.value || '';
      if (!password && lastTypedPassword) {
        password = lastTypedPassword;
      }

      if (!password || password.length < 1) {
        return null;
      }

      let username = '';

      const enclosingForm = form || passwordInput?.closest('form');

      if (enclosingForm) {
        const formInputs = Array.from(enclosingForm.querySelectorAll<HTMLInputElement>('input'));
        const textInputs = formInputs.filter(input => isTextualInput(input));

        // 1. Поиск инпута с autocomplete="username", autocomplete="email" или именами user, login, email, телефон, логин
        const heuristicMatches = textInputs.filter(input => matchesUsernameHeuristics(input) && input.value.trim().length > 0);
        if (heuristicMatches.length > 0) {
          if (passwordInput) {
            const precedingMatches = heuristicMatches.filter(input =>
              Boolean(input.compareDocumentPosition(passwordInput!) & Node.DOCUMENT_POSITION_PRECEDING)
            );
            username = (precedingMatches.length > 0 ? precedingMatches[precedingMatches.length - 1] : heuristicMatches[0]).value;
          } else {
            username = heuristicMatches[0].value;
          }
        }

        // 2. Если не найдено, берет ближайшее текстовое поле перед паролем
        if (!username && passwordInput) {
          const precedingTextInputs = textInputs.filter(input =>
            Boolean(input.compareDocumentPosition(passwordInput!) & Node.DOCUMENT_POSITION_PRECEDING)
          );
          for (let i = precedingTextInputs.length - 1; i >= 0; i--) {
            if (precedingTextInputs[i].value.trim().length > 0) {
              username = precedingTextInputs[i].value;
              break;
            }
          }
        }

        // Fallback: любое текстовое поле в форме со значением
        if (!username) {
          const anyFilled = textInputs.find(input => input.value.trim().length > 0);
          if (anyFilled) username = anyFilled.value;
        }
      } else {
        // Пароль вне формы: ищет ближайший предшествующий инпут логина в DOM
        const allDocInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
        const textInputs = allDocInputs.filter(input => isTextualInput(input));
        if (passwordInput) {
          const preceding = textInputs.filter(input =>
            Boolean(input.compareDocumentPosition(passwordInput!) & Node.DOCUMENT_POSITION_PRECEDING)
          );

          const heuristicMatches = preceding.filter(input => matchesUsernameHeuristics(input) && input.value.trim().length > 0);
          if (heuristicMatches.length > 0) {
            username = heuristicMatches[heuristicMatches.length - 1].value;
          } else {
            for (let i = preceding.length - 1; i >= 0; i--) {
              if (preceding[i].value.trim().length > 0) {
                username = preceding[i].value;
                break;
              }
            }
          }
        } else {
          const heuristicMatches = textInputs.filter(input => matchesUsernameHeuristics(input) && input.value.trim().length > 0);
          if (heuristicMatches.length > 0) {
            username = heuristicMatches[heuristicMatches.length - 1].value;
          }
        }
      }

      // Если в текущей форме поле логина не найдено или очищено — используем lastTypedUsername (2-этапный вход VK, Google, Yandex)
      if (!username && lastTypedUsername) {
        username = lastTypedUsername;
      }

      if (username && password) {
        return { username, password };
      }
    } catch {
      // Graceful error handling
    }
    return null;
  };

  // Селектор кнопок отправки: расширенный для любых современных SPA (React, Vue, VKUI, Tailwind)
  const SUBMIT_BUTTON_SELECTOR = 'button, input[type="submit"], input[type="button"], [role="button"], a[class*="btn"], a[class*="login"], a[class*="submit"], div[class*="btn"], div[class*="button"], [data-testid*="submit"], [data-testid*="login"]';
  const SUBMIT_TEXT_REGEX = /(?:войти|вход|log\s*in|sign\s*in|submit|далее|next|continue|продолжить|отправить)/i;

  const isSubmitTrigger = (el: HTMLElement): boolean => {
    try {
      if (typeof el.matches === 'function' && el.matches(SUBMIT_BUTTON_SELECTOR)) {
        const isBtn = typeof HTMLButtonElement !== 'undefined' && el instanceof HTMLButtonElement;
        const isInp = typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement;
        if (isBtn || isInp || (el && typeof el === 'object' && 'type' in el)) {
          if ((el as any).type === 'reset') return false;
        }
        return true;
      }
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 50 && SUBMIT_TEXT_REGEX.test(text)) {
        return true;
      }
    } catch {}
    return false;
  };

  // Перехватчик submit на уровне window (capture: true)
  window.addEventListener('submit', (event: Event) => {
    try {
      lastSubmitAttemptTime = Date.now();
      const form = event.target instanceof HTMLFormElement
        ? event.target
        : (typeof (event.target as Element)?.closest === 'function' ? (event.target as Element).closest('form') : null);
      const creds = extractCredentials(form);
      if (creds) {
        notifyPasswordSubmitted(creds.username, creds.password);
      }
    } catch {}
  }, true);

  // Перехватчик click на кнопках отправки формы и SPA
  window.addEventListener('click', (event: MouseEvent) => {
    try {
      const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
      if (!target) return;
      const submitBtn = typeof target.closest === 'function' ? (target.closest(SUBMIT_BUTTON_SELECTOR) as HTMLElement | null) : null;
      const isTextMatch = !submitBtn && isSubmitTrigger(target);
      const trigger = submitBtn || (isTextMatch ? target : null);

      if (trigger) {
        lastSubmitAttemptTime = Date.now();
        const form = typeof trigger.closest === 'function' ? (trigger.closest('form') as HTMLFormElement | null) : null;
        const creds = extractCredentials(form);
        if (creds) {
          notifyPasswordSubmitted(creds.username, creds.password);
        } else if (lastTypedUsername && lastTypedPassword) {
          notifyPasswordSubmitted(lastTypedUsername, lastTypedPassword);
        }
      }
    } catch {}
  }, true);

  // Перехватчик keydown с клавишей Enter в поле пароля или логина
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    try {
      if (event.key === 'Enter') {
        const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
        if (target instanceof HTMLInputElement) {
          lastSubmitAttemptTime = Date.now();
          if (target.type === 'password' || isTextualInput(target)) {
            const creds = extractCredentials(target.closest('form'), target.type === 'password' ? target : null);
            if (creds) {
              notifyPasswordSubmitted(creds.username, creds.password);
            }
          }
        }
      }
    } catch {}
  }, true);

  // Перехватчик перед уходом со страницы (beforeunload / pagehide)
  const onPageUnload = () => {
    try {
      const now = Date.now();
      if (lastTypedUsername && lastTypedPassword && (now - lastSubmitAttemptTime < 5000)) {
        notifyPasswordSubmitted(lastTypedUsername, lastTypedPassword);
      }
    } catch {}
  };
  window.addEventListener('beforeunload', onPageUnload, true);
  window.addEventListener('pagehide', onPageUnload, true);

  // =========================================================================
  // Autofill Engine: Auto-fill & Interactive Dropdown
  // =========================================================================

  const setNativeInputValue = (el: HTMLInputElement, val: string) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  };

  const findUsernameInputForPassword = (passwordInput: HTMLInputElement): HTMLInputElement | null => {
    const form = passwordInput.form || passwordInput.closest('form');
    if (form) {
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input')).filter(isTextualInput);
      const preceding = inputs.filter(i => Boolean(i.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_PRECEDING));
      const heuristicMatches = preceding.filter(matchesUsernameHeuristics);
      if (heuristicMatches.length > 0) return heuristicMatches[heuristicMatches.length - 1];
      if (preceding.length > 0) return preceding[preceding.length - 1];
      const anyHeuristic = inputs.filter(matchesUsernameHeuristics);
      if (anyHeuristic.length > 0) return anyHeuristic[0];
      if (inputs.length > 0) return inputs[0];
    } else {
      const container = passwordInput.closest('[role="form"], [class*="login"], [class*="auth"], [class*="modal"], [class*="form"], main, section') || passwordInput.parentElement;
      if (container) {
        const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input')).filter(isTextualInput);
        const preceding = inputs.filter(i => Boolean(i.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_PRECEDING));
        const heuristicMatches = preceding.filter(matchesUsernameHeuristics);
        if (heuristicMatches.length > 0) return heuristicMatches[heuristicMatches.length - 1];
        if (preceding.length > 0) return preceding[preceding.length - 1];
      }
      const all = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isTextualInput);
      const preceding = all.filter(i => Boolean(i.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_PRECEDING));
      const heuristicMatches = preceding.filter(matchesUsernameHeuristics);
      if (heuristicMatches.length > 0) return heuristicMatches[heuristicMatches.length - 1];
      if (preceding.length > 0) return preceding[preceding.length - 1];
    }
    return null;
  };

  const findPasswordInputForUsername = (usernameInput: HTMLInputElement): HTMLInputElement | null => {
    const form = usernameInput.form || usernameInput.closest('form');
    if (form) {
      const pw = form.querySelector<HTMLInputElement>('input[type="password"]');
      if (pw) return pw;
    }
    const container = usernameInput.closest('[role="form"], [class*="login"], [class*="auth"], [class*="modal"], [class*="form"], main, section') || usernameInput.parentElement;
    if (container) {
      const pw = container.querySelector<HTMLInputElement>('input[type="password"]');
      if (pw) return pw;
    }
    const allPw = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    const following = allPw.filter(i => Boolean(usernameInput.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (following.length > 0) return following[0];
    if (allPw.length > 0) return allPw[0];
    return null;
  };

  let cachedCredentials: { id: string; username: string; password: string; exactOrigin?: boolean }[] | null = null;
  let fetchingCredentialsPromise: Promise<{ id: string; username: string; password: string; exactOrigin?: boolean }[]> | null = null;

  const getSavedCredentials = async (): Promise<{ id: string; username: string; password: string; exactOrigin?: boolean }[]> => {
    if (cachedCredentials !== null) return cachedCredentials;
    if (fetchingCredentialsPromise) return fetchingCredentialsPromise;
    fetchingCredentialsPromise = (async () => {
      try {
        if (!window.location.protocol.startsWith('http')) return [];
        const res = await ipcRenderer.invoke('page:get-autofill-credentials', {
          origin: window.location.origin,
          hostname: window.location.hostname,
        });
        cachedCredentials = Array.isArray(res) ? res : [];
      } catch {
        cachedCredentials = [];
      } finally {
        fetchingCredentialsPromise = null;
      }
      return cachedCredentials;
    })();
    return fetchingCredentialsPromise;
  };

  const autofilledInputs = new WeakSet<HTMLInputElement>();

  const tryAutoFillSingleAccount = async () => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const creds = await getSavedCredentials();
    const exactCreds = creds.filter(c => c.exactOrigin !== false);
    if (exactCreds.length !== 1) return;
    const account = exactCreds[0];
    if (!account.username && !account.password) return;

    const pwInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
      .filter(pw => isInputVisible(pw) && !pw.readOnly && !pw.disabled);

    for (const pw of pwInputs) {
      if (autofilledInputs.has(pw)) continue;
      if (pw.value.length > 0) continue;

      const user = findUsernameInputForPassword(pw);
      if (user && isInputVisible(user) && !user.readOnly && !user.disabled) {
        if (!user.value || user.value === account.username) {
          if (!user.value) setNativeInputValue(user, account.username);
          setNativeInputValue(pw, account.password);
          autofilledInputs.add(pw);
          autofilledInputs.add(user);
        }
      } else {
        setNativeInputValue(pw, account.password);
        autofilledInputs.add(pw);
      }
    }
  };

  // Выпадающий список (Dropdown)
  let dropdownEl: HTMLDivElement | null = null;
  let activeTargetInput: HTMLInputElement | null = null;

  const removeDropdown = () => {
    if (dropdownEl) {
      dropdownEl.remove();
      dropdownEl = null;
    }
    activeTargetInput = null;
  };

  const createDropdown = (targetInput: HTMLInputElement, creds: { id: string; username: string; password: string }[]) => {
    removeDropdown();
    if (!creds || creds.length === 0) return;
    activeTargetInput = targetInput;

    const popup = document.createElement('div');
    popup.setAttribute('data-soulm8te-autofill', 'true');
    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#12131d',
      border: '1px solid rgba(139, 92, 246, 0.45)',
      borderRadius: '8px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(139, 92, 246, 0.25)',
      padding: '4px',
      minWidth: '220px',
      maxWidth: '340px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      color: '#f3f4f6',
      userSelect: 'none',
      overflow: 'hidden',
    });

    // Шапка
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 10px 4px 10px',
      fontSize: '11px',
      fontWeight: '600',
      color: '#a78bfa',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    });
    header.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block; flex-shrink:0;">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>soulm8te пароли</span>
    `;
    popup.appendChild(header);

    // Список учетных записей
    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      marginTop: '4px',
      maxHeight: '200px',
      overflowY: 'auto',
    });

    creds.forEach((account) => {
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      });

      item.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="m21 2-2 2m-1.5 1.5L16 7l-1.5-1.5L13 7l-1.5-1.5L10 7"></path>
          <circle cx="7.5" cy="15.5" r="5.5"></circle>
        </svg>
        <div style="display:flex; flex-direction:column; overflow:hidden; min-width:0;">
          <div style="font-weight:500; color:#f3f4f6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px;">
            ${account.username ? account.username.replace(/</g, '&lt;') : 'Без логина'}
          </div>
          <div style="font-size:11px; color:#9ca3af; letter-spacing:1px; line-height:1.2;">••••••••</div>
        </div>
      `;

      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(139, 92, 246, 0.22)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (targetInput.type === 'password') {
          setNativeInputValue(targetInput, account.password);
          const user = findUsernameInputForPassword(targetInput);
          if (user && account.username) setNativeInputValue(user, account.username);
        } else {
          if (account.username) setNativeInputValue(targetInput, account.username);
          const pw = findPasswordInputForUsername(targetInput);
          if (pw && account.password) setNativeInputValue(pw, account.password);
        }

        removeDropdown();
      });

      list.appendChild(item);
    });

    popup.appendChild(list);

    // Позиционирование
    const rect = targetInput.getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = Math.max(8, Math.min(window.innerWidth - 240, rect.left));
    const width = Math.max(220, Math.min(320, rect.width));

    popup.style.top = `${Math.min(window.innerHeight - 150, Math.max(8, top))}px`;
    popup.style.left = `${left}px`;
    popup.style.width = `${width}px`;

    (document.body || document.documentElement).appendChild(popup);
    dropdownEl = popup;
  };

  const showDropdownForInput = async (input: HTMLInputElement) => {
    if (!isInputVisible(input) || input.readOnly || input.disabled) return;
    const creds = await getSavedCredentials();
    if (!creds || creds.length === 0) return;
    createDropdown(input, creds);
  };

  const onFocusOrClick = (event: Event) => {
    try {
      const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
      if (!target || !isInput(target)) return;
      if (target.type === 'password' || isTextualInput(target)) {
        void tryAutoFillSingleAccount();
        void showDropdownForInput(target);
      }
    } catch {}
  };

  window.addEventListener('focusin', onFocusOrClick, true);
  window.addEventListener('click', (event: MouseEvent) => {
    if (dropdownEl && !dropdownEl.contains(event.target as Node) && event.target !== activeTargetInput) {
      removeDropdown();
    }
  }, true);

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dropdownEl) {
      removeDropdown();
    }
  }, true);

  window.addEventListener('scroll', () => {
    if (dropdownEl) {
      removeDropdown();
    }
  }, { capture: true, passive: true });
}
// Submitting a form does not guarantee data was saved (SPA handlers may cancel
// navigation or receive a server error). Keep the guard until document navigation.

// In-page media downloader helper for VK and YouTube
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initMediaHelper = () => {
    // Decorative/discovery polling does not need to walk hidden documents.
    // Playback/capture event handlers and essential media checks remain active.
    const visibleTasks: Array<{ callback: () => void; milliseconds: number; timer?: ReturnType<typeof setInterval> }> = [];
    let suspended = false;
    const refreshVisibleTasks = () => {
      const visible = !suspended && document.hidden !== true;
      for (const task of visibleTasks) {
        if (!visible && task.timer !== undefined) { clearInterval(task.timer); task.timer = undefined; }
        else if (visible && task.timer === undefined) {
          task.timer = setInterval(task.callback, task.milliseconds);
          task.callback();
        }
      }
    };
    const repeatWhenVisible = (callback: () => void, milliseconds: number) => {
      const task: typeof visibleTasks[number] = { callback, milliseconds };
      visibleTasks.push(task);
      if (document.hidden !== true && !suspended) task.timer = setInterval(callback, milliseconds);
    };
    document.addEventListener('visibilitychange', refreshVisibleTasks);
    window.addEventListener('pagehide', () => { suspended = true; refreshVisibleTasks(); });
    window.addEventListener('pageshow', () => { suspended = false; refreshVisibleTasks(); });
    const host = window.location.hostname || '';
    const isHostOrSubdomain = (domain: string): boolean => Boolean(host) && (host === domain || host.endsWith(`.${domain}`));
    const isVkHost = isHostOrSubdomain('vk.com') || isHostOrSubdomain('vkvideo.ru');
    const injectors: Array<() => void> = [];
    let injectionTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleInjection = () => {
      if (document.hidden === true || suspended || injectionTimer) return;
      injectionTimer = setTimeout(() => {
        injectionTimer = undefined;
        if (document.hidden !== true && !suspended) for (const inject of injectors) inject();
      }, 350);
    };

    // VK video, music & photo downloader
    if (isVkHost) {
      const injectVkButton = () => {
        const pvBottom = document.getElementById('pv_bottom_info');
        if (pvBottom && !pvBottom.querySelector('.soul-vk-dl')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-dl pv_bottom_action';
          btn.textContent = '⬇ Скачать оригинал';
          btn.style.cssText = 'color:#2563eb;margin-left:14px;cursor:pointer;font-weight:500;';
          btn.onclick = (e) => {
            e.preventDefault();
            const pvImg = document.querySelector('#pv_photo img') as HTMLImageElement | null;
            if (pvImg && pvImg.src) {
              ipcRenderer.send('page:download-media', { url: pvImg.src });
            }
          };
          pvBottom.appendChild(btn);
        }

        // VK Clip download button
        const vkClipActions = document.querySelector(
          '.ShortsOverlay, [class*="ShortsOverlay"], .ShortsItem__actions, [class*="ShortsItem__actions"], .ShortsSlide__actions, [class*="ClipViewer"]'
        );
        if (vkClipActions && !document.querySelector('.soul-vk-clip-btn')) {
          const clipBtn = document.createElement('a');
          clipBtn.className = 'soul-vk-clip-btn';
          clipBtn.textContent = '⬇ Скачать клип';
          clipBtn.style.cssText = 'color:#fff;background:#2563eb;margin:6px 0;cursor:pointer;font-weight:600;font-size:12px;display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3);text-decoration:none;z-index:9999;';
          clipBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            let targetVideoUrl = window.location.href;
            const pathname = window.location.pathname;
            const search = window.location.search;
            const pathClipMatch = pathname.match(/\/(?:clip)(-?\d+_\d+)/);
            const clipMatch = search.match(/(?:[?&#]|z=)clip(-?\d+_\d+)/);
            if (clipMatch) {
              targetVideoUrl = `https://vk.com/clip${clipMatch[1]}`;
            } else if (pathClipMatch) {
              targetVideoUrl = `https://vk.com/clip${pathClipMatch[1]}`;
            } else {
              const activeClipEl = document.querySelector('[class*="ShortsItem--active"] [data-clip-id], [class*="active"] [data-clip-id], [data-clip-id]:hover, [data-clip-id]');
              const clipId = activeClipEl?.getAttribute('data-clip-id') || activeClipEl?.getAttribute('data-id');
              if (clipId) {
                targetVideoUrl = `https://vk.com/clip${clipId.startsWith('-') || clipId.includes('_') ? clipId : '-' + clipId}`;
              }
            }
            ipcRenderer.send('page:download-media', {
              url: targetVideoUrl,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'vk-clip') + '.mp4',
              isAudio: false,
            });
            clipBtn.textContent = '✓ Загрузка...';
            setTimeout(() => { clipBtn.textContent = '⬇ Скачать клип'; }, 3000);
          };
          vkClipActions.appendChild(clipBtn);
        }

        // VK Video & Clip download button
        const vkVideoActions = document.querySelector('.videoplayer_controls, .VideoPage__actions, .mv_actions_block, .like_wrap, [data-video-id]');
        if (vkVideoActions && !document.querySelector('.soul-vk-vid-btn')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-vid-btn';
          btn.textContent = '⬇ Скачать видео (MP4)';
          btn.style.cssText = 'color:#2563eb;margin-left:12px;cursor:pointer;font-weight:600;font-size:13px;display:inline-flex;align-items:center;background:rgba(37,99,235,0.12);padding:6px 12px;border-radius:12px;border:1px solid #2563eb;';
          btn.onclick = (e) => {
            e.preventDefault();
            let targetVideoUrl = window.location.href;
            const search = window.location.search;
            const pathname = window.location.pathname;
            const zMatch = search.match(/(?:[?&#]|z=)?video(-?\d+_\d+)/);
            const clipMatch = search.match(/(?:[?&#]|z=)?clip(-?\d+_\d+)/);
            const pathClipMatch = pathname.match(/\/clip(-?\d+_\d+)/);
            const pathVidMatch = pathname.match(/\/video(-?\d+_\d+)/);
            if (clipMatch) {
              targetVideoUrl = `https://vk.com/clip${clipMatch[1]}`;
            } else if (pathClipMatch) {
              targetVideoUrl = `https://vk.com/clip${pathClipMatch[1]}`;
            } else if (zMatch) {
              targetVideoUrl = `https://vk.com/video${zMatch[1]}`;
            } else if (pathVidMatch) {
              targetVideoUrl = `https://vk.com/video${pathVidMatch[1]}`;
            } else {
              const modalEl = document.querySelector('#mv_box, [data-video-id]');
              const vidId = modalEl?.getAttribute('data-video-id');
              if (vidId) {
                targetVideoUrl = `https://vk.com/video${vidId}`;
              }
            }
            ipcRenderer.send('page:download-media', {
              url: targetVideoUrl,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'vk-video') + '.mp4',
              isAudio: false,
            });
            btn.textContent = '✓ Скачивается';
            setTimeout(() => { btn.textContent = '⬇ Скачать видео (MP4)'; }, 3000);
          };
          vkVideoActions.appendChild(btn);
        }

        // VK Music Top Player download button
        const topPlayer = document.querySelector('#top_audio_player, .top_audio_player, .AudioPlayer, .TopAudioPlayer');
        if (topPlayer && !topPlayer.querySelector('.soul-vk-top-audio-dl')) {
          const btn = document.createElement('button');
          btn.className = 'soul-vk-top-audio-dl';
          btn.textContent = '⬇ MP3';
          btn.title = 'Скачать текущий трек MP3';
          btn.style.cssText = 'background:rgba(37,99,235,0.12);color:#2563eb;border:1px solid #2563eb;border-radius:12px;padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer;margin-left:10px;display:inline-flex;align-items:center;vertical-align:middle;';
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const artist = document.querySelector('.top_audio_player_artist, .AudioPlayer__performer, .audio_page_player_performer')?.textContent?.trim() || '';
            const title = document.querySelector('.top_audio_player_title, .AudioPlayer__title, .audio_page_player_title')?.textContent?.trim() || 'Track';
            const filename = (artist ? `${artist} - ${title}.mp3` : `${title}.mp3`).replace(/[\\/:*?"<>|]/g, '');
            const audioEl = document.querySelector('audio');
            const src = audioEl?.src || audioEl?.currentSrc;
            ipcRenderer.send('page:download-media', {
              url: src && src.startsWith('http') ? src : window.location.href,
              filename,
              isAudio: true,
            });
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '⬇ MP3'; }, 2500);
          };
          topPlayer.appendChild(btn);
        }

        // VK Music Track Rows - inject download buttons on audio rows
        const audioRows = document.querySelectorAll('.audio_row, .AudioRow, .vkuiAudioRow');
        for (let i = 0; i < Math.min(audioRows.length, 50); i++) {
          const row = audioRows[i];
          if (row.querySelector('.soul-vk-row-dl')) continue;
          const actions = row.querySelector('.audio_row__actions, .AudioRow__actions, .audio_row__inner') || row;
          const dl = document.createElement('button');
          dl.className = 'soul-vk-row-dl';
          dl.textContent = '⬇';
          dl.title = 'Скачать MP3';
          dl.style.cssText = 'background:rgba(37,99,235,0.12);color:#2563eb;border:none;border-radius:8px;padding:2px 6px;font-size:12px;font-weight:bold;cursor:pointer;margin-left:6px;vertical-align:middle;';
          dl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const artist = row.querySelector('.audio_row__performers, .AudioRow__performer')?.textContent?.trim() || '';
            const title = row.querySelector('.audio_row__title_inner, .AudioRow__title')?.textContent?.trim() || 'Track';
            const filename = (artist ? `${artist} - ${title}.mp3` : `${title}.mp3`).replace(/[\\/:*?"<>|]/g, '');

            const audioEl = document.querySelector('audio');
            const src = audioEl?.src || audioEl?.currentSrc;
            if (src && (src.includes('vkuseraudio.net') || src.includes('.mp3') || src.includes('.m3u8'))) {
              ipcRenderer.send('page:download-media', { url: src, filename, isAudio: true });
              dl.textContent = '✓';
              setTimeout(() => { dl.textContent = '⬇'; }, 2000);
            } else {
              const play = row.querySelector('.audio_row__play_btn, .AudioRow__play, button[aria-label*="Воспроизвести"], [data-action="play"]') as HTMLElement | null;
              if (play) play.click();
              dl.textContent = '⏳';
              setTimeout(() => {
                const updatedAudio = document.querySelector('audio');
                const updatedSrc = updatedAudio?.src || updatedAudio?.currentSrc;
                ipcRenderer.send('page:download-media', {
                  url: updatedSrc && updatedSrc.startsWith('http') ? updatedSrc : window.location.href,
                  filename,
                  isAudio: true,
                });
                dl.textContent = '✓';
                setTimeout(() => { dl.textContent = '⬇'; }, 2000);
              }, 400);
            }
          };
          actions.appendChild(dl);
        }
      };
      injectors.push(injectVkButton);
      window.addEventListener('popstate', scheduleInjection);
    }

    // YouTube native stream downloader & AdBlocker
    if (isHostOrSubdomain('youtube.com')) {
      const initYouTubeAdBlocker = (): (() => void) | undefined => {
        try {
          // 1. Inject cosmetic ad blocking styles
          if (typeof document !== 'undefined' && !document.getElementById('soul-yt-adblock-styles')) {
            const style = document.createElement('style');
            style.id = 'soul-yt-adblock-styles';
            style.textContent = `
              /* Banners, Feed and Search Ads */
              ytd-ad-slot-renderer,
              ytd-in-feed-ad-layout-renderer,
              ytd-banner-promo-renderer,
              ytd-statement-banner-renderer,
              ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
              ytd-promoted-video-renderer,
              ytd-promoted-sparkles-web-renderer,
              ytd-player-legacy-desktop-watch-ads-renderer,
              ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
              ytd-search-pyv-renderer,
              #masthead-ad,
              #player-ads,
              #panels:has(ytd-ads-engagement-panel-content-renderer),
              /* In-player overlays and message containers */
              .ytp-ad-overlay-container,
              .ytp-ad-message-container,
              .ytp-ad-player-overlay,
              .ytp-ad-player-overlay-layout,
              .ytp-ad-overlay-image,
              .ytp-ad-text-overlay,
              .ytp-ad-action-interstitial,
              .ytp-ad-feedback-dialog-background,
              /* YouTube Anti-Adblock modal enforcement */
              ytd-enforcement-message-view-model,
              tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
              ytd-popup-container:has(ytd-enforcement-message-view-model) {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                min-height: 0 !important;
                overflow: hidden !important;
                pointer-events: none !important;
              }
            `;
            (document.head || document.documentElement)?.appendChild(style);
          }

          let isSkippingAd = false;
          let originalPlaybackRate = 1;
          let wasMuted = false;

          const handlePlayerAds = () => {
            try {
              if (typeof document === 'undefined') return;

              // A. Anti-Adblock popup automatic dismissal & video playback resume
              const enforcementModal = document.querySelector('ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)');
              if (enforcementModal) {
                // Dismiss modal backdrop
                const backdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
                backdrops.forEach((backdrop) => {
                  backdrop.remove();
                });
                const dialog = enforcementModal.closest('tp-yt-paper-dialog, ytd-popup-container') || enforcementModal;
                dialog.remove();

                const video = document.querySelector('video') as HTMLVideoElement | null;
                if (video && video.paused) {
                  video.play().catch(() => {});
                }
              }

              // B. Active In-Stream Video Ad Detection & Automatic Skip
              const player = document.querySelector('#movie_player, .html5-video-player') as HTMLElement | null;
              const isAdShowing = player?.classList.contains('ad-showing') ||
                                  player?.classList.contains('ad-interrupting') ||
                                  Boolean(document.querySelector('.ytp-ad-player-overlay, .ytp-ad-showing, .ytp-ad-preview-container'));

              const video = (player?.querySelector('video') || document.querySelector('video')) as HTMLVideoElement | null;

              if (isAdShowing && video) {
                if (!isSkippingAd) {
                  isSkippingAd = true;
                  originalPlaybackRate = (video.playbackRate && video.playbackRate <= 2) ? video.playbackRate : 1;
                  wasMuted = video.muted;
                }

                // Mute ad immediately to prevent loud audio pop
                video.muted = true;

                // Step 1: Click skip button if present
                const skipButtons = document.querySelectorAll<HTMLElement>(
                  '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-text, .ytp-ad-skip-button-slot button'
                );
                for (const btn of Array.from(skipButtons)) {
                  if (btn && typeof btn.click === 'function') {
                    btn.click();
                    return;
                  }
                }

                // Step 2: Unskippable or countdown ad: accelerate 16x and jump to end
                video.playbackRate = 16;
                if (isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = Math.max(0, video.duration - 0.05);
                }
              } else if (isSkippingAd && !isAdShowing) {
                // Ad finished: restore original user settings
                isSkippingAd = false;
                if (video) {
                  video.playbackRate = originalPlaybackRate;
                  video.muted = wasMuted;
                  if (video.paused) {
                    video.play().catch(() => {});
                  }
                }
              }
            } catch {
              // Ignore DOM exceptions
            }
          };

          let lastAdCheckAt = 0;
          const checkAdsThrottled = () => {
            const now = Date.now();
            if (now - lastAdCheckAt < 150) return;
            lastAdCheckAt = now;
            handlePlayerAds();
          };
          const timer = setInterval(checkAdsThrottled, 150);
          let observer: MutationObserver | undefined;
          if (typeof MutationObserver !== 'undefined' && (document.documentElement || document.body)) {
            observer = new MutationObserver(checkAdsThrottled);
            observer.observe(document.documentElement || document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'style'],
            });
          }
          return () => {
            clearInterval(timer);
            observer?.disconnect();
            document.getElementById('soul-yt-adblock-styles')?.remove();
            // Disabling the blocker during an ad must not leave the player's
            // audio muted or accelerated after the user opted out.
            if (isSkippingAd) {
              const video = document.querySelector('video') as HTMLVideoElement | null;
              if (video) {
                try { video.playbackRate = originalPlaybackRate; video.muted = wasMuted; } catch {}
              }
            }
          };
        } catch {
          // Gracefully ignore
        }
      };

      const applyAdBlockPolicy = createYouTubeAdBlockPolicyGate(initYouTubeAdBlocker);
      let policyVersion = 0;
      const refreshAdBlockPolicy = () => {
        const version = policyVersion;
        if (typeof ipcRenderer.invoke !== 'function') return;
        void ipcRenderer.invoke('page:get-adblock-policy').then((enabled: unknown) => {
          if (version === policyVersion) applyAdBlockPolicy(enabled);
        }).catch(() => {
          if (version === policyVersion) applyAdBlockPolicy(false);
        });
      };
      if (typeof ipcRenderer.on === 'function') {
        ipcRenderer.on('page:adblock-policy', (_event, enabled: unknown) => {
          policyVersion++;
          applyAdBlockPolicy(enabled);
        });
      }
      // Ask only for a boolean policy; website scripts receive no IPC bridge,
      // settings, exception list or credentials from the privileged process.
      refreshAdBlockPolicy();
      window.addEventListener('pagehide', () => { policyVersion++; applyAdBlockPolicy(false); });
      window.addEventListener('pageshow', refreshAdBlockPolicy);

      const injectYtButton = () => {
        // Inject native adaptive stylesheet once
        if (!document.getElementById('soul-yt-adaptive-styles')) {
          const style = document.createElement('style');
          style.id = 'soul-yt-adaptive-styles';
          style.textContent = `
            .soul-yt-chip-btn {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 6px !important;
              height: 36px !important;
              padding: 0 14px !important;
              border-radius: 18px !important;
              border: none !important;
              font-family: "Roboto", "Arial", sans-serif !important;
              font-size: 14px !important;
              font-weight: 500 !important;
              line-height: 36px !important;
              cursor: pointer !important;
              margin-left: 8px !important;
              user-select: none !important;
              box-sizing: border-box !important;
              background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1)) !important;
              color: var(--yt-spec-text-primary, #f1f1f1) !important;
              transition: background-color 0.2s cubic-bezier(0.05, 0, 0, 1), transform 0.1s ease !important;
              white-space: nowrap !important;
              flex-shrink: 0 !important;
              text-decoration: none !important;
              vertical-align: middle !important;
            }
            .soul-yt-chip-btn:hover {
              background: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.2)) !important;
            }
            .soul-yt-chip-btn:active {
              transform: scale(0.97) !important;
            }
            .soul-yt-chip-btn svg {
              display: inline-block !important;
              vertical-align: middle !important;
              flex-shrink: 0 !important;
              width: 18px !important;
              height: 18px !important;
              fill: currentColor !important;
            }
            .soul-yt-shorts-dl-btn,
            .soul-yt-shorts-audio-btn {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 5px !important;
              min-height: 36px !important;
              padding: 6px 14px !important;
              border-radius: 18px !important;
              border: 1px solid rgba(255, 255, 255, 0.2) !important;
              font-family: "Roboto", "Arial", sans-serif !important;
              font-size: 13px !important;
              font-weight: 500 !important;
              cursor: pointer !important;
              margin: 4px 0 !important;
              user-select: none !important;
              box-sizing: border-box !important;
              background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.15)) !important;
              backdrop-filter: blur(8px) !important;
              -webkit-backdrop-filter: blur(8px) !important;
              color: var(--yt-spec-text-primary, #ffffff) !important;
              transition: background-color 0.15s ease, transform 0.1s ease !important;
            }
            .soul-yt-shorts-dl-btn:hover,
            .soul-yt-shorts-audio-btn:hover {
              background: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.25)) !important;
              transform: scale(1.03) !important;
            }
            .soul-yt-shorts-dl-btn svg,
            .soul-yt-shorts-audio-btn svg {
              display: inline-block !important;
              vertical-align: middle !important;
              flex-shrink: 0 !important;
              width: 16px !important;
              height: 16px !important;
              fill: currentColor !important;
            }
          `;
          (document.head || document.documentElement).appendChild(style);
        }

        // Standard video target (action bar under video)
        const targetContainer = document.querySelector(
          '#actions #top-level-buttons-computed, #top-level-buttons-computed, ytd-watch-metadata #actions, #actions.ytd-watch-metadata, #actions, #top-row, #owner'
        );
        if (targetContainer && !document.querySelector('.soul-yt-dl-btn')) {
          const btn = document.createElement('button');
          btn.className = 'soul-yt-chip-btn soul-yt-dl-btn';
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>Скачать MP4</span>';
          btn.title = 'Скачать видео в MP4 (высокое качество)';
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-video') + '.mp4',
            });
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Скачивается</span>';
            setTimeout(() => {
              btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>Скачать MP4</span>';
            }, 3000);
          };
          targetContainer.appendChild(btn);
        }
        if (targetContainer && !document.querySelector('.soul-yt-audio-dl-btn')) {
          const audioBtn = document.createElement('button');
          audioBtn.className = 'soul-yt-chip-btn soul-yt-audio-dl-btn';
          audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
          audioBtn.title = 'Скачать аудиодорожку в MP3';
          audioBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-audio') + '.mp3',
              isAudio: true,
            });
            audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Скачивается</span>';
            setTimeout(() => {
              audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
            }, 3000);
          };
          targetContainer.appendChild(audioBtn);
        }

        // Floating player overlay badge for standard YouTube watch pages
        const playerContainer = document.querySelector('#movie_player, .html5-video-player');
        if (playerContainer && !playerContainer.querySelector('.soul-yt-player-float-badge') && (window.location.pathname.includes('/watch') || window.location.search.includes('v='))) {
          const floatBadge = document.createElement('div');
          floatBadge.className = 'soul-yt-player-float-badge';
          floatBadge.style.cssText = 'position:absolute;top:16px;right:16px;z-index:2147483647;display:flex;align-items:center;gap:6px;opacity:0.85;transition:opacity 0.2s ease;pointer-events:auto;';
          floatBadge.onmouseenter = () => { floatBadge.style.opacity = '1'; };
          floatBadge.onmouseleave = () => { floatBadge.style.opacity = '0.85'; };

          const fMp4 = document.createElement('button');
          fMp4.innerHTML = '<span style="font-size:12px;">⬇</span><span>MP4</span>';
          fMp4.title = 'Скачать видео (MP4)';
          fMp4.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:14px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
          fMp4.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-video') + '.mp4',
            });
            fMp4.innerHTML = '<span>✓</span><span>Загрузка...</span>';
            setTimeout(() => { fMp4.innerHTML = '<span style="font-size:12px;">⬇</span><span>MP4</span>'; }, 2500);
          };

          const fMp3 = document.createElement('button');
          fMp3.innerHTML = '<span style="font-size:12px;">♫</span><span>MP3</span>';
          fMp3.title = 'Скачать аудио (MP3)';
          fMp3.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:14px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
          fMp3.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-audio') + '.mp3',
              isAudio: true,
            });
            fMp3.innerHTML = '<span>✓</span><span>Загрузка...</span>';
            setTimeout(() => { fMp3.innerHTML = '<span style="font-size:12px;">♫</span><span>MP3</span>'; }, 2500);
          };

          floatBadge.appendChild(fMp4);
          floatBadge.appendChild(fMp3);
          playerContainer.appendChild(floatBadge);
        }

        // Shorts vertical target: dynamically inspect active reel renderers and shorts containers
        const reelRenderers = document.querySelectorAll('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer, ytd-shorts [is-active]');
        const isShortsPage = window.location.pathname.includes('/shorts');

        if (reelRenderers.length > 0) {
          reelRenderers.forEach((reel) => {
            // A. Floating overlay bar on the shorts player (immune to #actions overflow:hidden)
            const playerOverlay = reel.querySelector('ytd-reel-player-overlay-renderer, #player-container, .html5-video-player') || reel;
            if (!reel.querySelector('.soul-yt-shorts-float-bar') && playerOverlay) {
              const floatBar = document.createElement('div');
              floatBar.className = 'soul-yt-shorts-float-bar';
              floatBar.style.cssText = 'position:absolute;top:16px;left:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:auto;';

              const mp4Btn = document.createElement('button');
              mp4Btn.className = 'soul-yt-shorts-float-btn soul-yt-shorts-mp4';
              mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>';
              mp4Btn.title = 'Скачать Shorts в высоком качестве (MP4)';
              mp4Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#ffffff;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);transition:all 0.15s ease;letter-spacing:0.3px;';
              mp4Btn.onmouseenter = () => { mp4Btn.style.background = '#2563eb'; mp4Btn.style.borderColor = '#60a5fa'; mp4Btn.style.transform = 'translateY(-1px) scale(1.03)'; };
              mp4Btn.onmouseleave = () => { mp4Btn.style.background = 'rgba(15,23,42,0.88)'; mp4Btn.style.borderColor = 'rgba(255,255,255,0.25)'; mp4Btn.style.transform = 'none'; };
              mp4Btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp4',
                  isAudio: false,
                });
                mp4Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
                setTimeout(() => { mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>'; }, 3000);
              };

              const mp3Btn = document.createElement('button');
              mp3Btn.className = 'soul-yt-shorts-float-btn soul-yt-shorts-mp3';
              mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>';
              mp3Btn.title = 'Скачать аудиодорожку Shorts (MP3)';
              mp3Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);transition:all 0.15s ease;letter-spacing:0.3px;';
              mp3Btn.onmouseenter = () => { mp3Btn.style.background = 'rgba(255,255,255,0.25)'; mp3Btn.style.borderColor = '#ffffff'; mp3Btn.style.transform = 'translateY(-1px) scale(1.03)'; };
              mp3Btn.onmouseleave = () => { mp3Btn.style.background = 'rgba(15,23,42,0.88)'; mp3Btn.style.borderColor = 'rgba(255,255,255,0.25)'; mp3Btn.style.transform = 'none'; };
              mp3Btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp3',
                  isAudio: true,
                });
                mp3Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
                setTimeout(() => { mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>'; }, 3000);
              };

              floatBar.appendChild(mp4Btn);
              floatBar.appendChild(mp3Btn);
              playerOverlay.appendChild(floatBar);
            }

            // B. Also inject inside #actions if available
            const reelActions = reel.querySelector('#actions, ytd-reel-player-overlay-renderer #actions, #button-bar, #actions.ytd-reel-player-overlay-renderer') ||
              (reel.matches('[is-active]') ? document.querySelector('ytd-shorts #actions, ytd-reel-player-overlay-renderer #actions') : null);
            if (reelActions && !reelActions.querySelector('.soul-yt-shorts-dl-btn')) {
              const shortsBtn = document.createElement('button');
              shortsBtn.className = 'soul-yt-shorts-dl-btn';
              shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>MP4</span>';
              shortsBtn.title = 'Скачать Shorts в высоком качестве (MP4)';
              shortsBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp4',
                  isAudio: false,
                });
                shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Загрузка</span>';
                setTimeout(() => {
                  shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>MP4</span>';
                }, 3000);
              };
              reelActions.appendChild(shortsBtn);
            }

            if (reelActions && !reelActions.querySelector('.soul-yt-shorts-audio-btn')) {
              const shortsAudioBtn = document.createElement('button');
              shortsAudioBtn.className = 'soul-yt-shorts-audio-btn';
              shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
              shortsAudioBtn.title = 'Скачать звук Shorts в MP3';
              shortsAudioBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp3',
                  isAudio: true,
                });
                shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Загрузка</span>';
                setTimeout(() => {
                  shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
                }, 3000);
              };
              reelActions.appendChild(shortsAudioBtn);
            }
          });
        } else if (isShortsPage && !document.querySelector('.soul-yt-shorts-float-bar')) {
          // Fallback if polymer reels have not rendered custom element names yet
          const shortsContainer = document.querySelector('ytd-shorts, #shorts-player, #player-container, #shorts-container');
          if (shortsContainer) {
            const floatBar = document.createElement('div');
            floatBar.className = 'soul-yt-shorts-float-bar';
            floatBar.style.cssText = 'position:fixed;top:70px;left:24px;z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:auto;';

            const mp4Btn = document.createElement('button');
            mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>';
            mp4Btn.title = 'Скачать Shorts в высоком качестве (MP4)';
            mp4Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);color:#ffffff;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
            mp4Btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ipcRenderer.send('page:download-media', {
                url: window.location.href,
                filename: (document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts') + '.mp4',
                isAudio: false,
              });
              mp4Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
              setTimeout(() => { mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>'; }, 3000);
            };

            const mp3Btn = document.createElement('button');
            mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>';
            mp3Btn.title = 'Скачать аудио Shorts (MP3)';
            mp3Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
            mp3Btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ipcRenderer.send('page:download-media', {
                url: window.location.href,
                filename: (document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts') + '.mp3',
                isAudio: true,
              });
              mp3Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
              setTimeout(() => { mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>'; }, 3000);
            };

            floatBar.appendChild(mp4Btn);
            floatBar.appendChild(mp3Btn);
            shortsContainer.appendChild(floatBar);
          }
        }
      };
      injectors.push(injectYtButton);
      window.addEventListener('yt-navigate-finish', scheduleInjection);
      window.addEventListener('spfdone', scheduleInjection);
      window.addEventListener('yt-action', scheduleInjection);
      window.addEventListener('yt-visibility-refresh', scheduleInjection);
      window.addEventListener('yt-page-data-updated', scheduleInjection);
      window.addEventListener('popstate', scheduleInjection);
      window.addEventListener('scroll', scheduleInjection, { passive: true });
      repeatWhenVisible(scheduleInjection, 1500);
    }

    // Rutube does not expose a stable action toolbar across its player layouts.
    // Add compact controls beside the player and let yt-dlp resolve the page.
    if (isHostOrSubdomain('rutube.ru')) {
      const injectRutubeButtons = () => {
        const player = document.querySelector('video, [class*="player"], [class*="Player"]');
        const container = player?.parentElement || document.body;
        if (!container) return;
        if (!document.querySelector('.soul-rutube-dl-btn')) {
          const button = document.createElement('button');
          button.className = 'soul-rutube-dl-btn';
          button.textContent = '⬇ Скачать MP4';
          button.title = 'Скачать видео Rutube в MP4';
          button.style.cssText = 'position:relative;z-index:2147483647;background:#f4511e;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:8px;';
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'rutube-video') + '.mp4',
              isAudio: false,
            });
            button.textContent = '✓ Скачивается';
            setTimeout(() => { button.textContent = '⬇ Скачать MP4'; }, 3000);
          };
          container.appendChild(button);
        }
        if (!document.querySelector('.soul-rutube-audio-dl-btn')) {
          const button = document.createElement('button');
          button.className = 'soul-rutube-audio-dl-btn';
          button.textContent = '♫ MP3';
          button.title = 'Скачать аудио Rutube в MP3';
          button.style.cssText = 'position:relative;z-index:2147483647;background:#fff;color:#f4511e;border:1px solid #f4511e;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;margin:8px 8px 8px 0;';
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'rutube-audio') + '.mp3',
              isAudio: true,
            });
            button.textContent = '✓ Скачивается';
            setTimeout(() => { button.textContent = '♫ MP3'; }, 3000);
          };
          container.appendChild(button);
        }
      };
      injectors.push(injectRutubeButtons);
      window.addEventListener('popstate', scheduleInjection);
    }

    if (injectors.length && typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver(scheduleInjection);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('visibilitychange', scheduleInjection);
    scheduleInjection();

    // 4. Video & Audio media detection for download button checkmark
    const hasValidVideoSource = (v: HTMLVideoElement): boolean => {
      try {
        if (v.src && v.src.trim() !== '' && !v.src.startsWith('blob:null')) return true;
        if (v.currentSrc && v.currentSrc.trim() !== '') return true;
        if (v.querySelector('source[src], source[srcset]')) return true;
        if (v.readyState > 0 || v.duration > 0 || !v.paused) return true;
        return false;
      } catch {
        return false;
      }
    };

    let lastMediaSignature = '';
    const checkMedia = () => {
      try {
        const videos = document.getElementsByTagName('video');
        let hasVideo = false;
        for (let i = 0; i < videos.length; i++) {
          const v = videos[i];
          if (v && hasValidVideoSource(v)) {
            hasVideo = true;
            break;
          }
        }
        const audios = document.getElementsByTagName('audio');
        let hasAudio = false;
        for (let i = 0; i < audios.length; i++) {
          const a = audios[i];
          if (a && (a.src || a.currentSrc || !a.paused || a.duration > 0 || a.readyState > 0)) {
            hasAudio = true;
            break;
          }
        }
        const signature = `${hasVideo ? '1' : '0'}:${hasAudio ? '1' : '0'}`;
        if (signature === lastMediaSignature) return;
        lastMediaSignature = signature;
        ipcRenderer.send('page:media-detected', { hasVideo, hasAudio });
      } catch {}
    };
    checkMedia();
    setInterval(checkMedia, 5000);

    // Audio stream auto-capture on playback
    document.addEventListener('play', (e) => {
      const target = e.target;
      if (target instanceof HTMLAudioElement || (target instanceof HTMLElement && target.tagName === 'AUDIO')) {
        const audio = target as HTMLAudioElement;
        const src = audio.src || audio.currentSrc;
        if (src && (src.includes('vkuseraudio.net') || src.includes('.mp3') || src.includes('.m3u8') || src.startsWith('http'))) {
          const artist = document.querySelector('.top_audio_player_artist, .AudioPlayer__performer, .audio_page_player_performer, .audio_row_current .audio_row__performers')?.textContent?.trim() || '';
          const title = document.querySelector('.top_audio_player_title, .AudioPlayer__title, .audio_page_player_title, .audio_row_current .audio_row__title_inner')?.textContent?.trim() || '';
          const filename = (artist && title ? `${artist} - ${title}.mp3` : title ? `${title}.mp3` : undefined)?.replace(/[\\/:*?"<>|]/g, '');
          ipcRenderer.send('page:audio-stream-captured', { url: src, title, artist, filename });
        }
      }
    }, true);

    // 5. Google Account Detection & SSO Auto-sync
    if (isHostOrSubdomain('google.com') || isHostOrSubdomain('google.ru')) {
      let lastAccountSignature = '';
      const checkGoogleAccount = () => {
        if (document.hidden === true || suspended) return;
        try {
          const ariaEl = document.querySelector('a[aria-label*="@"], div[aria-label*="@"], [data-email*="@"]');
          let email = '';
          let name = '';
          let avatar = '';

          if (ariaEl) {
            const label = ariaEl.getAttribute('aria-label') || '';
            const emailMatch = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
              email = emailMatch[1];
              const nameMatch = label.match(/(?:Google Account|Аккаунт Google):\s*([^\n(]+)/i);
              if (nameMatch) name = nameMatch[1].trim();
            }
            const dataEmail = ariaEl.getAttribute('data-email');
            if (dataEmail && dataEmail.includes('@')) email = dataEmail;
            const img = ariaEl.querySelector('img') || ariaEl.closest('header, nav, #gb')?.querySelector('img[src*="googleusercontent.com"]');
            if (img && img instanceof HTMLImageElement && img.src) avatar = img.src;
          }

          if (!email) {
            const gbImg = document.querySelector('img.gb_p, img.gb_q, #gb img[src*="googleusercontent.com"], a[href*="SignOutOptions"] img');
            if (gbImg && gbImg instanceof HTMLImageElement) {
              avatar = gbImg.src;
              const parentLabel = gbImg.parentElement?.getAttribute('aria-label') || gbImg.getAttribute('aria-label') || '';
              const emMatch = parentLabel.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
              if (emMatch) email = emMatch[1];
            }
          }

          if (email) {
            const signature = JSON.stringify([email, name, avatar]);
            if (signature === lastAccountSignature) return;
            lastAccountSignature = signature;
            ipcRenderer.send('page:google-account-detected', { email, name, avatar });
          }
        } catch {}
      };
      checkGoogleAccount();
      repeatWhenVisible(checkGoogleAccount, 4000);
    }

    // 6. Native Video, Picture-in-Picture & Speed Controller (Chrome & Yandex Flagship)
    let lastVideoPresence: boolean | undefined;

    const findVideos = (root: Document | ShadowRoot | Element): HTMLVideoElement[] => {
      const list: HTMLVideoElement[] = [];
      if (!root) return list;
      try {
        if ('querySelectorAll' in root) {
          list.push(...Array.from(root.querySelectorAll('video')));
          const all = root.querySelectorAll('*');
          for (let i = 0; i < all.length; i++) {
            const sr = all[i].shadowRoot;
            if (sr) list.push(...findVideos(sr));
          }
        }
      } catch {}
      return list;
    };

    const checkVideo = () => {
      try {
        const videos = findVideos(document);
        const hasVideo = videos.some(hasValidVideoSource);
        if (hasVideo !== lastVideoPresence) {
          lastVideoPresence = hasVideo;
          ipcRenderer.send('page:video-detected', { hasVideo });
        }
      } catch {}
    };

    // A stream/chat page may mutate hundreds of times per second. Coalesce
    // discovery rather than walking its entire DOM in every observer callback.
    let videoCheckTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleVideoCheck = () => {
      if (document.hidden === true || suspended || videoCheckTimer !== undefined) return;
      videoCheckTimer = setTimeout(() => {
        videoCheckTimer = undefined;
        if (document.hidden !== true && !suspended) checkVideo();
      }, 250);
    };
    checkVideo();
    repeatWhenVisible(scheduleVideoCheck, 2500);
    document.addEventListener('play', checkVideo, true);
    document.addEventListener('playing', checkVideo, true);
    document.addEventListener('loadeddata', checkVideo, true);
    document.addEventListener('pause', checkVideo, true);
    document.addEventListener('ended', checkVideo, true);
    document.addEventListener('emptied', checkVideo, true);
    document.addEventListener('suspend', checkVideo, true);
    try {
      const observer = new MutationObserver(scheduleVideoCheck);
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch {}

    const togglePip = async (): Promise<{ success: boolean; isPip: boolean }> => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          ipcRenderer.send('page:pip-changed', { isPip: false, source: 'native' });
          return { success: true, isPip: false };
        }
        const videos = findVideos(document);
        if (!videos.length) return { success: false, isPip: false };
        const playing = videos.filter((v) => !v.paused && v.readyState > 0);
        let target = playing.find((v) => v.currentTime > 0) || playing[0];
        if (!target) {
          videos.sort((a, b) => {
            const rA = a.getBoundingClientRect();
            const rB = b.getBoundingClientRect();
            return (rB.width * rB.height) - (rA.width * rA.height);
          });
          target = videos[0];
        }
        if (target && typeof target.requestPictureInPicture === 'function') {
          try {
            target.removeAttribute('disablePictureInPicture');
            target.disablePictureInPicture = false;
          } catch {}
          await target.requestPictureInPicture();
          ipcRenderer.send('page:pip-changed', { isPip: true, source: 'native' });
          return { success: true, isPip: true };
        }
        return { success: false, isPip: false };
      } catch {
        return { success: false, isPip: Boolean(document.pictureInPictureElement) };
      }
    };

    if (typeof ipcRenderer?.on === 'function') {
      ipcRenderer.on('tab:toggle-pip', async () => {
        await togglePip();
      });
    }

    document.addEventListener('enterpictureinpicture', () => {
      ipcRenderer.send('page:pip-changed', { isPip: true, source: 'native' });
    }, true);
    document.addEventListener('leavepictureinpicture', () => {
      if (miniPipActive || nativePipTransition) return;
      ipcRenderer.send('page:pip-changed', { isPip: false, source: 'native' });
    }, true);

    let miniPipActive = false;
    let nativePipTransition = false;
    let miniPipGeneration = 0;
    let miniPipTabId: string | undefined;
    let miniPipCleanup: (() => void) | undefined;
    let miniPipShadowStyle: HTMLStyleElement | null = null;
    let miniPipResize: HTMLButtonElement | null = null;
    (window as unknown as { __hasPipVideo?: () => boolean }).__hasPipVideo = () => findVideos(document).some(hasValidVideoSource);
    let miniPipVideo: HTMLVideoElement | null = null;
    let miniPipOriginalControls = false;
    let miniPipStyles: HTMLStyleElement | null = null;
    let miniPipHud: HTMLDivElement | null = null;
    let miniPipBorder: HTMLDivElement | null = null;

    const setMiniPipMode = async (enabled: boolean, tabId?: string, tabTitle?: string) => {
      if (tabId) miniPipTabId = tabId;
      if (enabled === miniPipActive) return;
      const generation = ++miniPipGeneration;
      miniPipActive = enabled;

      if (enabled) {
        const videos = findVideos(document).filter(hasValidVideoSource);
        const playing = videos.filter((video) => !video.paused && video.readyState > 0);
        const target = playing.find((video) => video.currentTime > 0) || playing[0] || videos[0];
        if (!target) {
          miniPipActive = false;
          ipcRenderer.send('page:pip-changed', { isPip: false, source: 'mini' });
          return;
        }
        if (document.pictureInPictureElement) {
          nativePipTransition = true;
          try { await document.exitPictureInPicture(); } catch {
            if (generation === miniPipGeneration) miniPipActive = false;
            ipcRenderer.send('page:pip-changed', { isPip: Boolean(document.pictureInPictureElement), source: 'native' });
            return;
          } finally { nativePipTransition = false; }
        }
        if (generation !== miniPipGeneration || !miniPipActive) return;
        miniPipVideo = target;
        miniPipOriginalControls = target.controls;
        target.controls = false;
        target.classList.add('soulm8te-mini-pip-target');

        if (!miniPipStyles) {
          miniPipStyles = document.createElement('style');
          miniPipStyles.id = 'soulm8te-mini-pip-styles';
          miniPipStyles.textContent = `
            #soulm8te-video-pip-btn { display: none !important; }
            video.soulm8te-mini-pip-target {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 100vw !important;
              height: 100vh !important;
              max-width: 100vw !important;
              max-height: 100vh !important;
              z-index: 2147483640 !important;
              object-fit: contain !important;
              background: #000000 !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            #soulm8te-mini-pip-hud {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              right: 0 !important;
              min-height: 38px !important;
              flex-wrap: wrap !important;
              gap: 4px !important;
              background: linear-gradient(180deg, rgba(13, 16, 23, 0.95) 0%, rgba(13, 16, 23, 0.6) 80%, transparent 100%) !important;
              display: flex !important;
              align-items: center !important;
              justify-content: space-between !important;
              padding: 0 10px !important;
              z-index: 2147483647 !important;
              opacity: 0 !important;
              transition: opacity 0.2s ease !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
              pointer-events: auto !important;
              box-sizing: border-box !important;
            }
            body:hover #soulm8te-mini-pip-hud, #soulm8te-mini-pip-hud:hover, #soulm8te-mini-pip-hud:focus-within {
              opacity: 1 !important;
            }
            .soulm8te-mini-pip-title {
              font-size: 11px !important;
              font-weight: 600 !important;
              color: #f1f5f9 !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              min-width: 0 !important;
              flex: 1 !important;
              cursor: move !important;
              touch-action: none !important;
              user-select: none !important;
            }
            .soulm8te-mini-pip-actions {
              display: flex !important;
              align-items: center !important;
              gap: 6px !important;
            }
            .soulm8te-mini-pip-btn {
              display: inline-flex !important;
              align-items: center !important;
              gap: 4px !important;
              padding: 3px 8px !important;
              border-radius: 5px !important;
              font-size: 11px !important;
              font-weight: 600 !important;
              cursor: pointer !important;
              border: 1px solid rgba(255, 255, 255, 0.25) !important;
              background: rgba(30, 41, 59, 0.85) !important;
              color: #ffffff !important;
              transition: all 0.15s ease !important;
            }
            .soulm8te-mini-pip-btn:focus-visible { outline: 2px solid #38bdf8 !important; outline-offset: 2px !important; }
            .soulm8te-mini-pip-btn:disabled { opacity: .45 !important; cursor: default !important; }
            .soulm8te-mini-pip-playback { flex-basis: 100% !important; justify-content: center !important; padding-bottom: 6px !important; }
            #soulm8te-mini-pip-resize { position: fixed !important; right: 0 !important; bottom: 0 !important; width: 24px !important; height: 24px !important; padding: 0 !important; color: white !important; background: #1e293bcc !important; border: 0 !important; z-index: 2147483647 !important; cursor: nwse-resize !important; touch-action: none !important; }
            .soulm8te-mini-pip-btn:hover {
              background: #2563eb !important;
              border-color: #3b82f6 !important;
            }
            .soulm8te-mini-pip-close {
              background: rgba(239, 68, 68, 0.85) !important;
              border-color: rgba(239, 68, 68, 0.9) !important;
              padding: 3px 6px !important;
            }
            .soulm8te-mini-pip-close:hover {
              background: #dc2626 !important;
            }
            #soulm8te-mini-pip-border {
              position: fixed !important;
              inset: 0 !important;
              border: 1.5px solid rgba(56, 189, 248, 0.45) !important;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75) !important;
              pointer-events: none !important;
              z-index: 2147483646 !important;
              box-sizing: border-box !important;
            }
          `;
          document.head?.appendChild(miniPipStyles);
          const root = target.getRootNode();
          if (root instanceof ShadowRoot) {
            miniPipShadowStyle = miniPipStyles.cloneNode(true) as HTMLStyleElement;
            root.appendChild(miniPipShadowStyle);
          }
        }

        if (!miniPipHud) {
          miniPipHud = document.createElement('div');
          miniPipHud.id = 'soulm8te-mini-pip-hud';
          const titleSpan = document.createElement('span');
          titleSpan.className = 'soulm8te-mini-pip-title';
          titleSpan.textContent = tabTitle || document.title || 'soulm8te Video';
          miniPipHud.appendChild(titleSpan);

          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'soulm8te-mini-pip-actions';

          const makeButton = (label: string, text: string, action: () => void) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'soulm8te-mini-pip-btn';
            button.title = label;
            button.setAttribute('aria-label', label);
            button.textContent = text;
            button.onclick = (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.isTrusted) action();
            };
            return button;
          };
          const returnBtn = makeButton('Вернуться к вкладке', '↗', () => {
            if (miniPipTabId) ipcRenderer.send('page:request-activate-tab', miniPipTabId);
          });
          const closeBtn = makeButton('Закрыть мини-плеер', '✕', () => {
            void setMiniPipMode(false);
            ipcRenderer.send('page:pip-changed', { isPip: false, source: 'mini' });
          });
          closeBtn.classList.add('soulm8te-mini-pip-close');
          actionsDiv.append(returnBtn, closeBtn);
          miniPipHud.appendChild(actionsDiv);

          const playback = document.createElement('div');
          playback.className = 'soulm8te-mini-pip-actions soulm8te-mini-pip-playback';
          const seek = (delta: number) => {
            if (!Number.isFinite(target.duration) || target.duration <= 0) return;
            try { target.currentTime = Math.max(0, Math.min(target.duration, target.currentTime + delta)); } catch {}
          };
          const rewind = makeButton('Назад на 10 секунд', '−10', () => seek(-10));
          const playPause = makeButton('Пауза', 'Ⅱ', () => {
            if (target.paused) void target.play().catch(() => syncControls());
            else target.pause();
          });
          const forward = makeButton('Вперёд на 10 секунд', '+10', () => seek(10));
          const mute = makeButton('Выключить звук', '♪', () => { target.muted = !target.muted; });
          const labelButton = (button: HTMLButtonElement, label: string, text: string) => {
            button.title = label;
            button.setAttribute('aria-label', label);
            button.textContent = text;
          };
          const syncControls = () => {
            labelButton(playPause, target.paused ? 'Воспроизвести' : 'Пауза', target.paused ? '▶' : 'Ⅱ');
            labelButton(mute, target.muted ? 'Включить звук' : 'Выключить звук', target.muted ? '♩×' : '♪');
            rewind.disabled = forward.disabled = !Number.isFinite(target.duration) || target.duration <= 0;
          };
          const mediaEvents = ['play', 'pause', 'ended', 'volumechange', 'durationchange', 'loadedmetadata'];
          mediaEvents.forEach(name => target.addEventListener(name, syncControls));
          syncControls();
          playback.append(rewind, playPause, forward, mute);
          miniPipHud.appendChild(playback);
          document.body?.appendChild(miniPipHud);

          // screen coordinates remain stable while the native view itself moves.
          const wirePointer = (handle: HTMLElement, resize: boolean) => {
            let pointerId: number | undefined;
            let previousX = 0, previousY = 0, startX = 0, startWidth = 0;
            let frame: number | undefined;
            let deltaX = 0, deltaY = 0, width: number | undefined;
            const flush = () => {
              frame = undefined;
              if (!miniPipActive) return;
              if (resize && width !== undefined) ipcRenderer.send('page:pip-layout', { width });
              else if (deltaX || deltaY) ipcRenderer.send('page:pip-layout', { deltaX, deltaY });
              deltaX = deltaY = 0;
              width = undefined;
            };
            const end = () => {
              if (frame !== undefined) { cancelAnimationFrame(frame); flush(); }
              if (pointerId !== undefined && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
              pointerId = undefined;
            };
            const down = (event: PointerEvent) => {
              if (!event.isTrusted || event.button !== 0 || pointerId !== undefined) return;
              event.preventDefault(); event.stopPropagation();
              pointerId = event.pointerId;
              previousX = startX = event.screenX; previousY = event.screenY;
              startWidth = window.innerWidth;
              handle.setPointerCapture(pointerId);
            };
            const move = (event: PointerEvent) => {
              if (!event.isTrusted || event.pointerId !== pointerId) return;
              event.preventDefault(); event.stopPropagation();
              if (resize) width = startWidth + event.screenX - startX;
              else { deltaX += event.screenX - previousX; deltaY += event.screenY - previousY; }
              previousX = event.screenX; previousY = event.screenY;
              if (frame === undefined) frame = requestAnimationFrame(flush);
            };
            handle.addEventListener('pointerdown', down);
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
            handle.addEventListener('lostpointercapture', end);
            return () => {
              end();
              handle.removeEventListener('pointerdown', down);
              handle.removeEventListener('pointermove', move);
              handle.removeEventListener('pointerup', end);
              handle.removeEventListener('pointercancel', end);
              handle.removeEventListener('lostpointercapture', end);
            };
          };
          const releaseDrag = wirePointer(titleSpan, false);
          miniPipResize = makeButton('Изменить размер мини-плеера', '◢', () => undefined);
          miniPipResize.id = 'soulm8te-mini-pip-resize';
          document.body?.appendChild(miniPipResize);
          const releaseResize = wirePointer(miniPipResize, true);
          miniPipCleanup = () => {
            mediaEvents.forEach(name => target.removeEventListener(name, syncControls));
            releaseDrag(); releaseResize();
          };
        }

        if (!miniPipBorder) {
          miniPipBorder = document.createElement('div');
          miniPipBorder.id = 'soulm8te-mini-pip-border';
          document.body?.appendChild(miniPipBorder);
        }
      } else {
        miniPipCleanup?.();
        miniPipCleanup = undefined;
        miniPipResize?.remove();
        miniPipResize = null;
        miniPipShadowStyle?.remove();
        miniPipShadowStyle = null;
        if (miniPipVideo) {
          miniPipVideo.controls = miniPipOriginalControls;
          miniPipVideo.classList.remove('soulm8te-mini-pip-target');
          miniPipVideo = null;
        }
        if (miniPipStyles && miniPipStyles.parentNode) {
          miniPipStyles.remove();
          miniPipStyles = null;
        }
        if (miniPipHud && miniPipHud.parentNode) {
          miniPipHud.remove();
          miniPipHud = null;
        }
        if (miniPipBorder && miniPipBorder.parentNode) {
          miniPipBorder.remove();
          miniPipBorder = null;
        }
      }
    };

    if (typeof ipcRenderer?.on === 'function') {
      ipcRenderer.on('tab:set-pip-mini-mode', (_evt, data: { enabled: boolean; tabId?: string; title?: string }) => {
        void setMiniPipMode(Boolean(data?.enabled), data?.tabId, data?.title);
      });
    }

    // In-page Floating PiP Overlay (Яндекс.Браузер стиль)
    const setupVideoHoverOverlay = () => {
      let pipButton: HTMLButtonElement | null = null;
      let activeVideo: HTMLVideoElement | null = null;
      let hideTimer: any = null;

      const createPipButton = () => {
        if (pipButton && pipButton.isConnected) return pipButton;
        const btn = document.createElement('button');
        btn.id = 'soulm8te-video-pip-btn';
        btn.setAttribute('aria-label', 'Смотреть в отдельном окне (PiP)');
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;">
            <rect width="18" height="14" x="3" y="5" rx="2"/>
            <path d="M21 9v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9"/>
            <rect width="8" height="6" x="11" y="11" rx="1" fill="currentColor"/>
          </svg>
          <span>Вынести видео</span>
        `;
        Object.assign(btn.style, {
          position: 'fixed',
          zIndex: '2147483647',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 14px',
          background: 'rgba(15, 23, 42, 0.90)',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '12px',
          fontWeight: '600',
          letterSpacing: '0.02em',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          borderRadius: '9999px',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45), 0 0 12px rgba(56, 189, 248, 0.3)',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.16s ease',
          pointerEvents: 'auto',
          userSelect: 'none',
        });

        btn.onmouseenter = () => {
          clearTimeout(hideTimer);
          btn.style.background = '#2563eb';
          btn.style.borderColor = '#38bdf8';
          btn.style.transform = 'translateX(-50%) scale(1.05)';
        };

        btn.onmouseleave = () => {
          btn.style.background = 'rgba(15, 23, 42, 0.90)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
          btn.style.transform = 'translateX(-50%) scale(1)';
          scheduleHide();
        };

        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!activeVideo) return;
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
              ipcRenderer.send('page:pip-changed', { isPip: false, source: 'native' });
            } else {
              activeVideo.removeAttribute('disablePictureInPicture');
              activeVideo.disablePictureInPicture = false;
              await activeVideo.requestPictureInPicture();
              ipcRenderer.send('page:pip-changed', { isPip: true, source: 'native' });
            }
          } catch (err) {
            console.error('PiP error:', err);
          }
        };

        (document.fullscreenElement || document.body || document.documentElement).appendChild(btn);
        pipButton = btn;
        return btn;
      };

      const positionButton = (video: HTMLVideoElement) => {
        if (miniPipActive) {
          if (pipButton) pipButton.style.display = 'none';
          return;
        }
        const btn = createPipButton();
        const rect = video.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 90 || rect.bottom < 0 || rect.top > window.innerHeight) {
          btn.style.display = 'none';
          return;
        }

        const top = Math.max(12, rect.top + 14);
        const left = rect.left + (rect.width / 2);
        btn.style.top = `${top}px`;
        btn.style.left = `${left}px`;
        btn.style.transform = 'translateX(-50%)';
        btn.style.display = 'inline-flex';
      };

      const scheduleHide = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (pipButton) pipButton.style.display = 'none';
        }, 1200);
      };

      document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target instanceof HTMLVideoElement) {
          activeVideo = target;
          clearTimeout(hideTimer);
          positionButton(target);
        } else if (target instanceof Element && target.closest('#soulm8te-video-pip-btn')) {
          clearTimeout(hideTimer);
        } else if (activeVideo) {
          scheduleHide();
        }
      }, true);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupVideoHoverOverlay, { once: true });
    } else {
      setupVideoHoverOverlay();
    }

    // Video Speed Controller Hotkeys (Chrome Extension Standard: [, ], \, z, x)
    document.addEventListener('keydown', (e) => {
      if (!['[', ']', '\\', 'z', 'x', 'я', 'ч'].includes(e.key) || e.defaultPrevented || e.isComposing) return;
      const activeElement = (e.composedPath?.()[0] as HTMLElement | undefined) ?? document.activeElement as HTMLElement | null;
      const activeTag = (activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || activeElement?.isContentEditable) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const videos = findVideos(document);
      const playing = videos.find((v) => !v.paused && v.readyState > 0) || videos[0];
      if (!playing) return;

      const showToast = (text: string) => {
        let toast = document.getElementById('soulm8te-video-hud');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'soulm8te-video-hud';
          Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '2147483647',
            padding: '6px 14px',
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#38bdf8',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            fontWeight: '700',
            borderRadius: '8px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'none',
            transition: 'opacity 0.2s ease',
          });
          document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.style.opacity = '1';
        clearTimeout((toast as any).__timer);
        (toast as any).__timer = setTimeout(() => {
          if (toast) toast.style.opacity = '0';
        }, 1200);
      };

      if (e.key === ']') {
        playing.playbackRate = Math.min(4.0, Math.round((playing.playbackRate + 0.25) * 100) / 100);
        showToast(`Скорость: ${playing.playbackRate}x`);
      } else if (e.key === '[') {
        playing.playbackRate = Math.max(0.25, Math.round((playing.playbackRate - 0.25) * 100) / 100);
        showToast(`Скорость: ${playing.playbackRate}x`);
      } else if (e.key === '\\') {
        playing.playbackRate = 1.0;
        showToast('Скорость: 1.0x');
      } else if (e.key === 'z' || e.key === 'я') {
        playing.currentTime = Math.max(0, playing.currentTime - 10);
        showToast('-10 сек');
      } else if (e.key === 'x' || e.key === 'ч') {
        playing.currentTime = Math.min(playing.duration || Infinity, playing.currentTime + 10);
        showToast('+10 сек');
      }
    });

    // 7. Reader Mode Availability Detector
    let lastReaderAvailable: boolean | undefined;

    const isExcludedFromReader = (urlStr: string): boolean => {
      try {
        if (!urlStr) return true;
        const url = new URL(urlStr);
        if (['browser:', 'about:', 'chrome:', 'data:', 'javascript:'].includes(url.protocol)) return true;
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        // Search engines
        if (
          host === 'google.com' || host.endsWith('.google.com') ||
          host === 'google.ru' || host.endsWith('.google.ru') ||
          host === 'yandex.ru' || host.endsWith('.yandex.ru') ||
          host === 'yandex.com' || host.endsWith('.yandex.com') ||
          host === 'ya.ru' ||
          host === 'bing.com' || host.endsWith('.bing.com') ||
          host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com') ||
          host === 'baidu.com' || host.endsWith('.baidu.com') ||
          host === 'yahoo.com' || host.endsWith('.yahoo.com')
        ) {
          return true;
        }
        // Social networks & feeds & media sharing
        if (
          host === 'vk.com' || host.endsWith('.vk.com') || host === 'vkvideo.ru' ||
          host === 'twitter.com' || host === 'x.com' ||
          host === 'facebook.com' || host.endsWith('.facebook.com') ||
          host === 'instagram.com' || host.endsWith('.instagram.com') ||
          host === 'reddit.com' || host.endsWith('.reddit.com') ||
          host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
          host.includes('pinterest.')
        ) {
          return true;
        }
        // Video hostings & streaming
        if (
          host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' ||
          host === 'rutube.ru' || host.endsWith('.rutube.ru') ||
          host === 'twitch.tv' || host.endsWith('.twitch.tv') ||
          host === 'vimeo.com' || host.endsWith('.vimeo.com') ||
          host === 'dailymotion.com' || host.endsWith('.dailymotion.com')
        ) {
          return true;
        }
        // Webmail & messengers
        if (
          host === 'mail.google.com' || host === 'mail.ru' || host.endsWith('.mail.ru') ||
          host === 'mail.yandex.ru' || host === 'outlook.live.com' || host === 'outlook.office.com' ||
          host === 'web.telegram.org' || host === 'web.whatsapp.com'
        ) {
          return true;
        }
        // Homepages / root URLs without article path
        if ((url.pathname === '/' || url.pathname === '') && !url.search) {
          return true;
        }
        return false;
      } catch {
        return true;
      }
    };

    const checkReaderStatus = () => {
      if (document.hidden === true || suspended) return;
      try {
        const href = window.location.href;
        if (isExcludedFromReader(href)) {
          if (lastReaderAvailable !== false) {
            lastReaderAvailable = false;
            ipcRenderer.send('page:reader-status', { available: false });
          }
          return;
        }

        let available = false;
        const article = document.querySelector('article');
        const articleText = (article?.textContent || '').trim();
        if (article && articleText.length > 500) {
          available = true;
        } else {
          const main = document.querySelector('main, [role="main"]');
          const mainText = (main?.textContent || '').trim();
          if (main && mainText.length > 500) {
            available = true;
          } else {
            const paragraphs = document.querySelectorAll('p');
            let totalLength = 0;
            let longParagraphCount = 0;
            for (let i = 0; i < paragraphs.length; i++) {
              const text = (paragraphs[i].textContent || '').trim();
              if (text.length > 50) {
                longParagraphCount++;
                totalLength += text.length;
              }
              if (longParagraphCount >= 3 && totalLength > 500) {
                available = true;
                break;
              }
            }
          }
        }

        if (available !== lastReaderAvailable) {
          lastReaderAvailable = available;
          ipcRenderer.send('page:reader-status', { available });
        }
      } catch {}
    };
    checkReaderStatus();
    repeatWhenVisible(checkReaderStatus, 4000);
    window.addEventListener('popstate', checkReaderStatus);

    // 8. Reader Article Extractor
    const extractReaderArticle = (): ReaderArticle | null => {
      try {
        const title =
          document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')?.trim() ||
          document.querySelector('h1')?.textContent?.trim() ||
          document.title ||
          'Статья';

        const byline =
          document.querySelector('meta[name="author"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[property="article:author"]')?.getAttribute('content')?.trim() ||
          document.querySelector('[rel="author"], .byline, .author, .entry-author')?.textContent?.trim() ||
          undefined;

        const publishedTime =
          document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.trim() ||
          document.querySelector('time')?.getAttribute('datetime')?.trim() ||
          document.querySelector('time')?.textContent?.trim() ||
          undefined;

        const siteName =
          document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
          window.location.hostname ||
          undefined;

        const excerpt =
          document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
          undefined;

        let rootEl: Element | null = document.querySelector('article');
        if (!rootEl || (rootEl.textContent || '').trim().length < 200) {
          rootEl = document.querySelector('main, [role="main"], .post-content, .article-body, .entry-content');
        }
        if (!rootEl) {
          const candidates = Array.from(document.querySelectorAll('div, section'));
          let maxScore = 0;
          let bestCandidate: Element | null = null;
          for (const el of candidates) {
            const ps = el.querySelectorAll('p');
            if (ps.length >= 2) {
              let score = 0;
              for (const p of Array.from(ps)) score += (p.textContent || '').trim().length;
              if (score > maxScore) {
                maxScore = score;
                bestCandidate = el;
              }
            }
          }
          rootEl = bestCandidate || document.body;
        }

        if (!rootEl) return null;

        const clone = rootEl.cloneNode(true) as HTMLElement;

        // Collect corresponding live and clone images before any clone element removal
        const liveImgs = Array.from(rootEl.querySelectorAll('img'));
        const cloneImgs = Array.from(clone.querySelectorAll('img'));

        // Helper to parse srcset and select the highest resolution / width descriptor URL
        const parseBestSrcset = (srcsetStr: string | null | undefined, baseUrl: string): string | null => {
          if (!srcsetStr || typeof srcsetStr !== 'string') return null;
          const entries = srcsetStr.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
          let bestUrl: string | null = null;
          let maxScore = -1;

          for (const entry of entries) {
            const parts = entry.split(/\s+/);
            const rawUrl = parts[0]?.trim();
            if (!rawUrl) continue;
            const descriptor = parts[1]?.trim();
            let score = 1;
            if (descriptor) {
              if (descriptor.endsWith('w')) {
                const w = parseFloat(descriptor.slice(0, -1));
                if (!isNaN(w)) score = w;
              } else if (descriptor.endsWith('x')) {
                const x = parseFloat(descriptor.slice(0, -1));
                if (!isNaN(x)) score = x * 1000;
              }
            }
            if (score > maxScore) {
              maxScore = score;
              bestUrl = rawUrl;
            }
          }

          if (bestUrl) {
            try {
              return new URL(bestUrl, baseUrl).href;
            } catch {
              return bestUrl;
            }
          }
          return null;
        };

        const isPlaceholder = (u: string | null | undefined): boolean => {
          if (!u) return true;
          const str = u.trim().toLowerCase();
          if (str.startsWith('data:image/svg+xml') || str.startsWith('data:image/gif')) return true;
          if (str.startsWith('data:') && str.length < 250) return true;
          return /\b(placeholder|blank|spacer|1x1|pixel|transparent)\b/i.test(str);
        };

        // Process images with full Chromium-grade fidelity
        for (let i = 0; i < cloneImgs.length; i++) {
          const cloneImg = cloneImgs[i];
          const liveImg = liveImgs[i];
          let chosenUrl: string | null = null;

          // a) currentSrc from live rendered DOM (highest fidelity if not a placeholder)
          if (liveImg && liveImg.currentSrc && !isPlaceholder(liveImg.currentSrc)) {
            chosenUrl = liveImg.currentSrc;
          }

          // b) Check lazy-load attributes
          if (!chosenUrl || isPlaceholder(chosenUrl)) {
            const lazyAttrs = [
              'data-src',
              'data-original',
              'data-lazy-src',
              'data-actualsrc',
              'data-full-src',
              'data-orig-file',
              'data-url',
              'data-image',
            ];
            for (const attr of lazyAttrs) {
              const val = cloneImg.getAttribute(attr) || liveImg?.getAttribute(attr);
              if (val && !isPlaceholder(val)) {
                chosenUrl = val.trim();
                break;
              }
            }
          }

          // c) Parse srcset or data-srcset for highest resolution
          if (!chosenUrl || isPlaceholder(chosenUrl)) {
            const srcsetVal =
              cloneImg.getAttribute('data-srcset') ||
              cloneImg.getAttribute('srcset') ||
              cloneImg.getAttribute('data-lazy-srcset') ||
              liveImg?.getAttribute('data-srcset') ||
              liveImg?.getAttribute('srcset');
            if (srcsetVal) {
              const best = parseBestSrcset(srcsetVal, window.location.href);
              if (best && !isPlaceholder(best)) {
                chosenUrl = best;
              }
            }
          }

          // d) Check enclosing <picture> element sources
          if (!chosenUrl || isPlaceholder(chosenUrl)) {
            const picture = cloneImg.closest('picture') || liveImg?.closest('picture');
            if (picture) {
              const sources = Array.from(picture.querySelectorAll('source'));
              for (const source of sources) {
                const sourceSrcset =
                  source.getAttribute('srcset') ||
                  source.getAttribute('data-srcset') ||
                  source.getAttribute('data-lazy-srcset');
                if (sourceSrcset) {
                  const best = parseBestSrcset(sourceSrcset, window.location.href);
                  if (best && !isPlaceholder(best)) {
                    chosenUrl = best;
                    break;
                  }
                }
              }
            }
          }

          // e) Fallback to regular src attribute
          if (!chosenUrl || isPlaceholder(chosenUrl)) {
            const rawSrc = cloneImg.getAttribute('src') || liveImg?.getAttribute('src');
            if (rawSrc && !isPlaceholder(rawSrc)) {
              chosenUrl = rawSrc.trim();
            } else if (rawSrc && rawSrc.trim().startsWith('data:image/')) {
              chosenUrl = rawSrc.trim();
            }
          }

          // f) Convert relative URL to absolute URL
          if (chosenUrl) {
            try {
              chosenUrl = new URL(chosenUrl, window.location.href).href;
            } catch {}
            cloneImg.setAttribute('src', chosenUrl);
          }

          // Clean up conflicting or outdated responsive/lazy attributes on the clone
          cloneImg.removeAttribute('srcset');
          cloneImg.removeAttribute('data-srcset');
          cloneImg.removeAttribute('data-lazy-srcset');
          for (const attr of [
            'data-src', 'data-original', 'data-lazy-src', 'data-actualsrc',
            'data-full-src', 'data-orig-file', 'data-image', 'data-url'
          ]) {
            cloneImg.removeAttribute(attr);
          }
        }

        const removeSelectors = [
          'script', 'style', 'noscript', 'iframe', 'frame', 'object', 'embed',
          'form', 'input', 'button', 'select', 'textarea',
          'nav', 'header', 'footer', 'aside',
          '.ad', '.ads', '.advertisement', '.banner', '.social-share',
          'svg'
        ];
        for (const sel of removeSelectors) {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        }

        // Filter [aria-hidden="true"]: remove ONLY if it does not contain img, picture, or figure
        clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => {
          if (!el.querySelector('img, picture, figure')) {
            el.remove();
          } else {
            el.removeAttribute('aria-hidden');
          }
        });

        const allEls = clone.querySelectorAll('*');
        for (const el of Array.from(allEls)) {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('on') || attr.name === 'style') {
              el.removeAttribute(attr.name);
            }
          }
          if (el.tagName === 'A') {
            const rawHref = el.getAttribute('href');
            if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
              try {
                el.setAttribute('href', new URL(rawHref, window.location.href).href);
              } catch {}
            }
          }
        }

        const cleanedHtml = clone.innerHTML.trim();
        const textContent = clone.textContent?.trim() || '';
        const words = textContent ? textContent.split(/\s+/).filter(Boolean).length : 0;
        const readingTimeMinutes = Math.max(1, Math.round(words / 200));
        const lang =
          document.documentElement.lang?.trim() ||
          document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content')?.trim() ||
          'ru';

        return {
          title,
          byline,
          publishedTime,
          siteName,
          excerpt,
          content: cleanedHtml,
          textContent,
          length: textContent.length,
          readingTimeMinutes,
          lang,
        };
      } catch {
        return null;
      }
    };

    if (typeof ipcRenderer?.on === 'function') {
      ipcRenderer.on('tab:extract-reader-article', (_event, replyChannel?: string) => {
        const article = extractReaderArticle();
        if (replyChannel) {
          ipcRenderer.send(replyChannel, article);
        } else {
          ipcRenderer.send('page:reader-article-extracted', article);
        }
      });
    }

    // Fullscreen HUD Notification (Chromium / Chrome F11 style)
    const setupFullscreenHud = () => {
      let hudElement: HTMLDivElement | null = null;
      let fadeTimer: ReturnType<typeof setTimeout> | undefined;
      let mouseListenerActive = false;

      const createHud = () => {
        if (hudElement && hudElement.isConnected) return hudElement;
        const hud = document.createElement('div');
        hud.id = 'soul-fullscreen-hud';
        hud.setAttribute('role', 'status');
        hud.setAttribute('aria-live', 'polite');

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Полноэкранный режим · Нажмите F11 или Esc для выхода';

        const closeBtn = document.createElement('button');
        closeBtn.id = 'soul-fullscreen-hud-close';
        closeBtn.setAttribute('title', 'Выйти из полноэкранного режима (Esc / F11)');
        closeBtn.setAttribute('aria-label', 'Выйти из полноэкранного режима');
        closeBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;

        Object.assign(closeBtn.style, {
          background: 'rgba(255, 255, 255, 0.12)',
          border: 'none',
          color: '#ffffff',
          borderRadius: '50%',
          width: '22px',
          height: '22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: '0',
          transition: 'background 0.18s ease, transform 0.15s ease',
          outline: 'none',
          flexShrink: '0',
        });

        closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = 'rgba(239, 68, 68, 0.85)';
          closeBtn.style.transform = 'scale(1.08)';
        });
        closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = 'rgba(255, 255, 255, 0.12)';
          closeBtn.style.transform = 'scale(1)';
        });
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          ipcRenderer.send('page:exit-fullscreen');
        });

        hud.appendChild(textSpan);
        hud.appendChild(closeBtn);

        Object.assign(hud.style, {
          position: 'fixed',
          top: '18px',
          left: '50%',
          transform: 'translateX(-50%) translateY(0)',
          zIndex: '2147483647',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '9px 16px 9px 20px',
          background: 'rgba(15, 17, 23, 0.92)',
          color: '#f8fafc',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.015em',
          borderRadius: '9999px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.25)',
          backdropFilter: 'blur(14px)',
          webkitBackdropFilter: 'blur(14px)',
          opacity: '1',
          pointerEvents: 'auto',
          userSelect: 'none',
          webkitUserSelect: 'none',
          transition: 'opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        });

        hud.addEventListener('mouseenter', () => {
          clearTimeout(fadeTimer);
          hud.style.opacity = '1';
          hud.style.pointerEvents = 'auto';
          hud.style.transform = 'translateX(-50%) translateY(0)';
        });

        hud.addEventListener('mouseleave', () => {
          clearTimeout(fadeTimer);
          fadeTimer = setTimeout(() => {
            if (hudElement) {
              hudElement.style.opacity = '0';
              hudElement.style.pointerEvents = 'none';
              hudElement.style.transform = 'translateX(-50%) translateY(-14px)';
            }
          }, 1500);
        });

        const target = document.body || document.documentElement;
        target.appendChild(hud);
        hudElement = hud;
        return hud;
      };

      const showHud = () => {
        const hud = createHud();
        clearTimeout(fadeTimer);
        hud.style.opacity = '1';
        hud.style.pointerEvents = 'auto';
        hud.style.transform = 'translateX(-50%) translateY(0)';

        fadeTimer = setTimeout(() => {
          if (hudElement) {
            hudElement.style.opacity = '0';
            hudElement.style.pointerEvents = 'none';
            hudElement.style.transform = 'translateX(-50%) translateY(-14px)';
          }
        }, 3200);
      };

      const hideHud = () => {
        clearTimeout(fadeTimer);
        if (hudElement) {
          hudElement.remove();
          hudElement = null;
        }
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!hudElement) return;
        if (e.clientY <= 20) {
          showHud();
        }
      };

      const enableListeners = () => {
        if (!mouseListenerActive) {
          window.addEventListener('mousemove', onMouseMove, { passive: true });
          mouseListenerActive = true;
        }
      };

      const disableListeners = () => {
        if (mouseListenerActive) {
          window.removeEventListener('mousemove', onMouseMove);
          mouseListenerActive = false;
        }
      };

      if (typeof ipcRenderer?.on === 'function') {
        ipcRenderer.on('tab:fullscreen-changed', (_event, data: { isFullScreen: boolean; isHtmlFullscreen?: boolean }) => {
          if (data?.isFullScreen && !data?.isHtmlFullscreen) {
            enableListeners();
            showHud();
          } else {
            disableListeners();
            hideHud();
          }
        });
      }
    };

    setupFullscreenHud();

    (window as unknown as { __extractReaderArticle?: () => ReaderArticle | null }).__extractReaderArticle = extractReaderArticle;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMediaHelper, { once: true });
  } else {
    initMediaHelper();
  }
}
