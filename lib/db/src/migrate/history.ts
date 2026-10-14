import type { ClientBase } from "pg";
import type { Migration } from "./runner";

// SYC-178. Placeholder: the real check follows the tests.

export interface RecordedRow {
  id: number;
  hash: string;
  created_at: string | number;
}

export function historyProblems(
  _recorded: RecordedRow[],
  _migrations: Migration[],
): string[] {
  return [];
}

export interface HistoryResult {
  problems: string[];
  recorded: number;
  newest: string | null;
}

export async function checkHistory(
  _client: ClientBase,
  _migrations: Migration[],
): Promise<HistoryResult> {
  return { problems: [], recorded: 0, newest: null };
}
