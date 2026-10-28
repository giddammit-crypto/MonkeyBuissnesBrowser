import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Stethoscope } from 'lucide-react';
import type { DiagnosticsReport } from '../../../shared/types';

interface DiagnosticsScreenProps {
  onRunDiagnostics: () => Promise<DiagnosticsReport>;
}

export const DiagnosticsScreen: React.FC<DiagnosticsScreenProps> = ({ onRunDiagnostics }) => {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await onRunDiagnostics();
      setReport(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: 'pending' | 'running' | 'success' | 'warning' | 'error') => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-400 shrink-0" />;
      default:
        return <RefreshCw className="w-5 h-5 text-blue-400 animate-spin shrink-0" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-5 h-5 text-blue-500" />
          <h2 className="text-sm font-bold text-[var(--text-primary)]">Аудит и диагностика</h2>
        </div>

        <button
          onClick={handleRun}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Проверка...' : 'Запустить тест'}</span>
        </button>
      </div>

      {/* Summary Banner if run */}
      {report && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3 text-xs ${
            report.overallStatus === 'pass'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : report.overallStatus === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {report.overallStatus === 'pass' ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          ) : report.overallStatus === 'warning' ? (
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
          ) : (
            <XCircle className="w-6 h-6 text-red-400 shrink-0" />
          )}
          <div>
            <div className="font-bold">
              {report.overallStatus === 'pass'
                ? 'Все сетевые тесты успешно пройдены'
                : report.overallStatus === 'warning'
                ? 'Диагностика завершена с предупреждениями'
                : 'Обнаружены критические ошибки подключения'}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">
              Проверено в {new Date(report.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {/* Steps List */}
      <div className="space-y-2.5">
        {!report && !loading && (
          <div className="p-6 rounded-xl glass-panel text-center text-xs text-[var(--text-muted)]">
            Нажмите «Запустить тест» для проверки маршрутизации Linux, разрешения DNS, целостности туннеля и защиты от утечек.
          </div>
        )}

        {report?.steps.map((step) => (
          <div key={step.id} className="p-3.5 rounded-xl glass-panel space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon(step.status)}
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {step.title}
                </span>
              </div>
              {step.latencyMs !== undefined && (
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {step.latencyMs} ms
                </span>
              )}
            </div>

            <p className="text-[11px] text-[var(--text-secondary)] pl-7">
              {step.message}
            </p>

            {step.details && (
              <div className="pl-7 pt-1">
                <span className="font-mono text-[10px] text-[var(--text-muted)] bg-black/20 px-2 py-0.5 rounded border border-[var(--border-color)] inline-block">
                  {step.details}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
