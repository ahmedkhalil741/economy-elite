// Assigns a ride to a driver and gets it onto his phone.
//
// Three things happen, and none of them is allowed to stop the others:
//   1. The Bookings sheet row gets his name in the `driver` column.
//   2. The calendar entry is retitled so the ride reads "— Hany" at a glance,
//      and his name and number go into the description.
//   3. He gets an email with the ride sheet and a .ics file attached. Tapping
//      the attachment puts the ride on his own phone's calendar, with a
//      reminder, whether he uses Google, Apple or anything else.
//
// WHY A .ICS FILE RATHER THAN A CALENDAR INVITATION: Google does not let a
// service account invite guests to an event unless the whole domain is set up
// to let it act as a person (domain-wide delegation). An attached .ics needs
// no permission from anybody, works for a driver who has never touched Google
// Calendar, and can't be broken by a Workspace setting changing underneath us.
//
// The response carries a ready-written text message and an sms: link. The
// dispatch page turns that into a "Text the driver" button, so the message is
// sent from the owner's own phone, from his own number — no texting service to
// pay for, and the driver can just reply.

const { google } = require('googleapis');
const { findDriver } = require('./_drivers');
const { sendEmail } = require('./_email');
const { readTab, buildRow, rowToObject } = require('./_sheet');
const { formatRequestedDateTime, shiftLocalDateTime, easternOffsetMinutes, easternToInstant } = require('./_format');
const { estimateFare } = require('./_fare-calc');

const SHEET_TAB = 'Bookings';
const BUSINESS_TIMEZONE = 'America/New_York';
// How long either side of the pickup time to look for the calendar entry.
// Generous, because the entry was created from the same string we're
// searching with — this only has to survive rounding, not guesswork.
const SEARCH_WINDOW_MINUTES = 90;

async function googleAuth(scopes) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    scopes
  );
  await auth.authorize();
  return auth;
}

