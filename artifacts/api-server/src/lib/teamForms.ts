import { z } from "zod";

// Small form-field readers shared by the team's Colonies and Feeding sites
// routes (SYC-209 PR 2.1, moved here by PR 3.3 so the sites forms read a
// coordinate exactly as the colonies' centre does).

/** Postgres refuses a NUL character in text, so a form carrying one is a bad form. */
const NUL = String.fromCharCode(0);
export const noNul = (s: string) => !s.includes(NUL);

/** A browser sends a text box's line breaks as CRLF; store them as LF. */
export const lf = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v);

/** An optional text box: "" means none. */
export const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      const s = lf(v);
      return typeof s === "string" && s.trim() === "" ? null : s;
    },
    z.string().trim().max(max).refine(noNul).nullable(),
  );

/** A coordinate box: "" means none; anything else must be a real number. */
export const coordinate = (limit: number) =>
  z.preprocess(
    (v) => {
      if (typeof v === "string") {
        const s = v.trim();
        if (s === "") return null;
        // Plain decimal numbers only: Number() would also take "0x10",
        // "0b11" and "1e1".
        return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
      }
      return v;
    },
    z.number().finite().min(-limit).max(limit).nullable(),
  );

export const fieldsOf = (err: z.ZodError) => [...new Set(err.issues.map((i) => i.path.join(".")))];
