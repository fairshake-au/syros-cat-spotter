# Syros veterinary clinics — verification pass

**Researched:** 4 September 2026
**Purpose:** source-of-truth contact data for the in-app "injured cat, who do I call?" path. A wrong number at that moment is worse than no number, so every field below carries a confidence marking.

## Confidence key

| Mark | Meaning |
| --- | --- |
| **CONFIRMED** | Found on the business's own site, or on two or more independent third-party sources that agree. Source URL named. |
| **PARTIAL** | Found, but on a single weak source (a directory listing, a search-engine snippet), or sources disagree. |
| **UNVERIFIED** | Could not find it. Not guessed. |

---

## Summary — what changed, what to watch

**All three clinics exist and all three phone numbers in the Syros Cats standard reply check out.** No number in the original list appears to be wrong. That is the headline.

Four things you should know before this data goes in front of a tourist:

1. **The "no night cover" line in the Syros Cats reply is not what the clinics themselves advertise.** Two of the three publish out-of-hours contacts. Symviosis publishes a separate after-hours number on its own website. Cyclades Vets (Maragkos) advertises **24-hour operation, 365 days a year** on its operator's site, with a named emergency line. Whether that promise is honoured in practice on a small island at 3am is a different question and one only a phone call can settle — but "there is no night cover" should not be stated as fact in the app when the clinics' own published material says otherwise. See the open questions at the bottom.

2. **George Maragkos's clinic trades under a different name.** It is **Κτηνιατρική Κλινική Κυκλάδων / Cyclades Vets**, founded by Maragkos in June 2012. A tourist looking for a sign saying "Maragkos" will not find one. It is now part of the mainland **Plakentia** veterinary group — `cycladesvets.gr` 301-redirects to a Plakentia page. The Syros clinic is still operating; the branding is the change, not the closure. The app should show the trading name.

3. **"Mana, opposite the AVIN" and "Lazareta" are next door to each other, not in conflict.** The AVIN station on Syros sits on the Ermoupoli–Manna road at the Kourupi/Lazareta boundary. Maragkos (Manna/Livadia side) and Dermitzaki (Lazareta side) are roughly 500m apart on the same road. One directory does list Dermitzaki at "Livadia, Kato Manna" instead of Lazareta — flagged below, worth a call to settle.

4. **Nobody publishes a street name and number.** This is normal for rural Syros; addresses are given as area plus landmark, and the postcode for the whole island is 841 00. There is no envelope-format address to be had for any of the three. The app should lean on the landmark and the map pin, not on a street line.

### On the original Google Maps short links

**They were not supplied to me**, so I could not attempt to resolve them and cannot report whether they lead anywhere. What I can say is that the description given — roughly 17 characters where a genuine `maps.app.goo.gl` slug is 10–11 — is consistent with something fabricated or placeholder, and the suspicion is well founded. **Every link in this document is a plain, durable, coordinate-based URL that you can verify by reading it.** No shorteners.

### On the coordinates below — read this

**None of the three clinics is mapped as a named point in OpenStreetMap**, and I have no Google Places access to pull an authoritative pin. So the coordinates below are **landmark-anchored, not clinic-verified**: they are the verified OSM coordinates of the petrol station each clinic sits opposite, which is the exact landmark the clinics themselves use in their published addresses. That puts a pin within roughly 50–100 metres of the door — good enough to drive to, and honest about what it is. They are marked PARTIAL throughout and should be replaced with real pins once someone on the island can drop one.

(There is one unnamed `amenity=veterinary` building in OSM on Syros, at 37.4151195, 24.9514221, on the Ermoupoli–Azolimnos road near Kalamisia. It does not match the published location of any of the three clinics and I could not attribute it. Noted for completeness, not used.)

---

## 1. Symviosis — Κτηνιατρικό Κέντρο Σύρου

Founded 2024 by vet **Emmanouil (Manolis) Vorrisis / Εμμανουήλ (Μανώλης) Βορρίσης**. Part of a two-island group with a sister clinic on Tinos.

