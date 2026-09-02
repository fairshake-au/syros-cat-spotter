# Team access and the welfare queue

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.0 · 3 September 2026
**Covers:** PRODUCT-SPEC §2.5 (cat in trouble), §2.6 (team access), and the sign-in that makes both usable.
**Linear:** SYC-42 (report flow, urgent) · SYC-43 (staff dashboard) · SYC-44 (report an issue) · SYC-25 (mail transport, urgent) · SYC-26 (Google sign-in) · SYC-29 (adding people) · SYC-30 (admin@syroscats.com as a recipient).
**Status:** for adversarial review, then Samuel's approval, then an implementation plan.

---

## 1. The short version

Today a tourist can meet a hundred cats on Syros and photograph every one of them. If one of those cats is bleeding, starving, or has just had kittens under a taverna chair, the app has nothing to say and Syros Cats never hears about it. Meanwhile the charity — the people who actually know what to do — have no window into any of the data being collected about their own island.

This spec closes both gaps with three connected pieces:

1. **One staff sign-in.** A Syros Cats person types their email address, gets a link, clicks it, and they are in. No password to remember, no password to leak, no password to rotate when somebody leaves.
2. **A staff dashboard.** One page that answers "what needs us today?" — the welfare queue, the feeding-site map, the ability to fix a wrong record, and colony names that match the names they already use out loud.
3. **A report flow for the public.** "This cat needs help" and "there's something wrong with this photo", both reaching admin@syroscats.com *and* an in-app queue, with the reporter told what happened next.

Running through all of it is the piece that matters most and is easiest to get wrong: **capacity messaging**. Syros Cats are a small charity with finite money and finite space. Their goal is *fewer cats in their own care and more care happening in the community* — while still capturing every scrap of data about what is going on. A report button that quietly promises "we'll come and get it" would make their lives worse, not better. Section 5 is the design that avoids that, and it is the section to read first if you only read one.

### The two audiences want the same thing from different angles

A worried tourist wants to know that the cat they found will be alright, and that telling someone was worth doing. A cat guardian who has fed the same alley for nine years wants the record to be correct and the charity to know what she already knows. These are **complementary** needs: the tourist supplies attention and a photo at the moment it matters; the guardian and the team supply the judgment about what it means. The welfare queue is where those two meet.

---

## 2. Staff sign-in

### 2.1 What a Syros Cats person experiences

She opens the workspace on her phone. One field: her email address. She types it and taps "Send me a link".

Whatever she typed, the screen says the same thing: *"If that address is on the list, a link is on its way. It works once and lasts fifteen minutes."* It says that even for an address that is not on the list, and it takes the same moment to say it — otherwise the page becomes a tool for finding out who at Syros Cats has access.

She opens her mail, taps the link, and she is in, for thirty days, on that device. There is nothing to memorise and nothing to write on a Post-it. If she is on a shared computer she taps "Sign out" and the session is gone.

If somebody leaves the charity, their address comes off the list and their next click bounces them back to the sign-in page. There is no shared secret circulating that has to be changed for everyone else too.

### 2.2 Why email links rather than passwords

A shared password is the worst of both worlds for a small team: everybody knows it, nobody can prove who used it, and removing one person means disrupting all of them. An email link inverts that. The mailbox is the credential, and the mailbox is already the thing Syros Cats protect. It also means the list of who has access is a list of email addresses — something the charity can read, understand, and ask to change without a technical conversation.

The link is single-use and short-lived (fifteen minutes) precisely because email is not a private channel: it sits in inboxes, gets forwarded, gets scanned by security software. A link that stops working the moment it has been used, and expires within the length of a coffee, is a poor prize for anyone who gets hold of it later.

### 2.3 Decision: how the email actually gets sent

