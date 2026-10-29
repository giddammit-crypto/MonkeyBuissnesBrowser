import React, { useEffect, useState } from 'react';
import {
  Download,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  X,
  FileCheck,
  FolderOpen,
  ArrowRight,
} from 'lucide-react';
import type { UpdateAssetInfo, UpdateCheckResult, UpdateDownloadProgress } from '../shared/types';
import './update-modal.css';

interface UpdateModalProps {
  onDismiss: () => void;
  onFeedback?: (message: string, isError?: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Б';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} МБ`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} ГБ`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ onDismiss, onFeedback }) => {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<UpdateAssetInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    // Load current status on mount
    window.browserApi.getUpdateStatus().then((status) => {
      if (!mounted) return;
      if (status.downloadProgress && status.downloadProgress.status !== 'idle') {
        setDownloadProgress(status.downloadProgress);
        setDownloading(status.downloadProgress.status === 'downloading');
      }
      if (status.lastCheck) {
        setCheckResult(status.lastCheck);
        setSelectedAsset(status.lastCheck.recommendedAsset || status.lastCheck.assets?.[0] || null);
      } else {
        // Trigger check if never checked
        void checkNow();
      }
    }).catch(() => {
      if (mounted) void checkNow();
    });

    const unsubscribe = window.browserApi.onTabEvent((event) => {
      if (!mounted) return;
      if (event.type === 'update-download-progress' && event.data) {
        const progress = event.data as UpdateDownloadProgress;
        setDownloadProgress(progress);
        setDownloading(progress.status === 'downloading');
        if (progress.status === 'completed') {
          onFeedback?.('Обновление успешно скачано!', false);
        } else if (progress.status === 'error' && progress.error) {
          onFeedback?.(`Ошибка скачивания: ${progress.error}`, true);
        }
      }
      if (event.type === 'update-available' && event.data) {
        const res = event.data as UpdateCheckResult;
        setCheckResult(res);
        setSelectedAsset(res.recommendedAsset || res.assets?.[0] || null);
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const checkNow = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await window.browserApi.checkForUpdates(true);
      setCheckResult(res);
      setSelectedAsset(res.recommendedAsset || res.assets?.[0] || null);
      if (res.hasUpdate) {
        onFeedback?.(`Доступна новая версия: v${res.latestVersion}`, false);
      } else if (!res.error) {
        onFeedback?.('У вас установлена самая актуальная версия soulm8te', false);
      } else {
        onFeedback?.(res.error, true);
      }
    } catch (e) {
      onFeedback?.('Не удалось связаться с сервером обновлений GitHub', true);
    } finally {
      setChecking(false);
    }
  };

  const startDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const target = selectedAsset || checkResult?.recommendedAsset;
      const res = await window.browserApi.downloadUpdate(target?.downloadUrl, target?.name);
      if (!res.success) {
        onFeedback?.(res.error || 'Ошибка скачивания файла обновления', true);
      }
    } catch (e) {
      onFeedback?.('Сбой скачивания обновления', true);
    }
  };

  const openFile = async () => {
    if (!downloadProgress?.savePath) return;
    try {
      await window.browserApi.openDownloadedUpdate(downloadProgress.savePath);
    } catch {
      onFeedback?.('Не удалось запустить файл', true);
    }
  };

  const openGitHub = () => {
    const url = checkResult?.htmlUrl || 'https://github.com/giddammit-crypto/MonkeyBuissnesBrowser/releases';
    void window.browserApi.createTab({ url });
    onDismiss();
  };

  const hasUpdate = Boolean(checkResult?.hasUpdate);
  const isCompleted = downloadProgress?.status === 'completed';

