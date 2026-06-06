// #17 — UI polish: small presentation primitives used across the dashboard.
//  - Skeleton: shimmer placeholder for loading states
//  - FadeIn:   wraps children with a subtle fade-in animation
// Both respect prefers-reduced-motion via the CSS at styles.css.

import type { ReactNode } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`skeleton ${className}`}
      style={{ minHeight: 8, ...style }}
    />
  );
}

export function FadeIn({
  children,
  className = "",
  fast = false,
}: {
  children: ReactNode;
  className?: string;
  fast?: boolean;
}) {
  return (
    <div
      className={`${fast ? "anim-fade-in-fast" : "anim-fade-in"} ${className}`}
    >
      {children}
    </div>
  );
}
