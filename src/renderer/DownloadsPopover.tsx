import React, { useRef, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  File,
  Film,
  FolderOpen,
  Image,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { BrowserSnapshot, DownloadEntry } from "../shared/types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

export function DownloadsPopover({
  snapshot,
  onClose,
  onOpenAllDownloads,
}: {
  snapshot: BrowserSnapshot;
  onClose: () => void;
  onOpenAllDownloads: () => void;
}): React.JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null);
  const downloads = snapshot.downloads || [];

  const activeDownloads = downloads.filter(
    (d) => d.state === "progressing" || d.state === "queued" || d.isPaused,
  );
  const recentDownloads = downloads.filter(
    (d) => d.state !== "progressing" && d.state !== "queued" && !d.isPaused,
  ).slice(0, 8);

  // Click-outside and Escape handlers
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest(".download-header-btn")) {
          onClose();
        }
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const activeTab = snapshot.tabs.find((t) => t.id === snapshot.activeTabId);
  const canDownloadMedia = Boolean(activeTab?.canDownloadMedia && activeTab.url && activeTab.url.startsWith("http"));

  return (
    <div
      ref={popoverRef}
      className="toolbar-popover downloads-popover"
      role="dialog"
      aria-label="Загрузки Google Chrome стиль"
    >
      <div className="downloads-popover-header">
        <div className="downloads-popover-title">
          <Download size={18} className="downloads-popover-icon" />
          <span>Загрузки</span>
          {activeDownloads.length > 0 && (
            <span className="downloads-active-badge">
              {activeDownloads.length}
            </span>
          )}
        </div>
        <div className="downloads-popover-actions">
          <button
            type="button"
            className="downloads-link-btn"
            title="Открыть все загрузки (Ctrl+J)"
            onClick={onOpenAllDownloads}
          >
            Все загрузки
          </button>
          <button
            type="button"
            className="icon-button close-popover-btn"
            title="Закрыть"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {canDownloadMedia && (
        <div className="downloads-media-banner">
          <div className="downloads-media-info">
            <Film size={15} className="downloads-media-icon" />
            <span>Медиа на странице</span>
          </div>
          <div className="downloads-media-buttons">
            <button
              type="button"
              className="downloads-media-action-btn mp4"
              title="Скачать видео (MP4)"
              onClick={() => {
                if (activeTab?.url) {
                  void window.browserApi.downloadMediaUrl(activeTab.url, activeTab.title, false);
                }
              }}
            >
              <Download size={13} />
              <span>MP4</span>
            </button>
            <button
              type="button"
              className="downloads-media-action-btn mp3"
              title="Скачать аудио (MP3)"
              onClick={() => {
                if (activeTab?.url) {
                  void window.browserApi.downloadMediaUrl(activeTab.url, activeTab.title, true);
                }
              }}
            >
              <Music2 size={13} />
              <span>MP3</span>
            </button>
          </div>
        </div>
      )}

      <div className="downloads-popover-scroll">
        {/* Active downloads */}
        {activeDownloads.length > 0 && (
          <div className="downloads-popover-section">
            <div className="downloads-section-heading">Текущие загрузки</div>
            {activeDownloads.map((item) => {
              const percent =
                item.totalBytes > 0
                  ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
                  : null;
              const isPaused = item.isPaused || item.state === "queued";
              return (
                <div key={item.id} className="downloads-popover-item is-active-download">
                  <div className="downloads-item-preview">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" />
                    ) : item.kind === "video" ? (
                      <Film size={20} />
                    ) : item.kind === "audio" ? (
                      <Music2 size={20} />
                    ) : item.kind === "image" ? (
                      <Image size={20} />
                    ) : (
                      <File size={20} />
                    )}
                  </div>
                  <div className="downloads-item-info">
                    <strong className="downloads-item-name" title={item.filename}>
                      {item.filename}
                    </strong>
                    <div className="downloads-item-meta">
                      <span>{isPaused ? "На паузе" : percent !== null ? `${percent}%` : "Загрузка…"}</span>
                      <span>
                        {item.totalBytes > 0
                          ? `${formatBytes(item.receivedBytes)} из ${formatBytes(item.totalBytes)}`
                          : formatBytes(item.receivedBytes)}
                      </span>
                    </div>
                    <div className="downloads-item-progress">
                      <span style={{ width: `${percent ?? 15}%` }} />
                    </div>
                  </div>
                  <div className="downloads-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title={isPaused ? "Продолжить" : "Пауза"}
                      onClick={() =>
                        void window.browserApi.controlDownload(
                          item.id,
                          isPaused ? "resume" : "pause",
                        )
                      }
                    >
                      {isPaused ? <Play size={15} /> : <Pause size={15} />}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Отменить"
                      onClick={() => void window.browserApi.controlDownload(item.id, "cancel")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recent downloads */}
        {recentDownloads.length > 0 ? (
          <div className="downloads-popover-section">
            <div className="downloads-section-heading">Недавние</div>
            {recentDownloads.map((item) => {
              const isCompleted = item.state === "completed" && Boolean(item.path);
              const isError = item.state === "cancelled" || item.state === "interrupted" || Boolean(item.error);

              return (
                <div
                  key={item.id}
                  className={`downloads-popover-item ${isCompleted ? "is-draggable" : ""} ${isError ? "is-error" : ""}`}
                  draggable={isCompleted}
                  title={
                    isCompleted
                      ? "Кликните, чтобы открыть файл · Перетащите в поле ввода на любом сайте"
                      : isError
                        ? item.error || "Ошибка загрузки"
                        : item.filename
                  }
                  onDragStart={(e) => {
                    if (!isCompleted) return;
                    e.preventDefault();
                    window.browserApi.startDownloadDrag(item.id);
                    setTimeout(() => {
                      onClose();
                    }, 100);
                  }}
                  onClick={() => {
                    if (isCompleted) {
                      void window.browserApi.openDownload(item.id);
                    }
                  }}
                >
                  <div className="downloads-item-preview">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" />
                    ) : item.kind === "video" ? (
                      <Film size={20} />
                    ) : item.kind === "audio" ? (
                      <Music2 size={20} />
                    ) : item.kind === "image" ? (
                      <Image size={20} />
                    ) : isError ? (
                      <AlertCircle size={20} className="downloads-error-icon" />
                    ) : (
                      <File size={20} />
                    )}
                  </div>

                  <div className="downloads-item-info">
                    <strong className="downloads-item-name" title={item.filename}>
                      {item.filename}
                    </strong>
                    <div className="downloads-item-meta">
                      <span>
                        {isCompleted
                          ? formatBytes(Math.max(item.totalBytes || 0, item.receivedBytes || 0))
                          : isError
                            ? "Ошибка"
                            : item.state}
                      </span>
                      {item.finishedAt ? <span>{formatTime(item.finishedAt)}</span> : null}
                      {isCompleted && (
                        <span className="downloads-drag-hint">
                          ✥ Перетащите на сайт
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    className="downloads-item-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Retry / Re-download button for each downloaded or errored file */}
                    <button
                      type="button"
                      className="icon-button"
                      title="Повторить загрузку"
                      onClick={() => void window.browserApi.retryDownload(item.id)}
                    >
                      <RotateCcw size={15} />
                    </button>

                    {isCompleted && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          title="Показать в папке"
                          onClick={() => void window.browserApi.showDownloadInFolder(item.id)}
                        >
                          <FolderOpen size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="Открыть файл"
                          onClick={() => void window.browserApi.openDownload(item.id)}
                        >
                          <ExternalLink size={15} />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      className="icon-button"
                      title="Удалить из списка"
                      onClick={() => void window.browserApi.deleteDownload(item.id, false)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeDownloads.length === 0 ? (
          <div className="downloads-empty-state">
            <div className="downloads-empty-icon">
              <Download size={32} />
            </div>
            <p className="downloads-empty-title">Нет недавних загрузок</p>
            <p className="downloads-empty-desc">
              Файлы, которые вы скачиваете, появятся здесь. Их можно будет перетащить на любой сайт или открыть в один клик.
            </p>
          </div>
        ) : null}
      </div>

      <div className="downloads-popover-footer">
        <button
          type="button"
          className="downloads-footer-btn"
          onClick={onOpenAllDownloads}
        >
          <FolderOpen size={14} />
          <span>Все загрузки (Ctrl+J)</span>
        </button>
        {downloads.some((d) => d.state === "completed") && (
          <button
            type="button"
            className="downloads-footer-link"
            onClick={() => void window.browserApi.clearFinishedDownloads(false)}
          >
            Очистить список
          </button>
        )}
      </div>
    </div>
  );
}

export default DownloadsPopover;
