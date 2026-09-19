// Looks up a returning customer in the "Customers" tab and returns what we've
// saved about them, so the booking form can prefill it instead of asking a
// regular to repeat themselves — and can show them what they've earned.
//
// The key is PHONE **AND** NAME. Either one alone gets nothing back. See
// nameMatches below for why a first name is the bar.
//
// Columns are matched by HEADER NAME, not position — see _sheet.js. The tab
// can be rearranged freely without touching this file.
//
// Reuses the same service account and GOOGLE_SHEET_ID as the other
// functions. No extra environment variables.

const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');

const CUSTOMERS_TAB = 'Customers';

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').slice(-10);
}

// The phone number alone used to be the key, which meant anyone who typed a
// customer's number into the booking form learned their first name and how
// they like to travel. Ahmed's decision, 2026-09-19: the NAME has to match
// too before anything comes back.
//
// A first name is enough. Asking for the full name as typed a year ago fails
// honest people constantly — "Mike" against "Michael", a married name, a
// middle initial — and the point is a second thing only the customer is
// likely to know, not a password.
//
// Accents, punctuation, case and extra spaces are all ignored, because none of
// them are the customer's fault.
function nameKey(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(typed, stored) {
  const a = nameKey(typed), b = nameKey(stored);
  if (!a || !b) return false;
  if (a === b) return true;
  const first = (x) => x.split(' ')[0];
  // First names agreeing is the bar. A stored "Sarah Whitfield" answers to
  // "Sarah", and a customer who now books as "Sarah Cole" still gets in.
  return first(a) === first(b);
}

async function getSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    const phone = params.phone || '';
    const typedName = params.name || '';
    const target = normalizePhone(phone);
    if (!target || !nameKey(typedName)) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }

    const sheets = await getSheetsClient();
    const { keys, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);

    const phoneIndex = keys.indexOf('phone');
    const match = phoneIndex === -1
      ? undefined
      : rows.find((row) => normalizePhone(row[phoneIndex]) === target);

    if (!match) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }

    const customer = rowToObject(keys, match);

    // A wrong name on a real number answers exactly as a number nobody has
    // ever used. Anything else — a different message, a slower reply — would
    // confirm that the number belongs to a customer, which is the thing this
    // check exists to stop.
    if (!nameMatches(typedName, customer.name)) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        phone: customer.phone || '',
        name: customer.name || '',
        temp: customer.cabin_temp || '',
        carSeats: customer.car_seats || '',
        elderly: customer.elderly_assistance || '',
        email: customer.email || '',
        vehicle: customer.car_type || '',
        contact15: customer.text_before_ride || '',
        payMethod: customer.payment_method || '',
        notes: customer.notes || '',
        carType: customer.car_type || '',
        totalRides: customer.total_rides || '0',
        completedRides: customer.completed_rides || '0',
        status: customer.status || '',
        // What they are owed. The booking page uses this to fill the discount
        // box in by itself, which is the whole reason credits stopped being a
        // number that only ever went up.
        creditOwed: parseFloat(customer.credit_owed) || 0,
        lifetimePoints: parseInt(customer.lifetime_points, 10) || 0,
        likes: customer.likes || '',
        dislikes: customer.dislikes || '',
      }),
    };
  } catch (err) {
    // If the Customers tab doesn't exist yet, or anything else goes wrong,
    // fail quietly — a lookup hiccup should never break the booking form.
    return { statusCode: 200, body: JSON.stringify({ found: false }) };
  }
};
