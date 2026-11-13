# Clockwork input rework (delete in the final commit)

Answer input: a time is a number, so a direct widget (geo-ux rule 1): 24 hour buttons, minute chips, Check; Skip beside Check.
Typing digits, arrows and Enter stay as keyboard shortcuts.

## Done
- TimePicker.tsx, screen wiring, CSS; fits 1280x720 and 390x844 (screenshots checked).

## Next
- Rewrite the two clockwork e2e tests (widget path; keyboard path + both sizes), typecheck, vitest, commit.
