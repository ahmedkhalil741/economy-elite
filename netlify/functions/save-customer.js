// Saves or updates a customer's profile every time someone books a ride, in
// the "Customers" tab of the same Google Sheet used for booking records.
// This is what builds the running record of who the regulars are and what
// they like — see get-customer.js, which reads it back to prefill the
// booking form the next time they book.
//
// ---- HOW COLUMNS ARE MATCHED ----
// Same rule as log-booking.js: nothing is written to a fixed column
// position. Row 1 is read and each value goes to the column with the
// matching header name. Columns can be added, deleted, renamed or reordered
// in the sheet freely.
//
// Crucially, any column this file doesn't manage is left EXACTLY as it was.
// That's what protects the hand-typed columns — likes, dislikes, and
// anything else kept by hand — from being wiped on the next booking.
//
// Columns it fills automatically:
//   phone, email, name, cabin_temp, car_seats, elderly_assistance, notes,
//   car_type, referred_by, total_rides, last_booked, status, activity
//
// Filled by set-ride-status.js when a ride is COMPLETED, not here:
//   completed_rides, lifetime_points, first_ride, last_ride,
//   credit_owed, credit_history
//
// GONE, and safe to delete from the sheet: `month` and `rides_this_month`.
// They existed only for the old rule where Loyal meant ten rides inside one
// calendar month. Under the lifetime rule nothing writes them, so whatever is
// in those cells is frozen at the day the rule changed — which is worse than
// empty, because it still looks like data.
// Columns to keep by hand (never overwritten):
//   likes, dislikes, and any other column of your own
//
// ---- STATUS AND POINTS ----
// This file NO LONGER decides status or awards points. Booking a ride is not
// taking one: a cancellation and a no-show used to count exactly as much as a
// finished airport run, which is what Ahmed's loyalty specification set out to
// stop. Points are awarded in set-ride-status.js, when a ride is actually
// marked Completed on the dispatch page.
//
// What this file does with status: sets a brand-new customer to "New" and
// then never touches it again. The rules themselves live in _loyalty.js.
//
// ---- IDENTIFYING A CUSTOMER ----
// Phone number first, email second. Both are normalised before comparing, so
// "(908) 494-9256" and "9084949256" are the same person, and a customer who
// books once by phone and once with an email doesn't become two profiles.
//
// ---- MILESTONE ALERTS ----
// One email when somebody first appears. The rest — credits earned, reaching
// Loyal — come from set-ride-status, because that's where they're earned.
// Offers are never sent automatically: Ahmed is told, Ahmed decides.

const { google } = require('googleapis');
const { readTab, buildRow, rowToObject } = require('./_sheet');
const { easternToday } = require('./_format');
const { sendOwnerEmail } = require('./_email');
const L = require('./_loyalty');

const CUSTOMERS_TAB = 'Customers';

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').slice(-10);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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

// The only alert this file still sends: somebody new turned up. Everything
// else is earned by completing a ride, not by booking one.
function newCustomerEmail({ name, phone }) {
  const who = name ? `${name} (${phone})` : phone;
  return {
    subject: `🆕 New Customer – ${name || phone}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.7;color:#111">
      <h2 style="margin:0 0 10px;font-size:18px">New customer</h2>
      <p style="margin:0 0 12px"><strong>${who}</strong> has booked for the first time.</p>
      <p style="margin:0 0 12px">They are <strong>New</strong> with 0 points. They become <strong>Regular</strong> and earn their first point — and a $${L.FIRST_RIDE_CREDIT} credit — once this ride is marked <strong>Completed</strong> on the dispatch page.</p>
      <p style="margin:0;color:#555;font-size:13px">A booking is not a completed ride. Nothing is counted until you mark it.</p>
    </div>`,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone, email, name, temp, carSeats, elderly, notes, vehicle, referredBy } = JSON.parse(event.body);
    const target = normalizePhone(phone);
    const targetEmail = normalizeEmail(email);
    if (!target && !targetEmail) {
      return { statusCode: 200, body: JSON.stringify({ success: false }) };
    }

    const sheets = await getSheetsClient();
    const { keys, rows, lastColumn } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);
    if (!keys.length) {
      throw new Error(`No header row found in the "${CUSTOMERS_TAB}" tab.`);
    }

    const { date: today } = easternToday();

    // Phone first, then email — two ways to recognise the same person, so
    // booking once by phone and once with an email doesn't split them into
    // two profiles.
    const phoneIndex = keys.indexOf('phone');
    const emailIndex = keys.indexOf('email');
    let rowIndex = (phoneIndex !== -1 && target)
      ? rows.findIndex((row) => normalizePhone(row[phoneIndex]) === target)
      : -1;
    if (rowIndex === -1 && emailIndex !== -1 && targetEmail) {
      rowIndex = rows.findIndex((row) => normalizeEmail(row[emailIndex]) === targetEmail);
    }

    const existingRow = rowIndex === -1 ? [] : rows[rowIndex];
    const existing = rowToObject(keys, existingRow);
    const isNewCustomer = rowIndex === -1;

    // Bookings made — kept apart from completed_rides on purpose. The gap
    // between the two is how many rides were cancelled or no-showed, which is
    // worth being able to see.
    const bookingsMade = (parseInt(existing.total_rides, 10) || 0) + 1;

    // Points are NOT touched here. A booking earns nothing.
    const points = parseInt(existing.lifetime_points, 10) || 0;
    const status = isNewCustomer ? L.STATUS_NEW : L.statusFor(points, existing.status);

    const cells = {
      phone: phone || existing.phone || '',
      email: email || existing.email || '',
      name: name || existing.name || '',
      cabin_temp: temp || existing.cabin_temp || '',
      car_seats: carSeats || existing.car_seats || '',
      elderly_assistance: elderly ? 'Yes' : 'No',
      notes: notes || existing.notes || '',
      car_type: vehicle || existing.car_type || '',
      // Only ever set once, on the profile's first booking — a regular
      // customer mentioning a friend later doesn't rewrite who sent them.
      referred_by: existing.referred_by || (isNewCustomer ? (referredBy || '') : ''),
      total_rides: bookingsMade,
      last_booked: today,
      status,
      activity: L.activityFor(existing.last_ride),
    };

    const row = buildRow(keys, cells, existingRow);

    if (isNewCustomer) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${CUSTOMERS_TAB}!A:${lastColumn}`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    } else {
      const sheetRow = rowIndex + 2; // +1 for the header row, +1 for 1-indexing
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${CUSTOMERS_TAB}!A${sheetRow}:${lastColumn}${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    }

    // Only a brand-new customer is worth an email here. Never let a failed
    // send undo a profile that saved fine.
    const milestone = isNewCustomer ? newCustomerEmail({ name: cells.name, phone: cells.phone || cells.email }) : null;
    if (milestone) {
      try {
        await sendOwnerEmail(milestone.subject, milestone.html);
      } catch (mailErr) {
        return { statusCode: 200, body: JSON.stringify({ success: true, milestoneEmail: false, error: mailErr.message }) };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        status,
        points,
        bookingsMade,
        isNewCustomer,
        milestone: milestone ? milestone.subject : null,
      }),
    };
  } catch (err) {
    // Never let a customer-profile hiccup break the actual booking flow.
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

// Exported so the milestone rules can be checked without touching Google.
module.exports.newCustomerEmail = newCustomerEmail;
