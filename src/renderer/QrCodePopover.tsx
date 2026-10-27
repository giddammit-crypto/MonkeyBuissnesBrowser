import React, { useState, useMemo, useEffect, useRef } from "react";
import { QrCode, X, Copy, Check, Download, ExternalLink, Smartphone } from "lucide-react";
import { generateQrCodeSvg } from "../shared/qrCode";

export interface QrCodePopoverProps {
  url: string;
  title?: string;
  onClose: () => void;
  style?: React.CSSProperties;
}

export function QrCodePopover({ url, title, onClose, style }: QrCodePopoverProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Extract clean domain
  const domain = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }, [url]);

  // Generate clean SVG QR Code string
  const qrSvg = useMemo(() => {
    try {
      return generateQrCodeSvg(url, 180);
    } catch (err) {
      console.error("Failed to generate QR code:", err);
      return `<svg viewBox="0 0 180 180" width="180" height="180"><text x="90" y="90" text-anchor="middle" fill="#666" font-size="12">Ошибка создания QR</text></svg>`;
    }
  }, [url]);

  // Copy URL to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Download SVG
  const handleDownload = () => {
    try {
      const blob = new Blob([qrSvg], { type: "image/svg+xml;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      const sanitized = domain.replace(/[^a-z0-9_-]/gi, "_") || "qrcode";
      link.download = `qrcode-${sanitized}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Failed to download QR code:", err);
    }
  };

  // Handle ESC and click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const timeout = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="qr-popover"
      style={style}
      role="dialog"
      aria-label="QR-код страницы"
    >
      <div className="qr-popover-header">
        <div className="qr-popover-title">
          <QrCode size={16} className="qr-icon-accent" />
          <span>QR-код страницы</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          title="Закрыть · Esc"
          aria-label="Закрыть"
        >
          <X size={15} />
        </button>
      </div>

      <div className="qr-page-preview">
        <ExternalLink size={14} className="qr-page-icon" />
        <div className="qr-page-preview-text">
          <div className="qr-page-preview-title" title={title || url}>
            {title || url}
          </div>
          <div className="qr-page-preview-domain">{domain}</div>
        </div>
      </div>

      <div className="qr-code-canvas-box" title={`QR-код для ${url}`}>
        <div
          className="qr-svg-wrapper"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      </div>

      <div className="qr-url-box">
        <input
          type="text"
          readOnly
          value={url}
          className="qr-url-input"
          title="Ссылка для перехода"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
      </div>

      <div className="qr-actions">
        <button
          type="button"
          className={`qr-btn-primary ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          title="Копировать адрес ссылки"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Скопировано! ✓" : "Копировать ссылку"}</span>
        </button>

        <button
          type="button"
          className="qr-btn-secondary"
          onClick={handleDownload}
          title="Скачать QR-код (SVG)"
          aria-label="Скачать QR-код"
        >
          <Download size={15} />
        </button>
      </div>

      <div className="qr-footnote">
        <Smartphone size={12} className="qr-footnote-icon" />
        <span>Наведите камеру смартфона для быстрого перехода</span>
      </div>
    </div>
  );
}
