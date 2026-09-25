/**
 * Regions that outlive a page switch: the viewer and the timeline.
 *
 * Every page shows the programme viewer, and most show the timeline, but each page lays them out
 * in its own panel groups — so a page switch unmounts one set of groups and mounts another. If
 * `Preview` went with them, every switch would dispose the engine (`useEngine`'s cleanup: the
 * media pool, every decoded element, the audio graph, the composition pool) and build a new one
 * that starts cold, stops playback and replaces `window.bayEngine` under a probe holding the old
 * one. The timeline would lose its scroll position and zoom anchor the same way.
 *
 * So both are rendered exactly once, through a portal into a DOM node the workspace owns, and a
 * page only says *where* that node goes: `<Slot name="viewer" />` moves the node into its own
 * box (`appendChild` moves, it does not clone). React never sees the move — the portal's parent
 * is the same node throughout — so nothing remounts, and a 2D canvas keeps its bitmap across a
 * reparent. When no page claims a node (the Media page has no timeline) it waits in a hidden
 * parking box, still mounted.
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

export type HostedName = 'viewer' | 'timeline'

interface Host {
  nodes: Record<HostedName, HTMLDivElement>
  parking: RefObject<HTMLDivElement | null>
}

const HostContext = createContext<Host | null>(null)

function makeNode(name: HostedName): HTMLDivElement {
  const node = document.createElement('div')
  node.dataset.hosted = name
  node.className = 'flex h-full min-h-0 min-w-0 flex-col'
  return node
}

/** The workspace's hosted nodes, created once for its lifetime. */
export function useHost(): Host {
  const parking = useRef<HTMLDivElement>(null)
  const [nodes] = useState<Record<HostedName, HTMLDivElement>>(() => ({
    viewer: makeNode('viewer'),
    timeline: makeNode('timeline')
  }))
  return { nodes, parking }
}

export function HostProvider({ host, children }: { host: Host; children: ReactNode }): ReactNode {
  // Anything no slot claimed goes to the parking box. Children's layout effects run before this
  // one, so a slot that already took its node is left alone.
  useLayoutEffect(() => {
    const parking = host.parking.current
    if (!parking) return
    for (const node of Object.values(host.nodes)) if (!node.parentNode) parking.appendChild(node)
  })
  return (
    <HostContext.Provider value={host}>
      {children}
      <div ref={host.parking} hidden aria-hidden="true" inert data-hosted-parking="" />
    </HostContext.Provider>
  )
}

/**
 * Renders `children` into the named node, once. Place it *after* the page in the tree: sibling
 * layout effects run in order, so the page's slots have put the node in the document by the time
 * the hosted component's own layout effects measure anything.
 */
export function Hosted({ name, children }: { name: HostedName; children: ReactNode }): ReactNode {
  const host = useContext(HostContext)
  if (!host) throw new Error('Hosted must be inside a HostProvider')
  return createPortal(children, host.nodes[name])
}

/** Where a page wants a hosted region to appear. */
export function Slot({ name, className }: { name: HostedName; className?: string }): ReactNode {
  const host = useContext(HostContext)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const slot = ref.current
    const node = host?.nodes[name]
    if (!slot || !node || !host) return
    slot.appendChild(node)
    return () => {
      // Only if it is still here: the next page's slot may already have taken it.
      if (node.parentNode === slot) host.parking.current?.appendChild(node)
    }
  }, [host, name])
  return <div ref={ref} className={cn('flex h-full min-h-0 min-w-0 flex-col', className)} />
}