// A minimal, valid iCalendar file. Times are written in UTC (the trailing Z),
// because a floating local time is the one thing phones disagree about.
function buildIcs({ uid, startLocal, minutes, summary, description, location }) {
  // One converter for the whole codebase — see easternToInstant.
  const toUtcStamp = (localNoZone) => {
    const inst = easternToInstant(String(localNoZone).slice(0, 16));
    return (inst || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const start = toUtcStamp(startLocal);
  const endLocal = shiftLocalDateTime(startLocal.slice(0, 16), minutes);
  const end = toUtcStamp(endLocal);

  const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
                                    .replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Standard//Ride//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(location)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT45M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Pickup in 45 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // iCalendar wants CRLF line endings. Some phones are forgiving; not all.
  return lines.join('\r\n');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Same gate as list-bookings — this one writes to the sheet and sends mail,
  // so it matters more, not less.
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  const steps = { sheet: 'skipped', calendar: 'skipped', email: 'skipped' };

  try {
    const { token, driverKey, notify, rowNumber, fare: storedFare, when: storedWhen,
            pickup, dropoff, dateTime, name, phone, vehicle,
            passengers, carSeats, flight, temp, elderly, notes, payMethod } = JSON.parse(event.body);

    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };
    if (!driverKey) return { statusCode: 400, body: JSON.stringify({ error: 'No driver chosen.' }) };
    if (!pickup || !dropoff || !dateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'The ride is missing its pickup, drop-off or time.' }) };
    }

    // How the driver is told. The sheet and the calendar are updated either
    // way — those are the record, not a message to somebody.
    const how = ['email', 'text', 'both'].includes(String(notify || '').toLowerCase())
      ? String(notify).toLowerCase() : 'both';

    const driver = await findDriver(driverKey);
    if (!driver) return { statusCode: 404, body: JSON.stringify({ error: `No driver called "${driverKey}". Check the Drivers tab in the sheet.` }) };

    const when = storedWhen || formatRequestedDateTime(dateTime);

    // THE BUG THIS REPLACES: the ride sheet re-calculated the fare from
    // scratch. estimateFare treats anything that isn't exactly "sedan" as an
    // SUV, so a blank vehicle cell put the SUV price in the driver's hand for
    // a ride the customer was quoted as a sedan — $110 against $75 — and any
    // fare corrected by hand in the sheet was thrown away. The number the
    // customer agreed to is the one in the sheet. Only fall back to
    // calculating when the sheet has nothing.
    const fareText = String(storedFare || '').trim();
    const fare = fareText
      ? { matched: true, totalDisplay: /^[\d.]+$/.test(fareText) ? `$${fareText}` : fareText, display: fareText }
      : estimateFare(pickup, dropoff, vehicle, dateTime, payMethod);

    // ---- the ride sheet, written once and reused in all three places ----
    const sheetLines = [
      `${when}`,
      `Pick up: ${pickup}`,
      `Drop off: ${dropoff}`,
      `Passenger: ${name || 'not given'}${phone ? ` — ${phone}` : ''}`,
      `Car: ${vehicle || 'SUV'}${passengers ? ` · ${passengers} passenger${passengers === '1' ? '' : 's'}` : ''}`,
      (carSeats && carSeats !== '0' && carSeats !== 'None') ? `Car seats: ${carSeats}` : null,
      elderly === true || elderly === 'Yes' ? 'ELDERLY ASSISTANCE — help to and from the door' : null,
      flight ? `Flight: ${flight}` : null,
      temp && temp !== 'No preference' ? `Cabin: ${temp}` : null,
      `Payment: ${payMethod || 'not set'}`,
      fare.matched ? `Fare to collect: ${fare.totalDisplay || fare.display}` : `Fare: ${fare.display}`,
      vehicle ? null : 'CHECK THE CAR — no vehicle recorded on this booking',
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean);

    // ---- 1. the sheet ----
    try {
      const auth = await googleAuth(['https://www.googleapis.com/auth/spreadsheets']);
      const sheets = google.sheets({ version: 'v4', auth });
      const { keys, rows, lastColumn } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, SHEET_TAB);

      if (!keys.includes('driver')) {
        steps.sheet = 'no "driver" column in the Bookings tab — add one and it will fill in next time';
      } else {
        // Use the row number the dispatch page was looking at.
        //
        // THE BUG THIS REPLACES: this used to re-find the row by matching
        // pickup + drop-off + time with findIndex, which returns the FIRST
        // match. Two customers going Summit -> Newark at 11:00 is not exotic,
        // and a double-click on the booking form produces two identical rows
        // by itself. The driver was then written onto the wrong person's ride
        // and the page reported success in green.
        let idx = Number.isInteger(rowNumber) && rowNumber >= 2 ? rowNumber - 2 : -1;

        // Trust it, but check: if the sheet has been re-sorted since the page
        // loaded, that number points at somebody else. Verify the row still
        // holds this ride before writing to it.
        if (idx >= 0 && idx < rows.length) {
          const r = rowToObject(keys, rows[idx]);
          if (r.pickup !== pickup || r.dropoff !== dropoff) idx = -1;
        } else {
          idx = -1;
        }

        if (idx === -1) {
          steps.sheet = 'the sheet has changed since this page loaded — refresh and try again';
        } else {
          const updated = buildRow(keys, { driver: driver.name }, rows[idx]);
          await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${SHEET_TAB}!A${idx + 2}:${lastColumn}${idx + 2}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [updated] },
          });
          steps.sheet = 'assigned';
        }
      }
    } catch (err) {
      steps.sheet = `failed: ${err.message}`;
    }

    // ---- 2. the owner's calendar entry ----
    try {
      const auth = await googleAuth(['https://www.googleapis.com/auth/calendar']);
      const calendar = google.calendar({ version: 'v3', auth });
      // The pickup time is Eastern wall-clock; the calendar API wants real
      // instants. Converting is not optional - see easternToInstant.
      const pivot = easternToInstant(dateTime) || new Date(dateTime.slice(0, 16) + ':00Z');
      const list = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: new Date(pivot.getTime() - SEARCH_WINDOW_MINUTES * 60000).toISOString(),
        timeMax: new Date(pivot.getTime() + SEARCH_WINDOW_MINUTES * 60000).toISOString(),
        singleEvents: true,
        maxResults: 50,
      });
      // THE BUG THIS REPLACES: matching on the first 20 characters of the
      // pickup, with OR. Two rides from the same street matched each other;
      // "Terminal B" and "Terminal C" at Newark share their first 20
      // characters; and a short pickup like "Summit, NJ" also matched an
      // unrelated event that was DROPPING someone at Summit. The wrong ride
      // got retitled and the page said "updated".
      //
      // Now: the start time has to be the same minute, and BOTH ends have to
      // appear. add-to-calendar writes the summary as
      // "The Standard ride for NAME: PICKUP → DROPOFF", so both are in there.
      const wantStart = pivot.getTime();
      const candidates = (list.data.items || []).filter((e) => {
        const hay = `${e.summary || ''} ${e.description || ''}`;
        if (!hay.includes(pickup) || !hay.includes(dropoff)) return false;
        const started = e.start && (e.start.dateTime || e.start.date);
        return started ? Math.abs(new Date(started).getTime() - wantStart) < 60000 : false;
      });
      // More than one identical event is a duplicate booking, not a choice to
      // make silently — say so rather than picking one.
      const match = candidates.length === 1 ? candidates[0] : null;
      if (candidates.length > 1) steps.calendar = `${candidates.length} identical entries at that time — fix them on the calendar first`;

      if (!match) {
        if (steps.calendar === 'skipped') steps.calendar = 'no matching calendar entry found';
      } else {
        const base = (match.summary || '').replace(/\s+—\s+[^—]*$/, '');
        await calendar.events.patch({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          eventId: match.id,
          requestBody: {
            summary: `${base} — ${driver.name}`,
            description: `DRIVER: ${driver.name} (${driver.phoneDisplay})\n\n${match.description || ''}`,
          },
        });
        steps.calendar = 'updated';
      }
    } catch (err) {
      steps.calendar = `failed: ${err.message}`;
    }

    // ---- 3. the driver's email, with the ride on a .ics he can tap ----
    const startLocal = shiftLocalDateTime(dateTime.slice(0, 16), 0);
    const ics = how === 'text' ? null : buildIcs({
      uid: `ride-${Date.now()}@standardnj.com`,
      startLocal,
      minutes: 60,
      summary: `Ride: ${pickup} → ${dropoff}`,
      description: sheetLines.join('\n'),
      location: pickup,
    });

    if (how === 'text') {
      steps.email = 'not sent — you chose to text';
    } else if (!driver.email) {
      steps.email = 'no email on file for this driver — text him instead';
    } else {
      try {
        await sendEmail({
          to: driver.email,
          replyTo: process.env.OWNER_EMAIL,
          subject: `Your ride — ${when} — ${pickup} → ${dropoff}`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p style="margin:0 0 14px"><strong>${driver.name}</strong>, this ride is yours.</p>
  <table style="border-collapse:collapse;font-size:15px">
    ${sheetLines.map((l) => `<tr><td style="padding:3px 0">${l}</td></tr>`).join('')}
  </table>
  <p style="margin:18px 0 0;color:#555;font-size:13px">Open the attached file to put this on your phone's calendar. You'll get a reminder 45 minutes before pickup.</p>
</div>`,
          attachments: [{
            filename: 'ride.ics',
            content: Buffer.from(ics, 'utf8').toString('base64'),
          }],
        });
        steps.email = 'sent';
      } catch (err) {
        steps.email = `failed: ${err.message}`;
      }
    }

    // ---- the text, for the owner to send from his own phone ----
    const smsBody = [`${driver.name} — ride assigned:`, ...sheetLines].join('\n');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        driver: { name: driver.name, phone: driver.phone, phoneDisplay: driver.phoneDisplay, email: driver.email },
        steps,
        rideSheet: sheetLines,
        // The page builds the sms: link itself — iOS wants sms:number&body=
        // and Android wants sms:number?body=, and only the browser knows
        // which phone is about to open it.
        smsBody,
        // Whether the page should offer the Text button at all.
        offerText: how === 'text' || how === 'both',
        notify: how,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message, steps }) };
  }
};
