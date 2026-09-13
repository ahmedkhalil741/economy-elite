// Logs every booking to a Google Sheet so all reservations (web bookings
// automatically, plus phone/text/email bookings entered through the private
// quick-entry page at admin-booking.html) live in one place you can open in
// Excel, or pull into Python/SQL later for year-end totals and tax reporting.
//
// ---- HOW COLUMNS ARE MATCHED (important) ----
// This function does NOT write to fixed column positions. It reads row 1 of
// the sheet and matches each value to the column with the matching HEADER
// NAME. That means you can add, delete, rename or reorder columns in the
// Bookings tab whenever you like and the data keeps landing in the right
// place — no code change needed.
//
// Header matching ignores case, spaces, hyphens and underscores, so
// "Base Fare", "base_fare" and "base fare" are all the same column.
//
// The values it knows how to fill, by header name:
//   timestamp, requested_datetime, pickup, dropoff, name, phone,
//   passengers, car_seats, elderly_assistance, flight, cabin_temp,
//   text_before_ride, payment_method, notes, source, base_fare, suv_fee,
//   sedan, toll, tip, overnight_trip, hourly_trip, waiting_late_fee,
//   fare_total
// Any column whose header isn't in that list is left alone (so your own
// notes/status columns won't get overwritten). Any header in that list
// that isn't in your sheet is simply skipped.
//
// Anything the customer didn't provide is written as "N/A" rather than
// left blank. toll and waiting_late_fee are always "N/A" — neither can be
// known until the ride actually happens, so you fill those in by hand.
//
// ---- ONE-TIME SETUP ----
// 1. Enable the "Google Sheets API" in the same Google Cloud project used
//    for Calendar/Maps (APIs & Services -> Library -> Enable).
// 2. Share the Sheet with the service account's email (the "client_email"
//    in the JSON key file) with "Editor" access.
// 3. Copy the Sheet's ID out of its URL:
//    https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
// 4. A second tab named "Customers" holds saved customer preferences —
//    see get-customer.js and save-customer.js.
//
// ---- Netlify environment variables required ----
//   GOOGLE_SERVICE_ACCOUNT_EMAIL = same value already used for Calendar
//   GOOGLE_SERVICE_ACCOUNT_KEY   = same value already used for Calendar
//   GOOGLE_SHEET_ID              = the Sheet ID from step 3 above
//
// Phone, text, and email bookings should go through the private quick-entry
// page (admin-booking.html) rather than being typed straight into the
// sheet, so they end up in the same format as web bookings and also update
// the customer's saved profile.

const { google } = require('googleapis');
const { estimateFare } = require('./_fare-calc');
const { formatTimestamp, formatRequestedDateTime } = require('./_format');

// The tab bookings are appended to.
const SHEET_TAB = 'Bookings';

// What gets written when the customer didn't give us something.
const NA = 'N/A';

// Some headers in the sheet are spelled slightly differently from the key
// used below — map those here so they still match.
const HEADER_ALIASES = {
  elderly_assitance: 'elderly_assistance',
  elderly_assistence: 'elderly_assistance',
  elderly: 'elderly_assistance',
  requested_date_time: 'requested_datetime',
  car_seat: 'car_seats',
  carseats: 'car_seats',
  waiting_fee: 'waiting_late_fee',
  late_fee: 'waiting_late_fee',
  waiting_late: 'waiting_late_fee',
  overnight: 'overnight_trip',
  hourly: 'hourly_trip',
  total: 'fare_total',
  payment: 'payment_method',
};

// "Base Fare" / "base_fare" / "base fare" -> "base_fare"
function normalizeHeader(header) {
  const key = String(header || '').trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/_+/g, '_');
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

// Empty / missing -> "N/A". Note 0 is a real value and is kept as 0.
function orNA(value) {
  if (value === null || value === undefined) return NA;
  if (typeof value === 'string' && value.trim() === '') return NA;
  return value;
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
    const {
      name, pickup, dropoff, dateTime, phone, notes, payMethod,
      passengers, carSeats, flight, temp, elderly, contact15, source, vehicle,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const fare = estimateFare(pickup, dropoff, vehicle, dateTime);
    const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';

    // Local (range) and unmatched routes don't break down into base + SUV,
    // so those cells get N/A and the whole quote goes in fare_total rather
    // than forcing a number that isn't real.
    const hasNumericFare = fare.matched && fare.total !== null;

    const cells = {
      timestamp: formatTimestamp(new Date().toISOString()),
      requested_datetime: formatRequestedDateTime(dateTime),
      pickup,
      dropoff,
      name: orNA(name),
      phone: orNA(phone),
      passengers: orNA(passengers),
      car_seats: (carSeats && carSeats !== '0') ? carSeats : 'None',
      elderly_assistance: elderly ? 'Yes' : 'No',
      flight: orNA(flight),
      cabin_temp: orNA(temp),
      text_before_ride: contact15 ? 'Yes' : 'No',
      payment_method: orNA(payMethod),
      notes: orNA(notes),
      source: source || 'Web',
      base_fare: hasNumericFare ? fare.base : NA,
      suv_fee: hasNumericFare ? fare.suvFee : NA,
      sedan: isSedan ? 'Yes' : 'No',
      // Neither of these can be known at booking time — they depend on the
      // real route and what actually happened on the road.
      toll: NA,
      waiting_late_fee: NA,
      tip: orNA(fare.tipSuggested),
      // The dollar amount charged for an overnight pickup, 0 when it isn't
      // one — kept numeric so the column can be totalled at year-end.
      overnight_trip: fare.overnightFee,
      hourly_trip: fare.matched ? 'No' : 'Yes',
      fare_total: hasNumericFare ? fare.total : (fare.matched ? fare.totalDisplay : fare.display),
    };

    const sheets = await getSheetsClient();

    // Read the header row and build the row in whatever order the sheet is
    // currently arranged in.
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_TAB}!1:1`,
    });
    const headers = (headerRes.data.values && headerRes.data.values[0]) || [];
    if (!headers.length) {
      throw new Error(`No header row found in the "${SHEET_TAB}" tab — row 1 must contain the column names.`);
    }

    const row = headers.map((header) => {
      const key = normalizeHeader(header);
      return Object.prototype.hasOwnProperty.call(cells, key) ? cells[key] : '';
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_TAB}!A:${columnLetter(headers.length)}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Exported for testing the column matching without touching Google.
module.exports.normalizeHeader = normalizeHeader;
module.exports.columnLetter = columnLetter;
