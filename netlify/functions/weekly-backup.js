// A copy of the sheet, in Ahmed's inbox, every Monday morning.
//
// WHY THIS EXISTS. The Google Sheet is the database. Every booking, every
// customer, every point and every credit balance lives there and nowhere
// else. Google's own version history covers about thirty days, which is
// enough for an accident you NOTICE. It is not enough for the quiet kind: a
// column renamed, values dropping into nowhere, and the loss surfacing eight
// weeks later when a regular says their credit is gone. That already happened
// once, with discount_spent.
//
// So this takes a copy and mails it. The inbox matters as much as the copy:
// it is a different company from Google, so a bad day at Google does not take
// the backup with it. Nothing here writes to the sheet — it only reads.
//
// A failure is LOUD. A backup that quietly stopped running months ago is
// worse than no backup, because you believed you had one.

const { google } = require('googleapis');
const { readTab } = require('./_sheet');
const { sendEmail, sendOwnerEmail } = require('./_email');

// Every tab worth keeping. A tab that isn't there yet is skipped, not fatal —
// the sheet grows over time and a missing name should not cost you the rest.
const TABS = ['Bookings', 'Customers', 'Credits', 'Drivers'];

async function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    // Read only. A backup job has no business holding a write key.
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// Excel and Numbers both read this. A cell containing a comma, a quote or a
// newline has to be quoted or the columns shift by one and the file is a lie.
function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => csvCell(row[i])).join(','));
  }
  // A BOM, so Excel opens names with accents correctly instead of as mojibake.
  return '﻿' + lines.join('\r\n');
}

exports.handler = async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const attachments = [];
  const summary = [];
  const problems = [];

  let sheets;
  try {
    sheets = await sheetsClient();
  } catch (err) {
    await sendOwnerEmail(
      'BACKUP FAILED — The Standard',
      `<p>The weekly backup could not reach Google at all.</p>
       <p style="color:#b00">${String(err.message || err)}</p>
       <p>Nothing was saved this week. Until this is fixed you have no backup
          outside Google.</p>`
    ).catch(() => {});
    return { statusCode: 500, body: 'auth failed' };
  }

  for (const tab of TABS) {
    try {
      const { headers, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, tab);
      if (!headers.length) { problems.push(`${tab}: empty`); continue; }
      attachments.push({
        filename: `${tab.toLowerCase()}-${stamp}.csv`,
        content: Buffer.from(toCsv(headers, rows), 'utf8').toString('base64'),
      });
      summary.push(`<tr><td style="padding:5px 14px 5px 0">${tab}</td>` +
                   `<td style="padding:5px 0;text-align:right"><b>${rows.length}</b> rows</td></tr>`);
    } catch (err) {
      // A tab that does not exist is normal. Anything else is worth saying.
      const msg = String(err.message || err);
      if (!/Unable to parse range|not found/i.test(msg)) problems.push(`${tab}: ${msg}`);
    }
  }

  if (!attachments.length) {
    await sendOwnerEmail(
      'BACKUP FAILED — The Standard',
      `<p>The weekly backup ran but saved nothing. ${problems.join('; ') || 'No tabs could be read.'}</p>`
    ).catch(() => {});
    return { statusCode: 500, body: 'nothing to back up' };
  }

  const warn = problems.length
    ? `<p style="color:#b00;font-size:13px">Could not read: ${problems.join('; ')}</p>` : '';

  await sendEmail({
    to: process.env.OWNER_EMAIL,
    subject: `Backup — The Standard — ${stamp}`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222">
         <p>A copy of the sheet, attached as CSV. Keep it — this is your only copy
            outside Google.</p>
         <table style="border-collapse:collapse;font-size:14px;margin:12px 0">${summary.join('')}</table>
         ${warn}
         <p style="color:#777;font-size:12px">Sent every Monday. If a Monday goes by with no
            backup email, something is wrong — check Netlify &rarr; Functions.</p>
       </div>`,
    attachments,
  });

  return { statusCode: 200, body: `backed up ${attachments.length} tabs` };
};
