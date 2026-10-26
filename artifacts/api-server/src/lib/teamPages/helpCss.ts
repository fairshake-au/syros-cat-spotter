// The help pieces' styles (help.ts), apart so the page shell can include them
// without importing help.ts, which imports the shell.

/** The styles for pageIntro, howFold, whatHappens and Words we use; part of the page shell's stylesheet. */
export const HELP_CSS =
  ".intro{max-width:65ch;margin:4px 0 14px;color:var(--ink)}" +
  ".howpage{margin:0 0 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:0 12px}" +
  ".howpage>summary{font-weight:700}" +
  ".howpage>p.hint{max-width:65ch;margin:0 0 8px 1.2em}" +
  ".howpage>p.hint:last-child{margin-bottom:12px}" +
  ".what{max-width:65ch;margin:8px 0;padding:8px 12px;border-radius:10px;background:var(--accent-soft);color:var(--ink);font-size:14px}" +
  ".what.warn{background:var(--warn-soft);border:1px solid var(--warn-line);font-weight:600}" +
  "dl.words{display:block;max-width:65ch;margin:0}" +
  "dl.words dt{font-weight:700;font-size:16px;color:var(--ink);margin:14px 0 2px;padding:0}" +
  "dl.words dd{margin:0;color:var(--ink)}";
