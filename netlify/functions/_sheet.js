// Shared helpers for reading and writing the Google Sheet by COLUMN HEADER
// NAME rather than by fixed position.
//
// Why this exists: the Bookings and Customers tabs get rearranged by hand —
// columns added, deleted, renamed, reordered. Any code that writes to "column
// D" silently corrupts the sheet the moment a column moves. Every function
// here looks up where a value belongs by its header name instead, so the
// layout can change freely without touching the code.
//
// Matching ignores case, spaces, hyphens and underscores: "Base Fare",
// "base_fare" and "base fare" are the same column.

// Headers that are spelled differently in the sheet from the key used in
// code. Add to this rather than renaming columns in the sheet.
const HEADER_ALIASES = {
  elderly_assitance: 'elderly_assistance',
  elderly_assistence: 'elderly_assistance',
  elderly: 'elderly_assistance',
  requested_date_time: 'requested_datetime',
  car_seat: 'car_seats',
  carseats: 'car_seats',
  cabin_temperature: 'cabin_temp',
  waiting_fee: 'waiting_late_fee',
  late_fee: 'waiting_late_fee',
  waiting_late: 'waiting_late_fee',
  overnight: 'overnight_trip',
  hourly: 'hourly_trip',
  total: 'fare_total',
  payment: 'payment_method',
  rides: 'total_rides',
  monthly_rides: 'rides_this_month',
  rides_this_mounth: 'rides_this_month',
  car: 'car_type',
  vehicle: 'car_type',
  likes: 'likes',
  dislikes: 'dislikes',
  dislike: 'dislikes',
  like: 'likes',
};

function normalizeHeader(header) {
  const key = String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_');
  return HEADER_ALIASES[key] || key;
}

// 1 -> "A", 26 -> "Z", 27 -> "AA"
function columnLetter(n) {
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Empty / missing -> "N/A". 0 is a real value and is kept as 0.
function orNA(value) {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string' && value.trim() === '') return 'N/A';
  return value;
}

// Reads a whole tab and returns its header row (normalized), plus the data
// rows. `keys` lines up index-for-index with each row's cells.
async function readTab(sheets, spreadsheetId, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A:ZZ`,
  });
  const values = res.data.values || [];
  const headers = values[0] || [];
  return {
    headers,
    keys: headers.map(normalizeHeader),
    rows: values.slice(1),
    lastColumn: columnLetter(Math.max(headers.length, 1)),
  };
}

// Builds a row laid out to match `keys`. Starts from `existingRow` so any
// column the caller doesn't manage — hand-typed notes, likes, dislikes, a
// status column someone keeps by hand — survives the write untouched. Only
// keys present in `cells` are overwritten.
function buildRow(keys, cells, existingRow = []) {
  return keys.map((key, i) => {
    if (Object.prototype.hasOwnProperty.call(cells, key)) return cells[key];
    return existingRow[i] !== undefined ? existingRow[i] : '';
  });
}

// Pulls one row out into a plain object keyed by header name.
function rowToObject(keys, row = []) {
  const out = {};
  keys.forEach((key, i) => {
    out[key] = row[i] !== undefined ? row[i] : '';
  });
  return out;
}

module.exports = {
  normalizeHeader,
  columnLetter,
  orNA,
  readTab,
  buildRow,
  rowToObject,
  HEADER_ALIASES,
};
