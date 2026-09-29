import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";

/**
 * The page primitives. Every page on the site is assembled from these, so a new
 * product page inherits the theme instead of restating it. See DESIGN.md.
 */

/** The 1080px column, with 20px gutters on a phone and 32px above. */
export function Wrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-page px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  );
}

/**
 * The short label that opens a page: sentence case, in the accent, never caps.
 * One per page, over the h1. A section is opened by its own `Headline`.
 */
export function Eyebrow({
  children,
  tone = "paper",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <p
      className={`text-eyebrow font-semibold ${tone === "night" ? "text-accent" : "text-accent-ink"}`}
    >
      {children}
    </p>
  );
}

/** Which ground a piece sits on. Paper is the default; night is the app's. */
export type Tone = "paper" | "night";

/**
 * A section's heading: one sentence, set large, with its second clause in the
 * secondary ink when it has one (`quiet`). This is how a section opens, rather
 * than a caps label over a smaller title.
 */
export function Headline({
  children,
  quiet,
  tone = "paper",
  as: Tag = "h2",
  className = "",
}: {
  children: ReactNode;
  quiet?: ReactNode;
  tone?: Tone;
  as?: "h2" | "h3";
  className?: string;
}) {
  const night = tone === "night";
  return (
    <Tag
      className={`max-w-[26ch] text-headline font-semibold text-balance ${night ? "text-on-night" : "text-ink"} ${className}`}
    >
      {children}
      {quiet ? (
        <>
          {" "}
          <span className={night ? "text-on-night-muted" : "text-muted"}>
            {quiet}
          </span>
        </>
      ) : null}
    </Tag>
  );
}

/**
 * Top of a page: label, headline, lead, on a band of night under the nav, so
 * every page opens on the app's ground the way the home page does and turns to
 * paper for the reading. Used once per page, outside the page's `Wrap`.
 */
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
    <header className="bg-night pt-16 pb-16 sm:pt-24 sm:pb-24">
      <Wrap>
        <div className="max-w-[64ch]">
          <Reveal delay={0.05}>
            <Eyebrow tone="night">{eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={0.14}>
            <h1 className="mt-4 text-title font-semibold text-balance text-on-night">
              {title}
            </h1>
          </Reveal>
          {lead ? (
            <Reveal delay={0.24}>
              <p className="mt-6 max-w-[56ch] text-lead text-on-night-soft">
                {lead}
              </p>
            </Reveal>
          ) : null}
        </div>
      </Wrap>
    </header>
  );
}

const ACTION =
  "group inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-6 text-[15px] font-semibold text-night transition-[background-color,scale] duration-200 ease-paper hover:bg-accent-hover active:scale-[0.98] disabled:cursor-default disabled:bg-line disabled:text-muted disabled:active:scale-100";

/**
 * The site's only button: a pill in the accent, with night text on it (6.2:1),
 * and an arrow that nudges. The same on paper and on night. Use it for the one
 * action a screen is asking for.
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
        className="transition-transform duration-200 ease-paper group-hover:translate-x-1"
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
        className={`text-[15px] font-medium text-ink-soft underline decoration-ink-soft/40 underline-offset-4 transition-colors duration-200 hover:text-accent-ink hover:decoration-accent-ink disabled:text-muted ${className}`}
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
        className="transition-transform duration-200 ease-paper group-hover:translate-x-1 group-disabled:translate-x-0"
      >
        &rarr;
      </span>
    </button>
  );
}

/**
 * A text link in running copy or beside a button: underlined, in accent-ink on
 * paper and accent on night. `arrow` adds the nudging arrow for a link that is
 * the secondary action next to an ActionLink.
 */
