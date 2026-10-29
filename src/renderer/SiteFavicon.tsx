import React, { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";

export interface SiteFaviconProps {
  url: string;
  favicon?: string | null;
  size?: number;
  className?: string;
  isPrivate?: boolean;
}

export function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const h = host.toLowerCase().trim();
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (
    /^10\.\d+\.\d+\.\d+$/.test(h) ||
    /^192\.168\.\d+\.\d+$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)
  ) {
    return true;
  }
  return false;
}

export function getFaviconSources(
  url: string,
  favicon?: string | null,
  isPrivate?: boolean
): { primarySrc: string | null; fallbackSrc: string | null } {
  let hostname = "";
  try {
    const raw = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
    hostname = new URL(raw).hostname.replace(/^www\./, "");
  } catch {}

  const primarySrc = favicon && favicon.trim() ? favicon.trim() : null;
  const fallbackSrc =
    !isPrivate && hostname && !isPrivateHost(hostname)
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
      : null;

  return { primarySrc, fallbackSrc };
}

export const SiteFavicon: React.FC<SiteFaviconProps> = ({
  url,
  favicon,
  size = 18,
  className = "",
  isPrivate = false,
}) => {
  const [loadFailed, setLoadFailed] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
    setUseFallback(false);
  }, [url, favicon, isPrivate]);

  const { primarySrc, fallbackSrc } = useMemo(
    () => getFaviconSources(url, favicon, isPrivate),
    [url, favicon, isPrivate]
  );

  const currentSrc = !loadFailed
    ? useFallback
      ? fallbackSrc
      : primarySrc || fallbackSrc
    : null;

  const handleImageError = () => {
    if (!useFallback && primarySrc && fallbackSrc && primarySrc !== fallbackSrc) {
      setUseFallback(true);
    } else {
      setLoadFailed(true);
    }
  };

  if (currentSrc) {
    return (
      <img
        src={currentSrc}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={handleImageError}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          objectFit: "contain",
          flexShrink: 0,
          display: "inline-block",
        }}
      />
    );
  }

  return <Globe2 size={size} className={className} />;
};

export default SiteFavicon;
