import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Copy,
  Check,
  CornerDownLeft,
  X,
  Minus,
  EyeOff,
  Sparkles,
  MessageSquare,
  FileText,
  RotateCcw,
  Move,
  Globe,
  Layers,
  Search,
  MousePointer,
  Edit3,
  ArrowDown,
  Code,
  Mic,
  MicOff,
  Square,
  AlertCircle,
  MapPin,
  Compass,
  CloudSun,
  Navigation,
  FilePlus,
  ListChecks,
} from 'lucide-react';
import type { TabSnapshot, VoodooChatMessage } from '../shared/types';
import MarkdownView from './MarkdownView';
import voodooAvatar from './assets/voodoo-256.png';
import './voodoo-chat.css';

function getActionToolIcon(tool: string): React.JSX.Element {
  switch (tool) {
    case 'search_web':
      return <Search size={12} className="voodoo-action-type-icon" />;
    case 'open_url':
      return <Globe size={12} className="voodoo-action-type-icon" />;
    case 'list_tabs':
    case 'switch_tab':
      return <Layers size={12} className="voodoo-action-type-icon" />;
    case 'close_tab':
      return <X size={12} className="voodoo-action-type-icon" />;
    case 'read_page':
      return <FileText size={12} className="voodoo-action-type-icon" />;
    case 'get_page_elements':
      return <Search size={12} className="voodoo-action-type-icon" />;
    case 'click_element':
      return <MousePointer size={12} className="voodoo-action-type-icon" />;
    case 'fill_input':
      return <Edit3 size={12} className="voodoo-action-type-icon" />;
    case 'scroll_page':
      return <ArrowDown size={12} className="voodoo-action-type-icon" />;
    case 'execute_script':
      return <Code size={12} className="voodoo-action-type-icon" />;
    case 'get_active_dialog':
      return <MessageSquare size={12} className="voodoo-action-type-icon" />;
    case 'clean_browser':
      return <Sparkles size={12} className="voodoo-action-type-icon" />;
    case 'create_file':
      return <FilePlus size={12} className="voodoo-action-type-icon" />;
    case 'create_note_or_list':
      return <ListChecks size={12} className="voodoo-action-type-icon" />;
    case 'analyze_page_data':
      return <Search size={12} className="voodoo-action-type-icon" />;
    case 'geo_lookup':
      return <Compass size={12} className="voodoo-action-type-icon" />;
    case 'search_places':
      return <MapPin size={12} className="voodoo-action-type-icon" />;
    case 'get_weather_and_time':
      return <CloudSun size={12} className="voodoo-action-type-icon" />;
    case 'get_route_info':
      return <Navigation size={12} className="voodoo-action-type-icon" />;
    default:
      return <Sparkles size={12} className="voodoo-action-type-icon" />;
  }
}

interface VoodooChatBubbleProps {
  isOpen?: boolean;
  onToggleOpen?: () => void;
  onClose?: () => void;
  bubbleVisible?: boolean;
  onHideBubble?: () => void;
  currentTab?: TabSnapshot;
  standalone?: boolean;
}

const INITIAL_MESSAGE: VoodooChatMessage = {
  id: 'voodoo-welcome',
  role: 'assistant',
  content: `Привет! Я **Вуду** 🧵✨\n\nЯ твой автономный AI-ассистент и агент браузера soulm8te. Я умею искать в интернете, открывать и переключать любые сайты, читать страницы, кликать по кнопкам и формам, а также анализировать диалоги в соцсетях.\n\n*Нажми быстрые действия ниже или напиши мне, что сделать!*`,
  timestamp: Date.now(),
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function playVoiceChime(type: 'start' | 'stop' | 'cancel') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === 'start') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'stop') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.14);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    }
    // Close AudioContext after oscillator finishes to prevent resource leak
    osc.onended = () => { void ctx.close(); };
  } catch {
    // Graceful fallback if audio is not permitted yet
  }
}

