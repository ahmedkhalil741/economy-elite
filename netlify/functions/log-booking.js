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
//   sedan, vehicle, toll, tip, overnight_trip, hourly_trip,
//   waiting_late_fee, fare_total
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
const { readTab, buildRow, orNA } = require('./_sheet');

// The tab bookings are appended to.
const SHEET_TAB = 'Bookings';

// What gets written when the customer didn't give us something.
const NA = 'N/A';

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
      name, pickup, dropoff, dateTime, phone, email, notes, payMethod,
      passengers, carSeats, flight, temp, elderly, contact15, source, vehicle, referredBy, agreedFare,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const fare = estimateFare(pickup, dropoff, vehicle, dateTime, payMethod, agreedFare);
    const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';

    // Local (range) and unmatched routes don't break down into base + SUV,
    // so those cells get N/A and the whole quote goes in fare_total rather
    // than forcing a number that isn't real.
    const hasNumericFare = fare.matched && fare.total !== null;

    const cells = {
      timestamp: formatTimestamp(new Date().toISOString()),
      requested_datetime: formatRequestedDateTime(dateTime),
      // The month the RIDE falls in, not the month it was booked in — written
      // as "2026-09" so it sorts and filters as text. This exists so a
      // question like "how many rides did this customer take in September"
      // is one COUNTIFS in the sheet instead of a script that can drift out
      // of step with the rows it is counting.
      ride_month: /^(\d{4})-(\d{2})/.test(String(dateTime || '')) ? String(dateTime).slice(0, 7) : NA,
      pickup,
      dropoff,
      name: orNA(name),
      phone: orNA(phone),
      email: orNA(email),
      referred_by: orNA(referredBy),
      passengers: orNA(passengers),
      car_seats: (carSeats && carSeats !== '0') ? carSeats : 'None',
      elderly_assistance: elderly ? 'Yes' : 'No',
      flight: orNA(flight),
      cabin_temp: orNA(temp),
      text_before_ride: contact15 ? 'Yes' : 'No',
      payment_method: orNA(payMethod),
      notes: orNA(notes),
      source: source || 'Web',
      // Every booking starts here. Points are only awarded when this becomes
      // "Completed" on the dispatch page — see _loyalty.js.
      ride_status: 'Requested',
      base_fare: hasNumericFare ? fare.base : NA,
      // Exactly one of these three ever carries a number — the standard SUV
      // fee for New Jersey, or the New York fee for the vehicle booked. The
      // other two are "N/A", never 0, so a blank fee can't be mistaken for
      // a charge of nothing.
      card_fee: orNA(fare.cardFee),
      suv_fee: orNA(fare.suvFee),
      suv_fee_ny: orNA(fare.suvFeeNy),
      sedan_fee_ny: orNA(fare.sedanFeeNy),
      sedan: isSedan ? 'Yes' : 'No',
      // Says the vehicle outright so you never have to work it out from a
      // Yes/No plus a fee column. On a local trip the fare is one
      // all-inclusive range with no separate vehicle fee, so suv_fee is
      // legitimately N/A even on an SUV booking — which read as a
      // contradiction until this column existed.
      vehicle: isSedan ? 'Sedan' : 'SUV',
      // A column headed "vehicle" or "car" normalises to car_type (see
      // HEADER_ALIASES in _sheet.js), so a row keyed only `vehicle` left that
      // column empty however it was spelled. Write both keys; whichever one
      // the sheet actually has gets filled and the other is ignored.
      car_type: isSedan ? 'Sedan' : 'SUV',
      // The toll is an ESTIMATE from the destination — a Manhattan run crosses
      // one Port Authority tolled bridge or tunnel and pays the congestion
      // charge, an airport run crosses the bridge only, Newark and local trips
      // cross nothing. Replace it with the real figure off the E-ZPass
      // statement if it differs; nothing else recalculates from it.
      toll: orNA(fare.toll),
      // This one still cannot be known at booking time — it depends on what
      // actually happened on the road.
      waiting_late_fee: NA,
      tip: orNA(fare.tipSuggested),
      // The amount charged for an overnight pickup, "N/A" when it isn't one.
      overnight_trip: orNA(fare.overnightFee),
      // Always N/A. The booking form has no hourly option, so a web booking
      // is never an hourly job and there is no amount to record. This used to
      // read `fare.matched ? 'No' : 'Yes'`, which was wrong twice over: it
      // guessed "hourly" purely because a route didn't match a known zone
      // (unmatched means unknown, not hourly), and it wrote Yes/No into a
      // column that holds an amount everywhere else. If hourly bookings are
      // ever offered, put the charge here and leave N/A when it isn't one.
      hourly_trip: NA,
      fare_total: hasNumericFare ? fare.total : (fare.matched ? fare.totalDisplay : fare.display),
    };

    const sheets = await getSheetsClient();

    // Read the header row and build the row in whatever order the sheet is
    // currently arranged in.
    const { keys, lastColumn } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, SHEET_TAB);
    if (!keys.length) {
      throw new Error(`No header row found in the "${SHEET_TAB}" tab — row 1 must contain the column names.`);
    }

    const row = buildRow(keys, cells);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_TAB}!A:${lastColumn}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
