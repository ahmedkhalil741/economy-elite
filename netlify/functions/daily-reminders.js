// One email a morning: who to reach out to today, and what it would cost.
//
// WHY THIS EXISTS AS A SCHEDULED JOB. Two of Ahmed's offers aren't triggered
// by anything a customer does — they're triggered by TIME PASSING. A customer
// going quiet for 90 days is the absence of an event; a birthday arrives
// whether or not anyone books. Nothing in a website fires on its own, so
// something has to come looking. Netlify runs this once a day (see
// netlify.toml).
//
// NOTHING IS SENT TO ANY CUSTOMER. This reads the Customers tab and emails
// Ahmed a list. He decides who is worth a note and sends it himself, which is
// what he asked for while the programme is this young.
//
// A quiet day sends nothing at all. An email every morning saying "nothing to
// do" trains you to stop reading them.

const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');
const { sendOwnerEmail } = require('./_email');
const L = require('./_loyalty');

const CUSTOMERS_TAB = 'Customers';
const BIRTHDAY_LOOKAHEAD_DAYS = 7;

async function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function table(rows) {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 6px">${
    rows.map((r) => `<tr><td style="padding:6px 10px 6px 0;border-bottom:1px solid #eee">${r}</td></tr>`).join('')
  }</table>`;
}

exports.handler = async function () {
  try {
    const sheets = await sheetsClient();
    const { keys, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);
    const today = new Date();

    const wentQuiet = [];
    const birthdays = [];
    const owed = [];

    for (const row of rows) {
      const c = rowToObject(keys, row);
      const name = c.name || c.phone;
      if (!name) continue;

      const points = parseInt(c.lifetime_points, 10) || 0;
      const completed = parseInt(c.completed_rides, 10) || 0;
      const status = L.statusFor(points, c.status);
      const star = status === L.STATUS_LOYAL ? ' ⭐' : '';

      if (completed > 0 && L.justWentQuiet(c.last_ride, today)) {
        const days = L.daysSince(c.last_ride, today);
        wentQuiet.push(`<strong>${name}</strong>${star} — ${c.phone || ''} · last ride ${days} days ago · ${completed} completed · a $${L.WIN_BACK_CREDIT} note would bring them back`);
      }

      if (L.birthdayWithin(c.birthday, BIRTHDAY_LOOKAHEAD_DAYS, today)) {
        birthdays.push(`<strong>${name}</strong>${star} — ${c.phone || ''} · birthday ${c.birthday} · $${L.BIRTHDAY_CREDIT} or something personal`);
      }

      const balance = parseFloat(c.credit_owed) || 0;
      if (balance > 0) {
        owed.push(`<strong>${name}</strong>${star} — ${c.phone || ''} · <strong>$${balance}</strong> owed${c.credit_history ? ` · ${c.credit_history}` : ''}`);
      }
    }

    if (!wentQuiet.length && !birthdays.length && !owed.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'nothing to report today' }) };
    }

    const parts = [];
    if (wentQuiet.length) parts.push(`<h3 style="margin:22px 0 8px;font-size:16px">Gone quiet — worth a note</h3>${table(wentQuiet)}`);
    if (birthdays.length) parts.push(`<h3 style="margin:22px 0 8px;font-size:16px">Birthdays in the next ${BIRTHDAY_LOOKAHEAD_DAYS} days</h3>${table(birthdays)}`);
    if (owed.length) parts.push(`<h3 style="margin:22px 0 8px;font-size:16px">Credits earned and not yet sent</h3>${table(owed)}`);

    const subject = [
      wentQuiet.length ? `${wentQuiet.length} gone quiet` : null,
      birthdays.length ? `${birthdays.length} birthday${birthdays.length === 1 ? '' : 's'}` : null,
      owed.length ? `$${owed.length} credit${owed.length === 1 ? '' : 's'} to send` : null,
    ].filter(Boolean).join(' · ');

    await sendOwnerEmail(`The Standard — ${subject}`, `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111">
        ${parts.join('')}
        <p style="margin:24px 0 0;color:#555;font-size:13px">Nothing has been sent to anybody. This is a list for you. When you send a credit, clear it from <code>credit_owed</code> in the Customers tab so it stops appearing here.</p>
      </div>`);

    return { statusCode: 200, body: JSON.stringify({ sent: true, wentQuiet: wentQuiet.length, birthdays: birthdays.length, owed: owed.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// The schedule lives in netlify.toml, not here — one place to change it, and
// no chance of the two disagreeing.
