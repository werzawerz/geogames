// Extracts the city table from WUP 2018 (WUP2018-F12-Cities_Over_300K.xls) into a CSV snapshot.
// One-off; WUP 2018 is frozen. Usage: node scripts/extract-wup2018.cjs <dir with node_modules/xlsx> <xls> <out.csv>
// (xlsx 0.18.5 has known issues, so it isn't a project dependency; install it in a scratch folder.)
const XLSX = require(process.argv[2] + '/node_modules/xlsx');
const fs = require('fs');
const rows = XLSX.utils.sheet_to_json(XLSX.readFile(process.argv[3]).Sheets.Data, { header: 1, defval: '' });
const h = rows.findIndex((r) => r.includes('Urban Agglomeration'));
const header = rows[h];
const col = (n) => header.indexOf(String(n));
const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const years = [2015, 2020, 2025, 2030];
const out = [['city_code', 'country_code', 'country', 'name', 'note', 'lat', 'lng', ...years.map((y) => `pop_${y}`)].join(',')];
for (const r of rows.slice(h + 1)) {
  if (!r[col('Urban Agglomeration')]) continue;
  out.push(
    [r[col('City Code')], r[col('Country Code')], r[col('Country or area')], r[col('Urban Agglomeration')], r[col('Note')], r[col('Latitude')], r[col('Longitude')], ...years.map((y) => Math.round(r[header.findIndex((x) => String(x) === String(y))] * 1000))]
      .map(q)
      .join(','),
  );
}
fs.writeFileSync(process.argv[4], out.join('\n') + '\n');
console.log('rows', out.length - 1);
