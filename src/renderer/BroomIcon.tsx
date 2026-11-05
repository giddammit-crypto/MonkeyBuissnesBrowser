import React from 'react';

/**
 * Classic sweeping broom for the "Click & Clean" action.
 *
 * Drawn in the lucide grid (24×24, 2px stroke, round caps) so it sits visually
 * next to the other toolbar icons, but with an unmistakable bristle fan instead
 * of the thin angled brush shape the icon set shipped.
 */
export interface BroomIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

export default function BroomIcon({
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.8,
  className,
  title,
}: BroomIconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {/* handle */}
      <path d="M20.6 3.4 11 13" />
      {/* ferrule that binds the bristles to the handle */}
      <path d="M9.1 11.3 12.7 14.9" />
      {/* bristle fan */}
      <path d="M9.6 11.8 3.2 15.2" />
      <path d="M10.5 12.7 4.4 17.6" />
      <path d="M11.4 13.6 5.8 19.9" />
      <path d="M12.2 14.4 7.4 21.4" />
      {/* binding stitch across the bristles */}
      <path d="M8.2 14.2 10.7 16.7" />
    </svg>
  );
}
