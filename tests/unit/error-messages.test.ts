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
