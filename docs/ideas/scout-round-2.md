# Scout round 2: out-of-the-box games

Date: 2026-11-13. Brief: eight ideas, none centred on cities or on country borders/neighbours, new data sources allowed.

## The checks every idea had to pass

Each idea below was tested against `memory/game-taste.md` and `memory/game-feedback.md`:

- **Recall, not choice.** You type a name or click a spot. There are no options to choose from.
- **The answer is visible on the map.** Nothing too small to see is ever an answer. Where features are small (straits, short rivers), the map zooms to them.
- **Arcade life rules.** Endless with no level cap. Skip costs a life. At most one life is lost per level: 3 misses or a skip or a timeout. Like Halfway, a run may tighten the free misses late on.
- **The difficulty changes the skill (the City Lights lesson).** Every ramp below names the skill each band tests. None of them works by hiding the one clue that made it easy. Dot-pattern and imagery-recognition games were left out for that reason. A satellite or night-lights "where is this?" game hits the same trap as City Lights: with the coastline it's a giveaway, without it it's guesswork.
- **Variety.** Each idea has a different theme: physical geography, rivers, climate, time, trade, the coordinate grid, scripts and the sun.
- **No flag or capital spin-offs** (advised against in game-ideas.md). Nothing that relies on Silhouette Chain's outline-naming.

What I looked at on other sites: geographygames.net has Peak or Deep (elevation), Draw the Country/Border, Zoom Out and flag games. World of Maps (2025) makes you guess which dataset a globe shows. Worldle, Globle, Travle and MapTap all give a country or city with distance clues. Hardly anyone has a typed-recall arcade game on **physical features, rivers, climate or time zones**. That is the gap below. No UI cues were taken from geocore.fun.

---

## 1. Blank Atlas

**Pitch:** a sea, mountain range, desert, peninsula or lake lights up on a physical map with no labels and no borders. Name it.

**One level:**
1. The map pans and zooms to the feature: a filled area for seas, deserts and ranges, an outline for lakes. Only coastlines and shaded relief are drawn.
2. You type the name. Search accepts aliases (e.g. "Persian Gulf"/"Arabian Gulf", "Sea of Japan"/"East Sea", "Hindu Kush").
3. A wrong guess costs a miss, and the feature you named flashes where it really is, if it exists. So a miss teaches you something. 3 misses or Skip costs the level's single life.
4. A flawless level earns the bonus. Level 1 might be the Sahara, the Andes or the Mediterranean.

