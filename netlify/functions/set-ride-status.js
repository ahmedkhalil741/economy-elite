// Marks a ride Completed, Cancelled or No-show — and, on Completed, awards
// the loyalty point.
//
// This is the piece the loyalty programme was missing. Before it, every count
// happened at booking time, so a cancellation earned exactly as much as a
// finished airport run. Points are awarded HERE and nowhere else.
//
// Completing the same ride twice must not award two points, so the Bookings
// row's current status is read first and a ride already marked Completed is
// left alone. The same guard means a ride marked Cancelled AFTER it was
// completed takes its point back.
//
// Netlify environment variables: the usual Google ones, plus ADMIN_TOKEN.

const { google } = require('googleapis');
const { readTab, buildRow, rowToObject, orNA } = require('./_sheet');
const { easternToday } = require('./_format');
const { sendOwnerEmail } = require('./_email');
const L = require('./_loyalty');

const BOOKINGS_TAB = 'Bookings';
const CUSTOMERS_TAB = 'Customers';

const COMPLETED = 'Completed';
const CANCELLED = 'Cancelled';
const NO_SHOW = 'No-show';
const REQUESTED = 'Requested';
const ALLOWED = [COMPLETED, CANCELLED, NO_SHOW, REQUESTED];

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  try {
    const { token, rowNumber, status, pickup, dropoff, phone, name } = JSON.parse(event.body);
    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

    const wanted = ALLOWED.find((s) => s.toLowerCase() === String(status || '').trim().toLowerCase());
    if (!wanted) return { statusCode: 400, body: JSON.stringify({ error: `Status must be one of: ${ALLOWED.join(', ')}` }) };

    const sheets = await sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // ---- the booking row ----
    const bookings = await readTab(sheets, spreadsheetId, BOOKINGS_TAB);
    if (!bookings.keys.includes('ride_status')) {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'The Bookings tab has no "ride_status" column. Add one to the header row.' }) };
    }

    const idx = Number.isInteger(rowNumber) && rowNumber >= 2 ? rowNumber - 2 : -1;
    if (idx < 0 || idx >= bookings.rows.length) {
      return { statusCode: 409, body: JSON.stringify({ error: 'That ride is no longer at that row — refresh and try again.' }) };
    }
    const row = rowToObject(bookings.keys, bookings.rows[idx]);
    if (row.pickup !== pickup || row.dropoff !== dropoff) {
      return { statusCode: 409, body: JSON.stringify({ error: 'The sheet has changed since this page loaded — refresh and try again.' }) };
    }

    const before = String(row.ride_status || '').trim();
    if (before.toLowerCase() === wanted.toLowerCase()) {
      return { statusCode: 200, body: JSON.stringify({ success: true, unchanged: true, status: wanted }) };
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BOOKINGS_TAB}!A${rowNumber}:${bookings.lastColumn}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [buildRow(bookings.keys, { ride_status: wanted }, bookings.rows[idx])] },
    });

    // ---- the point ----
    // +1 on the way into Completed, -1 on the way out of it. Nothing else
    // moves the total, so marking a ride Completed twice can't double-count
    // and correcting a mistake genuinely corrects it.
    const wasCompleted = before.toLowerCase() === COMPLETED.toLowerCase();
    const nowCompleted = wanted === COMPLETED;
    const delta = (nowCompleted ? 1 : 0) - (wasCompleted ? 1 : 0);

    if (delta === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, status: wanted, pointsChanged: false }) };
    }

    const key = normalizePhone(phone || row.phone);
    if (!key) {
      return { statusCode: 200, body: JSON.stringify({ success: true, status: wanted, pointsChanged: false, note: 'No phone number on this ride, so no customer to credit.' }) };
    }

    const customers = await readTab(sheets, spreadsheetId, CUSTOMERS_TAB);
    const phoneCol = customers.keys.indexOf('phone');
    if (phoneCol === -1) {
      return { statusCode: 200, body: JSON.stringify({ success: true, status: wanted, pointsChanged: false, note: 'The Customers tab has no phone column.' }) };
    }
    const cIdx = customers.rows.findIndex((r) => normalizePhone(r[phoneCol]) === key);
    if (cIdx === -1) {
      return { statusCode: 200, body: JSON.stringify({ success: true, status: wanted, pointsChanged: false, note: 'No customer profile for that number yet.' }) };
    }

    const c = rowToObject(customers.keys, customers.rows[cIdx]);
    const pointsBefore = parseInt(c.lifetime_points, 10) || 0;
    const points = Math.max(0, pointsBefore + delta);
    const completedRides = Math.max(0, (parseInt(c.completed_rides, 10) || 0) + delta);

    const today = easternToday();
    const previousStatus = c.status;
    const status_ = L.statusFor(points, previousStatus);
    const lastRide = nowCompleted ? today.date : (c.last_ride || '');
    const firstRide = (nowCompleted && !c.first_ride) ? today.date : (c.first_ride || '');
    const activity = completedRides === 0 ? '—' : L.activityFor(lastRide);

    // Credits follow the point exactly, in both directions.
    //
    // THE BUG THIS FIXES (caught by testing the reversal, 2026-09-18): taking
    // a point back left the credit behind. Mark a ride Completed, then
    // Cancelled, then Completed again — a correction anyone might make — and
    // the customer walked away with $10 of credit for one $5 ride. Whatever
    // completing awarded, un-completing takes back.
    const credit = nowCompleted ? L.creditEarned(points) : null;
    // On the way OUT of Completed, `pointsBefore` is the total that earned the
    // credit in the first place, so that is the one to reverse.
    const reversed = !nowCompleted && wasCompleted ? L.creditEarned(pointsBefore) : null;

    const creditOwed = Math.max(0,
      (parseFloat(c.credit_owed) || 0)
      + (credit ? credit.amount : 0)
      - (reversed ? reversed.amount : 0));

    const entry = credit
      ? `${today.date} +$${credit.amount} (${credit.reason})`
      : reversed
        ? `${today.date} −$${reversed.amount} (${wanted.toLowerCase()} — reversed)`
        : null;
    const creditNote = entry
      ? [c.credit_history, entry].filter(Boolean).join(' · ')
      : (c.credit_history || '');

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CUSTOMERS_TAB}!A${cIdx + 2}:${customers.lastColumn}${cIdx + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [buildRow(customers.keys, {
          lifetime_points: points,
          completed_rides: completedRides,
          status: status_,
          activity,
          first_ride: firstRide,
          last_ride: lastRide,
          credit_owed: creditOwed ? creditOwed : 0,
          credit_history: creditNote,
        }, customers.rows[cIdx])],
      },
    });

    // ---- the referral ----
    // Paid to the REFERRER, once, when the person they sent completes their
    // first ride. Only on the first: a referral is worth one credit however
    // many times that customer comes back afterwards.
    let referral = null;
    if (nowCompleted && completedRides === 1 && c.referred_by) {
      const refKey = normalizePhone(c.referred_by);
      const refIdx = refKey
        ? customers.rows.findIndex((r) => normalizePhone(r[phoneCol]) === refKey)
        : -1;
      if (refIdx !== -1 && refIdx !== cIdx) {
        const ref = rowToObject(customers.keys, customers.rows[refIdx]);
        const refOwed = (parseFloat(ref.credit_owed) || 0) + L.REFERRAL_CREDIT;
        const refNote = [ref.credit_history, `${today.date} +$${L.REFERRAL_CREDIT} (referred ${c.name || key})`]
          .filter(Boolean).join(' · ');
        try {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${CUSTOMERS_TAB}!A${refIdx + 2}:${customers.lastColumn}${refIdx + 2}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [buildRow(customers.keys, { credit_owed: refOwed, credit_history: refNote }, customers.rows[refIdx])] },
          });
          referral = { name: ref.name || refKey, phone: refKey, amount: L.REFERRAL_CREDIT, owed: refOwed };
        } catch (err) {
          referral = { error: err.message };
        }
      } else if (refKey) {
        referral = { unmatched: c.referred_by };
      }
    }

    // ---- tell Ahmed, so he can send the offer himself ----
    const who = c.name || name || key;
    let emailed = null;
    const becameLoyal = previousStatus !== L.STATUS_LOYAL && status_ === L.STATUS_LOYAL;

    if (credit || becameLoyal || (referral && referral.amount)) {
      const subject = becameLoyal
        ? `⭐ New Loyal Customer – ${who}`
        : `${who} earned a $${credit.amount} credit`;
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.7;color:#111">
        <p style="margin:0 0 12px"><strong>${who}</strong> — ${key}</p>
        <p style="margin:0 0 12px">${L.standingLine({ name: who, status: status_, activity, points, completedRides })}</p>
        ${credit ? `<p style="margin:0 0 12px"><strong>Earned: $${credit.amount}</strong> — ${credit.reason}.<br>Balance owed: <strong>$${creditOwed}</strong>.</p>` : ''}
        ${referral && referral.amount ? `<p style="margin:0 0 12px;padding:10px 12px;background:#f5f2ea;border-radius:6px"><strong>${referral.name}</strong> referred them — <strong>$${referral.amount}</strong> credit added, balance now <strong>$${referral.owed}</strong>.</p>` : ''}
        ${referral && referral.unmatched ? `<p style="margin:0 0 12px;color:#a05">Referred by "${referral.unmatched}" — no customer with that number, so no referral credit was given.</p>` : ''}
        <p style="margin:0;color:#555;font-size:13px">Nothing has been sent to the customer. Send the offer yourself when you're ready, then adjust <code>credit_owed</code> in the Customers tab.</p>
      </div>`;
      try { await sendOwnerEmail(subject, html); emailed = subject; }
      catch (err) { emailed = `email failed: ${err.message}`; }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        status: wanted,
        pointsChanged: true,
        customer: {
          name: who, status: status_, activity, points, completedRides,
          creditOwed, creditEarned: credit ? credit.amount : 0,
          standing: L.standingLine({ name: who, status: status_, activity, points, completedRides }),
        },
        referral,
        emailed,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
