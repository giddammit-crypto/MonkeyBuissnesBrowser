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

function readRecording(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Audio read failed'));
    reader.onabort = () => reject(new Error('Audio read cancelled'));
    reader.readAsDataURL(blob);
  });
}

/** Cancellation prevents upload before it starts and discards an in-flight result. */
export async function transcribeVoiceRecording<T>(
  blob: Blob,
  current: () => boolean,
  transcribe: (base64: string, mimeType: string) => Promise<T>,
  read: (blob: Blob) => Promise<string> = readRecording,
): Promise<T | undefined> {
  if (!current()) return undefined;
  const base64 = await read(blob);
  if (!current()) return undefined;
  const result = await transcribe(base64, blob.type);
  return current() ? result : undefined;
}
