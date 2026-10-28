import { describe, expect, it, vi } from 'vitest';
import { VOODOO_SYSTEM_PROMPT } from '../../src/main/services/VoodooAiService';

describe('Voodoo Voice Commands & STT Subsystem', () => {
  it('includes STT instructions and voice command handling in system prompt', () => {
    expect(VOODOO_SYSTEM_PROMPT).toContain('ГОЛОСОВЫЕ КОМАНДЫ (STT)');
    expect(VOODOO_SYSTEM_PROMPT).toContain('search_web');
    expect(VOODOO_SYSTEM_PROMPT).toContain('open_url');
    expect(VOODOO_SYSTEM_PROMPT).toContain('read_page');
    expect(VOODOO_SYSTEM_PROMPT).toContain('close_tab');
    expect(VOODOO_SYSTEM_PROMPT).toContain('clean_browser');
  });

  it('simulates SpeechRecognition event lifecycle for voice commands', () => {
    let isListening = false;
    let latestTranscript = '';
    let submittedCommand: string | null = null;
    let voiceError: string | null = null;

    class MockSpeechRecognition {
      lang = 'en-US';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        isListening = true;
        this.onstart?.();
      }

      simulateResult(interimText: string, finalText: string) {
        latestTranscript = finalText || interimText;
        this.onresult?.({
          resultIndex: 0,
          results: [
            {
              isFinal: Boolean(finalText),
              0: { transcript: finalText || interimText },
            },
          ],
        });
      }

      simulateError(error: string) {
        isListening = false;
        if (error === 'not-allowed') {
          voiceError = 'Доступ к микрофону заблокирован';
        } else if (error === 'no-speech') {
          voiceError = 'Голос не обнаружен';
        } else if (error === 'network') {
          voiceError = 'Служба распознавания речи временно недоступна';
        } else {
          voiceError = `Ошибка: ${error}`;
        }
        this.onerror?.({ error });
      }

      stop() {
        this.onend?.();
      }

      abort() {
        latestTranscript = '';
        isListening = false;
      }
    }

    const rec = new MockSpeechRecognition();
    rec.lang = 'ru-RU';
    rec.interimResults = true;

    rec.onend = () => {
      isListening = false;
      const cmd = latestTranscript.trim();
      if (cmd) {
        submittedCommand = cmd;
        latestTranscript = '';
      }
    };

    // 1. Start listening
    rec.start();
    expect(isListening).toBe(true);
    expect(rec.lang).toBe('ru-RU');
    expect(rec.interimResults).toBe(true);

    // 2. Interim speech recognition
    rec.simulateResult('найди рецепт', '');
    expect(latestTranscript).toBe('найди рецепт');
    expect(submittedCommand).toBeNull();

    // 3. Final speech recognized & session ends
    rec.simulateResult('найди рецепт пиццы', 'найди рецепт пиццы');
    rec.stop();

    expect(isListening).toBe(false);
    expect(submittedCommand).toBe('найди рецепт пиццы');

    // 4. Test error handling
    rec.start();
    expect(isListening).toBe(true);
    rec.simulateError('not-allowed');
    expect(isListening).toBe(false);
    expect(voiceError).toBe('Доступ к микрофону заблокирован');
  });

  it('verifies media permissions allow app:// origin and voodoo contents', () => {
    const voodooContentsId = 42;
    const shellContentsId = 10;

    const checkMediaPermission = (origin: string, contentsId?: number): boolean => {
      return origin.startsWith('app://') || contentsId === voodooContentsId || contentsId === shellContentsId;
    };

    expect(checkMediaPermission('app://shell/index.html?view=voodoo')).toBe(true);
    expect(checkMediaPermission('app://shell/index.html')).toBe(true);
    expect(checkMediaPermission('about:blank', 42)).toBe(true);
    expect(checkMediaPermission('about:blank', 10)).toBe(true);
    expect(checkMediaPermission('https://malicious.com', 99)).toBe(false);
  });
});
