import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

export interface ErrorBoundaryProps {
  /** What this region is called in the message: "the timeline", "the inspector". */
  region: string
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
  /** Bumped by "Reload panel", so the children mount fresh rather than re-render in place. */
  generation: number
}

/**
 * Keeps one region's crash inside that region.
 *
 * Without one, a single render error unmounts React's whole root: a slider that read
 * `undefined.toFixed` on a partial `adjustments` object blanked the entire window, with no message
 * and nothing to click but reloading the app. Here the region shows what happened and offers to
 * mount it again; the project, the other regions and undo are untouched, so an edit that made the
 * region throw can be undone (⌘Z) and the region reloaded.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, stack: null, generation: 0 }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is where a developer looks; the panel is where a person does.
    console.error(`bay: ${this.props.region} hit an error`, error, info.componentStack)
    this.setState({ stack: info.componentStack ?? null })
  }

  private reload = (): void => {
    this.setState((state) => ({ error: null, stack: null, generation: state.generation + 1 }))
  }

  override render(): ReactNode {
    const { error, stack, generation } = this.state
    if (!error) return <RegionKey key={generation}>{this.props.children}</RegionKey>
    return (
      <div role="alert" className="flex h-full min-h-0 flex-col items-start gap-2 overflow-auto bg-surface-1 p-4 text-[12px]">
        <div className="flex items-center gap-2 text-ink-0">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-danger" />
          <span className="font-medium">
            {this.props.region.charAt(0).toUpperCase() + this.props.region.slice(1)} hit an error
          </span>
        </div>
        <p className="text-pretty text-ink-1">
          Your project is safe — nothing else was affected. If an edit just caused this, undo it (⌘Z) and reload
          the panel.
        </p>
        <Button size="sm" onClick={this.reload}>
          Reload panel
        </Button>
        <details className="w-full text-ink-2">
          <summary className="cursor-default select-none">Details</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-surface-2 p-2 text-[10px] leading-snug whitespace-pre-wrap select-text">
            {error.message}
            {stack ? `\n${stack.trim()}` : ''}
          </pre>
        </details>
      </div>
    )
  }
}

/** A keyed fragment: changing the key remounts the region. */
function RegionKey({ children }: { children: ReactNode }): ReactNode {
  return children
}
