T1 done: restore-code columns (code_hash, code_attempts, handle_hash + unique index) in migration 0043, newCode/codeHash/isCodeShaped helpers, restore_code fingerprint label; next: T2 request/outbox/template
T2 done: request issues an 8-digit code, email carries it, outbox clears it; next: T3
T3 done: POST /api/restore/code (exchangeCode in lib/keepSafe/code.ts, per-phone cap after device auth, 800 ms pad, single refusal); next: T4
