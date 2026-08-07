"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** Seconds of delay after the element is reached. Keep the total under ~0.5s. */
  delay?: number;
  /** `rise` is the default arrival. `settle` resolves out of a blur, home only. */
  variant?: "rise" | "settle";
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
};

/**
 * Reveals its children when they are actually scrolled to, once. Content below
 * the fold no longer plays its entrance before anyone has seen it.
 *
 * The pre-state lives in globals.css behind `[data-js]`, so if this never runs
 * the page is simply visible. See DESIGN.md.
 */
export function Reveal({
  children,
  delay = 0,
  variant = "rise",
  as: Tag = "div",
  className = "",
  style,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;

    // Defensive: no observer means show it now, straight on the node so this
    // stays out of React's render cycle.
    if (typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-shown", "");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <Tag
      ref={ref}
      data-reveal={variant}
      data-shown={shown ? "" : undefined}
      style={{ transitionDelay: delay ? `${delay}s` : undefined, ...style }}
      className={className}
    >
      {children}
    </Tag>
  );
}