export default function VoodooChatBubble({
  isOpen: propsIsOpen,
  onToggleOpen: propsOnToggleOpen,
  onClose: propsOnClose,
  bubbleVisible = true,
  onHideBubble: propsOnHideBubble,
  currentTab,
  standalone = false,
}: VoodooChatBubbleProps): React.JSX.Element {
  const [isOpenState, setIsOpenState] = useState(false);
  const isOpen = standalone ? isOpenState : (propsIsOpen ?? isOpenState);

  const [messages, setMessages] = useState<VoodooChatMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem('voodoo_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [INITIAL_MESSAGE];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [agentProgress, setAgentProgress] = useState('');
  const [modelLabel, setModelLabel] = useState('ИИ агент');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [insertedKey, setInsertedKey] = useState<string | null>(null);

  // Voice Command (STT) state
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const latestTranscriptRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Dragging state
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);

  // Resize state
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 395, h: 555 });

  const toggleOpen = useCallback(async () => {
    const next = !isOpen;
    if (standalone) {
      setIsOpenState(next);
      await window.browserApi.setVoodooOpen(next);
    } else {
      propsOnToggleOpen?.();
    }
  }, [isOpen, standalone, propsOnToggleOpen]);

  const closeWindow = useCallback(async () => {
    if (standalone) {
      setIsOpenState(false);
      await window.browserApi.setVoodooOpen(false);
    } else {
      propsOnClose?.();
    }
  }, [standalone, propsOnClose]);

  const hideBubble = useCallback(async () => {
    await window.browserApi.updateSettings({ voodooBubbleVisible: false });
    if (standalone) {
      setIsOpenState(false);
      await window.browserApi.setVoodooOpen(false);
    } else {
      propsOnHideBubble?.();
    }
  }, [standalone, propsOnHideBubble]);

  const scrollToBottom = useCallback(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  }, []);

  // Focus only when opening; incoming progress must not steal keyboard focus.
  useEffect(() => {
    if (!isOpen) return;
    followMessagesRef.current = true;
    scrollToBottom();
    const timer = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (isOpen && followMessagesRef.current) scrollToBottom();
  }, [isOpen, messages, loading, agentProgress, scrollToBottom]);

  useEffect(() => {
    let active = true;
    void window.browserApi.getSnapshot().then((snapshot) => {
      if (active) setModelLabel(snapshot.settings.voodooModel || 'ИИ агент');
    }).catch(() => {});
    const unsubscribe = window.browserApi.onSnapshotChanged((snapshot) => {
      setModelLabel(snapshot.settings.voodooModel || 'ИИ агент');
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  // Persist history to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('voodoo_chat_history', JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [messages]);

  const handleCopyMessage = useCallback(async (text: string, id: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // Fallback to execCommand if clipboard API fails
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedMessageId(id);
        setTimeout(() => setCopiedMessageId(null), 2000);
      } catch (e2) {
        console.warn('Failed to copy message:', e2);
      }
    }
  }, []);

  const handleStopRequest = useCallback(async () => {
    const controller = abortControllerRef.current;
    if (!controller || stopping) return;
    setStopping(true);
    setAgentProgress('Останавливаю дальнейшие действия…');
    try {
      await window.browserApi.cancelVoodooRequest();
      if (abortControllerRef.current !== controller) return;
      controller.abort();
      setMessages((prev) => [
        ...prev,
        {
          id: generateId('voodoo-stopped'),
          role: 'assistant',
          content: 'Запрос остановлен. Уже начатое действие могло завершиться; проверь результат перед повторным запуском.',
          timestamp: Date.now(),
        },
      ]);
    } catch {
      setAgentProgress('Не удалось остановить запрос. Попробуй ещё раз.');
    } finally {
      setStopping(false);
    }
  }, [stopping]);

  const handleSendMessage = useCallback(async (
    textToSend?: string,
    contextOverride?: { url?: string; title?: string; chatText?: string }
  ) => {
    const prompt = (textToSend || input).trim();
    if (!prompt || loading || abortControllerRef.current) return;
    followMessagesRef.current = true;

    const userMessage: VoodooChatMessage = {
      id: generateId('user'),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      analyzedContext: contextOverride?.chatText
        ? (contextOverride.chatText.length > 60 ? `${contextOverride.chatText.slice(0, 60)}…` : contextOverride.chatText)
        : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!textToSend) setInput('');
    setLoading(true);
    setAgentProgress('Планирую шаги и выбираю инструменты…');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const tabContext = contextOverride || (currentTab ? {
        url: currentTab.url,
        title: currentTab.title,
      } : undefined);

      const requestPromise = window.browserApi.sendVoodooMessage([...messages, userMessage], tabContext);
      const abortPromise = new Promise<never>((_, reject) => {
        abortController.signal.addEventListener('abort', () => reject(new Error('REQUEST_ABORTED')));
      });

      const response = await Promise.race([requestPromise, abortPromise]);

      if (abortController.signal.aborted || abortControllerRef.current !== abortController) return;
      const assistantMessage: VoodooChatMessage = {
        id: generateId('voodoo'),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        suggestedReplies: response.suggestedReplies,
        executedActions: response.executedActions,
        error: response.error,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      if (err?.message === 'REQUEST_ABORTED') {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : 'Ошибка при обращении к Вуду';
      setMessages((prev) => [
        ...prev,
        {
          id: generateId('voodoo-err'),
          role: 'assistant',
          content: `Не удалось завершить запрос: ${errorMsg}. Подробности ниже. Если часть действий уже выполнена, проверь результат перед повтором.`,
          timestamp: Date.now(),
          error: errorMsg,
        },
      ]);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        setLoading(false);
        setAgentProgress('');
      }
    }
  }, [input, loading, messages, currentTab]);

  const handleAnalyzeCustomText = useCallback(async (text: string) => {
    const prompt = `Проанализируй выделенный текст и предложи варианты ответа:\n«${text}»`;
    await handleSendMessage(prompt, {
      url: currentTab?.url,
      title: currentTab?.title,
      chatText: text,
    });
  }, [currentTab, handleSendMessage]);

  // Listen to IPC events from main process (context menu "Анализировать с ВуДу", hotkey, etc.)
  useEffect(() => {
    const removeListener = window.browserApi?.onTabEvent?.((event) => {
      if (event.type === 'voodoo-agent-progress' && abortControllerRef.current) {
        setAgentProgress(event.message || 'Выполняю следующий шаг…');
      } else if (event.type === 'voodoo-analyze-text' && event.message) {
        if (!isOpen) {
          if (standalone) {
            setIsOpenState(true);
            void window.browserApi.setVoodooOpen(true);
          } else {
            propsOnToggleOpen?.();
          }
        }
        void handleAnalyzeCustomText(event.message);
      } else if (event.type === 'voodoo-set-open') {
        const shouldOpen = event.message === 'true';
        if (standalone) {
          setIsOpenState(shouldOpen);
        }
      } else if (event.type === 'toggle-voodoo') {
        void toggleOpen();
      }
    });

    return () => {
      removeListener?.();
    };
  }, [isOpen, standalone, propsOnToggleOpen, handleAnalyzeCustomText, toggleOpen]);

  const handleAnalyzeActiveChat = async () => {
    if (loading) return;
    try {
      const chatCtx = await window.browserApi.extractActiveTabChatContext();
      if (!chatCtx || !chatCtx.text || chatCtx.text.trim().length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId('voodoo-notice'),
            role: 'assistant',
            content: `Не удалось обнаружить открытый диалог на этой вкладке. Перейди в нужный чат ВКонтакте (vk.com/im), Telegram Web или выдели текст на странице и выбери в контекстном меню «Анализировать с ВуДу».`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      const prompt = `Проанализируй активный диалог из последних сообщений выше и подскажи, что мне ответить. Предложи 3-4 готовых варианта ответа в разных тональностях.`;
      await handleSendMessage(prompt, {
        url: currentTab?.url,
        title: currentTab?.title,
        chatText: chatCtx.text,
      });
    } catch (e) {
      console.warn('Failed to analyze active chat:', e);
    }
  };

  const handleAnalyzePageSummary = async () => {
    if (loading) return;
    try {
      const chatCtx = await window.browserApi.extractActiveTabChatContext();
      const prompt = `Кратко расскажи, о чём эта страница («${currentTab?.title || 'текущая страница'}») и выдели 3 ключевых мысли.`;
      await handleSendMessage(prompt, {
        url: currentTab?.url,
        title: currentTab?.title,
        chatText: chatCtx?.text,
      });
    } catch (e) {
      console.warn('Failed to analyze page summary:', e);
    }
  };

  const handleCopyReply = async (text: string, key: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleInsertReply = async (text: string, key: string) => {
    const success = await window.browserApi.insertTextIntoActiveTab(text);
    if (success) {
      setInsertedKey(key);
      setTimeout(() => setInsertedKey(null), 2500);
    } else {
      handleCopyReply(text, key);
    }
  };

  const handleClearHistory = () => {
    if (abortControllerRef.current) return;
    setMessages([INITIAL_MESSAGE]);
    try { sessionStorage.removeItem('voodoo_chat_history'); } catch {}
  };

  const cancelListening = useCallback(() => {
    latestTranscriptRef.current = '';
    setInterimTranscript('');
    setIsTranscribing(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    setIsListening(false);
    playVoiceChime('cancel');
  }, []);

  const startMediaRecorderFallback = useCallback(async () => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mr = new MediaRecorder(stream, { mimeType });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mr.onstart = () => {
        setIsListening(true);
        setInterimTranscript('Запись голоса... Говорите (нажмите на микрофон для отправки)');
        playVoiceChime('start');
      };

      mr.onerror = (e) => {
        console.warn('MediaRecorder voice capture error:', e);
        setIsListening(false);
        playVoiceChime('cancel');
      };

      mediaRecorderRef.current = mr;
      mr.start(200);
    } catch (err) {
      console.error('Failed to start MediaRecorder audio capture:', err);
      setIsListening(false);
      setVoiceError('Доступ к микрофону заблокирован');
      setTimeout(() => setVoiceError(null), 4000);
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      const mr = mediaRecorderRef.current;
      mediaRecorderRef.current = null;

      mr.onstop = async () => {
        setIsListening(false);
        playVoiceChime('stop');

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        audioChunksRef.current = [];

        if (audioBlob.size < 500) {
          setInterimTranscript('');
          return;
        }

        setIsTranscribing(true);
        setInterimTranscript('Расшифровка голоса...');

        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const dataUrl = reader.result as string;
              const base64 = dataUrl.split(',')[1] || '';
              const res = await window.browserApi.transcribeAudio(base64, audioBlob.type);

              if (res.success && res.text) {
                void handleSendMessage(res.text);
              } else if (res.error === 'NO_STT_KEY') {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: generateId('voodoo-stt-guide'),
                    role: 'assistant',
                    content: `🎙️ **Голос записан!**\n\nВ среде Electron на Linux встроенное облако Google Speech отключено Chromium. Чтобы расшифровывать голос в текст через Whisper AI:\n• Укажите бесплатный ключ **Groq** (\`gsk_...\`) в Настройках браузера (раздел «AI-Ассистент Вуду»).\n\n*Или выберите готовую команду из вариантов ниже:*`,
                    suggestedReplies: [
                      'Подбери мне 5 вариантов шапки зимней мужской на вайлдберис, создай html фаил с твоим подбором, описанием, фото и активными ссылками-кнопками на эти товары. И открой этот фаил в новой вкладке',
                      'Какая погода в моём городе?',
                      'Найди последние новости технологий',
                      'Сохрани план задач на день в Заметки',
                      'Проанализируй открытую страницу',
                    ],
                    timestamp: Date.now(),
                  },
                ]);
              } else {
                setVoiceError(res.error || 'Не удалось распознать речь');
                setTimeout(() => setVoiceError(null), 4000);
              }
            } catch (err) {
              console.error('Audio transcription error:', err);
              setVoiceError('Ошибка при обработке голоса');
              setTimeout(() => setVoiceError(null), 4000);
            } finally {
              setIsTranscribing(false);
              setInterimTranscript('');
            }
          };
        } catch (e) {
          setIsTranscribing(false);
          setInterimTranscript('');
          console.error('Audio reader initialization error:', e);
        }
      };

      try {
        mr.stop();
      } catch {}
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    const command = latestTranscriptRef.current.trim();
    if (command) {
      playVoiceChime('stop');
      void handleSendMessage(command);
      latestTranscriptRef.current = '';
      setInterimTranscript('');
    }
  }, [handleSendMessage]);

  const startListening = useCallback(() => {
    const SpeechRecognitionConstructor = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition
      || (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRecognitionConstructor) {
      void startMediaRecorderFallback();
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognitionConstructor();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      latestTranscriptRef.current = '';
      setInterimTranscript('');
      setVoiceError(null);

      recognition.onstart = () => {
        setIsListening(true);
        playVoiceChime('start');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            final += item[0]?.transcript || '';
          } else {
            interim += item[0]?.transcript || '';
          }
        }

        const currentText = (final || interim).trim();
        if (currentText) {
          latestTranscriptRef.current = currentText;
          setInterimTranscript(currentText);
          setInput(currentText);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Voodoo voice recognition error:', event?.error);
        if (event?.error === 'network') {
          // Chromium lacks Google Cloud Speech keys in Electron; seamlessly fallback to MediaRecorder audio capture!
          try {
            recognition.abort();
          } catch {}
          recognitionRef.current = null;
          void startMediaRecorderFallback();
          return;
        }

        setIsListening(false);
        playVoiceChime('cancel');
        if (event?.error === 'not-allowed') {
          setVoiceError('Доступ к микрофону заблокирован');
        } else if (event?.error === 'no-speech') {
          setVoiceError('Голос не обнаружен');
        } else if (event?.error !== 'aborted') {
          setVoiceError(`Ошибка распознавания: ${event?.error || 'сбой'}`);
        }
        setTimeout(() => setVoiceError(null), 4000);
      };

      recognition.onend = () => {
        // If MediaRecorder took over, do not finalize here
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          return;
        }
        setIsListening(false);
        const command = latestTranscriptRef.current.trim();
        if (command) {
          playVoiceChime('stop');
          void handleSendMessage(command);
          latestTranscriptRef.current = '';
          setInterimTranscript('');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('SpeechRecognition failed to start, falling back to MediaRecorder:', err);
      void startMediaRecorderFallback();
    }
  }, [handleSendMessage, startMediaRecorderFallback]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
        mediaRecorderRef.current = null;
      }
      if (mediaStreamRef.current) {
        try {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        } catch {}
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isListening) {
        cancelListening();
      } else {
        void closeWindow();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isListening) {
        stopListening();
      } else {
        void handleSendMessage();
      }
    }
  };

  // Dragging support (Header / Bubble)
  const onMouseDownHeader = (e: React.MouseEvent) => {
    // Only drag on left mouse button and not on buttons
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    dragStartRef.current = { x: e.screenX, y: e.screenY };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvent.screenX - dragStartRef.current.x;
      const dy = moveEvent.screenY - dragStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMovedRef.current = true;
        dragStartRef.current = { x: moveEvent.screenX, y: moveEvent.screenY };
        void window.browserApi.moveVoodoo(dx, dy);
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Bubble dragging & click
  const onMouseDownBubble = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    dragStartRef.current = { x: e.screenX, y: e.screenY };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvent.screenX - dragStartRef.current.x;
      const dy = moveEvent.screenY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true;
        dragStartRef.current = { x: moveEvent.screenX, y: moveEvent.screenY };
        void window.browserApi.moveVoodoo(dx, dy);
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!hasMovedRef.current) {
        void toggleOpen();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Universal Resizing Support (4 corners + 4 edges)
  const onMouseDownResize = (direction: 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isResizingRef.current = true;

    let currentW = window.innerWidth;
    let currentH = window.innerHeight;
    let lastScreenX = e.screenX;
    let lastScreenY = e.screenY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const stepX = moveEvent.screenX - lastScreenX;
      const stepY = moveEvent.screenY - lastScreenY;
      if (stepX === 0 && stepY === 0) return;
      lastScreenX = moveEvent.screenX;
      lastScreenY = moveEvent.screenY;

      let targetW = currentW;
      let targetH = currentH;
      let deltaX = 0;
      let deltaY = 0;

      // Horizontal resize
      if (direction.includes('e')) {
        targetW = Math.max(320, currentW + stepX);
      } else if (direction.includes('w')) {
        const clampedW = Math.max(320, currentW - stepX);
        const appliedDeltaW = clampedW - currentW;
        targetW = clampedW;
        deltaX = -appliedDeltaW;
      }

      // Vertical resize
      if (direction.includes('s')) {
        targetH = Math.max(380, currentH + stepY);
      } else if (direction.includes('n')) {
        const clampedH = Math.max(380, currentH - stepY);
        const appliedDeltaH = clampedH - currentH;
        targetH = clampedH;
        deltaY = -appliedDeltaH;
      }

      currentW = targetW;
      currentH = targetH;
      void window.browserApi.resizeVoodoo(targetW, targetH, deltaX, deltaY);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <>
      {/* Floating Circle Bubble in Bottom-Right (Draggable) */}
      {!isOpen && bubbleVisible && (
        <button
          className="voodoo-floating-bubble"
          title="Вуду AI · Зажмите для перетаскивания / Кликните для открытия (Ctrl+Shift+V)"
          aria-label="Вуду AI"
          onMouseDown={onMouseDownBubble}
          onClick={(event) => { if (event.detail === 0) void toggleOpen(); }}
        >
          <img src={voodooAvatar} alt="Вуду AI" className="voodoo-bubble-avatar" />
          <span className="voodoo-bubble-status-badge" />
          <span className="voodoo-bubble-pulse-ring" />
        </button>
      )}

      {/* Mini-Chat Window (Draggable & Resizable) */}
      {isOpen && (
        <div className="voodoo-chat-window" role="dialog" aria-label="Вуду AI чат">
          {/* Resize Edges (4 sides) */}
          <div
            className="voodoo-resize-edge top"
            title="Изменить размер по вертикали"
            onMouseDown={onMouseDownResize('n')}
          />
          <div
            className="voodoo-resize-edge bottom"
            title="Изменить размер по вертикали"
            onMouseDown={onMouseDownResize('s')}
          />
          <div
            className="voodoo-resize-edge left"
            title="Изменить размер по горизонтали"
            onMouseDown={onMouseDownResize('w')}
          />
          <div
            className="voodoo-resize-edge right"
            title="Изменить размер по горизонтали"
            onMouseDown={onMouseDownResize('e')}
          />

          {/* Resize Handles (4 corners) */}
          <div
            className="voodoo-resize-handle top-left"
            title="Изменить размер окна"
            onMouseDown={onMouseDownResize('nw')}
          />
          <div
            className="voodoo-resize-handle top-right"
            title="Изменить размер окна"
            onMouseDown={onMouseDownResize('ne')}
          />
          <div
            className="voodoo-resize-handle bottom-left"
            title="Изменить размер окна"
            onMouseDown={onMouseDownResize('sw')}
          />
          <div
            className="voodoo-resize-handle bottom-right"
            title="Изменить размер окна"
            onMouseDown={onMouseDownResize('se')}
          />

          {/* Header (Draggable) */}
          <div className="voodoo-chat-header" onMouseDown={onMouseDownHeader}>
            <div className="voodoo-header-profile">
              <div className="voodoo-header-avatar-wrap">
                <img src={voodooAvatar} alt="Вуду" className="voodoo-header-avatar" />
              </div>
              <div className="voodoo-header-info">
                <div className="voodoo-header-title">
                  <span>Вуду AI</span>
                  <span className="voodoo-model-badge" title={modelLabel}>{modelLabel}</span>
                </div>
                <div className="voodoo-header-status">
                  <span className="voodoo-status-dot" />
                  <span>{loading ? 'Выполняю запрос' : 'Готов к запросу'}</span>
                </div>
              </div>
            </div>

            <div className="voodoo-header-actions">
              <button
                className="voodoo-header-btn"
                title="Сбросить позицию в правый нижний угол"
                aria-label="Сбросить позицию окна Вуду"
                onClick={() => void window.browserApi.resetVoodooPosition()}
              >
                <Move size={14} />
              </button>
              <button
                className="voodoo-header-btn"
                title="Свернуть в кружок"
                aria-label="Свернуть чат Вуду"
                onClick={() => void closeWindow()}
              >
                <Minus size={14} />
              </button>
              <button
                className="voodoo-header-btn"
                title="Закрыть (свернуть в кружок)"
                aria-label="Закрыть чат Вуду"
                onClick={() => void closeWindow()}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Quick Action Pills */}
          <div className="voodoo-quick-actions">
            <button
              className="voodoo-pill primary"
              onClick={() => {
                if (input.trim()) {
                  void handleSendMessage(`Найди в интернете: ${input.trim()}`);
                } else {
                  void handleSendMessage('Найди в интернете актуальные главные новости за сегодня');
                }
              }}
              disabled={loading}
              title="Поиск через автономного агента браузера"
            >
              <Globe size={12} />
              <span>🌐 Поиск</span>
            </button>
            <button
              className="voodoo-pill"
              onClick={handleAnalyzePageSummary}
              disabled={loading}
              title="Прочитать открытую страницу и выделить суть"
            >
              <FileText size={12} />
              <span>📄 Прочитать страницу</span>
            </button>
            <button
              className="voodoo-pill"
              onClick={() => void handleSendMessage('Покажи список всех моих открытых вкладок')}
              disabled={loading}
              title="Показать все открытые вкладки браузера"
            >
              <Layers size={12} />
              <span>📑 Мои вкладки</span>
            </button>
            <button
              className="voodoo-pill"
              onClick={handleAnalyzeActiveChat}
              disabled={loading}
              title="Прочитать последние сообщения активного диалога и предложить варианты ответа"
            >
              <MessageSquare size={12} />
              <span>🔍 Анализ диалога</span>
            </button>
            <button
              className={`voodoo-pill ${isListening ? 'listening primary' : ''}`}
              onClick={isListening ? stopListening : startListening}
              disabled={loading}
              title={isListening ? "Остановить запись и отправить команду" : "Активировать голосовую команду (STT)"}
            >
              {isListening ? <Square size={12} className="voodoo-mic-active-pulse" /> : <Mic size={12} />}
              <span>{isListening ? 'Слушаю...' : '🎙️ Голос'}</span>
            </button>
            <button
              className="voodoo-pill"
              onClick={handleClearHistory}
              disabled={loading}
              title="Очистить историю диалога с Вуду"
            >
              <RotateCcw size={12} />
              <span>Очистить</span>
            </button>
          </div>

          {/* Scrollable Messages Container with Markdown */}
          <div className="voodoo-messages-container" role="log" aria-label="История диалога с Вуду" aria-live="polite" aria-relevant="additions"
            onScroll={(event) => {
              const element = event.currentTarget;
              followMessagesRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
          >
            {messages.map((msg, msgIndex) => {
              const timeString = new Date(msg.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div key={msg.id} className={`voodoo-message-item ${msg.role}`}>
                  {msg.analyzedContext && (
                    <span className="voodoo-context-badge" title={msg.analyzedContext}>
                      <MessageSquare size={10} />
                      <span>{msg.analyzedContext}</span>
                    </span>
                  )}

                  <div className="voodoo-message-bubble">
                    {msg.executedActions && msg.executedActions.length > 0 && (
                      <div className="voodoo-agent-actions">
                        <div className="voodoo-agent-actions-title">
                          <Sparkles size={11} />
                          <span>Действия агента: {msg.executedActions.length}</span>
                        </div>
                        <div className="voodoo-action-pills-list">
                          {msg.executedActions.map((action, aIdx) => {
                            const isSuccess = !action.error;
                            return (
                              <div
                                key={aIdx}
                                className={`voodoo-action-pill ${isSuccess ? 'success' : 'error'}`}
                                title={action.error ? `Ошибка: ${action.error}` : JSON.stringify(action.args, null, 2)}
                              >
                                <span className="voodoo-action-status-icon">
                                  {isSuccess ? <Check size={9} /> : <X size={9} />}
                                </span>
                                {getActionToolIcon(action.tool)}
                                <span className="voodoo-action-summary">
                                  <span className="voodoo-action-step">Шаг {aIdx + 1}. {isSuccess ? 'Выполнено' : 'Ошибка'}: </span>
                                  {action.summary}
                                  {action.error && <span className="voodoo-action-error">{action.error}</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {msg.role === 'assistant' ? (
                      <MarkdownView content={msg.content} />
                    ) : (
                      msg.content
                    )}

                    {msg.error && (
                      <div className="voodoo-request-error" role="status">
                        <AlertCircle size={14} aria-hidden="true" />
                        <span>{msg.error}</span>
                      </div>
                    )}

                    {/* Suggested reply action cards */}
                    {msg.suggestedReplies && msg.suggestedReplies.length > 0 && (
                      <div className="voodoo-replies-list">
                        {msg.suggestedReplies.map((reply, rIdx) => {
                          const replyKey = `${msgIndex}-${rIdx}`;
                          const isCopied = copiedKey === replyKey;
                          const isInserted = insertedKey === replyKey;

                          return (
                            <div key={replyKey} className="voodoo-reply-card">
                              <span className="voodoo-reply-text">{reply}</span>
                              <div className="voodoo-reply-actions">
                                <button
                                  className={`voodoo-action-btn ${isCopied ? 'copied' : ''}`}
                                  onClick={() => handleCopyReply(reply, replyKey)}
                                  title="Скопировать ответ в буфер обмена"
                                >
                                  {isCopied ? <Check size={11} /> : <Copy size={11} />}
                                  <span>{isCopied ? 'Скопировано' : 'Копировать'}</span>
                                </button>
                                <button
                                  className={`voodoo-action-btn insert-btn ${isInserted ? 'copied' : ''}`}
                                  onClick={() => handleInsertReply(reply, replyKey)}
                                  title="Вставить ответ прямо в поле ввода текущего чата"
                                >
                                  {isInserted ? <Check size={11} /> : <CornerDownLeft size={11} />}
                                  <span>{isInserted ? 'Вставлено!' : 'Вставить в чат'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="voodoo-message-footer">
                    <span className="voodoo-message-time">{timeString}</span>
                    <button
                      type="button"
                      className={`voodoo-message-copy-btn ${copiedMessageId === msg.id ? 'copied' : ''}`}
                      onClick={() => handleCopyMessage(msg.content, msg.id)}
                      title="Скопировать текст сообщения"
                    >
                      {copiedMessageId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedMessageId === msg.id ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="voodoo-typing-indicator" role="status" aria-atomic="true">
                <span className="voodoo-dot" />
                <span className="voodoo-dot" />
                <span className="voodoo-dot" />
                <span>{agentProgress || 'Выполняю запрос…'}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice Status Indicator (STT) */}
          {(isListening || isTranscribing) && (
            <div className="voodoo-voice-status-bar">
              <div className="voodoo-voice-indicator">
                <span className={`voodoo-voice-dot ${isTranscribing ? 'transcribing' : ''}`} />
                <div className="voodoo-voice-waves">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="voodoo-voice-text" title={interimTranscript}>
                {isTranscribing ? (
                  <span className="voodoo-voice-preview">🎙️ Расшифровка голоса (Whisper AI)...</span>
                ) : interimTranscript ? (
                  <span className="voodoo-voice-preview">«{interimTranscript}»</span>
                ) : (
                  <span className="voodoo-voice-prompt">Слушаю... Скажите голосовую команду</span>
                )}
              </div>
              <button
                type="button"
                className="voodoo-voice-cancel-btn"
                onClick={cancelListening}
                title="Отменить голосовой ввод (Esc)"
                aria-label="Отменить голосовой ввод"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {voiceError && (
            <div className="voodoo-voice-error-bar" role="alert">
              <AlertCircle size={12} />
              <span>{voiceError}</span>
            </div>
          )}

          {/* Input Footer */}
          <div className="voodoo-input-container">
            <div className="voodoo-textarea-wrap">
              <textarea
                ref={textareaRef}
                className="voodoo-textarea"
                rows={2}
                aria-label="Запрос для Вуду"
                placeholder={isListening ? "Слушаю ваш голос..." : "Спроси Вуду или скажи команду..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
            </div>
            {loading ? (
              <button
                type="button"
                className="voodoo-stop-btn"
                onClick={() => void handleStopRequest()}
                disabled={stopping}
                title="Остановить запрос и дальнейшие действия агента"
              >
                <Square size={13} fill="currentColor" />
                <span>{stopping ? 'Останавливаю…' : 'Остановить'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`voodoo-mic-btn ${(isListening || isTranscribing) ? 'listening' : ''}`}
                  onClick={isListening ? stopListening : startListening}
                  disabled={loading || isTranscribing}
                  title={isListening ? "Остановить запись и отправить команду" : "Голосовая команда STT (нажмите и говорите)"}
                  aria-label={isListening ? "Отправить голосовую команду" : "Записать голосовую команду"}
                  aria-pressed={isListening}
                >
                  {isListening ? (
                    <Square size={13} className="voodoo-mic-stop-icon" />
                  ) : (
                    <Mic size={14} />
                  )}
                  {(isListening || isTranscribing) && <span className="voodoo-mic-ping-ring" />}
                </button>
                <button
                  type="button"
                  className="voodoo-send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={!input.trim() || loading}
                  title="Отправить (Enter)"
                  aria-label="Отправить запрос Вуду"
                >
                  <Send size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
