/** Release devices even when recorder construction/start or an individual track fails. */
export function releaseVoiceCapture(recorder: MediaRecorder | null, stream: MediaStream | null): void {
  if (recorder) {
    recorder.onstart = null;
    recorder.onstop = null;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Still release hardware. */ }
  }
  for (const track of stream?.getTracks() ?? []) {
    try { track.stop(); } catch { /* Release the remaining tracks too. */ }
  }
}

export function microphoneErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Доступ к микрофону запрещён. Проверьте разрешения браузера и системы.';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'Микрофон не найден. Подключите его и проверьте настройки звука.';
    case 'NotReadableError': case 'TrackStartError':
      return 'Не удалось открыть микрофон. Проверьте устройство и другие приложения.';
    case 'NotSupportedError':
      return 'Этот формат записи звука не поддерживается.';
    default:
      return 'Не удалось начать запись с микрофона. Проверьте настройки звука.';
  }
}
