import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  Globe,
  Layout,
  Monitor,
  Search,
  Terminal,
  Wrench,
  X,
  XOctagon,
} from "lucide-react";
import type {
  TaskManagerProcess,
  TaskManagerProcessType,
  TaskManagerSnapshot,
} from "../shared/types";
import SiteFavicon from "./SiteFavicon";

export interface TaskManagerModalProps {
  onDismiss: () => void;
  onError?: (error: unknown) => void;
}

type SortField = "name" | "pid" | "cpu" | "memory" | "type";
type SortDirection = "asc" | "desc";

function getProcessTypeLabel(type: TaskManagerProcessType): string {
  switch (type) {
    case "browser":
      return "Браузер";
    case "gpu":
      return "GPU";
    case "tab":
      return "Вкладка";
    case "shell":
      return "Интерфейс";
    case "utility":
      return "Служба";
    case "zygote":
      return "Zygote";
    default:
      return "Процесс";
  }
}

function renderProcessIcon(proc: TaskManagerProcess) {
  if (proc.type === "tab") {
    if (proc.favicon || proc.url) {
      return (
        <SiteFavicon
          url={proc.url || ""}
          favicon={proc.favicon}
          size={16}
          className="task-favicon"
        />
      );
    }
    return <Globe size={14} className="task-system-glyph" />;
  }
  if (proc.type === "browser") {
    return <Monitor size={14} className="task-system-glyph" />;
  }
  if (proc.type === "gpu") {
    return <Cpu size={14} className="task-system-glyph" />;
  }
  if (proc.type === "shell") {
    return <Layout size={14} className="task-system-glyph" />;
  }
  if (proc.type === "utility") {
    return <Wrench size={14} className="task-system-glyph" />;
  }
  return <Terminal size={14} className="task-system-glyph" />;
}

