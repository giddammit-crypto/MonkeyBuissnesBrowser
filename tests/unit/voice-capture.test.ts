import { expect, it, vi } from 'vitest';
import { microphoneErrorMessage, releaseVoiceCapture } from '../../src/renderer/voiceCapture';

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
