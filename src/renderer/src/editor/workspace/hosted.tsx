/**
 * Regions that outlive a page switch: the viewer, the timeline and the agent panel.
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
 *
 * The one thing a move does lose is scroll: Chromium drops the offsets of the scrollers inside a
 * moved subtree, so the timeline came back from another page scrolled to the start. Each node
 * remembers them (`ScrollMemory`) and its slot puts them back after the move.
 *
 * The agent panel is hosted for its own state rather than an engine: its draft, pending
 * attachments and in-flight send guard live in the component, and a remount (a switch between the
 * Resolve dock and the AI layout, or undocking) dropped all three — a double send became possible
 * and a refused attachment's message landed on an unmounted panel. Parked, it stays mounted.
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
import { ScrollMemory } from './scrollMemory'

export type HostedName = 'viewer' | 'timeline' | 'agent'

interface Host {
  nodes: Record<HostedName, HTMLDivElement>
  scrolls: Record<HostedName, ScrollMemory<Element>>
  parking: RefObject<HTMLDivElement | null>
}

const HostContext = createContext<Host | null>(null)

function makeNode(name: HostedName, scrolls: ScrollMemory<Element>): HTMLDivElement {
  const node = document.createElement('div')
  node.dataset.hosted = name
  node.className = 'flex h-full min-h-0 min-w-0 flex-col'
  // `scroll` does not bubble; capture sees every scroller inside.
  node.addEventListener('scroll', (event) => {
    if (event.target instanceof Element) scrolls.record(event.target)
  }, { capture: true, passive: true })
  return node
}

/** The workspace's hosted nodes, created once for its lifetime. */
export function useHost(): Host {
  const parking = useRef<HTMLDivElement>(null)
  // One object for the workspace's life: slots depend on it, and a new one each render would
  // re-run every slot's move.
  const [host] = useState<Host>(() => {
    const scrolls = {
      viewer: new ScrollMemory<Element>(),
      timeline: new ScrollMemory<Element>(),
      agent: new ScrollMemory<Element>()
    }
    const nodes = {
      viewer: makeNode('viewer', scrolls.viewer),
      timeline: makeNode('timeline', scrolls.timeline),
      agent: makeNode('agent', scrolls.agent)
    }
    return { nodes, scrolls, parking }
  })
  return host
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
    host.scrolls[name].restore((element) => node.contains(element))
    return () => {
      // Only if it is still here: the next page's slot may already have taken it.
      if (node.parentNode === slot) host.parking.current?.appendChild(node)
    }
  }, [host, name])
  return <div ref={ref} className={cn('flex h-full min-h-0 min-w-0 flex-col', className)} />
}