export function TextLink({
  href,
  children,
  tone = "paper",
  arrow = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: Tone;
  arrow?: boolean;
  className?: string;
}) {
  const classes = `group inline-flex items-baseline gap-1.5 font-medium transition-colors duration-200 ${
    tone === "night"
      ? "text-accent hover:text-on-night"
      : "text-accent-ink hover:text-ink"
  } ${className}`;
  const content = (
    <>
      <span
        className={`underline underline-offset-4 transition-colors duration-200 ${
          tone === "night"
            ? "decoration-accent/40 group-hover:decoration-on-night"
            : "decoration-accent-ink/40 group-hover:decoration-ink"
        }`}
      >
        {children}
      </span>
      {arrow ? (
        <span
          aria-hidden
          className="transition-transform duration-200 ease-paper group-hover:translate-x-1"
        >
          &rarr;
        </span>
      ) : null}
    </>
  );
  return href.startsWith("http") || href.startsWith("#") ? (
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
 * A field to write in: a raised box with a 1px muted edge (4.9:1, because the
 * edge is what says "type here"), 12px corners like every other surface, and
 * the accent on focus. The label sits above it, never inside.
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
    "mt-2 block w-full rounded-[12px] border border-muted bg-paper-raised px-4 py-3 text-base text-ink placeholder:text-muted transition-[border-color,box-shadow] duration-200 focus:border-accent-ink focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_28%,transparent)] focus:outline-none focus-visible:outline-none";
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink-soft">
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
      {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
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
export function RuledList({
  children,
  className = "mt-16",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
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
      className={`relative grid grid-cols-1 items-baseline gap-2 py-8 sm:gap-10 sm:py-10 ${
        wide ? "sm:grid-cols-[160px_1fr]" : "sm:grid-cols-[120px_1fr]"
      }`}
    >
      <div>{aside}</div>
      <div>
        <h3 className="mb-2.5 text-section font-semibold text-ink">{title}</h3>
        <div className="max-w-[62ch] text-base text-ink-soft">{children}</div>
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
 * Two blocks side by side from `md`, stacked below it. For a pair that reads as
 * a pair: the two ways in on /agents, the refusal and the honest status on the
 * home page. `ruled` draws a rule across the top of the pair.
 */
export function Columns({
  children,
  ruled = false,
  className = "",
}: {
  children: ReactNode;
  ruled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-14 md:grid-cols-2 md:gap-16 ${ruled ? "border-t border-line pt-14" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A small titled block inside `Columns` or on its own: a `text-section` h2 and
 * the body under it. The h2 is how a block opens; there is no label above it.
 */
export function Block({
  title,
  children,
  delay = 0,
}: {
  title: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <Reveal delay={delay}>
      <h2 className="text-section font-semibold text-ink">{title}</h2>
      <div className="mt-3 max-w-[60ch] text-base text-ink-soft">{children}</div>
    </Reveal>
  );
}

/**
 * Notes in two columns from `md`, each headed by the thing in the app it is
 * about (a key, a button, a tool name) in the app's monospace and accent-ink,
 * and ruled along its top. Exactly as many cells as notes; keep it even.
 */
export function MarkedGrid({
  items,
}: {
  items: { mark: string; title: string; body: ReactNode }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-x-16 md:grid-cols-2">
      {items.map((item, i) => (
        <Reveal
          key={item.title}
          delay={(i % 2) * 0.08}
          className="relative py-8 sm:py-10"
        >
          <span
            aria-hidden
            data-rule
            className="absolute inset-x-0 top-0 h-px bg-line"
          />
          <p className="font-app-mono text-[13px] text-accent-ink">{item.mark}</p>
          <h3 className="mt-3 text-section font-semibold text-ink">{item.title}</h3>
          <p className="mt-2.5 max-w-[60ch] text-base text-ink-soft">{item.body}</p>
        </Reveal>
      ))}
    </div>
  );
}

/**
 * A command you would actually type. The one place monospace appears on the
 * site, and one of the places night appears on a paper page: a terminal line
 * is the machine's, so it is set on the machine's ground, in the app's own
 * monospace fallback. Keep them to one command each.
 */
export function Command({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-night px-5 py-4 font-app-mono text-[13px] leading-relaxed wrap-anywhere text-on-night-soft">
      <span aria-hidden className="mr-3 text-accent select-none">
        $
      </span>
      {children}
    </div>
  );
}

/**
 * The words a person gave the agent, verbatim, on paper: a quiet label and the
 * message in body ink behind a 1px rule. It is a person's sentence, not the
 * machine's, so it is not a `Command` and does not borrow the night.
 */
export function Prompt({
  children,
  label = "The prompt, verbatim",
}: {
  children: ReactNode;
  label?: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <blockquote className="mt-2 max-w-[62ch] border-l border-line pl-4 text-base whitespace-pre-line text-ink-soft">
        {children}
      </blockquote>
    </div>
  );
}

/**
 * What ran, in order: one line per step, the tool's name (when the step is a
 * tool call) in the app's monospace and accent-ink, the rest in body ink.
 */
export function StepList({
  steps,
}: {
  steps: { tool?: string; rest: ReactNode }[];
}) {
  return (
    <ol className="space-y-1.5 text-sm text-ink-soft">
      {steps.map((step, i) => (
        <li key={i}>
          {step.tool ? (
            <span className="font-app-mono text-[13px] text-accent-ink">{step.tool}</span>
          ) : null}
          {step.rest}
        </li>
      ))}
    </ol>
  );
}

/** The closing statement of a page, set large. At most one per page. */
export function PullQuote({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="mt-24">
      <p className="max-w-[24ch] text-quote font-semibold text-balance text-ink">
        {children}
      </p>
    </Reveal>
  );
}

/**
 * One number and what it counts, for the owner's dashboard: the figure at
 * `text-headline` in ink, tabular, and a `text-sm` muted label under it. Set
 * several in a row with a grid; they carry no box and no rule of their own.
 */
export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div>
      <p className="text-headline font-semibold text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

/**
 * Counts as horizontal bars, for the owner's dashboard: the label on the left,
 * a 6px track in `line` with a bar in `ink-soft` scaled to the largest
 * value, and the number on the right. Neutral on purpose: a bar is
 * data, not a button, so it never takes the accent. No axis, no chart library.
 */
export function BarList({
  rows,
  empty = "Nothing yet.",
}: {
  rows: { label: ReactNode; value: number; key: string; note?: ReactNode }[];
  empty?: string;
}) {
  if (!rows.length) return <p className="text-base text-ink-soft">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-4 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
        >
          <span className="truncate text-ink-soft" title={typeof r.label === "string" ? r.label : undefined}>
            {r.label}
          </span>
          <span aria-hidden className="relative h-1.5 bg-line">
            <span
              className="absolute inset-y-0 left-0 bg-ink-soft"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-ink tabular-nums">
            {r.value.toLocaleString("en")}
            {r.note ? <span className="ml-2 text-muted">{r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
