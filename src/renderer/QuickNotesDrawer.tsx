import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  StickyNote,
  Plus,
  Search,
  X,
  Pin,
  Trash2,
  ExternalLink,
  Globe,
  Check,
  Link as LinkIcon,
} from "lucide-react";
import type { NoteColor, NoteEntry, SaveNoteInput, TabSnapshot } from "../shared/types";
import "./quick-notes.css";

// Serialize persistence so a delayed save can never overtake pin or delete.
export class NoteMutationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, () => Promise<unknown>>();
  schedule(id: string, operation: () => Promise<unknown>): void {
    this.pending.set(id, operation);
  }
  cancel(id: string): void { this.pending.delete(id); }
  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  flush(): Promise<unknown> {
    for (const operation of this.pending.values()) void this.enqueue(operation).catch(() => undefined);
    this.pending.clear();
    return this.tail;
  }
}

export interface QuickNotesDrawerProps {
  currentTab?: TabSnapshot | null;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}

const NOTE_COLORS: NoteColor[] = [
  "default",
  "yellow",
  "pink",
  "blue",
  "green",
  "violet",
];

export function QuickNotesDrawer({
  currentTab,
  onClose,
  onOpenUrl,
}: QuickNotesDrawerProps): React.JSX.Element {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "site">("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Active note editor state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState<NoteColor>("default");
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [tabTitle, setTabTitle] = useState<string | undefined>(undefined);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle" | "error">("idle");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queue = useRef(new NoteMutationQueue()).current;
  const selectedRef = useRef<string | null>(null);
  const notesRef = useRef<NoteEntry[]>([]);
  const revisions = useRef(new Map<string, number>());
  const deleted = useRef(new Set<string>());
  const failedSaves = useRef(new Set<string>());
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const updateNotes = (list: NoteEntry[]) => {
    notesRef.current = list;
    if (mounted.current) setNotes(list);
  };
  const flush = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    return queue.flush();
  };

  // Extract current tab host
  const currentTabHost = useMemo(() => {
    if (!currentTab?.url || currentTab.isInternal) return "";
    try {
      return new URL(currentTab.url).hostname;
    } catch {
      return "";
    }
  }, [currentTab]);

  // Load notes
  const loadNotes = async () => {
    try {
      const list = await window.browserApi.getNotes();
      if (!mounted.current) return;
      updateNotes([...notesRef.current, ...list.filter(n => !notesRef.current.some(existing => existing.id === n.id) && !deleted.current.has(n.id))]);
      if (list.length > 0 && !selectedRef.current) {
        selectNote(list[0]);
      }
    } catch (err) {
      console.error("Failed to load notes:", err);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void loadNotes();
    return () => {
      mounted.current = false;
      void flush();
    };
  }, []);

  // Set note in editor
  const selectNote = (candidate: NoteEntry) => {
    void flush();
    if (deleted.current.has(candidate.id)) return;
    const note = notesRef.current.find(entry => entry.id === candidate.id) || candidate;
    selectedRef.current = note.id;
    selectionVersion.current++;
    setSelectedNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setColor(note.color || "default");
    setUrl(note.url);
    setTabTitle(note.tabTitle);
    setSaveStatus("idle");
  };

  // Filter notes
  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      // Search text
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = note.title.toLowerCase().includes(q);
        const matchesContent = note.content.toLowerCase().includes(q);
        const matchesUrl = (note.url || "").toLowerCase().includes(q);
        if (!matchesTitle && !matchesContent && !matchesUrl) return false;
      }

      // Filter site
      if (filter === "site" && currentTabHost) {
        if (!note.url) return false;
        try {
          const noteHost = new URL(note.url).hostname;
          if (noteHost !== currentTabHost) return false;
        } catch {
          return false;
        }
      }

      return true;
    });
  }, [notes, searchQuery, filter, currentTabHost]);

  // Auto-save logic
  const triggerAutoSave = (
    newTitle: string,
    newContent: string,
    newColor: NoteColor,
    newUrl?: string,
    newTabTitle?: string
  ) => {
    const id = selectedRef.current;
    if (!id || deleted.current.has(id)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const revision = (revisions.current.get(id) || 0) + 1;
    revisions.current.set(id, revision);
    // Pin is a separate mutation: including an old pin value here would undo it.
    const input: SaveNoteInput = { id, title: newTitle || "Без названия", content: newContent,
      color: newColor, url: newUrl, tabTitle: newTabTitle };
    updateNotes(notesRef.current.map(note => note.id === id ? { ...note, ...input, id } : note));
    setSaveStatus("saving");
    const save = async () => {
      if (deleted.current.has(id)) return;
      try {
        const saved = await window.browserApi.saveNote(input);
        failedSaves.current.delete(id);
        if (!deleted.current.has(id) && revisions.current.get(id) === revision) {
          updateNotes(notesRef.current.map(note => note.id === id ? saved : note));
          if (mounted.current && selectedRef.current === id) setSaveStatus("saved");
        }
      } catch (err) {
        console.error("Failed to auto-save note:", err);
        if (!deleted.current.has(id) && revisions.current.get(id) === revision) {
          failedSaves.current.add(id);
          queue.schedule(id, save);
          if (mounted.current && selectedRef.current === id) setSaveStatus("error");
        }
        throw err;
      }
    };
    queue.schedule(id, save);
    saveTimerRef.current = setTimeout(() => { void flush(); }, 400);
  };

  // Handle title change
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    triggerAutoSave(newTitle, content, color, url, tabTitle);
  };

  // Handle content change
  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    triggerAutoSave(title, newContent, color, url, tabTitle);
  };

  // Handle color change
  const handleColorChange = (newColor: NoteColor) => {
    setColor(newColor);
    triggerAutoSave(title, content, newColor, url, tabTitle);
  };

  // Create new blank note or from current tab
  const handleCreateNew = async (fromTab = false) => {
    void flush();
    const version = selectionVersion.current;
    try {
      const note = await queue.enqueue(() => fromTab && currentTab && !currentTab.isInternal
        ? window.browserApi.createNoteFromTab(currentTab.id)
        : window.browserApi.saveNote({ title: "Новая заметка", content: "", color: "default",
            url: currentTab && !currentTab.isInternal ? currentTab.url : undefined,
            tabTitle: currentTab && !currentTab.isInternal ? currentTab.title : undefined }));
      updateNotes([note, ...notesRef.current]);
      if (mounted.current && selectionVersion.current === version) selectNote(note);
    } catch (err) { console.error("Failed to create note:", err); }
  };

  const handleTogglePin = async (noteId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    void flush();
    try {
      const updated = await queue.enqueue(() => window.browserApi.togglePinNote(noteId));
      if (updated && !deleted.current.has(noteId)) {
        // Preserve edits made while the pin IPC call was in flight.
        updateNotes(notesRef.current.map(note => note.id === noteId
          ? { ...note, isPinned: updated.isPinned } : note).sort((a, b) =>
          a.isPinned !== b.isPinned ? (a.isPinned ? -1 : 1) : b.updatedAt - a.updatedAt));
      }
    } catch (err) { console.error("Failed to toggle pin:", err); }
  };

  const handleDeleteNote = async (noteId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    deleted.current.add(noteId);
    failedSaves.current.delete(noteId);
    queue.cancel(noteId);
    const remaining = notesRef.current.filter(note => note.id !== noteId);
    updateNotes(remaining);
    if (selectedRef.current === noteId) {
      selectedRef.current = null;
      selectionVersion.current++;
      setSelectedNoteId(null);
      if (remaining.length) selectNote(remaining[0]);
      else { setTitle(""); setContent(""); setUrl(undefined); setTabTitle(undefined); }
    }
    try {
      await queue.enqueue(() => window.browserApi.deleteNote(noteId));
    } catch (err) {
      deleted.current.delete(noteId);
      console.error("Failed to delete note:", err);
      await loadNotes();
    }
  };

  // Attach current tab to active note
  const handleAttachCurrentTab = () => {
    if (!currentTab || currentTab.isInternal) return;
    setUrl(currentTab.url);
    setTabTitle(currentTab.title);
    triggerAutoSave(title, content, color, currentTab.url, currentTab.title);
  };

  // Format date
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { day: "numeric", month: "short" });
  };

  return (
    <aside className="notes-drawer" role="complementary" aria-label="Быстрые заметки">
      {/* Header */}
      <div className="notes-header">
        <div className="notes-header-left">
          <StickyNote size={17} className="qr-icon-accent" />
          <h2 className="notes-header-title">Быстрые заметки</h2>
          <span className="notes-count-badge">{notes.length}</span>
        </div>

        <div className="notes-header-actions">
          <button
            type="button"
            className="notes-btn-new"
            onClick={() => void handleCreateNew(false)}
            title="Создать новую заметку"
          >
            <Plus size={14} />
            <span>Заметка</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => { void flush().then(() => { if (!failedSaves.current.size) onClose(); }); }}
            title="Закрыть заметки"
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="notes-search-section">
        <div className="notes-search-wrapper">
          <Search size={14} className="notes-search-icon" />
          <input
            type="text"
            className="notes-search-input"
            placeholder="Поиск в заметках…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="notes-search-clear"
              onClick={() => setSearchQuery("")}
              title="Очистить поиск"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="notes-filter-pills">
          <button
            type="button"
            className={`notes-filter-pill ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Все ({notes.length})
          </button>
          {currentTabHost && (
            <button
              type="button"
              className={`notes-filter-pill ${filter === "site" ? "active" : ""}`}
              onClick={() => setFilter("site")}
              title={`Заметки по ${currentTabHost}`}
            >
              Сайт: {currentTabHost}
            </button>
          )}
        </div>
      </div>

      {/* Notes List */}
      <div className="notes-list">
        {filteredNotes.length === 0 ? (
          <div className="notes-empty">
            <StickyNote size={32} className="notes-empty-icon" />
            <p className="notes-empty-text">
              {searchQuery
                ? "Ничего не найдено по запросу"
                : filter === "site"
                ? `Нет заметок для ${currentTabHost}`
                : "Заметок пока нет. Нажмите «+ Заметка», чтобы сохранить важную мысль или сниппет."}
            </p>
          </div>
        ) : (
          filteredNotes.map((note) => {
            const isSelected = note.id === selectedNoteId;
            let noteDomain = "";
            if (note.url) {
              try {
                noteDomain = new URL(note.url).hostname;
              } catch {}
            }

            return (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                className={`note-card color-${note.color} ${isSelected ? "active" : ""}`}
                onClick={() => selectNote(note)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") selectNote(note);
                }}
              >
                <div className="note-card-top">
                  <div className="note-card-title">{note.title || "Без названия"}</div>
                  <button
                    type="button"
                    className={`note-card-pin-btn ${note.isPinned ? "pinned" : ""}`}
                    onClick={(e) => void handleTogglePin(note.id, e)}
                    title={note.isPinned ? "Открепить" : "Закрепить вверху"}
                  >
                    <Pin size={12} />
                  </button>
                </div>

                <div className="note-card-snippet">
                  {note.content || "Пустая заметка…"}
                </div>

                <div className="note-card-footer">
                  {noteDomain ? (
                    <span
                      role="link"
                      tabIndex={0}
                      className="note-card-url"
                      title={note.url}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (note.url) onOpenUrl(note.url);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && note.url) {
                          e.stopPropagation();
                          onOpenUrl(note.url);
                        }
                      }}
                    >
                      <Globe size={11} />
                      <span>{noteDomain}</span>
                      <ExternalLink size={9} />
                    </span>
                  ) : (
                    <span>{formatTime(note.updatedAt)}</span>
                  )}

                  {noteDomain && <span>{formatTime(note.updatedAt)}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Note Editor Pane */}
      {selectedNoteId && (
        <div className="note-editor-pane">
          <div className="note-editor-top">
            <input
              type="text"
              className="note-input-title"
              placeholder="Заголовок заметки…"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />

            {/* Color picker */}
            <div className="note-editor-colors" role="radiogroup" aria-label="Цвет заметки">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`note-color-dot ${c} ${color === c ? "selected" : ""}`}
                  onClick={() => handleColorChange(c)}
                  title={`Цвет: ${c}`}
                  aria-label={`Цвет ${c}`}
                  role="radio"
                  aria-checked={color === c}
                />
              ))}
            </div>
          </div>

          <textarea
            className="note-textarea-content"
            placeholder="Текст заметки, сниппет кода или список задач…"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
          />

          <div className="note-editor-bottom">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {url ? (
                <span
                  role="link"
                  tabIndex={0}
                  className="note-card-url"
                  title={`Привязана страница: ${url}`}
                  onClick={() => onOpenUrl(url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpenUrl(url);
                  }}
                >
                  <LinkIcon size={12} />
                  <span>{tabTitle || url}</span>
                </span>
              ) : currentTab && !currentTab.isInternal ? (
                <button
                  type="button"
                  className="note-attach-tab-btn"
                  onClick={handleAttachCurrentTab}
                  title="Привязать адрес текущей вкладки к этой заметке"
                >
                  <LinkIcon size={11} />
                  <span>Привязать страницу</span>
                </button>
              ) : null}

              {saveStatus === "saving" && <span>Сохранение…</span>}
              {saveStatus === "error" && <span role="alert">Не удалось сохранить. Повторите изменение.</span>}
              {saveStatus === "saved" && (
                <span style={{ color: "var(--cyber-green)", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                  <Check size={12} />
                  <span>Сохранено</span>
                </span>
              )}
            </div>

            <button
              type="button"
              className="note-delete-btn"
              onClick={() => void handleDeleteNote(selectedNoteId)}
              title="Удалить заметку"
            >
              <Trash2 size={12} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
