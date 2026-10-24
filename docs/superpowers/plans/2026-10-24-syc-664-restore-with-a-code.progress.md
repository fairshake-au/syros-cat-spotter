T1 done: restore-code columns (code_hash, code_attempts, handle_hash + unique index) in migration 0043, newCode/codeHash/isCodeShaped helpers, restore_code fingerprint label; next: T2 request/outbox/template
T2 done: request issues an 8-digit code, email carries it, outbox clears it; next: T3
T3 done: POST /api/restore/code (exchangeCode in lib/keepSafe/code.ts, per-phone cap after device auth, 800 ms pad, single refusal); next: T4
T4 done: peek, redeem and the 60 s replay accept a handle (rowIs at all four mail_tokens lookups in move.ts); next: T5
T5 done: exchangeRestoreCode + code guards in keepSafe.ts, restoreWaiting store (15 min, web localStorage); next: T6
T6 done: RestoreChooser extracted from app/restore.tsx (fromCode skips in-app advice, onMoved prop); next: T7
T7 done: code screen (address, code, chooser) with en/el/fr strings; next: T8
