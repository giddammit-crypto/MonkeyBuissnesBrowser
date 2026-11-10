import type { JSX } from 'react';

interface SiteErrorIllustrationProps {
  className?: string;
  variant?: 'network' | 'security' | 'page';
}

const accent = 'var(--site-error-art-accent, currentColor)';
const muted = 'var(--site-error-art-muted, currentColor)';
const surface = 'var(--site-error-art-surface, Canvas)';

export function SiteErrorIllustration({ className, variant = 'network' }: SiteErrorIllustrationProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 400 300"
      aria-hidden="true"
      focusable="false"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="201" cy="148" r="128" fill={accent} opacity=".06" />
      <circle cx="201" cy="148" r="112" stroke={accent} opacity=".15" />
      <path d="M41 231H68M54.5 217.5V244.5M348 56H371M359.5 44.5V67.5" stroke={accent} strokeWidth="2" opacity=".55" />
      <circle cx="47" cy="109" r="5" stroke={muted} strokeWidth="2" opacity=".46" />
      <circle cx="347" cy="219" r="5" fill={accent} opacity=".4" />
      <path d="M90 57H58a9 9 0 0 0-9 9v18m259 165h37a9 9 0 0 0 9-9v-6" stroke={muted} strokeWidth="1.5" strokeDasharray="3 6" opacity=".45" />

      <rect x="89" y="57" width="232" height="186" rx="22" fill={accent} opacity=".11" />
      <rect x="79" y="48" width="232" height="186" rx="22" fill={surface} stroke={muted} strokeWidth="1.5" strokeOpacity=".56" />
      <path d="M79 86H311" stroke={muted} strokeOpacity=".38" />
      <circle cx="101" cy="67" r="3" fill={accent} />
      <path d="M113 67h1m10 0h1M255 67h35" stroke={muted} strokeWidth="3" opacity=".45" />
      <path d="M102 109h25m-25 10h17m137 0h29m-20 10h20m-183 78h30m-30-10h15" stroke={muted} strokeWidth="2" opacity=".34" />

      <path d="M154 181v16c0 8 6 14 14 14h52c8 0 14-6 14-14v-16M193 129v-17" stroke={accent} strokeWidth="2.5" />
      <circle cx="193" cy="107" r="5" fill={surface} stroke={accent} strokeWidth="2.5" />
      <rect x="134" y="153" width="120" height="22" rx="9" fill={surface} stroke={muted} strokeWidth="2" />
      <rect x="145" y="128" width="98" height="68" rx="20" fill={surface} stroke={muted} strokeWidth="2" />
      <rect x="156" y="140" width="76" height="43" rx="13" fill={accent} opacity=".13" />
      <path d="M170 161q6-8 12 0m25 0q6-8 12 0m-30 10h11m-18 31h24" stroke={accent} strokeWidth="2.7" />

      <rect x="280" y="175" width="86" height="66" rx="19" fill={accent} opacity=".13" />
      <rect x="275" y="170" width="86" height="66" rx="19" fill={surface} stroke={accent} strokeWidth="2" />
      <rect x="282" y="177" width="72" height="52" rx="13" fill={accent} opacity=".1" />
      <g stroke={accent} strokeWidth="2.7">
        {variant === 'network' && (
          <path d="M300 197a27 27 0 0 1 35 0m-29 7a17 17 0 0 1 23 0m-17 7a8 8 0 0 1 11 0m-5.5 7h.1M303 187l30 31" />
        )}
        {variant === 'security' && (
          <path d="M318 187l13 5v9c0 8-6 14-13 17-7-3-13-9-13-17v-9l13-5Zm0 9v8m0 6h.1" />
        )}
        {variant === 'page' && (
          <path d="M308 187h13l7 7v23h-20zM321 187v7h7m-10 4v7m0 5h.1" />
        )}
      </g>

      <path d="M153 253h43m9 0h12m9 0h16" stroke={muted} strokeWidth="2" opacity=".34" />
    </svg>
  );
}
