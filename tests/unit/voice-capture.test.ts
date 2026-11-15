import { expect, it, vi } from 'vitest';
import { microphoneErrorMessage, releaseVoiceCapture, transcribeVoiceRecording } from '../../src/renderer/voiceCapture';

it('releases an acquired microphone when recorder construction failed', () => {
  const stop = vi.fn();
  releaseVoiceCapture(null, { getTracks: () => [{ stop }] } as unknown as MediaStream);
  expect(stop).toHaveBeenCalledOnce();
});

it('detaches pending recording events and releases every track even if stop fails', () => {
  const stop = vi.fn();
  const recorder = {
    state: 'recording', onstart: vi.fn(), onstop: vi.fn(), onerror: vi.fn(), ondataavailable: vi.fn(),
    stop: vi.fn(() => { throw new Error('device disconnected'); }),
  };
  const stream = { getTracks: () => [{ stop: () => { throw new Error('ended'); } }, { stop }] };
  releaseVoiceCapture(recorder as unknown as MediaRecorder, stream as unknown as MediaStream);
  expect(recorder.stop).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(recorder.onstop).toBeNull();
  expect(recorder.ondataavailable).toBeNull();
  expect(recorder.onerror).toBeNull();
});

it('does not stop an inactive recorder and accepts cleanup without acquired devices', () => {
  const stop = vi.fn();
  releaseVoiceCapture({ state: 'inactive', stop } as unknown as MediaRecorder, null);
  releaseVoiceCapture(null, null);
  expect(stop).not.toHaveBeenCalled();
});

it('distinguishes permission, missing-device, unavailable-device and codec failures', () => {
  expect(microphoneErrorMessage({ name: 'NotAllowedError' })).toContain('запрещён');
  expect(microphoneErrorMessage({ name: 'NotFoundError' })).toContain('не найден');
  expect(microphoneErrorMessage({ name: 'NotReadableError' })).toContain('другие приложения');
  expect(microphoneErrorMessage({ name: 'NotSupportedError' })).toContain('формат');
  expect(microphoneErrorMessage(undefined)).not.toContain('запрещён');
});

it('does not upload audio if cancelled while the recording is being read', async () => {
  let current = true;
  let finish!: (value: string) => void;
  const read = () => new Promise<string>(resolve => { finish = resolve; });
  const transcribe = vi.fn(async () => ({ text: 'cancelled command' }));
  const pending = transcribeVoiceRecording(new Blob(['audio']), () => current, transcribe, read);
  current = false;
  finish('base64-audio');
  expect(await pending).toBeUndefined();
  expect(transcribe).not.toHaveBeenCalled();
});

it('discards a late transcription after cancel or a new recording', async () => {
  let generation = 1;
  let finish!: (value: { text: string }) => void;
  const transcribe = vi.fn(() => new Promise<{ text: string }>(resolve => { finish = resolve; }));
  const pending = transcribeVoiceRecording(new Blob(['audio'], { type: 'audio/webm' }), () => generation === 1, transcribe, async () => 'base64-audio');
  await Promise.resolve();
  expect(transcribe).toHaveBeenCalledWith('base64-audio', 'audio/webm');
  generation++;
  finish({ text: 'old command' });
  expect(await pending).toBeUndefined();
});

it('returns current transcription and propagates reader errors without uploading', async () => {
  const transcribe = vi.fn(async () => ({ text: 'current command' }));
  expect(await transcribeVoiceRecording(new Blob(['audio']), () => true, transcribe, async () => 'encoded')).toEqual({ text: 'current command' });
  transcribe.mockClear();
  await expect(transcribeVoiceRecording(new Blob(['audio']), () => true, transcribe, async () => { throw new Error('read failure'); })).rejects.toThrow('read failure');
  expect(transcribe).not.toHaveBeenCalled();
});