| Field | Value | Confidence |
| --- | --- | --- |
| Trading name | Symviosis — Κτηνιατρικό Κέντρο Σύρου (Veterinary Centre of Syros) | **CONFIRMED** — own site `symviosis.vet/syros` |
| Vet | Εμμανουήλ Ν. Βορρίσης / Emmanouil N. Vorrisis | **CONFIRMED** — own site; vrisko listing "SYMVIOSIS (Βορρίσης Εμμανουήλ Ν.)" |
| Area (Greek) | Σταυρός Ταλάντων, Τάλαντα, Σύρος, 841 00 | **PARTIAL** — "Talanta" on own site; "Stavros Talanton" from a single directory snippet |
| Area (English) | Stavros Talanton, Talanta, Syros 841 00, Cyclades | **PARTIAL** — as above |
| Street name / number | None published | **UNVERIFIED** |
| Landmark | Opposite the Shell petrol station, on the Pagos–Ermoupoli road | **CONFIRMED** — Syros Cats reply corroborated by OSM: the Shell at 37.4234996, 24.9202989 reverse-geocodes to village Τάλαντα, road Πάγος–Ερμούπολη |
| Phone (hours) | **+30 22810 77929** | **CONFIRMED** — own site, listed as "Σύρος: 2281 077929" |
| Phone (out-of-hours) | **+30 697 005 5012** | **CONFIRMED** — own site, listed explicitly as the number to call outside clinic hours |
| Opening hours | Mon–Fri 09:00–18:00, Sat 09:00–17:00, Sun closed | **PARTIAL** — single directory source (xo.gr); not published on the clinic's own site |
| Out-of-hours cover | **Yes — a dedicated after-hours number.** Own site: visits are by appointment "πλην επειγόντων" (except emergencies) | **CONFIRMED** — own site |
| Explicit 24h claim | None made | **CONFIRMED** (absence verified on own site) |
| Website | https://symviosis.vet — Syros page: https://symviosis.vet/syros | **CONFIRMED** |
| Email | None published | **UNVERIFIED** |
| Facebook | Not located | **UNVERIFIED** |
| Latitude / longitude | **37.4234996, 24.9202989** — landmark anchor (the Shell station), not the clinic door | **PARTIAL** |

**Google Maps:** https://www.google.com/maps/search/?api=1&query=37.4234996,24.9202989
**Apple Maps:** https://maps.apple.com/?ll=37.4234996,24.9202989&q=Symviosis%20Vet%20Talanta

---

## 2. Dr Irini Dermitzaki — Κτηνιατρείο Δρ. Δερμιτζάκη Ειρήνη

Small-animal clinic plus a farm-animal practice.

| Field | Value | Confidence |
| --- | --- | --- |
| Trading name | Κτηνιατρείο Δρ. Δερμιτζάκη Ειρήνη / Dermitzaki Irini Veterinary Clinic | **CONFIRMED** — multiple directories agree |
| Vet | Δρ. Ειρήνη Δερμιτζάκη / Dr Irini Dermitzaki | **CONFIRMED** |
| Area (Greek) | Λαζαρέτα, Σύρος, 841 00 | **PARTIAL** — matches the Syros Cats reply and appears in directory listings; **but see conflict below** |
| Area (English) | Livadia, Manna, Syros 841 00 — Google Maps: "λιβάδια 0, Manna 841 00, Greece" | **CONFIRMED by Samuel, 28 Sep 2026** |
| Street name / number | None published | **UNVERIFIED** |
| Phone (landline) | **+30 22813 06720** | **CONFIRMED** — multiple independent directory listings agree, and it matches the Syros Cats reply |
| Phone (mobile) | **+30 6986 705837** | **CONFIRMED** — as above |
| Email | **vetdermitzaki@gmail.com** | **PARTIAL** — directory listings only, not a site the vet controls |
| Opening hours | Not published anywhere I could find | **UNVERIFIED** |
| Out-of-hours / emergency cover | No published position either way | **UNVERIFIED** — this is a real gap; do not imply cover exists, and do not imply it does not |
| Website | None found | **UNVERIFIED** |
| Facebook | Not located | **UNVERIFIED** |
| Reputation signal | 9.9/10 across ~90 reviews; "Eagles of Veterinarians" award listee 2022, 2023, 2024 | **PARTIAL** — single source, `aetoitonktiniatron.eu`, which is the award's own site |
| Latitude / longitude | **Needs a new pin.** The old value (37.4303699, 24.9439526) was the Lazareta locality node and is wrong now the clinic is known to be in Livadia, Manna. | **OPEN** |

> **Settled 28 Sep 2026: Livadia, Manna (Samuel).** The directory below was right. Kept as the record of the earlier conflict: **⚠ Address conflict — needs a phone call to settle.** The Syros Cats reply and most listings put this clinic in **Lazareta**. One directory (`syrostoday.gr`) instead lists it at **"Λιβάδια, Κάτω Μάννα"** — which is the address Cyclades Vets uses. That looks like a directory copy-paste error rather than a genuine second location, but it is unresolved, and Lazareta is the weaker-sourced of the two clinic addresses in this document. The two areas are only about 500m apart on the same road, so a wrong pin here is a short walk rather than a disaster — but confirm before shipping.

