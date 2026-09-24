import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'

/**
 * The agent's prose, rendered.
 *
 * It writes markdown — bold labels, bullet lists, the odd table or code span — and shown as
 * plain text that is a wall of asterisks and hyphens. Rendered with `react-markdown`, which
 * builds React elements from the syntax tree and never injects HTML: raw HTML in the text is
 * shown as text, so nothing the model writes can put markup or script into the editor.
 *
 * Sized for a narrow side panel: tight spacing, no heading larger than body text plus a step,
 * and anything wide (code blocks, tables) scrolls inside itself rather than widening the panel.
 * Links carry `target="_blank"`, which the main process routes to the system browser — a link
 * followed in-window would navigate the editor away.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink-0">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 marker:text-ink-2">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-0 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-0 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-2.5 mb-1 text-[12px] font-semibold text-ink-0 first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2.5 mb-1 text-[12px] font-semibold text-ink-0 first:mt-0">{children}</h4>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-line-strong pl-2 text-ink-1 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-line" />,
  code: ({ children, className }) =>
    // Fenced blocks arrive with a `language-…` class and are wrapped by `pre` below; everything
    // else is an inline span.
    className ? (
      <code className={cn('font-mono text-[11px]', className)}>{children}</code>
    ) : (
      <code className="rounded-xs bg-surface-3 px-1 py-px font-mono text-[11px] text-ink-0">{children}</code>
    ),
  pre: ({ children }) => (
    // A fence with no language reaches `code` without a class, which is indistinguishable from
    // an inline span there — so the block undoes the inline chip styling on its own child.
    <pre className="mb-2 overflow-x-auto rounded-md border border-line bg-surface-2 p-2 leading-relaxed last:mb-0 [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line-strong px-1.5 py-1 text-left font-semibold text-ink-0">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-1.5 py-1 align-top">{children}</td>
}

export function Markdown({ children, className }: { children: string; className?: string }): ReactNode {
  return (
    <div className={cn('min-w-0 break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
