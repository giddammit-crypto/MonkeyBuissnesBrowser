import React, { useState } from "react";
import { Globe2 } from "lucide-react";

interface SiteFaviconProps {
  url: string;
  favicon?: string | null;
  size?: number;
  className?: string;
}

export const SiteFavicon: React.FC<SiteFaviconProps> = ({
  url,
  favicon,
  size = 18,
  className = "",
}) => {
  const [loadFailed, setLoadFailed] = useState(false);

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {}

  const primarySrc = favicon && favicon.trim() ? favicon : null;
  const fallbackSrc = hostname
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
    : null;

  const currentSrc = !loadFailed ? (primarySrc || fallbackSrc) : null;

  if (currentSrc) {
    return (
      <img
        src={currentSrc}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setLoadFailed(true)}
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
