// Has this person ridden with us before, and does the $10 come off?
//
// WHY THIS IS ITS OWN FILE. Three places need the same answer and they must
// never disagree: the row written to the sheet, the email that lands in Ahmed's
// inbox, and what the customer was shown. When only log-booking knew about the
// discount, the sheet said $175 and the email said $185 for the same ride, and
// the first time that happens on a real booking nobody knows which number to
// collect.
//
// The sheet decides, not the browser. A page can be edited; a phone number with
// completed rides against it cannot.
const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');
const { FIRST_RIDE_CREDIT } = require('./_loyalty');

const CUSTOMERS_TAB = 'Customers';

async function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

// Returns the overrides to price with, and how much was taken off.
//
// A discount already set by hand wins outright. Someone redeeming $15 of credit
// from the dispatch is not also owed the new-customer ten, and Ahmed deciding a
// price is not something this should quietly edit.
async function firstRideOff(phone, overrides, existingSheets) {
  const base = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  const none = { overrides: base, applied: 0 };

  if (base.discount) return none;

  const digits = tenDigits(phone);
  if (digits.length !== 10) return none;

  try {
    const sheets = existingSheets || (await sheetsClient());
    const { keys, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);
    const them = rows
      .map((r) => rowToObject(keys, r))
      .find((c) => tenDigits(c.phone) === digits);
    if (them && (parseInt(them.completed_rides, 10) || 0) > 0) return none;
  } catch (err) {
    // No Customers tab yet, or the read failed. Full price is the safe wrong
    // answer: it takes ten seconds to correct on the dispatch, and a discount
    // handed to the wrong person cannot be taken back.
    return none;
  }

  return {
    overrides: Object.assign({}, base, { discount: FIRST_RIDE_CREDIT }),
    applied: FIRST_RIDE_CREDIT,
  };
}

module.exports = { firstRideOff, FIRST_RIDE_CREDIT };
