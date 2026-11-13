import type { CountryId } from '@geogames/geodata';

/**
 * The places Clockwork asks about, by hand: every one a country big enough to
 * see on the map (no microstates), or a named city in a country with several
 * time zones. The UTC offsets themselves come from the IANA time zone database,
 * through `scripts/build-clockwork.ts`, into `clockwork-offsets.ts`.
 *
 * `kind` is the skill a place tests first:
 * - 'longitude': its clock matches where it lies, about 15° of longitude an hour.
 * - 'exception': its clock doesn't match its longitude, or runs on a half hour.
 * - 'seasons': a daylight-saving trap, such as a place that dropped it.
 * - 'odd': the oddities, a quarter-hour or an island far ahead.
 * Places with daylight saving are asked on summer dates too, whatever their kind.
 */
export type ClockKind = 'longitude' | 'exception' | 'seasons' | 'odd';

export interface ClockPlace {
  /** Stable id, used in tests and to keep a place from coming back too soon. */
  id: string;
  country: CountryId;
  /** IANA zone. */
  zone: string;
  /** A named city, for countries with more than one zone: the level asks about its zone. */
  city?: { name: string; latlng: readonly [number, number] };
  kind: ClockKind;
  /** 1: a place anyone has heard of, fit for the first levels. */
  tier: 1 | 2;
  /** Why the clock is what it is, shown after the level when it's unusual. */
  note?: string;
}

const city = (name: string, lat: number, lng: number) => ({ name, latlng: [lat, lng] as const });

