# Clockwork fix round (delete in the final commit)

Playtest fixes asked: 1 focus scroll + map height + 1280x720 e2e; 2 date pools; 3 one free miss from 15;
4 tighter bands, wider spread; 5 no-repeat fallback to the oldest in the band; 6 small countries framed bigger.

## Done
- 2, 3, 4, 5 in the engine (clockwork-dates.ts seasons, 133 zones x 26 dates, places added), unit tests pass.

## Next
- Screen: focus({preventScroll}) instead of autoFocus, limit map height, frame small countries tighter.
- RULES text (one free miss from level 15), e2e date label + 1280x720 test, typecheck, vitest, commit.
