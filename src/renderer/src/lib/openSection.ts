/**
 * Opens a collapsible `Section` by its id from anywhere — a collapsed section's body is not
 * mounted, so something that needs a field inside it (a double-click on a title in the viewer
 * focusing its Words) has to open it first. The section remembers the choice as if clicked.
 *
 * No imports, so `components/` can listen for it without reaching anything else.
 */
export const OPEN_SECTION_EVENT = 'bay:open-section'

export function openSection(id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: { id } }))
}