**Google Maps (interim, until re-pinned):** https://www.google.com/maps/search/?api=1&query=Dermitzaki%20vet%20Livadia%20Manna%20Syros
**Apple Maps (interim, until re-pinned):** https://maps.apple.com/?q=Dermitzaki%20Vet%20Livadia%20Manna%20Syros

---

## 3. George Maragkos — trading as Κτηνιατρική Κλινική Κυκλάδων (Cyclades Vets)

**The name change matters for the app.** This is the clinic the Syros Cats reply calls "George Maragkos", but it does not trade under his name.

| Field | Value | Confidence |
| --- | --- | --- |
| Trading name | **Κτηνιατρική Κλινική Κυκλάδων / Cyclades Vets** — Syros clinic | **CONFIRMED** — operator site (plakentiavet.gr), syrostoday.gr, vrisko |
| Vet | Γιώργος Μαραγκός / George Maragkos, founder and director; clinic established June 2012 | **CONFIRMED** — operator site |
| Ownership | Now part of the **Plakentia** veterinary group; `cycladesvets.gr` 301-redirects to a Plakentia page | **CONFIRMED** — verified the redirect directly |
| Still operating? | **Yes.** Presented as an operating secondary-care facility with emergency services for the Cyclades | **CONFIRMED** — operator site |
| Address (Greek) | Λιβάδια, επί της κεντρικής οδού, έναντι AVIN — Κάτω Μάννα, Σύρος 841 00 | **CONFIRMED** — operator site and syrostoday.gr agree verbatim |
| Address (English) | Livadia, on the main road, opposite the AVIN petrol station — Kato Manna, Syros 841 00, Cyclades | **CONFIRMED** |
| Street name / number | None published | **UNVERIFIED** |
| Landmark | Opposite AVIN. Corroborated: the AVIN on Syros is at 37.4281630, 24.9400130, tagged `addr:place=Λαζαρέτα`, on the Ερμούπολη–Μάννα road in Μάννα village | **CONFIRMED** — OSM, plus the operator's own address line |
| Phone (main) | **+30 22810 79439** | **CONFIRMED** — operator site, syrostoday.gr; matches the Syros Cats reply |
| Phone (second landline) | **+30 22814 08262** | **PARTIAL** — directory listings only; not on the current operator page |
| Phone (mobile / emergency) | **+30 6937 252802** | **CONFIRMED** — operator site names this as the emergency line; matches the Syros Cats reply |
| Email | **syros@cycladesvets.gr** | **CONFIRMED** — operator site and syrostoday.gr |
| Website | https://cycladesvets.gr (redirects to the Plakentia group page) | **CONFIRMED** |
| Facebook | https://www.facebook.com/syrosvets/ — "Κτηνιατρική Κλινική Κυκλάδων - CycladesVets \| Syros" | **PARTIAL** — page exists and the title matches; content not readable without login |
| Opening hours | Clinic, by appointment: **Mon–Fri 08:00–21:00, Sat 09:00–17:00, Sun 10:00–18:00**. Attached shop: Mon–Sat 09:00–20:00, Sun 10:00–18:00 | **PARTIAL** — operator's own site, but a second source (syrostoday.gr) gives Mon–Fri 08:30–20:30 and Sat/Sun 09:30–15:30. **Sources disagree.** Treat the operator's site as primary and the directory as stale. |
| **Out-of-hours / 24h cover** | **Advertises "24ωρη λειτουργία, 365 μέρες το χρόνο" — 24-hour operation, 365 days a year — on the emergency line 6937252802** | **CONFIRMED** as a published claim on the operator's own site. **Not confirmed as operational reality** — see open questions. |
| Latitude / longitude | **37.4281630, 24.9400130** — landmark anchor (the AVIN station), not the clinic door | **PARTIAL** |

**Google Maps:** https://www.google.com/maps/search/?api=1&query=37.4281630,24.9400130
**Apple Maps:** https://maps.apple.com/?ll=37.4281630,24.9400130&q=Cyclades%20Vets%20Syros

---

## 4. Municipality of Syros-Ermoupoli

