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
//   phone, name, cabin_temp, car_seats, elderly_assistance, notes,
//   car_type, total_rides, rides_this_month, month, first_ride, last_ride,
//   status
// Columns to keep by hand (never overwritten):
//   likes, dislikes, and any other column of your own
//
// ---- STATUS ----
// A customer's first ever ride sets them to "New". Once they take
// LOYAL_THRESHOLD rides inside a single calendar month they become "Loyal"
// and STAY Loyal — a quiet month doesn't demote anyone.
//
// rides_this_month resets on its own: the `month` column records which month
// the count belongs to, and when a booking comes in for a different month
// the count starts over at 1.
//
// ---- MILESTONE ALERTS ----
// An email goes to the owner when a customer first appears, when they reach
// HEADS_UP_THRESHOLD rides in a month, and when they become Loyal — so an
// offer can be sent their way. Offers themselves aren't automated yet; that
// waits on the phone/SMS work.

const { google } = require('googleapis');
const { readTab, buildRow, rowToObject } = require('./_sheet');
const { easternToday } = require('./_format');
const { sendOwnerEmail } = require('./_email');

const CUSTOMERS_TAB = 'Customers';

// Rides within one calendar month.
const HEADS_UP_THRESHOLD = 5;   // "keep an eye on this one" email
const LOYAL_THRESHOLD = 10;     // promotes to Loyal

const STATUS_NEW = 'New';
const STATUS_LOYAL = 'Loyal';

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

// Decides what the milestone email should say, or null for "nothing worth
// interrupting them about". Only fires on the ride that actually crosses a
// line, never on every ride afterwards.
function milestoneFor({ isNewCustomer, ridesThisMonth, justBecameLoyal, name, phone, totalRides, month }) {
  const who = `${name || 'A customer'} (${phone})`;

  if (justBecameLoyal) {
    return {
      subject: `${name || 'A customer'} is now a Loyal client — ${LOYAL_THRESHOLD} rides this month`,
      html: `
        <h2>New Loyal client</h2>
        <p><strong>${who}</strong> just booked their <strong>${ridesThisMonth}th ride this month</strong> (${month}), so they've been marked <strong>Loyal</strong> in the Customers tab.</p>
        <p>Lifetime rides: <strong>${totalRides}</strong></p>
        <p style="color:#666;">Worth reaching out with something — a thank-you, or a perk on their next ride.</p>
      `,
    };
  }

  if (isNewCustomer) {
    return {
      subject: `New customer: ${name || phone}`,
      html: `
        <h2>First-time customer</h2>
        <p><strong>${who}</strong> just booked for the first time and has been added to the Customers tab as <strong>New</strong>.</p>
        <p style="color:#666;">A welcome offer on this first ride is the easiest way to get a second one.</p>
      `,
    };
  }

  if (ridesThisMonth === HEADS_UP_THRESHOLD) {
    return {
      subject: `${name || phone} has taken ${HEADS_UP_THRESHOLD} rides this month`,
      html: `
        <h2>Becoming a regular</h2>
        <p><strong>${who}</strong> is at <strong>${ridesThisMonth} rides this month</strong> (${month}). ${LOYAL_THRESHOLD - HEADS_UP_THRESHOLD} more and they become a Loyal client.</p>
        <p>Lifetime rides: <strong>${totalRides}</strong></p>
        <p style="color:#666;">Good moment for an offer, while they're deciding who their regular driver is.</p>
      `,
    };
  }

  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone, name, temp, carSeats, elderly, notes, vehicle } = JSON.parse(event.body);
    const target = normalizePhone(phone);
    if (!target) {
      return { statusCode: 200, body: JSON.stringify({ success: false }) };
    }

    const sheets = await getSheetsClient();
    const { keys, rows, lastColumn } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);
    if (!keys.length) {
      throw new Error(`No header row found in the "${CUSTOMERS_TAB}" tab.`);
    }

    const { date: today, yearMonth: thisMonth } = easternToday();
    const phoneIndex = keys.indexOf('phone');
    const rowIndex = phoneIndex === -1
      ? -1
      : rows.findIndex((row) => normalizePhone(row[phoneIndex]) === target);

    const existingRow = rowIndex === -1 ? [] : rows[rowIndex];
    const existing = rowToObject(keys, existingRow);
    const isNewCustomer = rowIndex === -1;

    const totalRides = (parseInt(existing.total_rides, 10) || 0) + 1;

    // The month column says which month the running count belongs to. A
    // booking in a different month starts the count over rather than adding
    // to last month's total.
    const sameMonth = String(existing.month || '').trim() === thisMonth;
    const ridesThisMonth = sameMonth ? (parseInt(existing.rides_this_month, 10) || 0) + 1 : 1;

    const wasLoyal = String(existing.status || '').trim().toLowerCase() === STATUS_LOYAL.toLowerCase();
    const justBecameLoyal = !wasLoyal && ridesThisMonth >= LOYAL_THRESHOLD;
    const status = (wasLoyal || justBecameLoyal) ? STATUS_LOYAL : STATUS_NEW;

    const cells = {
      phone: phone || existing.phone || '',
      name: name || existing.name || '',
      cabin_temp: temp || existing.cabin_temp || '',
      car_seats: carSeats || existing.car_seats || '',
      elderly_assistance: elderly ? 'Yes' : 'No',
      notes: notes || existing.notes || '',
      car_type: vehicle || existing.car_type || '',
      total_rides: totalRides,
      rides_this_month: ridesThisMonth,
      month: thisMonth,
      first_ride: existing.first_ride || today,
      last_ride: today,
      status,
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

    // Tell the owner when something worth acting on happened. Never let a
    // failed email undo a profile that saved fine.
    const milestone = milestoneFor({
      isNewCustomer, ridesThisMonth, justBecameLoyal,
      name: cells.name, phone: cells.phone, totalRides, month: thisMonth,
    });
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
        totalRides,
        ridesThisMonth,
        milestone: milestone ? milestone.subject : null,
      }),
    };
  } catch (err) {
    // Never let a customer-profile hiccup break the actual booking flow.
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

// Exported so the milestone rules can be checked without touching Google.
module.exports.milestoneFor = milestoneFor;
module.exports.HEADS_UP_THRESHOLD = HEADS_UP_THRESHOLD;
module.exports.LOYAL_THRESHOLD = LOYAL_THRESHOLD;
