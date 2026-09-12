// Adds each booking to the owner's Google Calendar automatically using a
// Google Service Account (no login prompts — it authenticates as itself).
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
//   GOOGLE_CALENDAR_ID           = usually just your Gmail address, e.g.
//                                   ahmedsolimankhalil33@gmail.com

const { google } = require('googleapis');

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
      pickup, dropoff, dateTime, phone, notes,
      passengers, carSeats, flight, drink, elderly, contact15,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff || !dateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const start = new Date(dateTime);
    const end = new Date(start.getTime() + 45 * 60000); // default 45-minute block

    const descLines = [
      `Customer phone: ${phone}`,
      `Passengers: ${passengers || 'N/A'}`,
      `Car seats needed: ${carSeats && carSeats !== '0' ? carSeats : 'None'}`,
      `Elderly assistance needed: ${elderly ? 'Yes' : 'No'}`,
      flight ? `Flight: ${flight}` : null,
      drink ? `Drink preference: ${drink}` : null,
      `Text/call 15 min before pickup: ${contact15 ? 'Yes' : 'No'}`,
      `Notes: ${notes || 'None'}`,
    ].filter(Boolean);

    const calendar = await getCalendarClient();
    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `EconomyElite ride: ${pickup} → ${dropoff}`,
        description: descLines.join('\n'),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
