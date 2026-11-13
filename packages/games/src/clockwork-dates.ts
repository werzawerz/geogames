/**
 * The dates Clockwork asks about, all in 2026, each with the season it tests.
 * - 'winter' and 'summer': northern winter or summer, the south the other way round.
 * - 'us-first': March, after the US, Canada and Cuba have put their clocks
 *   forward (8 March) but before Europe (29 March), with the south still on summer time.
 * - 'eu-first': late October, after Europe has put its clocks back (25 October)
 *   but before North America (1 November), with the south on summer time again.
 * - 'south-change': April, around the south's clocks going back (5 April) and
 *   Egypt's going forward (24 April); and late September, when New Zealand and
 *   Chile have started summer time but Australia hasn't (4 October).
 * The generator refuses any date on which a zone in the game changes its clock.
 */
export type ClockSeason = 'winter' | 'summer' | 'us-first' | 'eu-first' | 'south-change';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const at = (month: number, day: number, season: ClockSeason) => ({ month, day, season, label: `${day} ${MONTHS[month - 1]}` });

export const CLOCK_DATES = [
  at(1, 12, 'winter'),
  at(1, 20, 'winter'),
  at(1, 29, 'winter'),
  at(2, 6, 'winter'),
  at(2, 17, 'winter'),
  at(12, 9, 'winter'),
  at(12, 16, 'winter'),
  at(6, 18, 'summer'),
  at(7, 2, 'summer'),
  at(7, 14, 'summer'),
  at(7, 27, 'summer'),
  at(8, 8, 'summer'),
  at(8, 19, 'summer'),
  at(3, 11, 'us-first'),
  at(3, 16, 'us-first'),
  at(3, 20, 'us-first'),
  at(3, 24, 'us-first'),
  at(10, 26, 'eu-first'),
  at(10, 27, 'eu-first'),
  at(10, 28, 'eu-first'),
  at(4, 1, 'south-change'),
  at(4, 9, 'south-change'),
  at(4, 16, 'south-change'),
  at(4, 28, 'south-change'),
  at(9, 29, 'south-change'),
  at(10, 1, 'south-change'),
] as const;
