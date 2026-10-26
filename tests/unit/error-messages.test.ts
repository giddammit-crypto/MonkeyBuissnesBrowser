import { expect, it } from 'vitest';
import { userFacingError } from '../../src/renderer/userFacingError';

it('shows bookmark validation without the Electron transport prefix', () => {
  expect(userFacingError(new Error("Error invoking remote method 'browser:save-bookmark': Error: Закладка должна содержать HTTP(S)-адрес."))).toBe('Закладка должна содержать HTTP(S)-адрес.');
  expect(userFacingError(new Error('Этот адрес уже есть в закладках.'))).toBe('Этот адрес уже есть в закладках.');
});

it('uses useful file errors without exposing filesystem paths and handles missing messages', () => {
  expect(userFacingError(new Error("Error invoking remote method 'browser:save-bookmark': Error: EACCES: permission denied, open '/private/fixture'"))).not.toContain('/private/fixture');
  expect(userFacingError(null)).toBe('Действие не выполнено. Попробуйте ещё раз.');
});

it('formats user-friendly error details for unavailable sites and network failures', async () => {
  const { getErrorDetails } = await import('../../src/renderer/SiteErrorPage');

  const baseTab: import('../../src/shared/types').TabSnapshot = {
    id: 'tab-1',
    url: 'https://nonexistent.domain.test',
    title: 'Loading',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isMuted: false,
    isPinned: false,
    isPrivate: false,
    isInternal: false,
    workspaceId: 'personal',
    lifecycle: 'crashed',
  };

  const dnsError = getErrorDetails({
    ...baseTab,
    lastError: { errorCode: -105, errorDescription: 'net::ERR_NAME_NOT_RESOLVED' },
  });
  expect(dnsError.title).toBe('Не удалось найти IP-адрес сервера');
  expect(dnsError.code).toBe('ERR_NAME_NOT_RESOLVED');

  const connectionRefused = getErrorDetails({
    ...baseTab,
    lastError: { errorCode: -102, errorDescription: 'net::ERR_CONNECTION_REFUSED' },
  });
  expect(connectionRefused.title).toBe('Сервер отклонил подключение');
  expect(connectionRefused.code).toBe('ERR_CONNECTION_REFUSED');

  const internetDisconnected = getErrorDetails({
    ...baseTab,
    lastError: { errorCode: -106, errorDescription: 'net::ERR_INTERNET_DISCONNECTED' },
  });
  expect(internetDisconnected.title).toBe('Отсутствует подключение к сети');
  expect(internetDisconnected.code).toBe('ERR_INTERNET_DISCONNECTED');

  const fallback = getErrorDetails(baseTab);
  expect(fallback.title).toBe('Страница временно недоступна');
});
