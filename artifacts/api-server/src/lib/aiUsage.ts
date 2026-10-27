import { logger } from "./logger";

/** Which feature made the AI call. A fixed list, so a log line can't carry anything else. */
export type AiCaller = "sighting_match" | "find_from_photo" | "coat_reading" | "name_suggestion";

/**
 * SYC-534: one log line per paid AI call, with the tokens it used and which
 * feature made it, so the cost of a sighting, a search and a coat reading can
 * be worked out from real numbers. Nothing else goes in the line: no photo,
 * cat, person, device or position. A reply with no `usage` logs nulls, so a
 * gap shows up in the logs rather than as a missing line.
 */
export function logAiUsage(
  caller: AiCaller,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): void {
  logger.info(
    {
      caller,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    },
    "ai token usage",
  );
}
