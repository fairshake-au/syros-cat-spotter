// Money as the team pages print it (SYC-396 PR 3.1a). Its own module, so a page
// can print a cost without importing the vet visit writer.

/** An amount as the pages print it: "€60", "€55.50". Cents, never a float's tail. */
export function euroText(eur: number): string {
  const cents = Math.round(eur * 100);
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `€${whole}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}
