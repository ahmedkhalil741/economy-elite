// The drivers who can be assigned a ride.
//
// THEY LIVE IN THE SPREADSHEET, in a tab called "Drivers", one row each:
//
//   key     a short id, lowercase, no spaces. Leave it blank and the name is
//           used — "Sam Driver" becomes "sam-driver". It only has to be
//           different from the other drivers' keys.
//   name    what appears in the dropdown, on the ride sheet and in the
//           calendar entry.
//   phone   any format. (908) 494-9256 and 9084949256 are the same thing.
//   email   where the ride sheet is sent. Optional — without it a driver can
//           still be assigned and texted, he just gets no email.
//   active  put "No" to take somebody out of the dropdown without deleting
//           their row. Blank means active.
//
// Adding a driver is typing a row. Nothing to redeploy.
//
// WHY IT MOVED: this used to be a DRIVERS environment variable in Netlify,
// written as JSON. It worked, but adding a driver meant editing brackets and
// quote marks in a settings page and triggering a deploy, and one missing
// comma broke the whole list. Ahmed already lives in this spreadsheet.
//
// The old DRIVERS variable is still read as a fallback, so nothing breaks in
// the gap before the Drivers tab exists. Once the tab is there the variable
// can be deleted from Netlify.

const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');

const DRIVERS_TAB = 'Drivers';

function cleanPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function prettyPhone(raw) {
  const d = cleanPhone(raw);
  if (d.length !== 10) return String(raw || '');
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function shape(d) {
  return {
    key: String(d.key || d.name || '').trim().toLowerCase().replace(/\s+/g, '-'),
    name: String(d.name || '').trim(),
    phone: cleanPhone(d.phone),
    phoneDisplay: prettyPhone(d.phone),
    email: String(d.email || '').trim(),
  };
}

async function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// The old Netlify variable, kept only so the dropdown isn't empty in the gap
// before the Drivers tab is created.
function fromEnvironment() {
  let parsed;
  try {
    parsed = JSON.parse(process.env.DRIVERS || '[]');
  } catch (err) {
    throw new Error('The DRIVERS setting in Netlify is not valid JSON, and there is no Drivers tab in the sheet to read instead.');
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((d) => d && d.name).map(shape);
}

async function allDrivers(sheets) {
  try {
    const client = sheets || await sheetsClient();
    const { keys, rows } = await readTab(client, process.env.GOOGLE_SHEET_ID, DRIVERS_TAB);
    if (!keys.length) throw new Error('no header row');

    const drivers = rows
      .map((row) => rowToObject(keys, row))
      .filter((d) => String(d.name || '').trim())
      // "No" takes someone out of the dropdown without deleting their row and
      // losing which rides they drove.
      .filter((d) => !/^(no|n|inactive|off)$/i.test(String(d.active || '').trim()))
      .map(shape);

    // Two drivers sharing a key would make the dropdown ambiguous, so a
    // duplicate gets a number rather than silently shadowing the first.
    const seen = new Set();
    for (const d of drivers) {
      if (!seen.has(d.key)) { seen.add(d.key); continue; }
      let n = 2;
      while (seen.has(`${d.key}-${n}`)) n += 1;
      d.key = `${d.key}-${n}`;
      seen.add(d.key);
    }

    if (drivers.length) return drivers;
    return fromEnvironment();
  } catch (err) {
    // No Drivers tab yet — fall back rather than emptying the dropdown.
    return fromEnvironment();
  }
}

async function findDriver(key) {
  const wanted = String(key || '').trim().toLowerCase();
  const list = await allDrivers();
  return list.find((d) => d.key === wanted || d.name.toLowerCase() === wanted) || null;
}

module.exports = { allDrivers, findDriver, cleanPhone, prettyPhone };
