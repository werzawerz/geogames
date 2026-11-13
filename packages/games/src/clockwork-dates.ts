/**
 * The dates Clockwork asks about, all in 2026. Mid-January and mid-July are
 * plain winter and summer. 15 March falls after the US and Canada have put
 * their clocks forward but before Europe has, and while the southern hemisphere
 * is still on summer time; 28 October after Europe has put them back but before
 * North America has, with the south on summer time again.
 */
export const CLOCK_DATES = [
  { month: 1, day: 15, label: '15 January' },
  { month: 7, day: 15, label: '15 July' },
  { month: 3, day: 15, label: '15 March' },
  { month: 10, day: 28, label: '28 October' },
] as const;
