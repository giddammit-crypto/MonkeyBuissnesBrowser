import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  X,
  Type,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Clock,
  Globe2,
  Calendar,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import type {
  ReaderArticle,
  ReaderFontFamily,
  ReaderSettings,
  ReaderTheme,
} from "../shared/types";
import "./reader.css";
import { sanitizeReaderHtml } from "./sanitizeReaderHtml";

export interface ReaderViewProps {
  tabId: string;
  url: string;
  title?: string;
  onClose: () => void;
  initialSettings?: ReaderSettings;
}

const defaultSettings: ReaderSettings = {
  theme: "light",
  fontFamily: "sans",
  fontSize: 18,
  lineHeight: 1.72,
  maxWidth: 740,
};

export function ReaderView({
  tabId,
  url,
  title: fallbackTitle,
  onClose,
  initialSettings,
}: ReaderViewProps): React.JSX.Element {
  const [settings, setSettings] = useState<ReaderSettings>(initialSettings || defaultSettings);
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sanitizedContent = useMemo(() => sanitizeReaderHtml(article?.content || "", url), [article?.content, url]);

  // Text to speech state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Sync settings when initialSettings changes
  useEffect(() => {
    if (initialSettings) {
      setSettings(initialSettings);
    }
  }, [initialSettings]);

  // Load article content
  const loadArticle = async () => {
    setLoading(true);
    setError(null);
    try {
      const art = await window.browserApi.getReaderArticle(tabId);
      if (art && art.content) {
        setArticle(art);
      } else {
        setError("Не удалось выделить статью со страницы. Страница может быть пустой или не содержать связного текста.");
      }
    } catch (err) {
      console.error("Failed to load reader article:", err);
      setError("Ошибка при обработке содержимого страницы.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArticle();
  }, [tabId]);

  // Escape key listener to close reader mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle Speech Synthesis
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleToggleSpeech = () => {
    if (!window.speechSynthesis) return;

    if (isSpeaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      return;
    }

    if (isSpeaking && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    // Start new speech
    window.speechSynthesis.cancel();
    const textToSpeak = article?.textContent || article?.title || "";
    if (!textToSpeak.trim()) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = speechRate;
    utterance.lang = article?.lang || "ru-RU";

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
    setIsPaused(false);
  };

  const handleStopSpeech = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  };

  const handleCycleRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const nextIndex = (rates.indexOf(speechRate) + 1) % rates.length;
    const nextRate = rates[nextIndex];
    setSpeechRate(nextRate);
    if (isSpeaking) {
      handleStopSpeech();
    }
  };

  // Update Settings
  const updateSettings = async (patch: Partial<ReaderSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await window.browserApi.updateReaderSettings(patch);
    } catch (err) {
      console.error("Failed to update reader settings:", err);
    }
  };

  const domain = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }, [url]);

  return (
    <div
      className="reader-overlay"
      data-reader-theme={settings.theme}
      data-reader-font={settings.fontFamily}
      style={{
        ["--reader-font-size" as string]: `${settings.fontSize}px`,
        ["--reader-line-height" as string]: `${settings.lineHeight}`,
        ["--reader-max-width" as string]: `${settings.maxWidth}px`,
      }}
      role="region"
      aria-label="Режим чтения статьи"
    >
      {/* Floating Toolbar */}
      <div className="reader-toolbar-wrapper">
        <header className="reader-toolbar" role="toolbar" aria-label="Панель инструментов чтения">
          {/* Font Family selector */}
          <div className="reader-toolbar-group">
            <button
              type="button"
              className={`reader-tool-btn ${settings.fontFamily === "sans" ? "active" : ""}`}
              onClick={() => updateSettings({ fontFamily: "sans" })}
              title="Без засечек (Sans)"
            >
              Sans
            </button>
            <button
              type="button"
              className={`reader-tool-btn ${settings.fontFamily === "serif" ? "active" : ""}`}
              onClick={() => updateSettings({ fontFamily: "serif" })}
              title="С засечками (Книжный)"
            >
              Serif
            </button>
            <button
              type="button"
              className={`reader-tool-btn ${settings.fontFamily === "mono" ? "active" : ""}`}
              onClick={() => updateSettings({ fontFamily: "mono" })}
              title="Моноширинный код (Mono)"
            >
              Mono
            </button>
          </div>

          <div className="reader-toolbar-divider" />

          {/* Font Size */}
          <div className="reader-toolbar-group">
            <button
              type="button"
              className="reader-tool-btn"
              disabled={settings.fontSize <= 13}
              onClick={() => updateSettings({ fontSize: Math.max(13, settings.fontSize - 1) })}
              title="Уменьшить шрифт"
            >
              A-
            </button>
            <span className="reader-font-size-indicator">{settings.fontSize}</span>
            <button
              type="button"
              className="reader-tool-btn"
              disabled={settings.fontSize >= 28}
              onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}
              title="Увеличить шрифт"
            >
              A+
            </button>
          </div>

          <div className="reader-toolbar-divider" />

          {/* Theme Picker */}
          <div className="reader-theme-picker" role="radiogroup" aria-label="Цветовая тема">
            {(["light", "sepia", "dark", "graphite"] as ReaderTheme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`reader-theme-dot ${theme} ${settings.theme === theme ? "selected" : ""}`}
                onClick={() => updateSettings({ theme })}
                title={`Тема: ${
                  theme === "light"
                    ? "Светлая"
                    : theme === "sepia"
                    ? "Сепия"
                    : theme === "dark"
                    ? "Тёмная"
                    : "Графит"
                }`}
                aria-label={`Тема ${theme}`}
                aria-checked={settings.theme === theme}
                role="radio"
              />
            ))}
          </div>

          <div className="reader-toolbar-divider" />

          {/* Speech Text-to-Speech */}
          <div className="reader-toolbar-group">
            <button
              type="button"
              className={`reader-tool-btn reader-speech-btn ${isSpeaking ? "speaking" : ""}`}
              onClick={handleToggleSpeech}
              title={
                !isSpeaking
                  ? "Озвучить статью голосом"
                  : isPaused
                  ? "Возобновить чтение"
                  : "Приостановить чтение"
              }
            >
              {!isSpeaking ? (
                <>
                  <Volume2 size={14} />
                  <span>Озвучить</span>
                </>
              ) : isPaused ? (
                <>
                  <Play size={14} />
                  <span>Продолжить</span>
                </>
              ) : (
                <>
                  <Pause size={14} />
                  <span>Пауза</span>
                </>
              )}
            </button>

            {isSpeaking && (
              <button
                type="button"
                className="reader-tool-btn"
                onClick={handleStopSpeech}
                title="Остановить озвучку"
                aria-label="Стоп"
              >
                <VolumeX size={14} />
              </button>
            )}

            <button
              type="button"
              className="reader-tool-btn reader-speech-speed-btn"
              onClick={handleCycleRate}
              title="Скорость чтения голосом"
            >
              {speechRate}x
            </button>
          </div>

          <div className="reader-toolbar-divider" />

          {/* Close Reader View */}
          <button
            type="button"
            className="reader-tool-btn"
            onClick={onClose}
            title="Выйти из режима чтения · Esc"
            aria-label="Закрыть режим чтения"
          >
            <X size={16} />
          </button>
        </header>
      </div>

      {/* Main Reader Content */}
      <main className="reader-container">
        {loading ? (
          <div className="reader-empty-state">
            <BookOpen size={36} className="reader-empty-icon" />
            <h2 className="reader-empty-title">Подготовка статьи…</h2>
            <p className="reader-empty-desc">
              Извлекаем основной текст, удаляем рекламные баннеры и форматируем страницу для комфортного чтения.
            </p>
          </div>
        ) : error ? (
          <div className="reader-empty-state">
            <AlertCircle size={36} className="reader-empty-icon" />
            <h2 className="reader-empty-title">Не удалось открыть в режиме чтения</h2>
            <p className="reader-empty-desc">{error}</p>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                type="button"
                className="reader-tool-btn active"
                onClick={loadArticle}
              >
                <RotateCcw size={14} style={{ marginRight: "4px" }} />
                Повторить попытку
              </button>
              <button
                type="button"
                className="reader-tool-btn"
                onClick={onClose}
              >
                Вернуться к сайту
              </button>
            </div>
          </div>
        ) : article ? (
          <article>
            <div className="reader-meta-header">
              <div className="reader-meta-row">
                <span className="reader-meta-badge">
                  <Globe2 size={12} />
                  <span>{article.siteName || domain}</span>
                </span>

                {article.readingTimeMinutes && (
                  <>
                    <span className="reader-meta-divider">·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <Clock size={12} />
                      <span>{article.readingTimeMinutes} мин чтения</span>
                    </span>
                  </>
                )}

                {article.publishedTime && (
                  <>
                    <span className="reader-meta-divider">·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <Calendar size={12} />
                      <span>{article.publishedTime}</span>
                    </span>
                  </>
                )}
              </div>

              <h1 className="reader-title">{article.title || fallbackTitle}</h1>

              {article.byline && (
                <div className="reader-byline">Автор: {article.byline}</div>
              )}
            </div>

            <div
              className="reader-body"
              onClick={(event) => {
                const anchor = (event.target as Element).closest('a[href]');
                if (!anchor) return;
                event.preventDefault();
                const href = anchor.getAttribute('href');
                if (href) void window.browserApi.navigate(tabId, href).catch(() => setError("Не удалось открыть ссылку."));
              }}
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />
          </article>
        ) : null}
      </main>
    </div>
  );
}
