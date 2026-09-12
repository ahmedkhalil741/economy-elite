// Saves or updates a customer's profile every time someone books a ride, in
// a "Customers" tab in the same Google Sheet used for booking records. This
// is what builds up a running record of who your regulars are and what
// they like — see get-customer.js, which reads this data back to prefill
// the booking form automatically the next time they book.
//
// Uses the same "Customers" tab and setup as get-customer.js — see that
// file for the one-time setup steps. No new environment variables needed.

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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone, name, temp, carSeats, elderly, notes } = JSON.parse(event.body);
    const target = normalizePhone(phone);
    if (!target) {
      return { statusCode: 200, body: JSON.stringify({ success: false }) };
    }

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Customers!A:I',
    });

    const rows = res.data.values || [];
    const today = new Date().toISOString().slice(0, 10);
    const elderlyText = elderly ? 'Yes' : 'No';
    const rowIndex = rows.slice(1).findIndex((row) => normalizePhone(row[0]) === target);

    if (rowIndex === -1) {
      // New customer — add a row.
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Customers!A:I',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            phone || '', name || '', temp || '', carSeats || '',
            elderlyText, notes || '', 1, today, today,
          ]],
        },
      });
    } else {
      // Returning customer — update their row in place: keep whichever name
      // we already had if this booking didn't give a new one, keep their
      // First Ride date, bump Total Rides by one, and refresh everything
      // else with what they just told us since preferences can change.
      const existing = rows[rowIndex + 1];
      const sheetRow = rowIndex + 2; // +1 for header row, +1 for 1-indexing
      const totalRides = (parseInt(existing[6], 10) || 0) + 1;
      const firstRide = existing[7] || today;
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `Customers!A${sheetRow}:I${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            phone || existing[0] || '',
            name || existing[1] || '',
            temp || existing[2] || '',
            carSeats || existing[3] || '',
            elderlyText,
            notes || existing[5] || '',
            totalRides,
            firstRide,
            today,
          ]],
        },
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    // Never let a customer-profile hiccup break the actual booking flow.
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