**Ramp, and the skill each band tests:**
- Levels 1-8: the world's headline features, using Natural Earth's scalerank 0-2 (oceans' big seas, Himalayas, Sahara, Gobi, Great Lakes). *Skill: knowing the basic physical map.*
- Levels 9-20: the second tier and more categories: gulfs, bays, plateaus and basins (Gulf of Bothnia, Tibetan Plateau, Atacama, Zagros, Lake Titicaca). *Skill: naming regions you'd recognise on a physical map.*
- Levels 21+: straits, channels, small ranges and archipelagos (Strait of Hormuz, Mozambique Channel, Dinaric Alps, Svalbard). The zoom stays tight so they're visible. *Skill: detailed atlas knowledge.*
- Endless at the top band; misses tighten late, as in Halfway.
- No-repeat rule: a feature isn't asked again within the last N levels. Neighbouring features of the same type aren't asked back to back.

**Data:** Natural Earth 1:10m physical layers, public domain:
- `geography_regions_polys`: ranges, deserts, plateaus, basins, peninsulas, island groups, about 1,000 features
- `geography_marine_polys`: seas, gulfs, bays, straits, about 300
- `lakes`

Each feature has a `scalerank` and a feature class, which gives the ramp for free. Raw it's a few MB; simplified and filtered to about 600 features it's around 300-500 KB. Bundle it offline and lazy-load it like the country shapes. Trust: these are the layers most atlases and web maps use. The names are mostly the standard English ones. Expect a manual pass for fuzzy polygons and odd names, plus an alias list, through an `overrides.json` like the countries have.

**Main risk:** fuzzy shapes. A desert or a plateau has no hard edge, and a player who "knows" the Karakum may picture it elsewhere. Mitigations: show ranges and deserts as soft, shaded areas, accept known aliases, and drop features whose polygon a geography fan would dispute. A second risk is "name the shape" feeling like Silhouette Chain. It is different: the feature sits in place on the real map, so it's about location knowledge, not outline trivia.

**Effort:** M. It needs a build script for the NE layers, an alias list and a curation pass. The game screen is a typed-recall map level, which the repo already does.

---

## 2. River Run

**Pitch:** a river draws itself from its source towards the sea. Name it before it gets there.

**One level:**
1. On a borderless physical map, a blue line starts at a river's source and grows along its course at a steady speed.
2. Type the river's name at any time. The earlier you're right, the more points.
3. A wrong guess costs a miss, and the river you named is drawn faintly in grey where it really runs, so you learn from it. 3 misses or Skip costs a life. If the line reaches the mouth unnamed, that counts as a timeout (a skip).
4. When the level ends, the whole river is shown with its name and length.

**Ramp, and the skill each band tests:**
- Levels 1-8: the great rivers (Nile, Amazon, Mississippi, Danube, Yangtze, Ganges, Rhine) on a continent-scale view. *Skill: knowing which big river is which.*
- Levels 9-20: mid-sized rivers, zoomed to the region (Loire, Elbe, Vistula, Orinoco, Zambezi, Ob, Murray, Irrawaddy). *Skill: regional river knowledge.*
- Levels 21+: tributaries and rivers whose start misleads you (Inn, Ohio, Madeira, Blue Nile, Syr Darya). The line also draws faster, so you must name it from the first stretch, not the mouth. *Skill: knowing where rivers rise, not only where they end.*
- The speed and the tier move separately, so the game never flips from trivial to impossible: a hard river is drawn slowly, an easy one fast.

**Data:** Natural Earth 1:10m `rivers_lake_centerlines`, plus its Europe and North America supplements, public domain. That's about 1,400 named river segments with scalerank, joined by name into whole rivers. Simplified, it's about 300-600 KB. Each river needs its source end determined, i.e. the direction its segments flow; NE segments are mostly drawn in flow direction, but check them. For a quality check, compare names and lengths with Wikidata (`P2043` length, `P885` origin, `P403` mouth; CC0). Trust: good for major and mid rivers. Small ones need curating.

**Main risk:** rivers that run through lakes or cross borders under several names (Rhine/Lek, Amu Darya, Paraná/Río de la Plata). Store aliases and treat the river as a single course. Second risk: the course is the only clue. That's fine as long as the map has relief and coastlines, so you can place yourself; it's a location skill, not pattern guessing.

**Effort:** M. It needs a river-merge script with source detection, an alias list and the line animation. The game logic is small.

---

## 3. Clockwork

**Pitch:** it's 12:00 in London. A country lights up. What time is it there?

**One level:**
1. A borderless map shows a highlighted country (never a microstate). The level gives a reference time in UTC, and from the second band also a date.
2. Type the local time, like `17:30`. After a wrong guess you see "earlier" or "later", so the free misses become a short hunt, not a lottery.
3. 3 misses or Skip costs a life. Large countries with several zones ask for a highlighted part (e.g. "Western Australia", "Yakutia").
4. When the level ends, the country's time zone band is shown with its offset, and a short "why" when the zone is unusual.

**Ramp, and the skill each band tests:**
- Levels 1-8: whole-hour zones that match longitude (Japan, Brazil's east, Egypt, Mexico). No daylight saving. *Skill: reading longitude as time.*
- Levels 9-20: countries whose clock doesn't match their longitude (China on one zone, Spain on Central European time, Argentina, Iceland), and half-hour zones (India, Iran, Afghanistan, Newfoundland). *Skill: knowing the political exceptions.*
- Levels 21+: a real date is given, so daylight saving matters, including the southern hemisphere doing it the other way (Chile, New Zealand, south-east Australia), plus the oddities (Nepal +5:45, Chatham Islands, Kiribati at +14). *Skill: seasons and the calendar.*
- Each band adds a new skill rather than making the last one more obscure.

**Data:** the IANA time zone database. It's public domain and the global standard: every phone and OS uses it. The browser already has it through `Intl.DateTimeFormat`, so offsets and daylight-saving rules for any date need no bundle. We need only the country-to-zone mapping (`zone1970.tab`, a few KB). For the multi-zone countries, region shapes come from Natural Earth `admin_1_states_provinces` (public domain), or from timezone-boundary-builder (ODbL, from OpenStreetMap), only for the zones used, simplified to a few hundred KB. Trust: excellent, it's the same data a player's own clock uses.

**Main risk:** typing times may feel like arithmetic rather than geography. Answer: the early band is short, and the middle band is exactly the geography a fan enjoys knowing (why Spain is "wrong", why China has one zone). Second risk: browsers' `Intl` data can be out of date on old devices. Pin the expected answers in the build from a fixed tzdb release and test against them.

**Effort:** S-M. There is little data. The work is the time input and the multi-zone highlighting.

---

## 4. Climate Detective

**Pitch:** you see a year of weather: monthly temperature and rainfall. Click where on Earth it is.

**One level:**
1. A climograph shows 12 temperature points and 12 rain bars. There's no name, coordinates or hint.
2. Click a spot on the map. Scoring works like Pin Drop: every kilometre off eats into the level's budget.
3. After a miss, your pin's own climograph is drawn on top in grey. You see *why* you're wrong ("too wet in July, so I'm in the monsoon belt") and can try again. 3 misses or Skip costs a life.
4. The answer is shown with its Köppen class (e.g. "Csa, hot-summer Mediterranean").

**Ramp, and the skill each band tests:**
- Levels 1-8: unmistakable climates (Saharan desert, Siberian continental, equatorial rainforest, Indian monsoon) with a wide budget. *Skill: telling climate zones apart.*
- Levels 9-20: you must read the hemisphere (summer in January), oceanic versus continental, and rain-shadow and west-coast deserts. The budget is tighter. *Skill: reading what drives a climate.*
- Levels 21+: altitude climates (Andean altiplano, Ethiopian highlands, Tibet), cold currents (Namib, Atacama coast) and unusual monsoon timing (East Africa's two rainy seasons). *Skill: fine climate geography.*
- **Fairness filter:** a point qualifies as a puzzle only if no climatically near-identical point lies more than about 1,500 km away. That stops "this could be in five places" levels, which are the City Lights trap. Precompute this.

**Data:** gridded monthly climate normals. **Don't use WorldClim**: its terms forbid commercial use and redistribution, which matters for a freemium app. Use **CRU TS 4.x** climatology (University of East Anglia, 0.5°, published under an open licence with attribution; confirm before building) or **ERA5 monthly averaged reanalysis** (Copernicus, free including commercial use with attribution). Sample about 5,000 land points that pass the fairness filter, with 24 numbers each, about 250 KB of JSON. Köppen classes can be derived from the same numbers. Trust: research-grade data used by climate scientists. The values will look right to anyone who checks a climate chart.

**Main risk:** it's the most original idea and the most likely to split opinion. Some players don't read charts well. The fairness filter and the grey "your pin's climate" overlay are what make it a reasoning game rather than guessing. Phones need a compact chart.

**Effort:** L. It needs a precompute pipeline from a gridded dataset and a fairness filter, like Great Circle's precomputed lines, plus a chart component.

---

## 5. Supply Chain

**Pitch:** coffee, cobalt, cocoa or copper. Name the world's top producers.

**One level:**
1. The level names a commodity and how many top producers to find (3 to 5). The map has no borders. A country fills in when found, with its share of world output.
2. Type countries in any order. Any of the top N counts. A country that produces it but isn't in the top N is a miss, but it's shown with its rank ("Peru: 9th"), so the miss tells you something.
3. 3 misses or Skip costs a life. Finding all N without a miss is flawless and earns the bonus. This is the City Circle "name the biggest" loop that the user loves, with a new theme.

**Ramp, and the skill each band tests:**
- Levels 1-8: famous goods with famous leaders, top 3 (oil, coffee, rice, cocoa, wine). *Skill: general knowledge of the world economy.*
- Levels 9-20: top 4-5, plus minerals and farm goods where the order surprises people (lithium, cobalt, bananas, tea, soybeans, uranium). *Skill: knowing who actually produces what.*
- Levels 21+: niche or regional goods (vanilla, saffron, platinum, rare earths, olive oil). The ranks are also stricter: name the top producer first. *Skill: depth.*
- Commodities with a shared top 3 (e.g. many grains) aren't asked back to back. That's the 50% overlap rule applied to producer lists.
- Microstates never rank in the top 5 of these lists, so every answer is visible.

**Data:**
- **FAOSTAT** crops and livestock production (UN FAO, CC BY 4.0), with the latest year and a 3-year average to smooth out bad harvests.
- **USGS Mineral Commodity Summaries** (US public domain) for mining.
- **Energy Institute Statistical Review** (free download) or **EIA international data** (US public domain) for oil, gas and coal.

Bundled, it's about 150 commodities × top 10 producers, under 100 KB. Show the source and year on every level, so the user can compare and trust it. Trust: these are the official primary sources quoted in news and textbooks.

**Main risk:** it's "name countries" again, though the theme is new. It's also close to trivia rather than map skill. The map fill and share-of-world readout keep it geographic. Data years differ between sources, so state the year.

**Effort:** S-M. It needs a data build from three CSVs. The game loop is close to City Circle's.

---

## 6. On the Grid

**Pitch:** 23°S, 47°W. Click it. First with the grid lines drawn, then without.

**One level:**
1. You're given coordinates (whole degrees early, then decimals).
2. Click on a borderless world map. Distance is scored against the level's budget, as in Pin Drop.
3. Up to 3 clicks. After each miss, an arrow shows the direction and the distance in km. 3 misses or Skip costs a life.
4. The answer is shown with what's there ("off Brazil's coast, near São Paulo", "in the Tibetan Plateau"), so there's a reward.

**Ramp, and the skill each band tests:**
- Levels 1-8: the grid is drawn every 10°, with round coordinates. *Skill: reading a map grid.*
- Levels 9-20: only the Equator, the tropics and the prime meridian are drawn. *Skill: knowing where the main lines run (the Equator through Gabon, Kenya and Borneo; 0° through Ghana and London).*
- Levels 21+: no lines at all, and coordinates down to the degree. *Skill: a real internal grid: the 49th parallel, 30°N across the Gulf, Cairo, Shanghai; 180° through Fiji.*
- Each band removes a scaffold that you learned to replace in the band before. That's a learnable progression, not a flip from easy to impossible.

**Data:** none new. The coastlines come from the country shapes already in the repo, and the "what's there" label is a reverse lookup on the existing countries plus Blank Atlas's NE feature layers, if built.

**Main risk:** it could feel dry, like a numbers exercise. The "what's there" reveal and the shrinking scaffold have to carry it. Ocean-heavy targets are dull, so bias targets towards land and coasts.

**Effort:** S.

---

## 7. Native Tongue

**Pitch:** "Sakartvelo", "Ελλάδα", "Україна", "مصر". Name the country from its own name for itself.

**One level:**
1. A country's endonym is shown in its own script, large, with a native-speaker-style typeface. A borderless map shows only the coastline, with nothing highlighted.
2. Type the English name of the country. After the answer, the country lights up and the transliteration is shown.
3. A wrong guess costs a miss, and the name of the country you guessed is shown in its own script, so you can compare (e.g. guessing Bulgaria for "Україна" shows "България"). 3 misses or Skip costs a life.

**Ramp, and the skill each band tests:**
- Levels 1-8: Latin-script endonyms that look unlike English (Deutschland, Suomi, Magyarország, Hrvatska, Sverige). *Skill: knowing endonyms.*
- Levels 9-20: distinctive scripts that point to one country (Greek, Georgian, Armenian, Thai, Korean, Hebrew, Amharic). *Skill: recognising a script.*
- Levels 21+: shared scripts that must be read (Cyrillic: Беларусь, Україна, България, Србија, Монгол Улс; Arabic: مصر, العراق, تونس; Devanagari: नेपाल, भारत). *Skill: reading a little of the script.*
- This is the clearest "the difficulty changes the skill" ramp of the eight.

**Data:** **Unicode CLDR** territory names in each country's main language. Unicode licence, free including commercial use, maintained by Unicode with native-speaker vetting, and the most trusted source for this. Cross-check with Wikidata `P1448` official name (CC0). Under 30 KB. Microstates are excluded, keeping the visible-on-the-map rule even though the map plays a small role.

**Main risk:** the map isn't central, so it may feel like a quiz rather than a map game. A second risk: multi-language countries (Switzerland, Belgium, India) need one rule, such as using the most-spoken official language or showing them in rotation. It's close to "flag-type" quiz territory, which game-ideas.md warned about, but nobody else offers it as a ramped arcade game.

**Effort:** S. A font-coverage check is needed for Ge'ez, Georgian and similar scripts.

---

## 8. Sun Spot

**Pitch:** it's 15:00 UTC on 21 June. Click where the sun is directly overhead, and later where it's sunrise.

**One level:**
1. A UTC time and date are given. The world map has no borders, labels or terminator.
2. Click the subsolar point. Scoring works like Pin Drop, with a km budget.
3. After each click, the true day/night terminator is drawn for the time you *implied*, so you can see whether you're early, late or in the wrong season. 3 misses or Skip costs a life.
4. The answer is shown with the terminator and "what's under the sun" (e.g. "over the Sahara near Tibesti").

**Ramp, and the skill each band tests:**
- Levels 1-8: equinox dates and round hours (12:00 UTC = over the Gulf of Guinea). *Skill: longitude from time (15° per hour).*
- Levels 9-20: any date, so latitude moves with the season (the Tropics at the solstices). *Skill: the sun's yearly march.*
- Levels 21+: the task changes. Click a spot on the terminator ("where on the Equator is the sun rising now?") or a polar day/night boundary ("where does the midnight sun start today?"). *Skill: the full picture of day and night.*

**Data:** none. The solar position comes from standard astronomical formulas (NOAA solar calculator equations, public domain), and the coastlines are already in the repo.

**Main risk:** niche. It's closer to a physics puzzle than to the atlas-recall the user loves. Some players will find it a revelation, others will find it maths. It ranks last for that reason, but it's cheap and unlike anything on the other sites.

**Effort:** S.

---

## Considered and left out

- **Satellite or night-lights "where is this?"**: this is the City Lights failure again. With the coastline it's a giveaway, without it it's guesswork.
- **Earthquake or volcano dot patterns** (USGS, Smithsonian GVP): the same dot-pattern problem.
- **A volcano or peak pin drop** (Smithsonian GVP Holocene list, 1,300 volcanoes, free): a solid dataset, but it's Pin Drop with new data. It could later be a category inside Blank Atlas.
- **Name the countries where a language is official**: the theme is new, but it's the Border Blitz loop again, and the user asked for less country-listing.
- **Draw a country or border from memory** (geographygames.net has it): it's close to that site's game and centred on borders.

## Ranking and recommendation

| Rank | Game | Theme | Effort |
|---|---|---|---|
| 1 | Blank Atlas | physical features | M |
| 2 | River Run | rivers | M |
| 3 | Clockwork | time zones | S-M |
| 4 | Climate Detective | climate | L |
| 5 | Supply Chain | trade and resources | S-M |
| 6 | On the Grid | the latitude/longitude grid | S |
| 7 | Native Tongue | languages and scripts | S |
| 8 | Sun Spot | daylight and the sun | S |

**Build first: Blank Atlas, River Run, Clockwork.**
- **Blank Atlas** has the strongest typed recall from a mental map, on a theme the catalogue lacks entirely. One public-domain source gives it a natural difficulty ramp.
- **River Run** has the same recall plus stakes (name it before it reaches the sea), and its tier and speed ramp works separately. It shares the NE build script with Blank Atlas, so building the second is cheaper.
- **Clockwork** is cheap, its data is as trustworthy as the player's own clock, and each band adds a new skill (longitude → political exceptions → seasons).

Climate Detective is the boldest idea and the best fit for "out of the box". Build it fourth, once a cheaper game has tested the user's appetite for non-city themes, because it's the largest build.
