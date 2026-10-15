# CHECKPOINT — SYC-42 Slice 3 (the reporter's email)

Branch: claude/syc-42-slice-3-reporter-email (worktree compassionate-meninsky-9805ac), from origin/main 2acae50.

## Findings (15 Oct 2026)
- Shared verification tables EXIST (SYC-3, migration 0012): email_contacts (purpose 'report' allowed, address stored),
  mail_tokens, mail_requests, email_consent_events, email_suppressions. Reuse; no duplicates.
- welfare_reports.reporter_contact_id exists (FK set null). report_state_events.reporter_message exists (empty until Slice 3).
- send.ts already has public_verify (news), report_ack/report_outcome (mail., Reply-To admin@syroscats.com), all OFF.
- No mail_deliveries table, no Resend webhook yet -> Slice 3 migration = mail_deliveries only (number TBD; SYC-44 PR 4.1 claims 0023).
- news.catspotters.com DNS: Resend DKIM, SPF and bounce MX present (dig, 15 Oct). Resend dashboard status UNCHECKED (no local Resend key).
- News (SYC-45) not built -> news tick box stays hidden.
- Emails today are English only (keepSafeTemplates). Open question to Samuel: reporter email language.

## Plan items
- [ ] 3.1 email box + consent wording (email-capture §3.4) in the app flow
- [ ] 3.2 address -> email_contacts(purpose report); report row holds reporter_contact_id
- [ ] 3.3 fixed verification (§4.1) from news; nothing else until confirmed
- [ ] 3.4 ack (§5.3g) after confirm + one outcome (§5.3h) at closing state; optional team sentence on Done
- [ ] 3.5 limits 1/24h, 3 lifetime, suppression; report row always written
- [ ] 3.6 mail_deliveries + Resend webhook (signature-checked) -> suppression
- [ ] 3.7 confirmation screen "If an email was given" line
- [ ] SYC-63: severPerson erases reporter contacts
