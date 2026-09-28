/** Search matches a family's name, not its whole stack: "sans" should not match every fallback. */
export function fontMatches(option: { label: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || option.label.toLowerCase().includes(q)
}

/**
 * The picker's order: the project's imported fonts first — they travel with the project — then
 * the machine's, each group in the order given. Filtered by `query` on the family's name.
 */
export function fontGroups<T extends { label: string; group: 'project' | 'system' }>(
  options: readonly T[],
  query: string
): { project: T[]; system: T[] } {
  return {
    project: options.filter((option) => option.group === 'project' && fontMatches(option, query)),
    system: options.filter((option) => option.group === 'system' && fontMatches(option, query))
  }
}
