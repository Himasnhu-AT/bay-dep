import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";

/**
 * The page primitives. Every page on the site is assembled from these, so a new
 * product page inherits the theme instead of restating it. See DESIGN.md.
 */

/** The 1080px column with 32px gutters. Nothing sits outside it. */
export function Wrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-page px-8 ${className}`}>
      {children}
    </div>
  );
}

/** The small brass-free caps label that opens a page or a section. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-eyebrow font-medium text-muted uppercase">{children}</p>
  );
}

/** Top of a page: label, serif headline, serif lead. Used once per page. */
export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <div className="max-w-[64ch]">
      <Reveal delay={0.05}>
        <Eyebrow>{eyebrow}</Eyebrow>
      </Reveal>
      <Reveal delay={0.14}>
        <h1 className="mt-[26px] font-serif text-title font-light">{title}</h1>
      </Reveal>
      {lead ? (
        <Reveal delay={0.24}>
          <p className="mt-[30px] max-w-[56ch] font-serif text-lead font-light text-ink-soft">
            {lead}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}

const ACTION =
  "group inline-flex items-center gap-3 rounded-[1px] border border-ink px-[30px] py-[15px] text-[13px] font-medium tracking-[0.14em] text-ink uppercase transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-ink hover:text-paper disabled:cursor-default disabled:border-line disabled:text-muted disabled:hover:bg-transparent disabled:hover:text-muted";

/**
 * The site's only button. An outlined box that fills with ink on hover, with an
 * arrow that nudges. Use it for the one action a page is asking for.
 */
export function ActionLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const content = (
    <>
      {children}
      <span
        aria-hidden
        className="transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1.5"
      >
        &rarr;
      </span>
    </>
  );
  const classes = `${ACTION} ${className}`;

  return external ? (
    <a href={href} className={classes}>
      {content}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}

/**
 * ActionLink's twin for an action that is not a navigation: sign in, send,
 * approve. Same box, same fill on hover. `quiet` drops the box for a secondary
 * action beside a primary one, so a screen still asks for one thing.
 */
export function ActionButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  quiet = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  quiet?: boolean;
  className?: string;
}) {
  if (quiet) {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`text-[13px] tracking-[0.06em] text-ink-soft underline decoration-line underline-offset-4 transition-colors duration-200 hover:text-brass-deep hover:decoration-brass-deep disabled:text-muted ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${ACTION} ${className}`}
    >
      {children}
      <span
        aria-hidden
        className="transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1.5 group-disabled:translate-x-0"
      >
        &rarr;
      </span>
    </button>
  );
}

/**
 * A line to write on. The field is a rule rather than a box, the way a form is
 * ruled on paper. Here the rule carries meaning, so it is ink-soft (8.6:1) and
 * never `line` (1.4:1). The label is an eyebrow.
 */
export function Field({
  label,
  hint,
  multiline = false,
  id,
  value,
  onChange,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  multiline?: boolean;
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const classes =
    "mt-3 block w-full rounded-none border-0 border-b border-ink-soft bg-transparent px-0 pb-2.5 text-base text-ink placeholder:text-muted focus:border-brass-deep focus:outline-none focus-visible:outline-none";
  return (
    <div>
      <label
        htmlFor={id}
        className="text-eyebrow font-medium text-muted uppercase"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`${classes} resize-y`}
          {...rest}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={classes}
          {...rest}
        />
      )}
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A 1px rule that draws itself in from the left when it is reached, rather than
 * fading. Standalone, for the rule that opens a list.
 */
export function Rule({ className = "" }: { className?: string }) {
  return (
    <Reveal className={`h-px ${className}`}>
      <span aria-hidden data-rule className="block h-px w-full bg-line" />
    </Reveal>
  );
}

/** A ruled stack of rows. The site's one list style. */
export function RuledList({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[82px]">
      <Rule />
      {children}
    </div>
  );
}

/**
 * One row of a RuledList: a narrow left column for the numeral, status, or
 * other marginal note, and the substance on the right. Collapses to one column
 * on small screens.
 */
export function RuledRow({
  aside,
  title,
  children,
  delay = 0,
  /** Wide left column for a status plus a kind; narrow for a numeral. */
  wide = false,
}: {
  aside: ReactNode;
  title: ReactNode;
  children: ReactNode;
  delay?: number;
  wide?: boolean;
}) {
  return (
    <Reveal
      delay={delay}
      className={`relative grid grid-cols-1 items-baseline gap-2.5 py-9 sm:gap-10 sm:py-11 ${
        wide ? "sm:grid-cols-[140px_1fr]" : "sm:grid-cols-[96px_1fr]"
      }`}
    >
      <div>{aside}</div>
      <div>
        <h2 className="mb-3 font-serif text-section font-normal">{title}</h2>
        <div className="max-w-[60ch] text-base text-ink-soft">{children}</div>
      </div>
      <span
        aria-hidden
        data-rule
        className="absolute inset-x-0 bottom-0 h-px bg-line"
      />
    </Reveal>
  );
}

/**
 * A command you would actually type. The one place monospace appears on the
 * site, ruled down one edge rather than boxed in a shadow, so it reads as a
 * line from a terminal rather than a widget. Keep them to one line each.
 */
export function Command({ children }: { children: ReactNode }) {
  return (
    <div className="border-l border-brass bg-[#efe9dc] px-5 py-3.5 font-mono text-[13px] leading-relaxed text-ink-soft">
      <span aria-hidden className="mr-3 text-muted select-none">
        $
      </span>
      {children}
    </div>
  );
}

/** The italic serif line that closes a page. At most one per page. */
export function PullQuote({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="mt-20 max-w-[56ch]">
      <p className="font-serif text-quote font-light text-ink italic">
        {children}
      </p>
    </Reveal>
  );
}
