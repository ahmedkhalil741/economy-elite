// What the passenger thought, in their words, into a Feedback tab.
//
// WHY THIS IS WORTH HAVING AT ALL. The site promises that we remember how you
// travel - the cabin temperature, the car seat, the sedan or the Suburban -
// and until now the only way anything got into that memory was Ahmed typing it
// after a phone call. The last question here ("anything we should remember for
// next time") is the customer filling it in themselves, which is both more
// accurate and the thing they will notice on the next ride.
//
// The first question is the one nobody can answer any other way: how did you
// hear about us. Google, Yelp, Nextdoor, a flyer, a friend. That is the only
// honest measure of whether any of the marketing is working, and it costs a
// customer one tap to answer.
//
// NO TOKEN ON THIS ONE. It is the customer who fills it in, from a link in
// their own thank-you message, so it has to be open the way the booking form
// is open. What stops it being useful to a stranger is that it writes to a tab
// nobody reads but Ahmed, and it holds nothing worth stealing.
//
// A missing Feedback tab is reported plainly rather than swallowed. Feedback
// that silently went nowhere is worse than none: he would believe people had
// nothing to say.

const { google } = require('googleapis');
const { readTab, buildRow } = require('./_sheet');
const { formatTimestamp } = require('./_format');

const FEEDBACK_TAB = 'Feedback';

let cachedSheets = null;
async function sheetsClient() {
  if (cachedSheets) return cachedSheets;
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

// Trimmed and capped. A form on the open internet eventually meets somebody
// pasting a novel into it, and a 40,000-character cell makes the whole tab
// unreadable.
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 500);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (err) { return { statusCode: 400, body: JSON.stringify({ error: 'Bad request body.' }) }; }

  const phone = clean(body.phone, 20).replace(/\D/g, '').slice(-10);
  const rating = /^[1-5]$/.test(String(body.rating || '')) ? String(body.rating) : '';
  const heard = clean(body.heard, 60);
  const liked = clean(body.liked, 1000);
  const improve = clean(body.improve, 1000);
  const remember = clean(body.remember, 1000);

  // Something has to have been said, or it is a wasted row.
  if (!rating && !heard && !liked && !improve && !remember) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to save.' }) };
  }

  try {
    const sheets = await sheetsClient();
    const id = process.env.GOOGLE_SHEET_ID;

    let tab;
    try { tab = await readTab(sheets, id, FEEDBACK_TAB); }
    catch (err) {
      return { statusCode: 200, body: JSON.stringify({
        success: false,
        error: 'There is no Feedback tab in the spreadsheet yet, so this could not be saved.' }) };
    }
    if (!tab.keys.length) {
      return { statusCode: 200, body: JSON.stringify({
        success: false, error: 'The Feedback tab has no header row.' }) };
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${FEEDBACK_TAB}!A:${tab.lastColumn}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [buildRow(tab.keys, {
        date: formatTimestamp(new Date().toISOString()),
        phone, name: clean(body.name, 80),
        rating, heard_from: heard,
        liked, improve, remember_next_time: remember,
      })] },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
