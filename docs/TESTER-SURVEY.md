# Pre-MVP tester survey (Syros, September 2026)

Five questions for the Syros Cats testers. Every question is a 1–5 score plus a
reason box, so each round of testing yields five trackable numbers and five
explanations of them.

Rendered version: `docs/tester-survey.html` (also published as an artifact).

Scope check: the questions cover only what the tested build actually does —
photograph a cat, match or register it, name it, catalogue, map, points /
badges / leaderboard, offline queue, English / Greek / French. There is no
welfare-report question because the cat-in-trouble flow is not in this build.

## 1. How easy was it to record a cat? — ease of the core loop

From opening the app to finishing: photo, where you saw it, done.

1 Very hard · 2 Hard · 3 All right · 4 Easy · 5 Very easy

Reason (optional): "What made it that easy, or that hard?"

No "didn't get this far" option, deliberately: someone who could not complete
the loop scores it 1, and that is the answer. Below 4 here outranks everything
else on the list.

## 2. How well did the app recognise the cats? — matching accuracy

When it decided whether it had met that cat before, how often did it get it right?

1 Wrong most times · 2 Often wrong · 3 About half · 4 Usually right ·
5 Right every time · plus "I did not get as far as this"

Reason (optional): "When it got a cat wrong, what happened?"

The reason box is what separates the two failure directions — a known cat
treated as new, versus a plainly different cat offered as a match.

## 3. How clear was it what you were meant to do? — clarity and language

Including whether the words made sense in your language.

1 Lost throughout · 2 Often unsure · 3 All right · 4 Mostly clear ·
5 Completely clear · plus "I did not get as far as this"

Reason (optional): "Which part lost you? Tell us about anything oddly worded or
badly translated."

## 4. How well did it hold up while you were out? — reliability in the field

Speed, finding where you are, weak signal, keeping the sightings you took.

1 Constant trouble · 2 Frequent trouble · 3 Some trouble · 4 Nearly always
fine · 5 No trouble at all · plus "I did not get as far as this"

Reason (optional): "What happened when it gave you trouble? Where were you
when it did?"

## 5. How likely are you to recommend it to someone else on Syros who cares about the cats? — worth, and the one fix

1 Not at all likely · 2 Unlikely · 3 Possibly · 4 Likely · 5 Very likely

Reason (**required** — the only compulsory text box): "What is the one thing
that would move your score closer to 5?"

"One thing" rather than "what would you like" makes the testers do the ranking.

## Running it

- Multiple choice with five labelled rows, not a linear scale: Forms' linear
  scale labels only the two ends and will not take the "did not get this far"
  option.
- Two separate forms, English and Greek, both links in one WhatsApp message.
  A bilingual single form costs a question and invites mis-tapped rows.
- No email or name field. Email capture is a designed in-app moment; a
  feedback form is the wrong place for it.
- The Greek needs a native read before sending (folds into the open
  Greek/French review item).
- Open for a week, one reminder only.

## Reading the answers

1. Count the "did not get this far" answers first — that is the drop-off. A
   high count on Q2 means the problem is upstream in Q1's loop, whatever Q1
   scored.
2. Average Q2 and Q4 only over the people who got there; do not let a "did not
   get this far" land in the denominator as a zero.
3. Q1 below 4 outranks everything: the whole product is that loop repeated.
4. Three or more testers naming the same thing in Q5 is a launch blocker;
   scattered singletons go to the backlog.
5. Hunt the split scores — low Q1, high Q5 means someone pushed through real
   difficulty because they want this to exist. Interview them.

## Trade-off accepted

An all-ratings survey gives no hard count of who never got started (the earlier
draft had a behavioural checklist for exactly that). The "did not get this far"
options are the substitute; they are self-reported and will undercount the
people who gave up before installing.