export const TaskManagerModal: React.FC<TaskManagerModalProps> = ({
  onDismiss,
  onError,
}) => {
  const [metrics, setMetrics] = useState<TaskManagerSnapshot | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("type");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [isTerminating, setIsTerminating] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Metrics polling: initial load and interval every 1000ms
  useEffect(() => {
    let isMounted = true;
    const fetchMetrics = async () => {
      try {
        const snapshot = await window.browserApi.getTaskManagerMetrics();
        if (isMounted) {
          setMetrics(snapshot);
        }
      } catch (err) {
        if (isMounted) {
          onError?.(err);
        }
      }
    };

    void fetchMetrics();
    const interval = setInterval(fetchMetrics, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [onError]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Filter & sort processes
  const filteredProcesses = useMemo(() => {
    if (!metrics?.processes) return [];
    const query = searchQuery.trim().toLowerCase();
    let list = metrics.processes;
    if (query) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          (p.url && p.url.toLowerCase().includes(query)) ||
          p.pid.toString().includes(query) ||
          p.type.toLowerCase().includes(query) ||
          getProcessTypeLabel(p.type).toLowerCase().includes(query)
      );
    }

    return [...list].sort((a, b) => {
      let diff = 0;
      if (sortField === "name") {
        diff = a.title.localeCompare(b.title, "ru-RU");
      } else if (sortField === "pid") {
        diff = a.pid - b.pid;
      } else if (sortField === "cpu") {
        diff = a.cpuPercent - b.cpuPercent;
      } else if (sortField === "memory") {
        diff = a.memoryWorkingSetMB - b.memoryWorkingSetMB;
      } else if (sortField === "type") {
        diff = a.type.localeCompare(b.type);
      }
      return sortDir === "asc" ? diff : -diff;
    });
  }, [metrics?.processes, searchQuery, sortField, sortDir]);

  // Auto-select first process if none selected or if selected was removed
  useEffect(() => {
    if (filteredProcesses.length > 0) {
      if (
        selectedPid === null ||
        !filteredProcesses.some((p) => p.pid === selectedPid)
      ) {
        setSelectedPid(filteredProcesses[0].pid);
      }
    } else {
      setSelectedPid(null);
    }
  }, [filteredProcesses, selectedPid]);

  // Scroll selected row into view
  useEffect(() => {
    if (selectedPid !== null) {
      const row = rowRefs.current.get(selectedPid);
      row?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedPid]);

  // Keyboard navigation & global modal shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (filteredProcesses.length === 0) return;
        event.preventDefault();
        const currentIdx = filteredProcesses.findIndex(
          (p) => p.pid === selectedPid
        );
        let nextIdx = 0;
        if (event.key === "ArrowDown") {
          nextIdx =
            currentIdx >= 0 && currentIdx < filteredProcesses.length - 1
              ? currentIdx + 1
              : 0;
        } else {
          nextIdx =
            currentIdx > 0
              ? currentIdx - 1
              : filteredProcesses.length - 1;
        }
        setSelectedPid(filteredProcesses[nextIdx].pid);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredProcesses, selectedPid, onDismiss]);

  const selectedProcess = useMemo(
    () => filteredProcesses.find((p) => p.pid === selectedPid) ?? null,
    [filteredProcesses, selectedPid]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "cpu" || field === "memory" ? "desc" : "asc");
    }
  };

  const handleKillProcess = async () => {
    if (!selectedProcess || !selectedProcess.isKillable || isTerminating) return;
    setIsTerminating(true);
    try {
      await window.browserApi.killProcess(selectedProcess.pid);
      const snapshot = await window.browserApi.getTaskManagerMetrics();
      setMetrics(snapshot);
    } catch (err) {
      onError?.(err);
    } finally {
      setIsTerminating(false);
    }
  };

  // Stats calculations
  const totalMemMB = useMemo(
    () =>
      filteredProcesses.reduce(
        (sum, p) => sum + (p.memoryWorkingSetMB || 0),
        0
      ),
    [filteredProcesses]
  );

  const avgCpu = useMemo(
    () =>
      filteredProcesses.length > 0
        ? filteredProcesses.reduce((sum, p) => sum + (p.cpuPercent || 0), 0) /
          filteredProcesses.length
        : 0,
    [filteredProcesses]
  );

  const totalMemDisplay =
    totalMemMB >= 1024
      ? `${(totalMemMB / 1024).toFixed(2)} ГБ`
      : `${totalMemMB.toFixed(0)} МБ`;

  return (
    <div
      className="task-manager-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className="task-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Диспетчер задач"
      >
        {/* Header */}
        <header className="task-manager-header">
          <div className="task-manager-header-left">
            <div className="task-manager-icon-pulse">
              <Activity size={17} />
            </div>
            <div className="task-manager-title-group">
              <h2 className="task-manager-title">Диспетчер задач</h2>
              <span className="task-manager-engine-badge">Chromium Engine</span>
            </div>
          </div>
          <div className="task-manager-header-actions">
            <button
              type="button"
              className="task-manager-close-btn"
              onClick={onDismiss}
              title="Закрыть (Esc)"
              aria-label="Закрыть диспетчер задач"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        {/* Toolbar */}
        <div className="task-manager-toolbar">
          <div className="task-manager-search-wrap task-manager-search-box">
            <Search className="task-manager-search-icon" size={15} />
            <input
              ref={searchInputRef}
              type="text"
              className="task-manager-search-input"
              placeholder="Поиск процесса или вкладки..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Поиск процессов"
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                className="task-manager-search-clear"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                title="Очистить поиск"
                aria-label="Очистить поиск"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="task-manager-stats">
            <div className="task-stat-card">
              <span className="task-stat-label">Всего процессов</span>
              <span className="task-stat-value">{filteredProcesses.length}</span>
            </div>
            <div className="task-stat-card">
              <span className="task-stat-label">Суммарная память</span>
              <span className="task-stat-value">{totalMemDisplay}</span>
            </div>
            <div className="task-stat-card">
              <span className="task-stat-label">Средняя нагрузка CPU</span>
              <span className="task-stat-value">{avgCpu.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Table container */}
        <div className="task-manager-table-wrapper" ref={tableWrapperRef}>
          <table className="task-manager-table">
            <thead>
              <tr>
                <th
                  className={`col-task th-sortable ${sortField === "name" ? "th-sorted" : ""}`}
                  onClick={() => handleSort("name")}
                >
                  <div className="th-content">
                    <span>Задача</span>
                    {sortField === "name" && (
                      <span
                        className={`sort-indicator ${sortDir === "desc" ? "desc" : ""}`}
                      >
                        ▲
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className={`col-pid th-sortable ${sortField === "pid" ? "th-sorted" : ""}`}
                  onClick={() => handleSort("pid")}
                >
                  <div className="th-content">
                    <span>PID</span>
                    {sortField === "pid" && (
                      <span
                        className={`sort-indicator ${sortDir === "desc" ? "desc" : ""}`}
                      >
                        ▲
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className={`col-cpu th-sortable ${sortField === "cpu" ? "th-sorted" : ""}`}
                  onClick={() => handleSort("cpu")}
                >
                  <div className="th-content">
                    <span>ЦП</span>
                    {sortField === "cpu" && (
                      <span
                        className={`sort-indicator ${sortDir === "desc" ? "desc" : ""}`}
                      >
                        ▲
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className={`col-memory th-sortable ${sortField === "memory" ? "th-sorted" : ""}`}
                  onClick={() => handleSort("memory")}
                >
                  <div className="th-content">
                    <span>Память</span>
                    {sortField === "memory" && (
                      <span
                        className={`sort-indicator ${sortDir === "desc" ? "desc" : ""}`}
                      >
                        ▲
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className={`col-type th-sortable ${sortField === "type" ? "th-sorted" : ""}`}
                  onClick={() => handleSort("type")}
                >
                  <div className="th-content">
                    <span>Тип</span>
                    {sortField === "type" && (
                      <span
                        className={`sort-indicator ${sortDir === "desc" ? "desc" : ""}`}
                      >
                        ▲
                      </span>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="task-manager-empty">
                      <Activity size={36} />
                      <span className="task-manager-empty-text">
                        {searchQuery
                          ? "Нет процессов, соответствующих запросу"
                          : "Процессы не найдены"}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProcesses.map((proc) => {
                  const isSelected = proc.pid === selectedPid;
                  const isHeavy = proc.memoryWorkingSetMB > 1024;
                  const cpuClass =
                    proc.cpuPercent > 80
                      ? "cpu-danger"
                      : proc.cpuPercent > 50
                        ? "cpu-warning"
                        : "cpu-normal";

                  return (
                    <tr
                      key={proc.pid}
                      ref={(el) => {
                        if (el) {
                          rowRefs.current.set(proc.pid, el);
                        } else {
                          rowRefs.current.delete(proc.pid);
                        }
                      }}
                      className={`task-manager-row ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedPid(proc.pid)}
                    >
                      <td className="col-task">
                        <div className="task-cell-name">
                          <div className="task-icon-container">
                            {renderProcessIcon(proc)}
                          </div>
                          <div className="task-name-group">
                            <span className="task-title" title={proc.title}>
                              {proc.title}
                            </span>
                            {proc.url && (
                              <span className="task-subtitle" title={proc.url}>
                                {proc.url}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="col-pid task-col-pid">{proc.pid}</td>
                      <td className={`col-cpu task-col-cpu ${cpuClass}`}>
                        {proc.cpuPercent.toFixed(1)}%
                      </td>
                      <td
                        className={`col-memory task-col-memory ${isHeavy ? "memory-heavy" : ""}`}
                      >
                        {proc.memoryWorkingSetMB >= 1024
                          ? `${(proc.memoryWorkingSetMB / 1024).toFixed(2)} ГБ`
                          : `${proc.memoryWorkingSetMB.toFixed(0)} МБ`}
                        {isHeavy && (
                          <span className="memory-heavy-badge">Высокая</span>
                        )}
                      </td>
                      <td className="col-type task-col-type">
                        <span
                          className={`process-badge badge-${proc.type}`}
                        >
                          {getProcessTypeLabel(proc.type)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <footer className="task-manager-footer">
          <div className="task-manager-footer-left">
            <span className="task-manager-shortcut-hint">
              <kbd className="task-manager-kbd">Shift</kbd> +{" "}
              <kbd className="task-manager-kbd">Esc</kbd> для быстрого вызова
            </span>
            {selectedProcess && !selectedProcess.isKillable && (
              <span className="task-manager-protected-hint">
                Системный процесс защищен
              </span>
            )}
          </div>
          <div className="task-manager-footer-actions">
            <button
              type="button"
              className="task-manager-end-process-btn"
              disabled={
                !selectedProcess || !selectedProcess.isKillable || isTerminating
              }
              onClick={handleKillProcess}
              title={
                !selectedProcess
                  ? "Выберите процесс"
                  : !selectedProcess.isKillable
                    ? "Этот процесс защищён от завершения"
                    : "Завершить выбранный процесс"
              }
            >
              <XOctagon size={15} />
              <span>
                {isTerminating ? "Завершение..." : "Завершить процесс"}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TaskManagerModal;