export const CLOCK_PLACES: readonly ClockPlace[] = [
  // Clocks that follow longitude.
  { id: 'gbr', country: 'GBR', zone: 'Europe/London', kind: 'longitude', tier: 1, note: 'UTC is the old Greenwich Mean Time, London’s winter clock.' },
  { id: 'irl', country: 'IRL', zone: 'Europe/Dublin', kind: 'longitude', tier: 1 },
  { id: 'prt', country: 'PRT', zone: 'Europe/Lisbon', city: city('Lisbon', 38.72, -9.14), kind: 'longitude', tier: 1 },
  { id: 'deu', country: 'DEU', zone: 'Europe/Berlin', kind: 'longitude', tier: 1 },
  { id: 'ita', country: 'ITA', zone: 'Europe/Rome', kind: 'longitude', tier: 1 },
  { id: 'pol', country: 'POL', zone: 'Europe/Warsaw', kind: 'longitude', tier: 1 },
  { id: 'swe', country: 'SWE', zone: 'Europe/Stockholm', kind: 'longitude', tier: 1 },
  { id: 'nor', country: 'NOR', zone: 'Europe/Oslo', kind: 'longitude', tier: 1 },
  { id: 'aut', country: 'AUT', zone: 'Europe/Vienna', kind: 'longitude', tier: 1 },
  { id: 'cze', country: 'CZE', zone: 'Europe/Prague', kind: 'longitude', tier: 1 },
  { id: 'hun', country: 'HUN', zone: 'Europe/Budapest', kind: 'longitude', tier: 1 },
  { id: 'che', country: 'CHE', zone: 'Europe/Zurich', kind: 'longitude', tier: 1 },
  { id: 'grc', country: 'GRC', zone: 'Europe/Athens', kind: 'longitude', tier: 1 },
  { id: 'fin', country: 'FIN', zone: 'Europe/Helsinki', kind: 'longitude', tier: 1 },
  { id: 'ukr', country: 'UKR', zone: 'Europe/Kyiv', kind: 'longitude', tier: 1 },
  { id: 'rou', country: 'ROU', zone: 'Europe/Bucharest', kind: 'longitude', tier: 1 },
  { id: 'isr', country: 'ISR', zone: 'Asia/Jerusalem', kind: 'longitude', tier: 1, note: 'Israel’s summer time starts on the Friday before the last Sunday of March, two days before most of Europe’s.' },
  { id: 'rus-moscow', country: 'RUS', zone: 'Europe/Moscow', city: city('Moscow', 55.76, 37.62), kind: 'longitude', tier: 1 },
  { id: 'sau', country: 'SAU', zone: 'Asia/Riyadh', kind: 'longitude', tier: 1 },
  { id: 'are', country: 'ARE', zone: 'Asia/Dubai', kind: 'longitude', tier: 1 },
  { id: 'pak', country: 'PAK', zone: 'Asia/Karachi', kind: 'longitude', tier: 1 },
  { id: 'bgd', country: 'BGD', zone: 'Asia/Dhaka', kind: 'longitude', tier: 1 },
  { id: 'tha', country: 'THA', zone: 'Asia/Bangkok', kind: 'longitude', tier: 1 },
  { id: 'vnm', country: 'VNM', zone: 'Asia/Ho_Chi_Minh', kind: 'longitude', tier: 1 },
  { id: 'idn-jakarta', country: 'IDN', zone: 'Asia/Jakarta', city: city('Jakarta', -6.2, 106.85), kind: 'longitude', tier: 1 },
  { id: 'phl', country: 'PHL', zone: 'Asia/Manila', kind: 'longitude', tier: 1 },
  { id: 'twn', country: 'TWN', zone: 'Asia/Taipei', kind: 'longitude', tier: 1 },
  { id: 'kor', country: 'KOR', zone: 'Asia/Seoul', kind: 'longitude', tier: 1 },
  { id: 'jpn', country: 'JPN', zone: 'Asia/Tokyo', kind: 'longitude', tier: 1 },
  { id: 'aus-brisbane', country: 'AUS', zone: 'Australia/Brisbane', city: city('Brisbane', -27.47, 153.03), kind: 'longitude', tier: 1, note: 'Queensland has no daylight saving.' },
  { id: 'usa-new-york', country: 'USA', zone: 'America/New_York', city: city('New York', 40.71, -74.01), kind: 'longitude', tier: 1 },
  { id: 'usa-chicago', country: 'USA', zone: 'America/Chicago', city: city('Chicago', 41.88, -87.63), kind: 'longitude', tier: 1 },
  { id: 'usa-denver', country: 'USA', zone: 'America/Denver', city: city('Denver', 39.74, -104.99), kind: 'longitude', tier: 1 },
  { id: 'usa-los-angeles', country: 'USA', zone: 'America/Los_Angeles', city: city('Los Angeles', 34.05, -118.24), kind: 'longitude', tier: 1 },
  { id: 'can-toronto', country: 'CAN', zone: 'America/Toronto', city: city('Toronto', 43.65, -79.38), kind: 'longitude', tier: 1 },
  { id: 'can-vancouver', country: 'CAN', zone: 'America/Vancouver', city: city('Vancouver', 49.28, -123.12), kind: 'longitude', tier: 1 },
  { id: 'mex-mexico-city', country: 'MEX', zone: 'America/Mexico_City', city: city('Mexico City', 19.43, -99.13), kind: 'longitude', tier: 1, note: 'Most of Mexico dropped daylight saving in 2022.' },
  { id: 'col', country: 'COL', zone: 'America/Bogota', kind: 'longitude', tier: 1 },
  { id: 'per', country: 'PER', zone: 'America/Lima', kind: 'longitude', tier: 1 },
  { id: 'ecu-quito', country: 'ECU', zone: 'America/Guayaquil', city: city('Quito', -0.18, -78.47), kind: 'longitude', tier: 1 },
  { id: 'bra-rio', country: 'BRA', zone: 'America/Sao_Paulo', city: city('Rio de Janeiro', -22.91, -43.17), kind: 'longitude', tier: 1, note: 'Brazil dropped daylight saving in 2019.' },
  { id: 'usa-honolulu', country: 'USA', zone: 'Pacific/Honolulu', city: city('Honolulu', 21.31, -157.86), kind: 'longitude', tier: 2, note: 'Hawaii has no daylight saving.' },
  { id: 'ken', country: 'KEN', zone: 'Africa/Nairobi', kind: 'longitude', tier: 2 },
  { id: 'eth', country: 'ETH', zone: 'Africa/Addis_Ababa', kind: 'longitude', tier: 2 },
  { id: 'tza', country: 'TZA', zone: 'Africa/Dar_es_Salaam', kind: 'longitude', tier: 2 },
  { id: 'zaf', country: 'ZAF', zone: 'Africa/Johannesburg', kind: 'longitude', tier: 2 },
  { id: 'nga', country: 'NGA', zone: 'Africa/Lagos', kind: 'longitude', tier: 2 },
  { id: 'jam', country: 'JAM', zone: 'America/Jamaica', kind: 'longitude', tier: 2 },
  { id: 'dom', country: 'DOM', zone: 'America/Santo_Domingo', kind: 'longitude', tier: 2 },
  { id: 'ven', country: 'VEN', zone: 'America/Caracas', kind: 'longitude', tier: 2 },
  { id: 'bol', country: 'BOL', zone: 'America/La_Paz', kind: 'longitude', tier: 2 },
  { id: 'ury', country: 'URY', zone: 'America/Montevideo', kind: 'longitude', tier: 2, note: 'Uruguay dropped daylight saving in 2015.' },
  { id: 'irq', country: 'IRQ', zone: 'Asia/Baghdad', kind: 'longitude', tier: 2 },
  { id: 'uzb', country: 'UZB', zone: 'Asia/Tashkent', kind: 'longitude', tier: 2 },
  { id: 'kaz', country: 'KAZ', zone: 'Asia/Almaty', kind: 'longitude', tier: 2, note: 'Kazakhstan moved to a single zone, UTC+5, in 2024.' },
  { id: 'mng-ulaanbaatar', country: 'MNG', zone: 'Asia/Ulaanbaatar', city: city('Ulaanbaatar', 47.89, 106.91), kind: 'longitude', tier: 2 },
  { id: 'rus-yekaterinburg', country: 'RUS', zone: 'Asia/Yekaterinburg', city: city('Yekaterinburg', 56.84, 60.6), kind: 'longitude', tier: 2 },
  { id: 'rus-novosibirsk', country: 'RUS', zone: 'Asia/Novosibirsk', city: city('Novosibirsk', 55.01, 82.93), kind: 'longitude', tier: 2 },
  { id: 'rus-vladivostok', country: 'RUS', zone: 'Asia/Vladivostok', city: city('Vladivostok', 43.12, 131.89), kind: 'longitude', tier: 2 },
  { id: 'aus-perth', country: 'AUS', zone: 'Australia/Perth', city: city('Perth', -31.95, 115.86), kind: 'longitude', tier: 2 },
  { id: 'png', country: 'PNG', zone: 'Pacific/Port_Moresby', kind: 'longitude', tier: 2 },
  { id: 'khm', country: 'KHM', zone: 'Asia/Phnom_Penh', kind: 'longitude', tier: 2 },
  { id: 'lao', country: 'LAO', zone: 'Asia/Vientiane', kind: 'longitude', tier: 2 },
  { id: 'omn', country: 'OMN', zone: 'Asia/Muscat', kind: 'longitude', tier: 2 },
  { id: 'yem', country: 'YEM', zone: 'Asia/Aden', kind: 'longitude', tier: 2 },
  { id: 'tjk', country: 'TJK', zone: 'Asia/Dushanbe', kind: 'longitude', tier: 2 },
  { id: 'mdg', country: 'MDG', zone: 'Indian/Antananarivo', kind: 'longitude', tier: 2 },
  { id: 'moz', country: 'MOZ', zone: 'Africa/Maputo', kind: 'longitude', tier: 2 },
  { id: 'ago', country: 'AGO', zone: 'Africa/Luanda', kind: 'longitude', tier: 2 },
  { id: 'sdn', country: 'SDN', zone: 'Africa/Khartoum', kind: 'longitude', tier: 2 },
  { id: 'mli', country: 'MLI', zone: 'Africa/Bamako', kind: 'longitude', tier: 2 },
  { id: 'gha', country: 'GHA', zone: 'Africa/Accra', kind: 'longitude', tier: 2 },
  { id: 'cmr', country: 'CMR', zone: 'Africa/Douala', kind: 'longitude', tier: 2 },
  { id: 'zwe', country: 'ZWE', zone: 'Africa/Harare', kind: 'longitude', tier: 2 },
  { id: 'som', country: 'SOM', zone: 'Africa/Mogadishu', kind: 'longitude', tier: 2 },
  { id: 'cod-kinshasa', country: 'COD', zone: 'Africa/Kinshasa', city: city('Kinshasa', -4.32, 15.31), kind: 'longitude', tier: 2 },
  { id: 'cod-lubumbashi', country: 'COD', zone: 'Africa/Lubumbashi', city: city('Lubumbashi', -11.66, 27.48), kind: 'longitude', tier: 2 },
  { id: 'gtm', country: 'GTM', zone: 'America/Guatemala', kind: 'longitude', tier: 2 },
  { id: 'cri', country: 'CRI', zone: 'America/Costa_Rica', kind: 'longitude', tier: 2 },
  { id: 'pan', country: 'PAN', zone: 'America/Panama', kind: 'longitude', tier: 2 },
  { id: 'guy', country: 'GUY', zone: 'America/Guyana', kind: 'longitude', tier: 2 },
  { id: 'bra-manaus', country: 'BRA', zone: 'America/Manaus', city: city('Manaus', -3.12, -60.02), kind: 'longitude', tier: 2 },
  { id: 'idn-makassar', country: 'IDN', zone: 'Asia/Makassar', city: city('Makassar', -5.15, 119.43), kind: 'longitude', tier: 2 },
  { id: 'idn-jayapura', country: 'IDN', zone: 'Asia/Jayapura', city: city('Jayapura', -2.53, 140.72), kind: 'longitude', tier: 2 },
  { id: 'rus-yakutsk', country: 'RUS', zone: 'Asia/Yakutsk', city: city('Yakutsk', 62.03, 129.73), kind: 'longitude', tier: 2 },

  // Clocks that don't match their longitude.
  { id: 'chn', country: 'CHN', zone: 'Asia/Shanghai', kind: 'exception', tier: 1, note: 'China is about five zones wide but runs on Beijing time everywhere: in the far west the sun is highest around 15:00.' },
  { id: 'esp-madrid', country: 'ESP', zone: 'Europe/Madrid', city: city('Madrid', 40.42, -3.7), kind: 'exception', tier: 1, note: 'Spain lies level with Britain but has kept Central European Time since 1940.' },
  { id: 'fra', country: 'FRA', zone: 'Europe/Paris', kind: 'exception', tier: 1, note: 'France is on Central European Time, an hour ahead of its longitude.' },
  { id: 'nld', country: 'NLD', zone: 'Europe/Amsterdam', kind: 'longitude', tier: 2 },
  { id: 'bel', country: 'BEL', zone: 'Europe/Brussels', kind: 'longitude', tier: 2 },
  { id: 'arg', country: 'ARG', zone: 'America/Argentina/Buenos_Aires', kind: 'exception', tier: 1, note: 'Argentina lies mostly in the UTC−4 and −5 bands but keeps UTC−3 all year.' },
  { id: 'isl', country: 'ISL', zone: 'Atlantic/Reykjavik', kind: 'exception', tier: 1, note: 'Iceland keeps UTC all year, though its longitude says about UTC−1.' },
  { id: 'ind', country: 'IND', zone: 'Asia/Kolkata', kind: 'exception', tier: 1, note: 'India has one zone, half an hour off the usual grid: UTC+5:30.' },
  { id: 'irn', country: 'IRN', zone: 'Asia/Tehran', kind: 'exception', tier: 1, note: 'Iran runs on UTC+3:30, and dropped daylight saving in 2022.' },
  { id: 'tur', country: 'TUR', zone: 'Europe/Istanbul', kind: 'exception', tier: 1, note: 'Turkey stayed on summer time for good in 2016: UTC+3 all year.' },
  { id: 'can-st-johns', country: 'CAN', zone: 'America/St_Johns', city: city('St. John’s', 47.56, -52.71), kind: 'exception', tier: 2, note: 'Newfoundland runs half an hour off its neighbours: UTC−3:30, or −2:30 in summer.' },
  { id: 'lka', country: 'LKA', zone: 'Asia/Colombo', kind: 'exception', tier: 2, note: 'Sri Lanka shares India’s UTC+5:30.' },
  { id: 'afg', country: 'AFG', zone: 'Asia/Kabul', kind: 'exception', tier: 2, note: 'Afghanistan runs on UTC+4:30.' },
  { id: 'mmr', country: 'MMR', zone: 'Asia/Yangon', kind: 'exception', tier: 2, note: 'Myanmar runs on UTC+6:30.' },
  { id: 'aus-darwin', country: 'AUS', zone: 'Australia/Darwin', city: city('Darwin', -12.46, 130.84), kind: 'exception', tier: 2, note: 'Central Australia runs on a half hour, UTC+9:30, and the north has no daylight saving.' },
  { id: 'mys', country: 'MYS', zone: 'Asia/Kuala_Lumpur', kind: 'exception', tier: 2, note: 'Malaysia moved to UTC+8 in 1982, so its peninsula and Borneo share one clock.' },
  { id: 'prk', country: 'PRK', zone: 'Asia/Pyongyang', kind: 'exception', tier: 2 },
  { id: 'rus-kaliningrad', country: 'RUS', zone: 'Europe/Kaliningrad', city: city('Kaliningrad', 54.71, 20.51), kind: 'exception', tier: 2, note: 'Kaliningrad is an hour behind Moscow and keeps no daylight saving, so it’s an hour ahead of Poland in winter and level with it in summer.' },
  { id: 'usa-anchorage', country: 'USA', zone: 'America/Anchorage', city: city('Anchorage', 61.22, -149.9), kind: 'exception', tier: 2, note: 'Alaska is a zone ahead of its longitude, nearer to the rest of the US.' },
  { id: 'dza', country: 'DZA', zone: 'Africa/Algiers', kind: 'exception', tier: 2, note: 'Algeria is on UTC+1, though it sits mostly on the Greenwich meridian.' },
  { id: 'sen', country: 'SEN', zone: 'Africa/Dakar', kind: 'exception', tier: 2, note: 'Senegal keeps UTC, though its longitude says about UTC−1.' },
  { id: 'grl-nuuk', country: 'GRL', zone: 'America/Nuuk', city: city('Nuuk', 64.18, -51.72), kind: 'exception', tier: 2, note: 'Nuuk moved its clock an hour forward in 2023, to UTC−2, with daylight saving from 2024.' },

  { id: 'chn-kashgar', country: 'CHN', zone: 'Asia/Shanghai', city: city('Kashgar', 39.47, 75.99), kind: 'exception', tier: 2, note: 'Kashgar, at China’s western edge, officially keeps Beijing time, UTC+8, though its longitude says about UTC+5. Many locals also keep an unofficial Xinjiang time, two hours behind.' },
  { id: 'rus-kamchatka', country: 'RUS', zone: 'Asia/Kamchatka', city: city('Petropavlovsk-Kamchatsky', 53.02, 158.65), kind: 'exception', tier: 2, note: 'Kamchatka runs on UTC+12, more than an hour ahead of its longitude, like much of Russia.' },
  { id: 'rus-samara', country: 'RUS', zone: 'Europe/Samara', city: city('Samara', 53.2, 50.15), kind: 'exception', tier: 2, note: 'Samara is an hour ahead of Moscow, on UTC+4.' },
  { id: 'blr', country: 'BLR', zone: 'Europe/Minsk', kind: 'exception', tier: 2, note: 'Belarus stayed on summer time for good in 2011, and so keeps Moscow’s UTC+3, an hour ahead of its longitude.' },
  { id: 'geo', country: 'GEO', zone: 'Asia/Tbilisi', kind: 'exception', tier: 2, note: 'Georgia runs on UTC+4, an hour ahead of its longitude and of Moscow.' },
  { id: 'kgz', country: 'KGZ', zone: 'Asia/Bishkek', kind: 'exception', tier: 2, note: 'Kyrgyzstan runs on UTC+6, an hour ahead of its longitude and of Kazakhstan.' },
  { id: 'lby', country: 'LBY', zone: 'Africa/Tripoli', kind: 'exception', tier: 2, note: 'Libya uses UTC+2, an hour ahead of its longitude.' },
  { id: 'nam', country: 'NAM', zone: 'Africa/Windhoek', kind: 'exception', tier: 2, note: 'Namibia keeps UTC+2 all year, like South Africa, though most of it lies in the UTC+1 band.' },

  // Daylight-saving traps.
  { id: 'chl-santiago', country: 'CHL', zone: 'America/Santiago', city: city('Santiago', -33.45, -70.67), kind: 'seasons', tier: 1, note: 'Chile is on daylight saving in the southern summer, from September to April.' },
  { id: 'nzl-auckland', country: 'NZL', zone: 'Pacific/Auckland', city: city('Auckland', -36.85, 174.76), kind: 'seasons', tier: 1, note: 'New Zealand is on daylight saving from late September to early April.' },
  { id: 'aus-sydney', country: 'AUS', zone: 'Australia/Sydney', city: city('Sydney', -33.87, 151.21), kind: 'seasons', tier: 1, note: 'South-east Australia is on daylight saving from October to April; Queensland, to the north, isn’t.' },
  { id: 'aus-adelaide', country: 'AUS', zone: 'Australia/Adelaide', city: city('Adelaide', -34.93, 138.6), kind: 'seasons', tier: 2, note: 'South Australia is on a half hour, UTC+9:30, plus daylight saving in the southern summer.' },
  { id: 'usa-phoenix', country: 'USA', zone: 'America/Phoenix', city: city('Phoenix', 33.45, -112.07), kind: 'seasons', tier: 2, note: 'Arizona keeps no daylight saving: level with Denver in winter, with Los Angeles in summer.' },
  { id: 'pry', country: 'PRY', zone: 'America/Asuncion', kind: 'seasons', tier: 2, note: 'Paraguay stopped changing its clocks in 2024 and keeps UTC−3 all year.' },
  { id: 'egy', country: 'EGY', zone: 'Africa/Cairo', kind: 'seasons', tier: 2, note: 'Egypt brought daylight saving back in 2023.' },
  { id: 'cub', country: 'CUB', zone: 'America/Havana', kind: 'seasons', tier: 2, note: 'Cuba changes its clocks on the same days as the United States.' },
  { id: 'jor', country: 'JOR', zone: 'Asia/Amman', kind: 'seasons', tier: 2, note: 'Jordan stayed on summer time for good in 2022: UTC+3 all year.' },

  { id: 'aus-melbourne', country: 'AUS', zone: 'Australia/Melbourne', city: city('Melbourne', -37.81, 144.96), kind: 'seasons', tier: 2, note: 'Victoria is on daylight saving from October to April.' },
  { id: 'mex-tijuana', country: 'MEX', zone: 'America/Tijuana', city: city('Tijuana', 32.51, -117.04), kind: 'seasons', tier: 2, note: 'Most of Mexico dropped daylight saving in 2022, but towns on the US border such as Tijuana still change with the US.' },
  { id: 'can-regina', country: 'CAN', zone: 'America/Regina', city: city('Regina', 50.45, -104.61), kind: 'seasons', tier: 2, note: 'Saskatchewan keeps Central Standard Time all year, with no daylight saving.' },
  { id: 'syr', country: 'SYR', zone: 'Asia/Damascus', kind: 'seasons', tier: 2, note: 'Syria stayed on summer time for good in 2022: UTC+3 all year.' },
  { id: 'hti', country: 'HTI', zone: 'America/Port-au-Prince', kind: 'seasons', tier: 2, note: 'Haiti changes its clocks on the same days as the United States.' },

  // The oddities.
  { id: 'npl', country: 'NPL', zone: 'Asia/Kathmandu', kind: 'odd', tier: 2, note: 'Nepal runs on UTC+5:45, a quarter-hour off India.' },
  { id: 'nzl-chatham', country: 'NZL', zone: 'Pacific/Chatham', city: city('Chatham Islands', -43.95, -176.55), kind: 'odd', tier: 2, note: 'The Chatham Islands run 45 minutes ahead of the rest of New Zealand: UTC+12:45, or +13:45 in summer.' },
  { id: 'chl-easter', country: 'CHL', zone: 'Pacific/Easter', city: city('Easter Island', -27.11, -109.35), kind: 'odd', tier: 2, note: 'Easter Island is two hours behind mainland Chile, and changes its clocks on the same days.' },
  { id: 'esp-canary', country: 'ESP', zone: 'Atlantic/Canary', city: city('Canary Islands', 28.29, -16.63), kind: 'odd', tier: 2, note: 'The Canary Islands are an hour behind mainland Spain, on London’s time.' },
  { id: 'prt-azores', country: 'PRT', zone: 'Atlantic/Azores', city: city('Azores', 37.74, -25.67), kind: 'odd', tier: 2, note: 'The Azores run an hour behind Lisbon: UTC−1, or UTC in summer.' },
];
