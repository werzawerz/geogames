---
name: geo-ux
description: GeoGames UX rules and the answer-input pattern (free text vs multiple choice vs a direct widget). Load before designing, building, fixing or playtesting any game screen.
---

# GeoGames UX rules

These come from the user's feedback (2026-11-13: "UX is not really taken into consideration during development"). They hold for every new game and every rework. The builder designs to them; the playtester scores against them.

## 1. Pick the answer input by the shape of the answer

Decide this first, for each band of the game, and write it in PIPELINE-NOTES.md.

| The answer is… | Use | Examples |
|---|---|---|
| A name from a big, familiar set the player can produce (countries, big cities) | **Free text** with search suggestions | City Circle, Border Route, Halfway |
| A name that's hard to produce or spell, from a niche set (physical features, rivers, tributaries, scripts) | **Multiple choice** (4 options) | Blank Atlas, Flags |
| A number or a quantity (time, offset, distance, year, population) | **A direct widget**: buttons, a dial, a slider or a stepper. Never a bare text box. Typing can stay as a keyboard shortcut. | Clockwork |
| A place | **A click on the map** | Pin Drop |

- **Choice as a costed help.** A free-text game may offer multiple choice as a hint that costs points, or that turns on after a trigger (River Run: once 50% of the river is drawn). The help must cost something, so recall still pays more.
- **Distractors make or break multiple choice.** Use the same kind of thing (desert vs desert), with a closer region and a closer look-alike as levels go up. Never use an obviously absurd option. Shuffle, and avoid patterns in the position of the right answer.
- **Lives with multiple choice.** Free misses don't fit 4 options, because 3 misses would exhaust them. A wrong pick costs the level's life straight away. Skip still costs a life. A flawless pick gives a life back, as usual.
- **Search suggestions must not leak.** Don't show the kind or category of each row when the kind is the clue. Enter accepts only an exact name or alias. A string that doesn't clearly match must never become a guess: it gets a free "not one of the answers" message.

## 2. Layout: the question is always in view

- The question, status (level, lives, score), the map and the input all fit **with no page scroll**, at 1280×720 and 390×844. The map shrinks to make room. Add a browser test for both sizes.
- Focus the input with `focus({ preventScroll: true })`, never `autoFocus`. When a level ends, focus the Next button so Enter continues.
- One primary action per state. Skip and Give up are visually secondary but always reachable without scrolling.

## 3. Phones

- Tap targets are at least 44×44 px. Multiple-choice options and widget buttons are full-width or a 2×2 grid on phones.
- Avoid the on-screen keyboard where the answer isn't a name: it covers half the map.
- Small targets get an auto-zoom or a ring, so they're clearly visible on a 390 px map.

## 4. Feedback

- Every answer gets instant feedback (under 100 ms): right, or wrong and why (e.g. shown in red where it really is, with the distance).
- Show what the input understood ("= 17:30") before it counts.
- When a level ends, show the answer with a one-line "why" or fact. That's where players learn.
- Feedback is never colour-only. Pair it with text or an icon.

## 5. Looks

- Use the CSS tokens. Check contrast on both themes.
- Maps should look like maps: use the shaded-relief terrain layer where physical geography matters (Blank Atlas, River Run). Avoid straight-edged "debug" polygons; clip or soften them, or drop the feature.

## 6. The playtester's UX score

The playtester adds a **UX score (1–5)** with a check of each section above, and lists any rule that's broken as a fix.
