import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Cpu,
  FileCode2,
  HardDrive,
  Info,
  Play,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import type {
  CanonModelKey,
  CupsPrinterInfo,
  DetectedUsbDevice,
  SystemDiagnosticReport,
  SystemErrorItem,
} from '../shared/types';
import './system-assistant.css';

const CANON_MODEL_OPTIONS: Array<{ id: CanonModelKey; label: string; desc: string }> = [
  { id: 'lbp2900', label: 'Canon LBP2900 / LBP2900B / LBP3000', desc: 'CAPT v2.71 (CNCUPSLBP2900CAPTK.ppd)' },
  { id: 'lbp6000', label: 'Canon LBP6000 / LBP6000B / LBP6018', desc: 'CAPT v3.40 (CNCUPSLBP6000CAPTK.ppd)' },
  { id: 'lbp6020', label: 'Canon LBP6020 / LBP6020B', desc: 'CAPT v3.40 (CNCUPSLBP6020CAPTK.ppd)' },
  { id: 'lbp6030', label: 'Canon LBP6030 / LBP6030B / LBP6030w', desc: 'CAPT v3.40 (CNCUPSLBP6030CAPTK.ppd)' },
  { id: 'lbp3000', label: 'Canon LBP3000', desc: 'CAPT v2.71 (CNCUPSLBP3000CAPTK.ppd)' },
  { id: 'lbp3010', label: 'Canon LBP3010 / LBP3018 / LBP3050', desc: 'CAPT v3.40 (CNCUPSLBP3010CAPTK.ppd)' },
  { id: 'lbp3100', label: 'Canon LBP3100 / LBP3108 / LBP3150', desc: 'CAPT v3.40 (CNCUPSLBP3100CAPTK.ppd)' },
  { id: 'lbp3250', label: 'Canon LBP3250', desc: 'CAPT v3.40 (CNCUPSLBP3250CAPTK.ppd)' },
  { id: 'lbp1120', label: 'Canon LBP-1120', desc: 'CAPT v2.71 (CNCUPSLBP1120CAPTK.ppd)' },
  { id: 'lbp1210', label: 'Canon LBP-1210', desc: 'CAPT v2.71 (CNCUPSLBP1210CAPTK.ppd)' },
];

