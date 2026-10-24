// Correcting what we hold about a customer, from the dispatch.
//
// WHY THIS EXISTS, AND WHY THE BIRTHDAY IS THE WHOLE REASON.
//
// Two birthdays in the Customers tab read 46235 and 33480. They are not
// mistakes anybody made: somebody typed a date into a cell, and Google Sheets
// did what Google Sheets does and turned it into a day-count from 1899. The
// numbers are perfectly correct — 1 August 2026 and 30 August 1991 — and
// completely unreadable to _loyalty.js, which looks for a month and a day and
// finds one long integer. So the birthday reward silently never fires for
// those two, and nothing anywhere says so.
//
// Fixing them by hand in the sheet fixes today and not tomorrow: the next
// birthday typed into that column converts the same way. So the fix is to
// stop typing into the cell. Everything written here goes in as TEXT, the
// birthday with a leading apostrophe, and Sheets leaves it alone.
//
// Netlify environment variables: the usual Google ones, plus ADMIN_TOKEN.

const { google } = require('googleapis');
const { readTab, buildRow, rowToObject } = require('./_sheet');
const { monthDay, birthdayCell } = require('./_format');

const CUSTOMERS_TAB = 'Customers';

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const clean = (v) => String(v === null || v === undefined ? '' : v).trim();

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  try {
    const { token, phone, birthday, email, cardOnFile, notes } = JSON.parse(event.body || '{}');
    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

    const key = tenDigits(phone);
    if (key.length !== 10) return { statusCode: 400, body: JSON.stringify({ error: 'That phone number is not ten digits.' }) };

    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const { keys, rows, lastColumn } = await readTab(sheets, spreadsheetId, CUSTOMERS_TAB);
    const pc = keys.indexOf('phone');
    if (pc === -1) return { statusCode: 200, body: JSON.stringify({ error: 'The Customers tab has no phone column.' }) };
    const at = rows.findIndex((r) => tenDigits(r[pc]) === key);
    if (at === -1) return { statusCode: 404, body: JSON.stringify({ error: 'No customer with that number.' }) };

    const cells = {};
    const notes_ = [];

    if (birthday !== undefined) {
      const md = clean(birthday) === '' ? '' : monthDay(birthday);
      if (clean(birthday) !== '' && !md) {
        return { statusCode: 400, body: JSON.stringify({ error: `Couldn't read "${birthday}" as a date. Try 09-20.` }) };
      }
      // birthdayCell adds the leading apostrophe. Without it USER_ENTERED
      // hands "08-01" to Sheets, which stores a date serial and the month and
      // day are gone — which is the whole reason this screen exists.
      cells.birthday = birthdayCell(birthday);
      if (md) notes_.push(`birthday ${md}`);
    }

    if (email !== undefined) cells.email = clean(email);

    if (cardOnFile !== undefined) {
      cells.card_on_file = cardOnFile ? 'Yes' : '';
      notes_.push(cardOnFile ? 'card on file — keyed rate from the next booking'
                             : 'card on file cleared — back to the tapped rate');
    }

    if (notes !== undefined) cells.notes = clean(notes);

    if (!Object.keys(cells).length) {
      return { statusCode: 200, body: JSON.stringify({ success: true, unchanged: true }) };
    }

    const missing = Object.keys(cells).filter((k) => !keys.includes(k));
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CUSTOMERS_TAB}!A${at + 2}:${lastColumn}${at + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [buildRow(keys, cells, rows[at])] },
    });

    const saved = rowToObject(keys, buildRow(keys, cells, rows[at]));
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        note: notes_.join(' · ') || 'saved',
        missing: missing.length ? `the Customers tab has no ${missing.join(', ')} column` : undefined,
        customer: { phone: saved.phone, birthday: saved.birthday, email: saved.email, cardOnFile: /^(yes|y|true|1)$/i.test(String(saved.card_on_file || '').trim()) },
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
