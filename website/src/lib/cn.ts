/**
 * Join class names, dropping anything falsy. Deliberately tiny: this site has
 * three runtime dependencies and a class-name utility is not worth a fourth.
 * There is no conflict resolution, so write conditionals that do not overlap
 * rather than relying on later classes winning.
 */
export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
