# Session handoff — Boulder Lifts (CSE 290R)

Written 2026-09-21. Read this first next session.

## What this project is
A gym/workout web app that shows weight lifted as boulders. Planning docs were written from `_TEMPLATE.md`, plus a throwaway demo page. Nothing else exists yet (no real app, no backend, no saving).

Folder: `C:\Users\maste\OneDrive\Desktop\cse29r` (device "biggie-cheese", Windows).

## Files created this session
- `plans/1.1-boulder-conversion.md` — revision 2. Each rep is one boulder; tier is set by the weight of that set.
- `plans/1.2-boulder-display-modes.md` — revision 2. Scope (Session / Lifetime / 7-day) and mode (Mixed pile / One big boulder / All one tier).
- `demo/boulders-demo.html` — single-file test page, no saving.
- `demo/Boulder Lifts Demo.url` — double-click shortcut to the page (drag to Desktop to use).

## Decisions made (user's choices)
- Web app first, local-only, no accounts.
- Tiers (weight of one lift, lower bound inclusive): Pebble under 10 lb, Stone 10 to under 50, Rock 50 to under 100, Boulder 100 to under 200, Great Boulder 200 to under 300, Monolith 300 and up. Exactly 50 lb is a Rock.
- Brackets apply to each lift's weight, not to totals.
- Weights stored as integer grams. Tier thresholds use the same rounding function so exactly 100 lb is never below 100 lb.
- Revision 1 (unit-weight tiers, greedy split of a total) was discarded. Do not bring it back without asking.

## My assumptions the user has NOT confirmed
- Reference weights for 1.2 "All one tier" and "One big boulder": Pebble 5 lb, every other tier = its lower bound (10, 50, 100, 200, 300).
- "Carry" means just a large boulder, with no figure carrying it.
- Cube-root scaling for the big boulder.
- Feature IDs: 1.0 = Workout Logging (not written), 1.3 = Milestones & Sharing (not written).
- Stack: TypeScript web app with IndexedDB. The demo is plain HTML and JS, so a framework has not been chosen.
- The template is education-oriented (K12, FERPA, instructors, `docs/MISSING_FEATURES.md`, `server/migrations`). I dropped or adapted those parts.

## Known issues and bugs
1. **Plan and demo disagree slightly.** The 1.2 plan says 7,653 lb in Pebbles is "1,530 + 0.6"; the demo shows 0.61. The cause is probably per-set gram rounding, but I did not confirm it. Fix the plan wording ("about 0.6") or the rounding.
2. **Fixed:** exactly 10,000 lb displayed as 9,999.9 lb (rounding). The display now rounds to one decimal. Because weight is stored as integer grams, a total can still be off by a small amount from the exact lb figure.
3. **Mixed pile and All one tier count different things.** Mixed pile counts reps (105 boulders). All one tier counts weight (25 Monoliths for the same workout). The demo labels each view, but this is the biggest design risk. The user has not settled it.
4. **Big-boulder scaling looks small.** 7,653 lb is only about 11.5 times a Pebble's width, and it is clamped at 260 px.
5. **Very light or very heavy users:** a plain rep count means 36 lateral-raise Pebbles look as big as 36 Monoliths. Open in the 1.1 plan.
6. `.url` shortcuts can trigger a Windows security warning. Untested on the user's machine.

## What was and was not tested
- Tested (headless Chromium, cloud): sample totals, all bracket edges in lb and kg, zero-weight rejection, clear, unit switch, no console errors.
- Only ONE screenshot was reviewed by eye (Mixed pile with 100 Boulders). The One big boulder view, the partial-icon fraction in All one tier, dark mode, and phone width were not visually checked.
- Not tested on the user's own browser, and the `.url` shortcut was not opened.
- No automated tests exist for the demo (the test script was scratch and is not saved).

## Things to be careful about
- `CLAUDE.md` in the folder sets up an unrelated "interview practice" workflow (four agents in `.claude/agents/`, an `INTERVIEW_ERROR` handoff rule and a `CRASH_TEST` keyword). It has nothing to do with the boulder app. Do not follow it for boulder work, and ask the user whether it should stay.
- A `.env` file (89 bytes) is in the folder. I did not open it. `.gitignore` is only 6 bytes and I did not check that it covers `.env`.
- `study-agent-old/` and `Claude outputs/` are older work, not touched.

## Suggested next steps
1. Ask the user to settle the open design questions (below), and make them defend the answers.
2. Write `1.0 Workout Logging` (1.1 and 1.2 depend on it), then `1.3`.
3. Decide the stack, then turn the demo into a real app with local storage (1.0, then the 7-day and Lifetime scopes).
4. Review the demo visually in every mode, in dark mode and at phone width.
5. Add real boulder art (original or licensed only).

## Open questions carried over
- Are the tier bounds right? Should an average lifter ever see a Monolith?
- Should heavy lifts count for more than many light reps (weighted pile)?
- Metric-native bounds, or keep lb-based bounds shown in kg (4.5 kg is a Pebble, 4.54 kg a Stone)?
- Should changing tier bounds re-bucket old workouts?
- Count warm-up and drop sets? Count bodyweight work?
- Reference weights for All one tier (Pebble = 5 lb?), and should the modes agree on what they count?
- Does "carry" need a figure? Is cube-root the right sizing rule?
- Keep the 7-day scope? One saved mode overall, or one per scope?
