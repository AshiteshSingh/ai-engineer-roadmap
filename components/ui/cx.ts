export function cx(
  ...a: (string | false | null | undefined)[]
): string {
  return a.filter(Boolean).join(" ");
}
