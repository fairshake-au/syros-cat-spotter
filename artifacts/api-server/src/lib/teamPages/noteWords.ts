// The first words of a reporter's note, for one-line rows on Home and the Queue.

const NOTE_WORDS = 80;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The first words of a note, on whole characters: a family emoji or a flag is one, never cut in half. */
export function firstWords(note: string | null): string {
  if (!note) return "";
  const chars = [...graphemes.segment(note.trim().replace(/\s+/g, " "))].map((s) => s.segment);
  return chars.length <= NOTE_WORDS ? chars.join("") : `${chars.slice(0, NOTE_WORDS).join("").trimEnd()}…`;
}
