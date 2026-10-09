// Puts a credit on a customer's account at the moment Ahmed decides to offer
// it — the birthday $15, and the win-back $10 for someone who has gone quiet.
//
// WHY THIS FUNCTION HAD TO EXIST BEFORE THE MESSAGES COULD.
//
// Every other credit in this system is earned by a ride, so by the time
// anybody texts the customer the money is already on the account and the
// message is simply reporting a fact. These two are not. A birthday and a long
// silence are Ahmed's decision to make, which left the dispatch page in the one
// position it must never be in: about to send a text saying "there's $15 on
// your account" when credit_owed says 0. The customer turns up expecting it,
// and a figure in a text to a customer is a figure we have to honour.
//
// So the grant happens FIRST and the message is written from the balance
// afterwards. One tap does both, in that order, and if the grant fails no text
// is offered at all.
//
// NOTHING IS SENT TO ANYBODY HERE. This writes to the spreadsheet. The text
// still goes out of the phone in Ahmed's hand.
//
// Netlify environment variables: the usual Google ones, plus ADMIN_TOKEN.

const { google } = require('googleapis');
const { readTab, rowToObject, buildRow } = require('./_sheet');
const { easternToday } = require('./_format');
const L = require('./_loyalty');

const CUSTOMERS_TAB = 'Customers';
const CREDITS_TAB = 'Credits';

async function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

const normalizePhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);

// What each kind is worth and what the ledger should call it. Both amounts come
// from _loyalty.js, so the page, the sheet and the rules can never disagree.
const KINDS = {
  birthday: { amount: L.BIRTHDAY_CREDIT, reason: 'birthday' },
  quiet:    { amount: L.WIN_BACK_CREDIT, reason: 'win-back — gone quiet' },
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request body.' }) };
  }
  if (body.token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

  const rule = KINDS[body.kind];
  if (!rule) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown kind of credit.' }) };

  const key = normalizePhone(body.phone);
  if (!key) return { statusCode: 400, body: JSON.stringify({ error: 'No phone number.' }) };

  try {
    const sheets = await sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const customers = await readTab(sheets, spreadsheetId, CUSTOMERS_TAB);
    const phoneCol = customers.keys.indexOf('phone');
    if (phoneCol === -1) return { statusCode: 200, body: JSON.stringify({ error: 'The Customers tab has no phone column.' }) };

    const idx = customers.rows.findIndex((r) => normalizePhone(r[phoneCol]) === key);
    if (idx === -1) return { statusCode: 200, body: JSON.stringify({ error: 'No customer with that number.' }) };

    const c = rowToObject(customers.keys, customers.rows[idx]);
    const today = easternToday();

    // Already done this year? Say so and change nothing. Two taps on the same
    // birthday must not be worth $30 — the button is on a phone, in a hand, in
    // a car, and a double tap is not an unusual thing to happen.
    if (body.kind === 'birthday' && L.birthdayOfferedThisYear(c.birthday_offered)) {
      return { statusCode: 200, body: JSON.stringify({
        alreadyDone: true,
        creditOwed: parseFloat(c.credit_owed) || 0,
        note: 'This birthday has already been offered this year. Nothing added.',
      }) };
    }

    const balanceBefore = parseFloat(c.credit_owed) || 0;
    const creditOwed = Math.round((balanceBefore + rule.amount) * 100) / 100;
    const points = parseInt(c.lifetime_points, 10) || 0;

    const cells = { credit_owed: creditOwed };
    // Only written when the column exists; a missing column must not silently
    // swallow the marker and leave the birthday repeating.
    if (body.kind === 'birthday') cells.birthday_offered = String(today.date).slice(0, 4);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CUSTOMERS_TAB}!A${idx + 2}:${customers.lastColumn}${idx + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [buildRow(customers.keys, cells, customers.rows[idx])] },
    });

    let ledger = 'not logged';
    try {
      const credits = await readTab(sheets, spreadsheetId, CREDITS_TAB);
      if (credits.keys.length) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${CREDITS_TAB}!A:${credits.lastColumn}`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [buildRow(credits.keys, {
            date: today.date, phone: key, name: c.name || '',
            type: 'Offered', amount: rule.amount, reason: rule.reason,
            balance_after: creditOwed, points_after: points,
          })] },
        });
        ledger = 'logged';
      }
    } catch (err) { ledger = `not logged: ${err.message}`; }

    const markerMissing = body.kind === 'birthday' && !customers.keys.includes('birthday_offered');

    return { statusCode: 200, body: JSON.stringify({
      success: true,
      amount: rule.amount,
      creditOwed,
      ledger,
      // Said out loud rather than failing quietly: the credit is on the
      // account either way, but without the column the same birthday will come
      // back round tomorrow morning.
      warning: markerMissing
        ? 'The $' + rule.amount + ' is on the account, but the Customers tab has no birthday_offered column, so this birthday will keep appearing. Add that column to the header row.'
        : '',
    }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
