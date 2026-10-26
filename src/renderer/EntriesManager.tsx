import React, { useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Globe2,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import type { BookmarkEntry, BrowserSnapshot } from "../shared/types";
import { userFacingError } from "./userFacingError";
import SiteFavicon from "./SiteFavicon";
import "./entries-manager.css";

type BookmarkEditor = { id?: string; title: string; url: string };

export default function EntriesManager({
  kind,
  snapshot,
  onOpen,
}: {
  kind: "bookmarks" | "history";
  snapshot: BrowserSnapshot;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("all");
  const [editor, setEditor] = useState<BookmarkEditor | null>(null);
  const [removed, setRemoved] = useState<BookmarkEntry | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const bookmarks = kind === "bookmarks";
  const entries = bookmarks ? snapshot.bookmarks : snapshot.history;
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const threshold =
    range === "day"
      ? Date.now() - 86400000
      : range === "week"
        ? Date.now() - 7 * 86400000
        : 0;
  const filtered = entries.filter(
    (entry) =>
      `${entry.title} ${entry.url}`
        .toLocaleLowerCase("ru-RU")
        .includes(normalizedQuery) &&
      (!("visitedAt" in entry) || entry.visitedAt >= threshold),
  );
  const openEditor = (value: BookmarkEditor, opener: HTMLButtonElement) => {
    editorOpenerRef.current = opener;
    setEditor(value);
    setError("");
  };
  const closeEditor = () => {
    setEditor(null);
    setError("");
    requestAnimationFrame(() => {
      const opener = editorOpenerRef.current;
      if (opener?.isConnected) opener.focus();
      else addButtonRef.current?.focus();
    });
  };
  const perform = async (action: () => Promise<unknown>, success = "") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      if (success !== "Закладка удалена.") setRemoved(null);
    } catch (cause) {
      setError(userFacingError(cause, "Не удалось выполнить действие."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="utility-panel entries-manager"
      aria-label={bookmarks ? "Менеджер закладок" : "История посещений"}
    >
      <div className="manager-heading">
        <div className="panel-header">
          <span className="panel-header-icon">
            {bookmarks ? <Bookmark size={22} /> : <History size={22} />}
          </span>
          <div>
            <h2>{bookmarks ? "Закладки" : "История"}</h2>
            <p>
              {bookmarks
                ? "Сохранённые страницы под рукой"
                : "Посещения обычного профиля"}
            </p>
          </div>
        </div>
        <button
          ref={bookmarks ? addButtonRef : undefined}
          className="plain-button"
          disabled={busy || (!bookmarks && entries.length === 0)}
          onClick={(event) =>
            bookmarks
              ? openEditor({ title: "", url: "https://" }, event.currentTarget)
              : void perform(() => window.browserApi.clearBrowsingHistory())
          }
        >
          {bookmarks ? <Plus size={17} /> : <Trash2 size={17} />}{" "}
          {bookmarks ? "Добавить закладку" : "Очистить историю"}
        </button>
      </div>
      <div className="manager-filters">
        <label className="panel-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или адрес"
            aria-label={bookmarks ? "Поиск в закладках" : "Поиск в истории"}
          />
          <span>{filtered.length}</span>
        </label>
        {!bookmarks && (
          <select
            aria-label="Период истории"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            <option value="all">Всё время</option>
            <option value="day">За сутки</option>
            <option value="week">За неделю</option>
          </select>
        )}
      </div>
      {editor && (
        <form
          className="bookmark-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) closeEditor();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await window.browserApi.saveBookmark(editor);
              closeEditor();
            }, "Закладка сохранена.");
          }}
        >
          <h3>{editor.id ? "Изменить закладку" : "Новая закладка"}</h3>
          <label>
            Название
            <input
              autoFocus
              value={editor.title}
              maxLength={1000}
              onChange={(event) =>
                setEditor({ ...editor, title: event.target.value })
              }
              placeholder="Название страницы"
            />
          </label>
          <label>
            Адрес
            <input
              type="url"
              required
              value={editor.url}
              maxLength={8192}
              onChange={(event) =>
                setEditor({ ...editor, url: event.target.value })
              }
              placeholder="https://example.com"
              spellCheck={false}
            />
          </label>
          <div className="manager-form-actions">
            <button
              type="button"
              className="plain-button"
              disabled={busy}
              onClick={closeEditor}
            >
              Отмена
            </button>
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="manager-message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="manager-message" role="status">
          {message}
          {removed && (
            <button
              className="plain-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await window.browserApi.saveBookmark({
                    title: removed.title,
                    url: removed.url,
                  });
                  setRemoved(null);
                }, "Закладка восстановлена.")
              }
            >
              <RotateCcw size={15} />
              Вернуть
            </button>
          )}
        </p>
      )}
      {!filtered.length ? (
        <div className="empty-state">
          <div className="empty-icon">
            {bookmarks ? <Bookmark size={28} /> : <History size={28} />}
          </div>
          <h3>
            {normalizedQuery
              ? "Ничего не найдено"
              : bookmarks
                ? "Здесь будут ваши закладки"
                : "Нет посещений за этот период"}
          </h3>
          <p>
            {normalizedQuery
              ? "Попробуйте другой запрос."
              : bookmarks
                ? "Добавьте адрес здесь или нажмите звезду в адресной строке."
                : "Приватные посещения в историю не записываются."}
          </p>
        </div>
      ) : (
        <div className="entry-list">
          {filtered.map((entry) => (
            <article className="managed-entry" key={entry.id}>
              <button
                className="managed-entry-open"
                onClick={() => onOpen(entry.url)}
                title={entry.url}
              >
                <span className="entry-icon">
                  <SiteFavicon url={entry.url} favicon={(entry as any).favicon} size={19} />
                </span>
                <span className="entry-copy">
                  <strong>{entry.title || new URL(entry.url).hostname}</strong>
                  <small>{entry.url}</small>
                </span>
                {"visitedAt" in entry && (
                  <time
                    dateTime={new Date(entry.visitedAt).toISOString()}
                    className="entry-time"
                  >
                    {new Date(entry.visitedAt).toLocaleString("ru-RU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                )}
                <ArrowRight size={16} />
              </button>
              <div className="manager-row-actions">
                {bookmarks && (
                  <button
                    className="icon-button"
                    aria-label={`Изменить закладку ${entry.title}`}
                    title="Изменить"
                    disabled={busy}
                    onClick={(event) =>
                      openEditor(
                        { id: entry.id, title: entry.title, url: entry.url },
                        event.currentTarget,
                      )
                    }
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`${bookmarks ? "Удалить закладку" : "Удалить посещение"} ${entry.title}`}
                  title="Удалить запись"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      async () => {
                        if (bookmarks) {
                          await window.browserApi.removeBookmark(entry.id);
                          setRemoved(entry as BookmarkEntry);
                        } else
                          await window.browserApi.removeHistoryEntry(entry.id);
                      },
                      bookmarks ? "Закладка удалена." : "Посещение удалено.",
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