The sign-in flow is only as real as the mail transport behind it. A link nobody receives is a locked door. This decision also carries the welfare-report emails in section 5 and the issue reports in section 6 — it is one dependency serving three features, which is why it is the first thing to settle.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Resend** (a transactional email service) | The workspace calls Resend's HTTP API with an API key held as a platform secret. The sending domain `catspotters.com` is verified once with DNS records. | Fits the platform exactly — an HTTP call, no mail server, no ports. Real deliverability tooling: we can see that a message was accepted, bounced, or spam-foldered, which matters enormously when the failure mode is "Susan says she never got it". One provider covers sign-in links, welfare reports, issue reports and later the "your cat was sterilised" loop. Sends to any address, so it does **not** need admin@syroscats.com to be verified by anybody at Syros Cats first. Free tier comfortably covers this volume. | One more supplier in the stack, and one API key to hold safely (see 2.5). Domain verification needs DNS records added — minutes of work, but it is a step. |
| **B. Cloudflare Email Sending** | The platform sends the mail itself through a built-in binding. DNS records on `catspotters.com`. | No third-party account and, importantly, **no API key at all** — the permission is a platform binding rather than a secret that can leak. Fewest moving parts. | Less mature; thinner sending logs, so diagnosing "it didn't arrive" is harder. Reputation and deliverability are less within our control. Still needs the same DNS work, so it does not save the step it appears to save. |
| **C. Google Workspace SMTP** (send as admin@syroscats.com) | Authenticate to Google's mail servers and send as the charity's own address. | Mail genuinely comes from Syros Cats, which is the friendliest possible "from" line. No new supplier. | The platform the workspace runs on has no real SMTP client — this fights the architecture rather than using it. Requires either an app password or a service-account OAuth grant stored as a long-lived credential; an app password in particular is a reusable key to the charity's mailbox, which is a much worse thing to hold than a send-only API key. Google throttles and occasionally blocks programmatic sending, and when it does, sign-in stops for everyone. **Not recommended in any form.** |
| **D. Google sign-in instead of email** (SYC-26) | People sign in with the Google account they already use for admin@syroscats.com. Google proves who they are; our list decides whether they get in. | No email to deliver at all, so the mail problem disappears for sign-in. One tap for anyone already signed in to Google, which most of them will be. | Only helps people with a Google account — and it does not remove the mail dependency, because welfare reports and issue reports still have to be sent. Needs an OAuth client created outside the platform, plus a client ID and secret. Adds a second identity path to keep correct: **Google proving who somebody is must never be the same thing as letting them in** — the allow-list check still has to happen after Google answers. |

**Recommendation: A now, D soon, B named as the fallback.**

Take Resend. It unblocks sign-in, welfare reports and issue reports in one move, it is already the shape the code expects, and its logs are the difference between "we think the email went" and "we know it did". Add Google sign-in as a second door once the first door works — it is a genuine convenience for a team already living in Google Workspace, and it makes sign-in survive a mail outage. If domain verification with Resend stalls for any reason, Cloudflare Email Sending is the fallback and requires no code rethink, only a different send call.

One useful side effect: because Resend delivers to any address, **welfare reports can go straight to admin@syroscats.com without waiting for anyone at Syros Cats to click a verification link** (the blocker in SYC-30). SYC-30 is still worth finishing so that mail to `hello@catspotters.com` reaches the charity too — but it stops being on the critical path for this feature.

### 2.4 Decision: where the staff dashboard lives

The cat data and the workspace currently sit in different places. That is fine for documents; it is not fine for a dashboard that has to show cats, sightings and welfare reports.

| Option | Benefits | Risks |
|---|---|---|
| **A. Dashboard on the app's own backend, one sign-in issued there; the document workspace links across.** | One source of truth for cats. The queue sits next to the data it acts on. One identity, one allow-list, one place to add or remove a person. | The sign-in flow has to exist in a second codebase — the design carries over, the code does not. |
| **B. Dashboard inside the existing workspace, calling the app's API for everything.** | Reuses the sign-in that already exists. Nothing new to stand up. | Every screen becomes a network hop away from its data; permissions have to be enforced twice; the API grows a staff-only surface that must be guarded separately. Slower and more fragile for no real gain. |
| **C. Two separate sign-ins, one per system.** | Simplest to build. | Directly contradicts the requirement — "one Syros Cats staff sign-in". Two links in two inboxes for the same person is exactly the friction that stops a volunteer using a tool. |

**Recommendation: A.** One identity, issued by the backend that owns the cat data, with the document workspace recognising the same person. The list of who is allowed in lives in one table, and adding a colleague (SYC-29) is one row, once.

### 2.5 Handling the sending key safely — non-negotiable

