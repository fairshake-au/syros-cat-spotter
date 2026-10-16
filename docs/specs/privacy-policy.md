# Privacy policy — catspotters.com/privacy

**Status:** Split out of `email-capture.md` §6.5 on 28 September 2026 (Samuel). **Awaiting Samuel's approval**, separately from the email-capture spec.
**Owner:** Samuel
**Covers:** SYC-66 (publish a privacy policy on catspotters.com).
**Draws on:** `email-capture.md` (email, consent, verification, retention of addresses), `cat-record-data-spine.md` §8 (the deletion mechanism), `team-access-and-welfare-queue.md` §8.5 (welfare reports and their retention), `hosting-and-photo-storage.md` (photos, location data stripped from photos, processors). When any of those change, this page changes with them.

---

## 1. The policy
Published at **catspotters.com/privacy**, linked from every ask screen, every email, and the store listing. **Syros Cats is the data controller** *(D6)* — they decide what is collected and why, and the policy names them. There is a store-listing deadline **this month**: Google Play requires a live privacy-policy URL at submission, and the closed test is inside the launch window, so this is a dated blocker rather than an open question. Owner: Samuel, with Syros Cats.

The policy is written to be read, not to be defended. The draft:

> ## What Cat Spotters knows about you
>
> **Short version.** You can use this app without telling us who you are, and most people do. If you choose to give us an email address, we use it to tell you what happened to the cats you met, and for nothing else. You can delete everything about yourself from inside the app, in two taps, whenever you like.
>
> **Who we are.** Cat Spotters is made for **Syros Cats**, a cat charity on the island of Syros in Greece. Syros Cats decide what this app collects and why, which in data-protection language makes them the *data controller*. If you want to ask us anything here, or ask us to delete something: **hello@catspotters.com**.
>
> **What we collect if you say nothing.** Your phone gets a random identifier the first time you open the app. It is not your name, your account, or anything we can trace to a person — it exists so that your spots are yours and your points add up. Alongside it we keep the cats you've spotted, the photographs you took of them, and roughly where and when you saw them. When someone taps "Help feed a cat", Cat Spotters adds one to a count for that day. It keeps nothing about who tapped it, their phone, or where they were. The donation page itself is run by Syros Cats.
>
> **What we do with photographs and places.** Photographs of cats go into the island's record of its cats, and may be shown publicly in the app. We strip the hidden location tag out of every photo before we store it. Cat locations are shown to the public rounded to a wide area rather than an exact spot, because an exact spot is a map to a cat that some people would rather not have one.
>
> **Email, if you give us one.** We offer once when you first open the app, and ask at four moments: after you've spotted a cat, at the end of a visit, after you've reported a cat in trouble, and in Settings. It is always optional, and saying no costs you nothing.
>
> Whatever address you type, we send **one** message asking whether it is really yours. Until you tap the button in that message, we send nothing else — no news, no summary, no acknowledgement. If it wasn't you, ignore it, and we forget the address in a week.
>
> Once you've confirmed it, we use your address for exactly what you asked for: news about cats you've met (only when there's real news, and never more than once a week), the summary of your visit if you asked for one, and what happened to a cat you reported. Every message has a one-tap way to stop, and a one-tap way to delete your address entirely.
>
> *[Drafting note, not policy text: "(only when there's real news, and never more than once a week)" replaced "(a handful of times a year at most)" on 15 October 2026, after Samuel set the cat-news limit to once a week with no yearly cap (SYC-344 Decision 5). The new wording is pending Samuel's approval of this policy (SYC-66).]*
>
> **What your news email is not.** It is not a login. Knowing it gives nobody any access to anything, and it won't get your spots back on a new phone.
>
> **"Keep my spots safe", if you choose it.** This is a separate email, and it's optional. It lets you get your spots back if you lose or change your phone. It works like a key: anyone who can open that inbox can open your collection, so use an address only you (or a parent) can read. When it's used on a new phone, your old phone is signed out and told. You can remove it in Settings, and deleting your data removes it too.
>
> **Who else sees it.** Nobody, apart from the service that delivers the mail (Resend, which is our *processor* — it sends on our instructions and holds nothing on its own account). We don't sell your address. We don't give it to advertisers. We don't use it to build a picture of you. And we don't show it in the app: not on a leaderboard, not on a cat's page, not to anyone at Syros Cats reading a report you sent.
>
> **Children.** This app is for everybody, but in Greece you need to be 15 to agree to something like an email list on your own. If you're younger than that, ask a parent before you type an address in. If you tell us we're holding a child's address, we'll delete it.
>
> **Deleting yourself.** In the app: **Settings → Delete my data**. There's a link in every email we send. Or write to **hello@catspotters.com** and we'll do it for you.
>
> Here's exactly what happens, because this is the bit people ask about most: **we delete everything that identifies you — the cat sightings stay, with your name off them.** Your address, your points, your streak, your spot history and anything you typed all go. The record of which cat was seen where stays, without you attached to it, because it belongs to the island's cats rather than to us — and pulling it out would put holes in the history of cats that have nothing to do with you. Names you gave cats stay too, because other people use them now. If you told us a cat lives with you, the note about where it lives stays with the cat, but your name and your link to it are taken off. If you sent us a report about a cat, the report and what you wrote in it stay with the cat's record, but your link to it is taken off. It cannot be undone.
>
> **How long we keep things.** An unconfirmed address: seven days. A confirmed one: while you want the emails. A report address: until the report is finished, plus three months. If you haven't opened anything or used the app in two years we'll ask once, and then delete it.
>
> **Where it is.** Our database is in the EU. Resend, our mail service, is in the United States, and mail we send you goes through them under the standard EU contract terms for that.
>
> **Complaining.** If you think we've handled your data badly, tell us at hello@catspotters.com — and you can complain to the Hellenic Data Protection Authority, who regulate us.
>
> **Changes.** If we change how any of this works, we'll change this page and date it. We won't start using your address for something new without asking you first.

**Two supporting pieces of work this creates, both build requirements rather than prose:** a signed data-processing agreement with Resend, with the transfer terms recorded; and a verified-by-test check that deleting an address at the provider actually removes it — a provider that keeps a copy we cannot delete would make §6.1 a lie.

**Also, and it belongs in one place:** the threat model's asset list needs one combined revision covering all four specs' new personal data — email addresses and consent records here, free-text sighting notes and cat-guardian names in the data spine, reporter addresses and the staff list in team access. Email addresses are not "the first genuinely personal data in the system"; that was true when this spec was written alone and is false read against its siblings. The privacy policy above must be checked against the finished asset list before submission, not before it.
