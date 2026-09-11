import { useEffect, useRef } from 'react'
import { allItems } from '@shared/project'
import { selectDuration, selectTimeline, useEditor } from '@/store/editor'

export interface KeyboardOptions {
  /** Cmd+S. Lives outside the store because saving is an IPC round trip. */
  onSave(): void
  /** Cmd+E opens the export dialog; Escape closes whatever modal is open. */
  onExport(): void
  onEscape(): void
}

/** True when the keystroke belongs to whatever the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Every global shortcut in the app, in one place.
 *
 * Mounted once, at the root. Two rules it exists to enforce: a shortcut never fires while
 * a text field has focus — otherwise typing "s" into a clip name silently razors the
 * timeline — and Escape is the one key that still works there, because Escape is how you
 * get out.
 */
export function useKeyboard(options: KeyboardOptions): void {
  // Read through a ref so the listener is registered once, not on every parent render.
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTyping(event.target)
      const mod = event.metaKey || event.ctrlKey

      if (event.key === 'Escape') {
        latest.current.onEscape()
        return
      }
      if (typing) return

      const state = useEditor.getState()

      if (mod) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault()
            if (event.shiftKey) state.redo()
            else state.undo()
            return
          case 'd':
            event.preventDefault()
            state.duplicateSelected()
            return
          case 's':
            event.preventDefault()
            latest.current.onSave()
            return
          case 'e':
            event.preventDefault()
            latest.current.onExport()
            return
          case 'a': {
            event.preventDefault()
            const timeline = selectTimeline(state)
            if (timeline) state.select(allItems(timeline).map((item) => item.id))
            return
          }
          default:
            return
        }
      }

      switch (event.key) {
        case ' ':
          // Space is also "activate" for a focused button, so it must be claimed before
          // the default action turns the last button the user clicked into a play toggle.
          event.preventDefault()
          state.togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          state.nudgePlayhead(event.shiftKey ? -10 : -1)
          break
        case 'ArrowRight':
          event.preventDefault()
          state.nudgePlayhead(event.shiftKey ? 10 : 1)
          break
        case 'Home':
          event.preventDefault()
          state.setPlayhead(0)
          break
        case 'End':
          event.preventDefault()
          state.setPlayhead(selectDuration(state))
          break
        case 's':
        case 'S':
          event.preventDefault()
          state.splitAt()
          break
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          // Shift is ripple, as it is in Premiere and Resolve: remove the span and close it.
          // Plain delete lifts and leaves the gap. Two operations, one key, and the modifier
          // is the one editors already have in their fingers.
          if (event.shiftKey) state.rippleDelete()
          else state.deleteSelected()
          break
        case '=':
        case '+':
          event.preventDefault()
          state.zoomBy(1.25)
          break
        case '-':
        case '_':
          event.preventDefault()
          state.zoomBy(1 / 1.25)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
