// Finding the calendar entry for a ride, in one place.
//
// This logic was written once inside assign-driver and is now needed by
// anything that changes a booking after the fact. Two copies would drift, and
// the failure when they drift is silent: the wrong event gets edited and
// everything reports success.
//
// MATCHING IS DELIBERATELY STRICT. An earlier version matched on the first 20
// characters of the pickup with an OR, and it picked the wrong event whenever
// two rides left the same street, whenever Newark "Terminal B" met "Terminal
// C", and whenever a short pickup like "Summit, NJ" appeared as somebody
// else's DROP-OFF. Now the start time has to be the same minute and both ends
// have to appear. More than one match is reported rather than silently picked.

const { google } = require('googleapis');
const { easternToInstant } = require('./_format');

const SEARCH_WINDOW_MINUTES = 90;

async function calendarClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  await auth.authorize();
  return google.calendar({ version: 'v3', auth });
}

// Returns { event, calendar, note }. `event` is null when nothing matched or
// when more than one did — `note` says which, in words meant for a person.
async function findRideEvent({ pickup, dropoff, dateTime }) {
  const calendar = await calendarClient();

  // The pickup time is Eastern wall-clock; the API wants a real instant.
  // Converting is not optional — searching 22:39 UTC for an event at 22:39
  // Eastern misses it by four hours, silently, every time.
  const pivot = easternToInstant(dateTime);
  if (!pivot) return { event: null, calendar, note: 'that ride has no readable date' };

  const list = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: new Date(pivot.getTime() - SEARCH_WINDOW_MINUTES * 60000).toISOString(),
    timeMax: new Date(pivot.getTime() + SEARCH_WINDOW_MINUTES * 60000).toISOString(),
    singleEvents: true,
    maxResults: 50,
  });

  const want = pivot.getTime();
  const hits = (list.data.items || []).filter((e) => {
    const hay = `${e.summary || ''} ${e.description || ''}`;
    if (!hay.includes(pickup) || !hay.includes(dropoff)) return false;
    const started = e.start && (e.start.dateTime || e.start.date);
    return started ? Math.abs(new Date(started).getTime() - want) < 60000 : false;
  });

  if (!hits.length) return { event: null, calendar, note: 'no matching calendar entry found' };
  if (hits.length > 1) {
    return { event: null, calendar, note: `${hits.length} identical entries at that time — fix them on the calendar first` };
  }
  return { event: hits[0], calendar, note: null };
}

module.exports = { calendarClient, findRideEvent, SEARCH_WINDOW_MINUTES };
