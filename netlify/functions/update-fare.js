// Changes the price of a ride that is already booked, everywhere at once.
//
// A fare gets renegotiated. A customer adds a stop. A route turns out longer
// than it looked. Before this, the number was written in three places at
// booking time and there was no way to change it except editing the sheet by
// hand — which left the calendar entry, where the driver actually reads it,
// still showing the old price.
//
// So this updates the Bookings row AND the calendar entry together, and the
// dispatch card reflects it immediately. One change, one number, everywhere.
//
// It writes the agreed figure as given. It does not re-run the rate card,
// because the whole point is that a person decided this price.

const { google } = require('googleapis');
const { readTab, buildRow, rowToObject } = require('./_sheet');
const { findRideEvent } = require('./_calendar');

const BOOKINGS_TAB = 'Bookings';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  const steps = { sheet: 'skipped', calendar: 'skipped' };

  try {
    const { token, rowNumber, pickup, dropoff, dateTime, fare, toll, note } = JSON.parse(event.body || '{}');
    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

    const amount = parseFloat(fare);
    if (isNaN(amount) || amount < 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That fare is not a number.' }) };
    }
    const tollAmount = (toll === '' || toll === null || toll === undefined) ? null : parseFloat(toll);
    if (tollAmount !== null && (isNaN(tollAmount) || tollAmount < 0)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That toll is not a number.' }) };
    }

    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // ---- the sheet ----
    const { keys, rows, lastColumn } = await readTab(sheets, spreadsheetId, BOOKINGS_TAB);
    const idx = Number.isInteger(rowNumber) && rowNumber >= 2 ? rowNumber - 2 : -1;
    if (idx < 0 || idx >= rows.length) {
      return { statusCode: 409, body: JSON.stringify({ error: 'That ride is no longer at that row — refresh and try again.' }) };
    }
    const existing = rowToObject(keys, rows[idx]);
    // The row number came from a page that may have loaded before the sheet was
    // re-sorted. Check it still holds this ride before writing a price to it.
    if (existing.pickup !== pickup || existing.dropoff !== dropoff) {
      return { statusCode: 409, body: JSON.stringify({ error: 'The sheet has changed since this page loaded — refresh and try again.' }) };
    }

    const cells = { fare_total: amount };
    if (tollAmount !== null) cells.toll = tollAmount;
    if (note) cells.notes = [existing.notes, note].filter((x) => x && x !== 'N/A').join(' · ');

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BOOKINGS_TAB}!A${rowNumber}:${lastColumn}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [buildRow(keys, cells, rows[idx])] },
    });
    steps.sheet = 'updated';

    // ---- the calendar, where the driver actually reads it ----
    try {
      const { event: match, calendar, note: why } = await findRideEvent({ pickup, dropoff, dateTime });
      if (!match) {
        steps.calendar = why || 'no matching calendar entry found';
      } else {
        // Replace an existing fare line rather than stacking a second one on
        // top, so the entry never shows two prices.
        const body = String(match.description || '');
        const cleaned = body.replace(/^FARE:.*$/mi, '').replace(/\n{3,}/g, '\n\n').trim();
        await calendar.events.patch({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          eventId: match.id,
          requestBody: { description: `FARE: $${amount}${tollAmount !== null ? ` (incl. $${tollAmount} tolls)` : ''}\n\n${cleaned}` },
        });
        steps.calendar = 'updated';
      }
    } catch (err) {
      steps.calendar = `failed: ${err.message}`;
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, fare: amount, toll: tollAmount, steps }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message, steps }) };
  }
};
