/** Electron adds the IPC channel to errors; show the application's explanation. */
export function userFacingError(error: unknown, fallback = 'Действие не выполнено. Попробуйте ещё раз.'): string {
  let message = error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  for (let index = 0; index < 3; index++) {
    const cleaned = message.replace(/^Error invoking remote method '[^'\r\n]{1,160}':\s*(?:Error:\s*)?/, '');
    if (cleaned === message) break;
    message = cleaned;
  }
  if (/^(?:EACCES|EPERM):/.test(message)) return 'Нет доступа к файлу. Проверьте разрешения и повторите действие.';
  if (/^ENOENT:/.test(message)) return 'Файл не найден. Проверьте, что он не был перемещён или удалён.';
  return message.trim().slice(0, 1200) || fallback;
}
