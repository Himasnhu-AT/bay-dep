/**
 * Opens a collapsible `Section` by its id from anywhere — a collapsed section's body is hidden,
 * so something that needs a field inside it (a double-click on a title in the viewer focusing
 * its Words) has to open it first. The section remembers the choice as if clicked.
 *
 * The open state is written before the event is sent, because the section may not be mounted
 * yet: the inspector is tabbed, it hears the same event, switches to the tab holding `id`, and
 * the section then mounts reading the state written here. (`bay.section.<id>` is the key
 * `components/Panel.tsx` reads; it is the same key the section writes when clicked.)
 *
 * No imports, so `components/` can listen for it without reaching anything else.
 */
export const OPEN_SECTION_EVENT = 'bay:open-section'

export function openSection(id: string): void {
  try {
    localStorage.setItem(`bay.section.${id}`, '1')
  } catch {
    // Not remembered; a mounted section still opens on the event below.
  }
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: { id } }))
}
