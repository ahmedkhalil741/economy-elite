// Logs every booking to a Google Sheet so all reservations (web bookings
// automatically, plus phone/email bookings you add by hand) live in one
// place you can open in Excel, or pull into Python/SQL later for
// year-end totals and tax reporting.
//
// Reuses the SAME Google Service Account already set up for
// add-to-calendar.js -- no new Google Cloud setup needed there, just two
// more things to turn on:
//
// ---- ONE-TIME SETUP ----
// 1. In the same Google Cloud project used for Calendar/Maps, enable the
//    "Google Sheets API" (APIs & Services -> Library -> search
//    "Google Sheets API" -> Enable).
// 2. Create a new Google Sheet (sheets.new). In row 1, add these headers,
//    in this exact order:
//    Timestamp | Requested Date/Time | Pickup | Drop-off | Phone | Passengers | Car Seats | Elderly Assistance | Flight | Drink Preference | Text 15min Before | Payment Method | Notes | Source
// 3. Click Share on that Sheet and add the service account's email
//    (the same "client_email" from the JSON key file you used for
//    Calendar -- looks like economyelite-calendar@your-project.iam.gserviceaccount.com)
//    with "Editor" access.
// 4. Copy the Sheet's ID out of its URL:
//    https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
//
// ---- Netlify environment variables required ----
//   GOOGLE_SERVICE_ACCOUNT_EMAIL = same value already used for Calendar
//   GOOGLE_SERVICE_ACCOUNT_KEY   = same value already used for Calendar
//   GOOGLE_SHEET_ID              = the Sheet ID from step 4 above
//
// For phone or email bookings, just add a new row yourself at the bottom
// of the same sheet (Source = "Phone" or "Email") so everything lands in
// one place by year end.

const { google } = require('googleapis');

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
    const {
      pickup, dropoff, dateTime, phone, notes, payMethod,
      passengers, carSeats, flight, drink, elderly, contact15,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'A:N',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          dateTime || '',
          pickup,
          dropoff,
          phone || '',
          passengers || '',
          (carSeats && carSeats !== '0') ? carSeats : 'None',
          elderly ? 'Yes' : 'No',
          flight || '',
          drink || '',
          contact15 ? 'Yes' : 'No',
          payMethod || '',
          notes || '',
          'Web',
        ]],
      },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