| Field | Value | Confidence |
| --- | --- | --- |
| Switchboard | **+30 22813 61000** | **CONFIRMED** — the municipality's own service telephone directory at syros-ermoupolis.gr lists "Γραφείο Δήμου: 2281361000". The number in the Syros Cats reply is correct. |
| Address | Πλατεία Μιαούλη, Ερμούπολη, Σύρος 841 00 / Miaouli Square, Ermoupoli | **CONFIRMED** |
| Website | https://www.syros-ermoupolis.gr | **CONFIRMED** |
| Animal welfare / strays office | **No dedicated published contact.** The municipality's own service directory has no entry for αδέσποτα, ζώα, or κτηνιατρική. The nearest category is public health (Υγεία), listed without a direct number. | **UNVERIFIED** — verified absence on the official directory, not merely "not found by search" |

**Practical implication for the app:** there is no direct animal-welfare number to give. A tourist calling 22813 61000 will reach a general switchboard, in office hours, in Greek. That is a weak referral and the app copy should not oversell it. The vets and Syros Cats themselves are the stronger routes.

---

## Open questions worth one phone call each

These are the things a five-minute call from someone who speaks Greek would settle, and they are the highest-value follow-ups here.

1. **Does Cyclades Vets actually answer 6937 252802 at night?** They publish a 24/365 claim. Syros Cats say there is no night cover. Both cannot be right in the way the app needs. This is the single most consequential unknown in this document — it decides whether the app can tell a tourist there is anyone to call at 2am.
2. **Does Symviosis's after-hours number (6970 055012) reach a person overnight, or a voicemail?** Their own framing — appointments required "except emergencies" — suggests a real emergency route, but does not say how far it extends.
3. ~~**Is Dermitzaki in Lazareta or Kato Manna?**~~ **Settled 28 Sep 2026: Livadia, Manna.** The pin still needs replacing.
4. **Does Dermitzaki offer any emergency contact?** Complete blank at present.
5. **Exact map pins for all three.** Everything here is landmark-anchored. Someone standing outside each clinic with a phone fixes this permanently in ten minutes.
6. **Confirm Symviosis's opening hours** against the clinic directly — the only source is a third-party directory.

---

## Sources

| # | URL | Used for |
| --- | --- | --- |
| 1 | https://symviosis.vet/ | Symviosis group, Syros + Tinos numbers, out-of-hours numbers |
| 2 | https://symviosis.vet/syros | Symviosis Syros: founding 2024, Talanta, both numbers, appointment/emergency policy |
| 3 | https://www.plakentiavet.gr/24ωρη-κτηνιατρική-κλινική/κτηνιατρική-κλινική-κυκλάδων/ | Cyclades Vets: address, phones, email, hours, 24/365 claim, Maragkos as founder, Plakentia group |
| 4 | https://cycladesvets.gr/epikoinonia/ | Verified the 301 redirect to Plakentia (ownership/branding change) |
| 5 | https://www.syrostoday.gr/Business/568-KTHNIATRIKH-KLINIKH-KYKLADON--KLINIKH-SYROY.aspx | Cyclades Vets: address, postcode, phones incl. 22814 08262, email — independent corroboration |
| 6 | https://www.syrostoday.gr/Business/763-KTHNIATREIO--DR-DERMITZAKH-EIRHNH.aspx | Dermitzaki: phones, email — and the source of the Kato Manna address conflict |
| 7 | https://www.aetoitonktiniatron.eu/profile-19618-ktiniatrio-dermitzaki-irini | Dermitzaki: existence, Ermoupoli location, review score, award listing |
| 8 | https://www.facebook.com/syrosvets/ | Cyclades Vets Facebook page existence (title only; content gated) |
| 9 | https://www.syros-ermoupolis.gr/service-telephones/ | Municipality switchboard 2281361000; verified absence of an animal-welfare entry |
| 10 | OpenStreetMap via Overpass API — `amenity=fuel` and `amenity=veterinary` over Syros | Verified coordinates for the Shell (Talanta) and AVIN (Manna) landmarks; the one unattributed vet building |
| 11 | OpenStreetMap via Nominatim — forward and reverse geocoding | Confirmed Talanta, Lazareta, Kato Manna, Kourupi as real places and reconciled the Manna/Lazareta geography |

### Sources that could not be read

Three Greek business directories block automated access and could not be checked directly, though search-engine snippets of their content were available and are reflected above at PARTIAL confidence:

- `vrisko.gr` — HTTP 403 / Akamai "Access Denied"
- `primepages.gr` — Cloudflare challenge
- `xo.gr` — bot challenge (this is the only source for Symviosis's opening hours, which is why that field is PARTIAL)

Facebook pages could not be read without a login. Google Places was not available, which is the direct reason no clinic-door coordinates are in this document.
