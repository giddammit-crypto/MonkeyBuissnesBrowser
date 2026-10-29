import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  ImageOff,
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

  // Lightbox state for enlarged image view
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string; caption?: string } | null>(null);

  // Body container ref
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Text to speech state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechElementsRef = useRef<HTMLElement[]>([]);
  const currentSpeechIndexRef = useRef<number>(0);
  const isSpeakingRef = useRef(false);
  const isPausedRef = useRef(false);

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

  // Escape key listener: close lightbox if open, otherwise close reader mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxImage) {
          e.stopPropagation();
          setLightboxImage(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage, onClose]);

  // Helper to remove all speech highlights
  const clearSpeechHighlights = useCallback(() => {
    if (bodyRef.current) {
      bodyRef.current.querySelectorAll('.reader-speech-active').forEach((el) => {
        el.classList.remove('reader-speech-active');
      });
    }
  }, []);

  const handleStopSpeech = useCallback(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    clearSpeechHighlights();
    currentSpeechIndexRef.current = 0;
    setIsSpeaking(false);
    setIsPaused(false);
    isSpeakingRef.current = false;
    isPausedRef.current = false;
  }, [clearSpeechHighlights]);

  // Handle Speech Synthesis cleanup on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      clearSpeechHighlights();
    };
  }, [clearSpeechHighlights]);

  // Speak a specific element in the article queue
  const speakElement = useCallback((index: number, rate = speechRate) => {
    if (!window.speechSynthesis) return;
    clearSpeechHighlights();

    const elements = speechElementsRef.current;
    if (index >= elements.length) {
      handleStopSpeech();
      return;
    }

    currentSpeechIndexRef.current = index;
    const el = elements[index];
    el.classList.add('reader-speech-active');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const text = el.textContent?.trim() || '';
    if (!text) {
      speakElement(index + 1, rate);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.lang = article?.lang || "ru-RU";

    utterance.onboundary = () => {
      if (!el.classList.contains('reader-speech-active')) {
        el.classList.add('reader-speech-active');
      }
    };

    utterance.onend = () => {
      el.classList.remove('reader-speech-active');
      if (isSpeakingRef.current && !isPausedRef.current) {
        speakElement(index + 1, rate);
      }
    };

    utterance.onerror = () => {
      el.classList.remove('reader-speech-active');
      handleStopSpeech();
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [article?.lang, speechRate, clearSpeechHighlights, handleStopSpeech]);

  const handleToggleSpeech = () => {
    if (!window.speechSynthesis) return;

    if (isSpeaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      isPausedRef.current = true;
      return;
    }

    if (isSpeaking && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      isPausedRef.current = false;
      return;
    }

    // Start fresh speech
    window.speechSynthesis.cancel();
    clearSpeechHighlights();

    const els = Array.from(
      bodyRef.current?.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, blockquote, li') || []
    ).filter((el) => (el.textContent || '').trim().length > 0);

    if (els.length > 0) {
      speechElementsRef.current = els;
      setIsSpeaking(true);
      setIsPaused(false);
      isSpeakingRef.current = true;
      isPausedRef.current = false;
      speakElement(0, speechRate);
    } else {
      const textToSpeak = article?.textContent || article?.title || "";
      if (!textToSpeak.trim()) return;

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = speechRate;
      utterance.lang = article?.lang || "ru-RU";
      utterance.onend = () => handleStopSpeech();
      utterance.onerror = () => handleStopSpeech();
      speechUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
      setIsPaused(false);
      isSpeakingRef.current = true;
      isPausedRef.current = false;
    }
  };

  const handleCycleRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const nextIndex = (rates.indexOf(speechRate) + 1) % rates.length;
    const nextRate = rates[nextIndex];
    setSpeechRate(nextRate);
    if (isSpeaking) {
      const curIndex = currentSpeechIndexRef.current;
      handleStopSpeech();
      setTimeout(() => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        speakElement(curIndex, nextRate);
      }, 50);
    }
  };

  // Image error handling: replace broken images with a neat fallback card
  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;

    const handleImageError = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) {
        if (target.classList.contains("reader-img-error")) return;
        target.classList.add("reader-img-error");

        const fallback = document.createElement("div");
        fallback.className = "reader-img-fallback";
        fallback.setAttribute("role", "note");
        fallback.setAttribute("aria-label", "Изображение недоступно");

        const iconContainer = document.createElement("div");
        iconContainer.className = "reader-img-fallback-icon";
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><line x1="13.5" y1="13.5" x2="6" y2="21"/><line x1="18" y1="12" x2="21" y2="15"/><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.05-.22 1.41-.59"/><path d="M21 15V5a2 2 0 0 0-2-2H9"/></svg>`;

        const textContainer = document.createElement("div");
        textContainer.className = "reader-img-fallback-text";
        textContainer.textContent = target.alt || target.title || "Изображение недоступно";

        fallback.appendChild(iconContainer);
        fallback.appendChild(textContainer);

        target.style.display = "none";
        target.parentNode?.insertBefore(fallback, target);
      }
    };

    container.addEventListener("error", handleImageError, true);
    return () => {
      container.removeEventListener("error", handleImageError, true);
    };
  }, [sanitizedContent]);

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
              ref={bodyRef}
              className="reader-body"
              onClick={(event) => {
                const target = event.target as HTMLElement;
                const img = target.closest('img');
                if (img && img.src && !img.classList.contains('reader-img-error')) {
                  event.preventDefault();
                  const figure = img.closest('figure');
                  const caption = figure?.querySelector('figcaption')?.textContent?.trim() || img.alt || undefined;
                  const anchor = target.closest('a[href]');
                  const anchorHref = anchor?.getAttribute('href');
                  const isImageLink = Boolean(anchorHref && /\.(jpe?g|png|webp|gif|svg|avif)(\?.*)?$/i.test(anchorHref));
                  setLightboxImage({
                    src: isImageLink && anchorHref ? anchorHref : (img.currentSrc || img.src),
                    alt: img.alt || undefined,
                    caption,
                  });
                  return;
                }

                const anchor = target.closest('a[href]');
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

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="reader-lightbox-backdrop"
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
        >
          <div
            className="reader-lightbox-container"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="reader-lightbox-close"
              onClick={() => setLightboxImage(null)}
              title="Закрыть · Esc"
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt || ""}
              className="reader-lightbox-img"
            />
            {(lightboxImage.caption || lightboxImage.alt) && (
              <div className="reader-lightbox-caption">
                {lightboxImage.caption || lightboxImage.alt}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