The Resend API key is a credential that can send mail as `catspotters.com`. It must be set as a **platform secret** (`wrangler secret put RESEND_API_KEY` / the deployment platform's secret store), never:

- written into a configuration file that is committed to a repository,
- pasted into a scheduled routine, automation, or agent prompt,
- included in a runbook, ticket, or chat message.

If a scheduled or automated job ever needs to send mail, it reads the secret from the platform at run time; the alternative — a key sitting in cleartext inside a routine — turns one convenience into a permanent exposure that no rotation schedule can undo. Scope the key to sending only, and treat rotation as a five-minute job so that rotating it is never the reason not to.

Google's client secret (option D) has exactly the same rule.

### 2.6 Who is on the list

The allow-list is a table of people: email address, name, role, and when they were added. Adding a colleague is adding a row; removing them is removing one, and their next request ends their session.

Two operational truths the charity should be told plainly, because they change behaviour:

- A thirty-day session on a device is convenient and also real — someone removed from the list loses access at their next request, but a browser they left signed in elsewhere is not something we can reach into. Shared or borrowed devices should be signed out.
- Any shared password that exists alongside this (for public documents, say) is visible to everyone with access, so removing a person realistically means changing that password too. **Recommendation: retire shared passwords entirely once the staff sign-in is live.** One credential model, not two.

---

## 3. The staff dashboard

One page, mobile-first, because a Syros Cats volunteer is far more likely to open this standing in a street than sitting at a desk.

### 3.1 What needs us today — the welfare queue

The landing view. A list, newest and most urgent first:

- **Urgent** reports at the top, marked unmistakably.
- **Needs attention** below.
- Each row: the photo, where it was found (exact location — this is the team view), how long ago, what the reporter said, and whether the reporter left a way to contact them.
- Each row has one of four states: **New · Looking at it · Done · Not for us**. Changing the state is one tap, and it is what triggers the reporter's update (section 5.5).
- A free-text note field on each report, visible to the team only — "Maria went, cat had already moved on".
- If the report can be tied to a cat already in the catalogue, the row links straight to that cat's record.

The queue is deliberately not a ticketing system. Four states, one note field, no assignment, no due dates. A charity of this size will use a simple thing and abandon a complicated one.

### 3.2 The feeding-site map

Every feeding site on the island, on a map, **visible only to Syros Cats by default**. Each site has a switch: *private* (the default) or *public*. A site only becomes visible in the public app when someone at Syros Cats turns that switch on, one site at a time.

This is a safety feature, not a preference. A public list of where cats reliably gather is a public list of where to find cats, and the charity has good reasons to worry about who else reads it. So: private unless deliberately opened, no bulk "make everything public" action, and a plain-English line on the toggle saying what turning it on means. Turning a site public is recorded with who did it and when — not to police anybody, but so the question "how did this become public?" always has an answer.

**Dependency:** the list of sites that may be public comes from Syros Cats. It is requested early and it never blocks — every site simply stays private until they say otherwise, which is the correct default anyway.

### 3.3 Fixing what is wrong

Small corrections, done in seconds, by people who actually know:

- **Hide a photo** — one tap, reversible, no confirmation dialogue theatre. A bad photo comes down first and gets discussed afterwards.
- **Rename a cat** — because the AI-suggested or tourist-supplied name is sometimes simply wrong, and the charity's name for a cat is the real one.
- **Correct a life status** — street, homed, in care, deceased.
- **Correct a sterilisation record** — a team entry is *Confirmed*; a clipped tip seen by a spotter is *Likely*; the absence of a visible clip is never evidence of anything. Photographs are taken from the wrong side all the time.
- Every correction records who made it and when, so a disagreement can be traced rather than argued.

### 3.4 Colony names

Colonies get the names Syros Cats already use — a place plus the name of the person who looks after it ("Vaporia — Eleni's"). The dashboard lets the team create a colony, name it that way, and attach feeding sites and cats to it.

This sounds like a small feature and is not. The charity's operational vocabulary is colony names; a system that invents its own names quietly stops matching the conversations people have on the phone, and then nobody trusts it. The person named in a colony is a **cat guardian** — the term the charity uses — and naming a colony after her is the first, lightest step towards the full guardian role in section 7.

---

## 4. "This cat needs help" — the report flow

### 4.1 Where it starts

A "this cat needs help" action is available from the obvious places: the camera flow, a cat's record, and the map. It is never buried, and it is never the biggest thing on the screen — most cats are fine, and an app that shouts "REPORT A PROBLEM" at everyone teaches people to ignore it.

### 4.2 What the reporter is asked

Short. Someone using this is worried, possibly upset, and possibly standing in the sun with one hand on their phone.

1. **A photo** — reused automatically if they have just taken one.
2. **Where** — the confirmed location, exactly as the spotting flow does it, so a poor GPS fix does not send someone to the wrong street.
3. **How bad** — two choices, in plain words:
   - *Needs attention* — "Thin, limping, sore eye, or just not right."
   - *Urgent* — "Badly hurt, collapsed, or in danger right now."
4. **What you saw** — free text, optional, no character counter, no format.
5. **A litter?** — a tick box: "This is kittens, or a mother with kittens." This changes what the app says next (section 5.4).
6. **Your email** — optional, with the reason stated: "So we can tell you what happened. We use it for this and nothing else, and you can ask us to delete it." Consent-based, purpose-stated, deletable.

### 4.3 What happens when they submit

Two things at once:

- An email to **admin@syroscats.com**, containing the photo, the location, a map link, the severity, the note, and the reporter's contact if they gave one — everything needed to act without opening anything else.
- A row in the **in-app queue** (section 3.1), which is where the team actually works and where the reporter's status update comes from.

If the phone has no signal, the report queues locally alongside offline sightings and sends when signal returns. **Be precise about this with users:** the report is safely saved on the device, and it reaches Syros Cats when the phone next has a connection. It is not delivered while offline, and the confirmation screen says so rather than implying someone has already been told.

---

## 5. Capacity messaging — the most important part of this spec

### 5.1 The problem in one paragraph

Syros Cats can only look after so many cats. Every cat that comes into their care costs money they would rather spend on sterilisation, which is what actually reduces suffering on the island over time — at **€50–60 per cat**, one sterilisation prevents far more misery than one rescue. Their aim is *fewer cats in their care and more care happening in the community*: a visitor who takes a sick cat to a vet themselves, or a resident who keeps an eye on a litter where it is, does more good than a report that becomes an expectation the charity cannot meet. But the charity still wants the data — every one of those cats should end up in the record.

So the flow has to do something delicate: **capture the report, and at the same time move the reporter towards acting themselves.** Not by refusing to help. By being honest, early, and warm about what happens next.

### 5.2 Where the messaging goes

Two moments, deliberately:

- **Before submitting**, on the severity step — a short block of guidance that gives the reporter a better option than waiting.
- **After submitting**, on the confirmation screen and in the acknowledgement email — Syros Cats' standard reply, so the person has it in writing.

Guidance before the report, not instead of it. The report always goes through. Nobody is ever blocked from telling the charity something.

### 5.3 Draft copy — for Syros Cats to review

> **Everything below is a draft written to be corrected.** It is a starting point so Syros Cats have something concrete to react to, not a proposal to publish as-is. The charity has the final word on every line, and Susan's standard reply (5.6) replaces the acknowledgement wording once it arrives.

**On the severity step, when "Urgent" is chosen:**

> **If this cat is badly hurt, the fastest help is a vet.**
> Syros Cats is a small charity and there may not be anyone free to come out today. If you are able to take this cat to a vet yourself, that is the quickest thing that can happen for it — and it might save its life.
>
> Please know the vet will normally charge you for the visit. If that is difficult, tell us in your report and send it anyway.
>
> Either way, please send this report. It tells us where this cat is and helps us look after the cats of Syros.
>
> *[Nearest vets — Ermoupoli · phone · map]*

**On the severity step, when "Needs attention" is chosen:**

> **Thank you for noticing.**
> Reports like this are how Syros Cats know which cats need checking. Someone will look at it, though it may not be today — the team is small and the island is large.
>
> If the cat seems to be getting worse, a vet is the fastest help, and you can send another report any time.

**On the confirmation screen, after any report:**

> **Sent. Thank you.**
> Syros Cats have this now, with your photo and the location.
>
> They will look at every report, but they cannot always come out — often the best thing for a cat is someone nearby keeping an eye on it, and you have already done the most important part by telling them.
>
> *[If an email was given]* We will email you when the team has looked at it.
>
> *[Susan's standard reply appears here — see 5.6]*

**When the report is marked as a litter:**

> **Please talk to us before you bring kittens anywhere.**
> Kittens are almost always better off where they are, with their mother, than moved. She is usually nearby even when you cannot see her, and she is far better at this than any of us.
>
> If they are truly in danger, please **contact Syros Cats first** rather than turning up with them. There may not be space, and a kitten that arrives unannounced is much harder to help than one we have planned for.
>
> **admin@syroscats.com** · *[phone, once confirmed]*
>
> Sending this report is exactly the right thing to do. It helps us plan sterilisation for the mother, which is what stops the next litter — around **€50–60** does it, and it is the single most useful thing anyone can pay for on this island.

**In the acknowledgement email:**

> Subject: We have your report about a cat on Syros
>
> Hello,
>
> Thank you for telling us about this cat. Your report and photo reached Syros Cats on *[date]*.
>
> Someone will look at it. We cannot always come out — we are a small charity and there are a great many cats — but every report goes into the record, and the record is what lets us plan sterilisation where it will do the most good.
>
> If this cat is badly hurt and you are able to take it to a vet yourself, please do; the vet will normally charge for the visit. If it is a litter of kittens, please contact us before bringing them anywhere.
>
> We will write again when the team has been able to look at this.
>
> Syros Cats
> admin@syroscats.com

### 5.4 Litter reports specifically

Ticking "this is kittens" changes three things: the guidance above appears in place of the general text, the queue row is tagged as a litter, and the acknowledgement carries the "contact us first, don't just turn up" line. Same rule, same words, in the flow and in the email — a message that only appears in one place is a message half the people never see.

### 5.5 Closing the loop with the reporter

If the reporter gave an email address, they hear from us twice and no more:

1. **Straight away** — the acknowledgement above.
2. **When the team changes the state** — one message when the report moves to *Looking at it*, *Done*, or *Not for us*, with a sentence the team can edit before it sends.

No newsletter, no drip campaign, no third message. The email was given for one purpose and it gets used for that purpose. Every message carries a one-click way to delete the address entirely.

If they gave no email, the confirmation screen is the whole of the loop, and it says so honestly rather than implying a follow-up that will never come.

### 5.6 Dependency: Susan's standard reply

Syros Cats already have a form of words they use when someone reports a sick cat. Susan is sending it. When it arrives it replaces the drafts in 5.3 — theirs is better, because it is what they actually say and it carries their name.

**This never blocks the build.** The draft copy above ships as a placeholder in a single copy file, marked clearly, and swapping it in is a text change requiring no code and no release of the app if the copy is served from configuration. The request goes to Syros Cats early, in writing, with the drafts attached so they have something easy to react to rather than a blank page.

---

## 6. "Report an issue" on cats and photos

Every cat record and every photo carries a quiet "Report an issue" action.

The reporter picks a reason in plain words:

- Wrong information about this cat
- This is not a cat / not this cat
- The photo is upsetting or inappropriate
- Something else

Plus an optional note, and an optional email.

It goes to the same two places: **admin@syroscats.com** and the in-app queue, arriving in the same list as welfare reports but visually distinct — a wrong name is not an emergency and must never sit at the top of a queue above an injured animal.

**Objectionable content is treated differently in one specific way.** A photo reported as upsetting or inappropriate is **hidden immediately, automatically, before any human looks at it**, and appears in the queue for the team to restore or confirm. The reasoning is simple: the cost of briefly hiding a perfectly good photo of a cat is nothing, and the cost of leaving genuinely objectionable content visible while waiting for a volunteer to wake up is real. Repeated reports from the same device that are all overturned are a signal the team can see, which is how abuse of the hide-it button gets noticed.

---

## 7. Roles now, roles later

### 7.1 What exists now

One role: **Syros Cats staff**. Everyone on the list can see everything and change everything in the dashboard. For a team of this size that is honest and correct — inventing permissions nobody has asked for produces a system where the person who needs to fix something can't.

### 7.2 What is coming

Later, the same access model carries invited roles: **cat guardians** (who look after specific colonies and are authorised to arrange sterilisation the charity pays for), **volunteers**, and **vets**. Those roles need things this one does not — a guardian should see her own colonies in full and other people's approximately; a vet needs to record a procedure but has no business renaming cats; a volunteer working a hillside with no mobile data needs the colony view to work offline.

### 7.3 What we are leaving room for, deliberately

So that later arrives without a rebuild:

- **People, not admins.** The access table is a table of *people* with a role, not a table of administrators. Adding a second role is adding a value, not adding a table.
- **Permission checks ask "can this person do this?", never "is this person staff?".** Every check goes through a single capability function. When guardians arrive, that function changes; the screens do not.
- **Scope is a first-class idea from day one.** A person's access has a scope — today "everything", tomorrow "these colonies". The data model carries the column even while there is only one value in it, because retro-fitting scope into permission checks written without it is the expensive version of this work.
- **Invitation is the only way in, at every tier.** The email-link flow is the same flow a guardian will use. No second sign-in mechanism gets built for the second role.
- **Every change is attributed.** Who did it and when, from the first record. Attribution added later cannot describe the past.
- **Colony membership already exists** (section 3.4), so "which colonies is this person a guardian of?" is a join, not a new concept.

What we are explicitly *not* building now: an invitation user interface, per-field permissions, approval workflows, or an offline volunteer view. Those belong with the roles they serve.

---

## 8. Technical notes

*This section is for whoever implements it. Everything above is the product; this is the wiring.*

### 8.1 Sign-in mechanics

- **Allow-list first.** A sign-in link is only minted for an address present in the people table. The response, the status code, and the response *time* are identical either way — a padded delay before replying, so the endpoint cannot be used to enumerate who has access.
- **Token:** 32 bytes of cryptographic randomness, stored with the address and an expiry. **Fifteen minutes, single use.**
- **Single use means a conditional write, not read-then-write.** `UPDATE … SET used_at = now WHERE token = ? AND used_at IS NULL AND expires_at >= ? RETURNING email`. A mail scanner prefetching the link while the person clicks it must not result in two valid sessions.
- **Session:** signed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed, thirty days. Every request re-checks the address against the people table, so removal takes effect at the next request rather than at cookie expiry.
- **Read every cookie of that name, not the last one.** A sibling subdomain can set a same-named cookie; taking only one value lets it shadow the real session.
- **Signature verification is constant-time**, and a token whose payload has no parseable expiry is rejected rather than treated as never expiring.
- **Cross-site POSTs are refused outright.** A missing `Origin` header is not a free pass — `SameSite=Lax` treats every sibling subdomain as same-site, so this check is what stands between a compromised subdomain and these endpoints.
- **Google sign-in (when added):** exchange the code, read the *verified* email claim, and **only then** check the people table. Google authenticating someone is not authorisation. Redirect URI registered exactly; client ID and secret as platform secrets.

### 8.2 Mail

- `RESEND_API_KEY` and `MAIL_FROM` as platform secrets (see 2.5). Sending domain verified with SPF/DKIM DNS records on `catspotters.com`; DMARC set once the domain is verified.
- **Sign-in mail and report mail use one send function** with different templates, so there is one place where delivery failures are logged and one place to swap providers.
- **A failed send is logged loudly and never silently swallowed.** A sign-in endpoint that says "sent!" when nothing was sent is worse than one that admits the problem.
- **Welfare and issue emails are queued, not sent inline.** Report submission must succeed even when the mail provider is having a bad afternoon — the queue row is the source of truth, the email is a notification about it. Retry with backoff; surface persistent failure in the dashboard so the team knows mail is behind.
- Reporter-supplied text is escaped in the HTML part of every email. Header injection is prevented by never interpolating user input into headers.

### 8.3 Data

New tables, alongside the existing schema:

- `people` — email (unique, lowercased), name, role, scope, added_at, added_by.
- `signin_tokens` — token, email, expires_at, used_at. Spent tokens tidied opportunistically.
- `welfare_reports` — id, kind (`welfare` | `content`), severity (`attention` | `urgent`), is_litter, photo, lat/lng, note, reporter_email (nullable), reporter_device, cat_id (nullable), state, state_changed_at, state_changed_by, team_note, created_at.
- `feeding_sites` — id, name, lat/lng, colony_id, is_public (default false), made_public_by, made_public_at.
- `colonies` — id, name, place, guardian_name.
- `record_changes` — an append-only log of corrections: what, who, when, before, after.

Photos attached to reports follow the same handling as sighting photos — magic-byte detection, full decode, EXIF rotation, bounded and re-encoded, size caps — and are stored in object storage rather than the database.

### 8.4 Abuse and rate limits

Report endpoints are public and unauthenticated, and they cost money (image handling) and attention (a queue a human reads). Rate limit per device and per IP on the same basis as the existing AI-backed endpoints. A flood of junk reports is a denial-of-service against the charity's attention, which is the scarcest resource in this entire system.

### 8.5 Privacy

- Reporter email addresses are personal data collected for a stated purpose, with consent, and deletable on request — one-click from every message we send.
- Exact cat and feeding-site locations are visible to the team. Public views show cat locations approximately, and feeding sites not at all unless individually made public.
- Team notes on reports are never shown publicly.

---

## 9. Risks and open questions

### 9.1 Risks

| # | Risk | Why it matters | What we do |
|---|---|---|---|
| **1** | **The capacity messaging lands wrong and hurts the charity.** Too soft and people expect a rescue service; too hard and a worried tourist feels told off and never reports again. | This is the whole design. Getting it wrong creates either an unmeetable expectation or a silent island. | Syros Cats review every word before launch. Test the copy on the WhatsApp testers, who include actual tourists. Serve the copy from configuration so it can be corrected without an app release. Owner: **Samuel** (drafts), **Syros Cats** (final wording). |
| **2** | **Mail transport slips, and it blocks everything.** Sign-in, welfare reports, issue reports and acknowledgements all sit on the same dependency. | A dashboard nobody can sign in to and reports nobody receives is a feature that does not exist. Two urgent tickets already sit on this. | Settle the provider decision first, before dashboard work starts. Verify with a real send to a real Syros Cats inbox, not a test address. Have the fallback (Cloudflare Email Sending) identified so a stall does not become a rethink. Owner: **Samuel**. |
| **3** | **A report arrives about a genuinely dying cat and nobody sees it for two days.** | The one outcome that would damage trust in both directions — the reporter's and the charity's. | Urgent reports are visibly separated in the queue and carry an unmistakable subject line in the email. Be honest in the copy about response times rather than implying a service level. Consider a phone number in the urgent guidance if Syros Cats want one. Owner: **Syros Cats** (whether to publish a number). |

Also worth naming, below the top three: a feeding-site location becoming public by accident (mitigated by private-by-default, per-site toggles, and an attributed audit trail); abuse of the auto-hide on photos (mitigated by team restore and per-device patterns); and email addresses accumulating without a deletion path (mitigated by one-click deletion in every message).

### 9.2 Open questions

| Question | Owner | Notes |
|---|---|---|
| Susan's standard reply text | **Syros Cats (Susan)** | Requested; drafts in 5.3 stand in until it arrives. **Never blocks** — it is a copy swap. |
| Which feeding sites may be public | **Syros Cats** | Requested early. **Never blocks** — everything stays private until they say otherwise, which is the right default regardless. |
| Is there a phone number for genuinely urgent cases, and may we publish it? | **Syros Cats** | Changes the urgent guidance copy. Ships without one if the answer is no. |
| A named list of Syros vets with hours and phone numbers | **Syros Cats** | Makes "go to a vet" actionable rather than aspirational. Without it the guidance is weaker but still correct. |
| Who else goes on the access list, and with what name (SYC-29) | **Syros Cats** | One row each. |
| Should `hello@catspotters.com` also reach the charity (SYC-30) | **Samuel** | Worth finishing, but no longer on this feature's critical path if reports are sent directly. Worth raising with them whether a distribution list beats a forward to one person's mailbox. |
| Do reporters get a status update by push as well as email, when they use the app? | **Samuel** | Would close the loop for the majority who give no email address. |

### 9.3 What needs Samuel specifically

1. **Confirm the mail provider** (2.3) — Resend recommended. Everything else waits on this.
2. **Confirm where the dashboard lives** (2.4) — one backend, one sign-in, recommended.
3. **Confirm shared passwords retire** once staff sign-in is live (2.6), rather than running two credential models side by side.

---

## 10. What "done" looks like

- A Syros Cats person who has never seen the app can get from "I have an email address" to "I am looking at the queue" without anybody running a database command for them.
- A worried tourist can report an injured cat in under a minute, understands what will and will not happen next, knows a vet is the fastest help and that it will probably cost them, and does not feel dismissed.
- A litter report always says "contact us first, don't just turn up" — in the app and in the email.
- Every report is in two places: the charity's inbox and a queue that remembers.
- Every feeding site is private until Syros Cats decide otherwise, one at a time.
- Nothing in this build has to be unpicked when cat guardians, volunteers and vets get their own accounts.
