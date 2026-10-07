/**
 * Only the newest of several overlapping loads may write its result. /admin
 * starts a read when the window changes; switching 7 → 30 → 7 quickly leaves
 * two reads in flight, and whichever answers last would otherwise put its
 * figures under the other one's label.
 *
 *   const guard = latest();
 *   const current = guard.begin();
 *   const data = await read();
 *   if (current()) show(data);
 */
export function latest() {
  let newest = 0;
  return {
    /** Starts a load; the function it returns is true while no later load has begun. */
    begin(): () => boolean {
      const id = ++newest;
      return () => id === newest;
    },
  };
}
