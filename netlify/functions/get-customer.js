// Looks up a returning customer by phone number in the "Customers" tab of
// the same Google Sheet used for booking records, and returns whatever
// preferences we've saved for them — name, cabin temperature, car
// seats, elderly assistance — so the booking form can prefill it
// automatically instead of asking a returning customer to repeat themselves.
//
// Reuses the SAME Google Service Account already set up for log-booking.js
// and add-to-calendar.js. One extra one-time setup step:
//
// ---- ONE-TIME SETUP ----
// In your existing Google Sheet (the one GOOGLE_SHEET_ID points to), add a
// second tab named exactly "Customers", with these headers in row 1:
//   Phone | Name | Cabin Temperature | Car Seats Needed | Elderly Assistance | Notes | Total Rides | First Ride | Last Ride
//
// No new Netlify environment variables needed — this reuses
// GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY, and
// GOOGLE_SHEET_ID, already set up for log-booking.js.

const { google } = require('googleapis');

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
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Customers!A:I',
    });

    const rows = res.data.values || [];
    const match = rows.slice(1).find((row) => normalizePhone(row[0]) === target);

    if (!match) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        phone: match[0] || '',
        name: match[1] || '',
        temp: match[2] || '',
        carSeats: match[3] || '',
        elderly: match[4] || '',
        notes: match[5] || '',
        totalRides: match[6] || '0',
      }),
    };
  } catch (err) {
    // If the Customers tab doesn't exist yet, or anything else goes wrong,
    // fail quietly — a lookup hiccup should never break the booking form.
    return { statusCode: 200, body: JSON.stringify({ found: false }) };
  }
};