  return (
    <div className="update-modal-backdrop" onClick={onDismiss}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="update-modal-header">
          <div className="update-header-info">
            <div className="update-header-icon">
              {hasUpdate ? <Sparkles size={24} /> : <Download size={24} />}
            </div>
            <div className="update-header-text">
              <h3>
                Обновление soulm8te
                {checkResult && (
                  <span className={`update-badge-status ${hasUpdate ? 'has-update' : 'latest'}`}>
                    {hasUpdate ? 'Доступно обновление' : 'Актуальная версия'}
                  </span>
                )}
              </h3>
              <p>Официальные релизы и сборки с GitHub</p>
            </div>
          </div>
          <button className="update-close-btn" onClick={onDismiss} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="update-modal-body">
          {/* Version Comparison Card */}
          <div className="update-version-card">
            <div className="version-item">
              <span className="version-label">Текущая версия</span>
              <span className="version-value">v{checkResult?.currentVersion || '0.9.0'}</span>
            </div>
            <div className="version-arrow">
              <ArrowRight size={20} />
            </div>
            <div className="version-item" style={{ textAlign: 'right' }}>
              <span className="version-label">Новая версия</span>
              <span className="version-value" style={{ color: hasUpdate ? '#00e5ff' : '#4ade80' }}>
                v{checkResult?.latestVersion || checkResult?.currentVersion || '0.9.0'}
              </span>
            </div>
          </div>

          {/* Status Message */}
          {checkResult?.error ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 13, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 10, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <AlertCircle size={18} />
              <span>{checkResult.error}</span>
            </div>
          ) : !hasUpdate && checkResult ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#4ade80', fontSize: 13, padding: '10px 14px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 10, border: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <CheckCircle2 size={18} />
              <span>У вас установлена самая последняя версия soulm8te. Обновлений не требуется.</span>
            </div>
          ) : null}

          {/* Release Notes */}
          {hasUpdate && checkResult?.releaseNotes && (
            <div className="update-notes-container">
              <span className="update-notes-title">Что нового в этом выпуске:</span>
              <div className="update-notes-box">
                {checkResult.releaseNotes}
              </div>
            </div>
          )}

          {/* Recommended Asset */}
          {hasUpdate && selectedAsset && (
            <div className="update-asset-card">
              <div className="asset-details">
                <span className="asset-name">{selectedAsset.name}</span>
                <span className="asset-meta">
                  Пакет для текущей системы · {formatBytes(selectedAsset.size)}
                </span>
              </div>
              <span className="asset-tag">Рекомендуется</span>
            </div>
          )}

          {/* Download Progress */}
          {downloadProgress && (downloading || isCompleted || downloadProgress.status === 'error') && (
            <div className="update-progress-container">
              <div className="update-progress-header">
                <span>
                  {isCompleted
                    ? '✓ Файл готов к установке'
                    : downloadProgress.status === 'error'
                      ? '✕ Ошибка при скачивании'
                      : `Скачивание: ${downloadProgress.percent}%`}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(downloadProgress.transferredBytes)} / {formatBytes(downloadProgress.totalBytes)}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${downloadProgress.percent}%`,
                    background: downloadProgress.status === 'error' ? '#ef4444' : undefined,
                  }}
                />
              </div>
              {downloadProgress.savePath && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Путь: {downloadProgress.savePath}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="update-modal-footer">
          <button className="update-link-btn" onClick={openGitHub}>
            <ExternalLink size={14} />
            <span>Релизы на GitHub</span>
          </button>

          <div className="update-footer-actions">
            <button
              className="update-btn btn-secondary"
              onClick={checkNow}
              disabled={checking || downloading}
            >
              <RefreshCw size={14} className={checking ? 'spin-icon' : ''} />
              <span>{checking ? 'Проверка...' : 'Проверить'}</span>
            </button>

            {isCompleted ? (
              <button className="update-btn btn-primary" onClick={openFile}>
                <FileCheck size={16} />
                <span>Открыть / Установить</span>
              </button>
            ) : hasUpdate ? (
              <button
                className="update-btn btn-primary"
                onClick={startDownload}
                disabled={downloading}
              >
                <Download size={16} />
                <span>{downloading ? 'Скачивание...' : 'Скачать обновление'}</span>
              </button>
            ) : (
              <button className="update-btn btn-secondary" onClick={onDismiss}>
                Закрыть
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
