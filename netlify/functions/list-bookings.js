// The upcoming rides, for the dispatch page.
//
// This hands back customer names, phone numbers and home addresses, so unlike
// every other function here it will not answer without a token. The PIN box on
// admin-booking.html is only a cover on a door — anyone who reads the page
// source can walk past it. A token checked HERE cannot be read out of the page.
//
// Netlify environment variable required:
//   ADMIN_TOKEN = any long random string you like. Treat it as a password.
//
// With ADMIN_TOKEN unset this function refuses every request rather than
// defaulting to open, because the failure nobody notices is the dangerous one.

const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');
const { parseRequestedDateTime } = require('./_format');
const { allDrivers } = require('./_drivers');

const SHEET_TAB = 'Bookings';
// Rides that started within the last few hours still matter — the driver may
// be on that trip right now.
const LOOK_BACK_HOURS = 6;

exports.handler = async function (event) {
  const token = (event.queryStringParameters || {}).token || '';
  const expected = process.env.ADMIN_TOKEN || '';

  if (!expected) {
    return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify. Set it, redeploy, and this page will work.' }) };
  }
  if (token !== expected) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };
  }

  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    const { headers, keys, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, SHEET_TAB);
    const cutoff = Date.now() - LOOK_BACK_HOURS * 3600 * 1000;

    const rides = rows
      .map((row, i) => {
        const r = rowToObject(keys, row);
        const dateTime = parseRequestedDateTime(r.requested_datetime);
        return {
          rowNumber: i + 2,                 // 1 for the header, 1 because sheets count from 1
          dateTime,
          when: r.requested_datetime || '',
          name: r.name || '', phone: r.phone || '',
          pickup: r.pickup || '', dropoff: r.dropoff || '',
          vehicle: r.vehicle || r.car_type || '', passengers: r.passengers || '',
          carSeats: r.car_seats || '', flight: r.flight || '',
          temp: r.cabin_temp || '', elderly: r.elderly_assistance || '',
          notes: r.notes || '', payMethod: r.payment_method || '',
          fare: r.fare_total || '', driver: r.driver || '',
        };
      })
      .filter((r) => r.pickup && r.dropoff)
      // Undated rows stay in — better a ride you have to look at than one that
      // silently vanished because its date cell was typed by hand.
      .filter((r) => !r.dateTime || new Date(r.dateTime + ':00Z').getTime() > cutoff)
      .sort((a, b) => String(a.dateTime || '').localeCompare(String(b.dateTime || '')));

    let drivers = [];
    let driversError = null;
    try { drivers = allDrivers(); } catch (err) { driversError = err.message; }

    return {
      statusCode: 200,
      body: JSON.stringify({
        rides,
        drivers,
        driversError,
        hasDriverColumn: keys.includes('driver'),
        // what the sheet's header row actually says, so an empty field on the
        // dispatch card points at a missing column rather than a mystery
        sheetColumns: headers,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
