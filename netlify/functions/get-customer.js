// Looks up a returning customer by phone number in the "Customers" tab and
// returns what we've saved about them, so the booking form can prefill it
// instead of asking a regular to repeat themselves.
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
    const phone = (event.queryStringParameters || {}).phone || '';
    const target = normalizePhone(phone);
    if (!target) {
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
        notes: customer.notes || '',
        carType: customer.car_type || '',
        totalRides: customer.total_rides || '0',
        completedRides: customer.completed_rides || '0',
        status: customer.status || '',
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
