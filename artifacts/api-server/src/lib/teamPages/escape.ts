/**
 * The one HTML escaper for every dashboard page (SYC-43 part 2 plan, PR 1).
 * Every value that reaches a page goes through it, in text and in attributes
 * (it escapes both kinds of quote). team.ts and the page frame share this one;
 * a second copy is how one gets forgotten.
 */
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
