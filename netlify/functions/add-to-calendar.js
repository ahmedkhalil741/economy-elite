// Adds each booking to the owner's Google Calendar automatically using a
// Google Service Account (no login prompts — it authenticates as itself).
//
// This calendar is how the driver actually sees the day's rides, so the
// event carries everything needed to run the trip: who, where, what car,
// how they're paying, and the internal fare to collect.
//
// ---- ONE-TIME SETUP (done once in Google Cloud Console) ----
// 1. In the same Google Cloud project used for Maps, enable "Google Calendar API"
//    (APIs & Services -> Library -> search "Google Calendar API" -> Enable)
// 2. Create a Service Account:
//    APIs & Services -> Credentials -> Create Credentials -> Service Account
//    Give it any name, e.g. "economyelite-calendar"
// 3. Open the new service account -> Keys -> Add Key -> Create new key -> JSON
//    This downloads a .json file — KEEP IT PRIVATE, never put it in the website code.
// 4. Open Google Calendar (calendar.google.com) on the account you want bookings
//    added to -> Settings -> Settings for my calendars -> [your calendar] ->
//    "Share with specific people" -> add the service account's email address
//    (it looks like economyelite-calendar@your-project.iam.gserviceaccount.com,
//    found inside the downloaded JSON file as "client_email")
//    -> give it "Make changes to events" permission.
//
// ---- Netlify environment variables required ----
//   GOOGLE_SERVICE_ACCOUNT_EMAIL = the "client_email" value from the JSON file
//   GOOGLE_SERVICE_ACCOUNT_KEY   = the "private_key" value from the JSON file
//                                   (paste it exactly, including the
//                                   -----BEGIN PRIVATE KEY----- lines)
//   GOOGLE_CALENDAR_ID           = the Calendar ID of the calendar bookings go
//                                   on. Currently hany@standardnj.com.
//
// ---- IF BOOKINGS STOP APPEARING ON THE CALENDAR ----
// This happened on 2026-09-17 and cost an evening, so: an insert that returns
// success only means Google accepted it for whatever GOOGLE_CALENDAR_ID names.
// It had been left pointing at an old Yahoo-login Google account nobody opened,
// so months of rides went somewhere invisible while every call reported OK.
// Check the env var FIRST, before suspecting the code.
//
// Two further traps, both hit that same evening:
//   1. Changing a Netlify environment variable does nothing until a new deploy.
//   2. standardnj.com is a Google Workspace domain, and Workspace refuses by
//      default to share a calendar with an address outside the domain - which a
//      service account always is. It does not refuse loudly; it silently
//      downgrades the permission to "See only free/busy", and the insert then
//      fails with "You need to have writer access to this calendar". The fix is
//      in the Admin console: Apps > Google Workspace > Calendar > Sharing
//      settings > External sharing options for primary calendars.

const { google } = require('googleapis');
const { estimateFare, isOvernightPickup } = require('./_fare-calc');
const { shiftLocalDateTime } = require('./_format');

// The business runs out of New Providence, NJ, so every pickup time a
// customer types is Eastern wall-clock time. This MUST be sent to Google
// alongside the naive date string — see the note on RIDE_MINUTES below.
const BUSINESS_TIMEZONE = 'America/New_York';

// The event is created AT the pickup time with no length, so the calendar
// reads "12:43am" rather than a made-up "12:43 - 1:28am" block. The pickup
// time is the fact that matters; how long the drive takes isn't known.
//
// If Google ever refuses a zero-length event, the insert is retried with
// this many minutes so the ride still lands on the calendar either way.
const FALLBACK_MINUTES = 30;

async function getCalendarClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  await auth.authorize();
  return google.calendar({ version: 'v3', auth });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const {
      name, pickup, dropoff, dateTime, phone, notes, payMethod,
      passengers, carSeats, flight, temp, elderly, contact15, vehicle, overrides,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff || !dateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    // The booking form hands us a wall-clock time with no timezone on it,
    // e.g. "2026-09-13T11:38" meaning 11:38 AM here. Passing that through
    // `new Date()` used to interpret it as the SERVER's timezone — which on
    // Netlify is UTC — so every event landed on the calendar 4-5 hours early
    // (an 11:38 AM pickup showed up at 7:38 AM). Instead, keep the naive
    // string exactly as typed and tell Google which timezone it belongs to.
    const start = shiftLocalDateTime(dateTime, 0);
    if (!start) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unrecognized date/time format: ${dateTime}` }) };
    }

    const fare = estimateFare(pickup, dropoff, vehicle, dateTime, payMethod, overrides);

    const descLines = [
      `Customer name: ${name || 'N/A'}`,
      `Customer phone: ${phone}`,
      `Vehicle: ${vehicle || 'SUV'}`,
      passengers ? `Passengers: ${passengers}` : null,
      `Car seats needed: ${carSeats && carSeats !== '0' ? carSeats : 'None'}`,
      `Elderly assistance needed: ${elderly ? 'Yes' : 'No'}`,
      flight ? `Flight: ${flight}` : null,
      temp && temp !== 'No preference' ? `Cabin temperature: ${temp}` : null,
      `Text/call 15 min before pickup: ${contact15 ? 'Yes' : 'No'}`,
      isOvernightPickup(dateTime) ? 'Overnight pickup (12 AM–5:59 AM)' : null,
      `Notes: ${notes || 'None'}`,
      '',
      `Payment method: ${payMethod || 'N/A'}`,
      // Internal number, on a private calendar — confirm with the customer
      // before treating it as final.
      // driverDisplay, not display. Whoever opens this entry is on their way
      // to collect a number, and a discount line beside it is a question the
      // driver should never have to ask the customer. The discount is Ahmed's
      // business and the customer's — it lives in the sheet and in his email.
      `Fare (internal estimate): ${fare.driverDisplay || fare.display}`,
      fare.tipSuggested ? `Suggested tip (20%): $${fare.tipSuggested}` : null,
    ].filter((line) => line !== null);

    const calendar = await getCalendarClient();
    const requestBody = {
      summary: `The Standard ride for ${name || 'customer'}: ${pickup} → ${dropoff}`,
      description: descLines.join('\n'),
      start: { dateTime: start, timeZone: BUSINESS_TIMEZONE },
      end: { dateTime: start, timeZone: BUSINESS_TIMEZONE },
    };

    try {
      await calendar.events.insert({ calendarId: process.env.GOOGLE_CALENDAR_ID, requestBody });
    } catch (zeroLengthErr) {
      // A zero-length event is what puts a single time on the calendar, but
      // don't lose the booking over it if Google won't take one.
      requestBody.end = { dateTime: shiftLocalDateTime(dateTime, FALLBACK_MINUTES), timeZone: BUSINESS_TIMEZONE };
      await calendar.events.insert({ calendarId: process.env.GOOGLE_CALENDAR_ID, requestBody });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