export const SystemAssistant: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'canon' | 'ai-doctor'>('canon');
  const [report, setReport] = useState<SystemDiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Canon Driver Form State
  const [selectedModel, setSelectedModel] = useState<CanonModelKey>('lbp2900');
  const [driverMode, setDriverMode] = useState<'capt-systemd' | 'rastertocapt'>('capt-systemd');
  const [selectedPort, setSelectedPort] = useState('/dev/usb/lp0');
  const [generatedScript, setGeneratedScript] = useState<{ script: string; filename: string } | null>(null);
  const [testPrinterName, setTestPrinterName] = useState<string>('');
  const [testPrintStatus, setTestPrintStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [testPrintLoading, setTestPrintLoading] = useState(false);

  // AI Doctor State
  const [customErrorInput, setCustomErrorInput] = useState('');
  const [customAnalysis, setCustomAnalysis] = useState<SystemErrorItem | null>(null);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const data = await window.browserApi.getSystemDiagnosticReport();
      setReport(data);
      if (data.canonStatus.configuredPrinters.length > 0 && !testPrinterName) {
        const def = data.canonStatus.configuredPrinters.find((p) => p.isDefault) || data.canonStatus.configuredPrinters[0];
        setTestPrinterName(def.name);
      }
    } catch (err) {
      console.error('Failed to get system report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const handleGenerateScript = async () => {
    try {
      const res = await window.browserApi.generateCanonDriverScript(selectedModel, driverMode, selectedPort);
      setGeneratedScript(res);
    } catch (err) {
      console.error('Failed to generate script:', err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleTestPrint = async () => {
    if (!testPrinterName) return;
    setTestPrintLoading(true);
    setTestPrintStatus(null);
    try {
      const res = await window.browserApi.testPrintPage(testPrinterName);
      setTestPrintStatus(res);
    } catch (err: any) {
      setTestPrintStatus({ success: false, message: err?.message || 'Ошибка' });
    } finally {
      setTestPrintLoading(false);
    }
  };

  const handleAnalyzeCustomError = async () => {
    if (!customErrorInput.trim()) return;
    try {
      const analysis = await window.browserApi.analyzeCustomError(customErrorInput);
      setCustomAnalysis(analysis);
    } catch (err) {
      console.error('Failed to analyze error:', err);
    }
  };

  return (
    <div className="system-assistant-container">
      {/* Top Banner */}
      <header className="system-assistant-header">
        <div className="header-meta">
          <div className="header-icon-badge">
            <Cpu size={24} />
          </div>
          <div>
            <h1 className="header-title">Системный ИИ-помощник & Драйверы</h1>
            <p className="header-subtitle">
              Установка драйверов Canon для Astra Linux / Debian и устранение системных ошибок с помощью ИИ
            </p>
          </div>
        </div>

        <div className="header-actions">
          {report && (
            <div className="os-badge" title={report.osInfo.prettyName}>
              <span className="os-dot active" />
              <span className="os-name">{report.osInfo.prettyName}</span>
              <span className="os-arch">({report.osInfo.arch})</span>
            </div>
          )}
          <button className="refresh-btn" onClick={fetchDiagnostics} disabled={loading} title="Обновить диагностику">
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            <span>{loading ? 'Сканирование...' : 'Диагностика'}</span>
          </button>
        </div>
      </header>

      {/* Tabs Switcher */}
      <div className="system-tabs-nav">
        <button
          className={`system-tab-btn ${activeTab === 'canon' ? 'active' : ''}`}
          onClick={() => setActiveTab('canon')}
        >
          <Printer size={18} />
          <span>Драйверы Canon (Astra Linux)</span>
        </button>

        <button
          className={`system-tab-btn ${activeTab === 'ai-doctor' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai-doctor')}
        >
          <Sparkles size={18} />
          <span>ИИ-Доктор ОС (Диагностика)</span>
          {report && report.errors.length > 0 && (
            <span className="errors-badge">{report.errors.length}</span>
          )}
        </button>
      </div>

      {/* Tab Content: Canon Drivers */}
      {activeTab === 'canon' && (
        <div className="tab-pane-content">
          {/* Hardware & Service Status Cards */}
          <section className="status-grid">
            <div className={`status-card ${report?.canonStatus.cupsRunning ? 'card-ok' : 'card-warn'}`}>
              <div className="card-header">
                <span className="card-title">Служба печати CUPS</span>
                {report?.canonStatus.cupsRunning ? (
                  <CheckCircle2 size={18} className="icon-ok" />
                ) : (
                  <AlertCircle size={18} className="icon-warn" />
                )}
              </div>
              <div className="card-value">
                {report?.canonStatus.cupsRunning ? 'Работает (Active)' : 'Остановлена'}
              </div>
              <div className="card-hint">
                {report?.canonStatus.cupsRunning
                  ? 'Планировщик печати готов к приему заданий'
                  : 'Запустите: sudo systemctl enable --now cups'}
              </div>
            </div>

            <div className={`status-card ${report?.canonStatus.ccpdRunning ? 'card-ok' : report?.canonStatus.rastertocaptInstalled ? 'card-ok' : 'card-warn'}`}>
              <div className="card-header">
                <span className="card-title">Демон Canon CAPT (ccpd)</span>
                {report?.canonStatus.ccpdRunning || report?.canonStatus.rastertocaptInstalled ? (
                  <CheckCircle2 size={18} className="icon-ok" />
                ) : (
                  <AlertTriangle size={18} className="icon-warn" />
                )}
              </div>
              <div className="card-value">
                {report?.canonStatus.ccpdRunning
                  ? 'ccpd активен'
                  : report?.canonStatus.rastertocaptInstalled
                  ? 'Активен rastertocapt'
                  : report?.canonStatus.ccpdInstalled
                  ? 'Установлен, но остановлен'
                  : 'Не установлен'}
              </div>
              <div className="card-hint">
                {report?.canonStatus.ccpdRunning
                  ? 'Сокет связи с принтером открыт'
                  : report?.canonStatus.rastertocaptInstalled
                  ? 'Используется прямой CUPS фильтр'
                  : 'Требуется запуск или установка скриптом'}
              </div>
            </div>

            <div className={`status-card ${report?.canonStatus.udevRuleExists ? 'card-ok' : 'card-warn'}`}>
              <div className="card-header">
                <span className="card-title">Автовосстановление USB</span>
                {report?.canonStatus.udevRuleExists ? (
                  <CheckCircle2 size={18} className="icon-ok" />
                ) : (
                  <Info size={18} className="icon-info" />
                )}
              </div>
              <div className="card-value">
                {report?.canonStatus.udevRuleExists ? 'Правило udev активно' : 'Правило отсутствует'}
              </div>
              <div className="card-hint">
                Автоматический перезапуск ccpd при включении принтера
              </div>
            </div>

            <div className="status-card card-neutral">
              <div className="card-header">
                <span className="card-title">Обнаруженные устройства USB</span>
                <HardDrive size={18} />
              </div>
              <div className="card-value">
                {report?.canonStatus.detectedPrinters.length
                  ? `${report.canonStatus.detectedPrinters.length} устр.`
                  : 'Принтер не обнаружен'}
              </div>
              <div className="card-hint">
                {report?.canonStatus.detectedPrinters.length
                  ? report.canonStatus.detectedPrinters.map((p) => p.name).join(', ')
                  : 'Проверьте подключение USB-кабеля'}
              </div>
            </div>
          </section>

          {/* Master Generator for Astra Linux */}
          <section className="assistant-card">
            <div className="card-section-title">
              <Wrench size={20} />
              <span>Мастер установки драйверов Canon для Astra Linux & Debian</span>
            </div>
            <p className="section-desc">
              Решает главные проблемы установки Canon LBP2900 / LBP6000 в Astra Linux: автосоздание systemd-сервиса,
              восстановление связи при выключении питания через udev, права группы lp и зависимость 32-битных библиотек.
            </p>

            <div className="generator-controls-grid">
              <div className="control-group">
                <label className="control-label">Модель принтера Canon:</label>
                <select
                  className="control-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as CanonModelKey)}
                >
                  {CANON_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} — {opt.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-group">
                <label className="control-label">USB Порт устройства:</label>
                <input
                  type="text"
                  className="control-input"
                  value={selectedPort}
                  onChange={(e) => setSelectedPort(e.target.value)}
                  placeholder="/dev/usb/lp0"
                />
              </div>

              <div className="control-group full-width">
                <label className="control-label">Метод интеграции драйвера:</label>
                <div className="radio-group">
                  <label className={`radio-card ${driverMode === 'capt-systemd' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="driverMode"
                      value="capt-systemd"
                      checked={driverMode === 'capt-systemd'}
                      onChange={() => setDriverMode('capt-systemd')}
                    />
                    <div>
                      <strong>Официальный CAPT с системной службой systemd (Рекомендуется)</strong>
                      <span>
                        Полная совместимость со всеми функциями Canon, автозапуск демона ccpd и правило udev для Astra Linux.
                      </span>
                    </div>
                  </label>

                  <label className={`radio-card ${driverMode === 'rastertocapt' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="driverMode"
                      value="rastertocapt"
                      checked={driverMode === 'rastertocapt'}
                      onChange={() => setDriverMode('rastertocapt')}
                    />
                    <div>
                      <strong>Открытый драйвер rastertocapt (Без демона ccpd)</strong>
                      <span>
                        Прямая печать через стандартный фильтр CUPS. Идеально для LBP2900 и LBP3000, никогда не зависает.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="generator-actions">
              <button className="primary-action-btn" onClick={handleGenerateScript}>
                <Zap size={18} />
                <span>Сгенерировать решение под ключ для Astra Linux</span>
              </button>
            </div>

            {/* Generated Script Display */}
            {generatedScript && (
              <div className="script-output-container">
                <div className="script-header">
                  <div className="script-title">
                    <FileCode2 size={16} />
                    <span>Скрипт: {generatedScript.filename}</span>
                  </div>
                  <div className="script-actions">
                    <button
                      className="copy-btn"
                      onClick={() => handleCopy(generatedScript.script, 'script-body')}
                    >
                      <Clipboard size={14} />
                      <span>{copiedId === 'script-body' ? 'Скопировано!' : 'Скопировать весь скрипт'}</span>
                    </button>
                    <button
                      className="copy-btn copy-accent"
                      onClick={() =>
                        handleCopy(
                          `cat << 'EOF' > /tmp/${generatedScript.filename}\n${generatedScript.script}\nEOF\nsudo bash /tmp/${generatedScript.filename}`,
                          'script-cmd'
                        )
                      }
                    >
                      <Terminal size={14} />
                      <span>{copiedId === 'script-cmd' ? 'Скопировано!' : 'Команда запуска в терминал'}</span>
                    </button>
                  </div>
                </div>
                <pre className="script-code-block">{generatedScript.script}</pre>
              </div>
            )}
          </section>

          {/* Test Print Card */}
          <section className="assistant-card">
            <div className="card-section-title">
              <Printer size={20} />
              <span>Тестовая печать и проверка связи</span>
            </div>

            <div className="test-print-row">
              <div className="control-group flex-1">
                <label className="control-label">Выберите принтер из настроенных в CUPS:</label>
                <select
                  className="control-select"
                  value={testPrinterName}
                  onChange={(e) => setTestPrinterName(e.target.value)}
                >
                  {report?.canonStatus.configuredPrinters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.isDefault ? '(По умолчанию)' : ''} — {p.status}
                    </option>
                  ))}
                  {(!report || report.canonStatus.configuredPrinters.length === 0) && (
                    <option value="LBP2900">LBP2900 (по умолчанию)</option>
                  )}
                </select>
              </div>

              <button
                className="secondary-action-btn"
                onClick={handleTestPrint}
                disabled={testPrintLoading || !testPrinterName}
              >
                <Play size={16} />
                <span>{testPrintLoading ? 'Отправка...' : 'Отправить тестовую страницу'}</span>
              </button>
            </div>

            {testPrintStatus && (
              <div className={`notification-pill ${testPrintStatus.success ? 'pill-success' : 'pill-error'}`}>
                {testPrintStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{testPrintStatus.message}</span>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab Content: AI Doctor */}
      {activeTab === 'ai-doctor' && (
        <div className="tab-pane-content">
          {/* Custom Error Analysis Box */}
          <section className="assistant-card">
            <div className="card-section-title">
              <Sparkles size={20} className="icon-ai" />
              <span>Интерактивный ИИ-диагност системных ошибок Astra Linux</span>
            </div>
            <p className="section-desc">
              Вставьте любую ошибку из терминала, логов или окна ошибки. ИИ определит причину, специфичную для Astra Linux / Debian, и сформирует безопасную команду решения.
            </p>

            <div className="ai-query-box">
              <textarea
                className="ai-error-textarea"
                rows={3}
                placeholder="Например: Could not get lock /var/lib/dpkg/lock-frontend или ccpd: command not found..."
                value={customErrorInput}
                onChange={(e) => setCustomErrorInput(e.target.value)}
              />
              <button
                className="primary-action-btn"
                onClick={handleAnalyzeCustomError}
                disabled={!customErrorInput.trim()}
              >
                <Search size={16} />
                <span>Разобрать ошибку с помощью ИИ</span>
              </button>
            </div>

            {customAnalysis && (
              <div className="analysis-result-card">
                <div className="analysis-header">
                  <span className={`severity-tag ${customAnalysis.severity}`}>
                    {customAnalysis.severity === 'critical'
                      ? 'Критическая'
                      : customAnalysis.severity === 'warning'
                      ? 'Внимание'
                      : 'Инфо'}
                  </span>
                  <h3 className="analysis-title">{customAnalysis.title}</h3>
                </div>

                <div className="analysis-body">
                  <div className="analysis-block">
                    <strong>Что произошло:</strong>
                    <p>{customAnalysis.aiExplanation}</p>
                  </div>
                  <div className="analysis-block">
                    <strong>Причина в Astra Linux:</strong>
                    <p>{customAnalysis.aiRootCause}</p>
                  </div>
                  <div className="analysis-block">
                    <strong>Решение:</strong>
                    <p>{customAnalysis.suggestedFix}</p>
                  </div>

                  {customAnalysis.fixCommand && (
                    <div className="fix-cmd-row">
                      <code>{customAnalysis.fixCommand}</code>
                      <button
                        className="copy-btn"
                        onClick={() => handleCopy(customAnalysis.fixCommand!, 'custom-cmd')}
                      >
                        <Clipboard size={14} />
                        <span>{copiedId === 'custom-cmd' ? 'Скопировано!' : 'Скопировать'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Auto-detected System Issues */}
          <section className="assistant-card">
            <div className="card-section-title">
              <AlertTriangle size={20} />
              <span>Обнаруженные проблемы в системе ({report?.errors.length || 0})</span>
            </div>

            {report && report.errors.length === 0 ? (
              <div className="clean-system-state">
                <CheckCircle2 size={36} className="icon-ok" />
                <h3>Критических ошибок в системе не обнаружено</h3>
                <p>Службы CUPS, менеджер пакетов APT и системные юниты работают штатно.</p>
              </div>
            ) : (
              <div className="errors-list">
                {report?.errors.map((err) => (
                  <div key={err.id} className="error-item-card">
                    <div className="error-item-header">
                      <div className="error-item-title-group">
                        <span className={`severity-tag ${err.severity}`}>
                          {err.severity === 'critical' ? 'Критично' : 'Внимание'}
                        </span>
                        <h4>{err.title}</h4>
                      </div>
                      <span className="source-tag">{err.source.toUpperCase()}</span>
                    </div>

                    <div className="error-item-body">
                      <p className="explanation-text">{err.aiExplanation}</p>
                      <div className="root-cause-line">
                        <strong>Причина:</strong> {err.aiRootCause}
                      </div>

                      {err.fixCommand && (
                        <div className="fix-cmd-row">
                          <code>{err.fixCommand}</code>
                          <button
                            className="copy-btn"
                            onClick={() => handleCopy(err.fixCommand!, err.id)}
                          >
                            <Clipboard size={14} />
                            <span>{copiedId === err.id ? 'Скопировано' : 'Скопировать команду'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
