import React, { useEffect, useState } from "react";
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

  // Do not send browsing history (including private/local hosts) to an
  // unrelated favicon service just because a page has no icon.
  const source = favicon && favicon.trim() ? favicon : null;
  useEffect(() => setLoadFailed(false), [source]);
  const currentSrc = !loadFailed ? source : null;

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
