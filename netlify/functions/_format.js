// Small date/time formatting helpers, shared by the booking-notification
// email and the Google Sheet log, so nobody has to read raw ISO strings
// like "2026-09-13T15:38:28.309Z" to figure out what time something was.

// Formats the value of a <input type="datetime-local"> field, e.g.
// "2026-09-13T11:38" -> "Sat, Sep 13, 2026 · 11:38 AM". No timezone
// conversion — that raw value is already the customer's own local wall-clock
// time with no zone attached, so we just format it as written.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatRequestedDateTime(dateTimeLocal) {
  if (!dateTimeLocal) return 'Not specified';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal);
  if (!m) return dateTimeLocal; // fall back to raw value if it's not the shape we expect
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour24 = Number(m[4]), minute = Number(m[5]);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayName = DAYS[dateObj.getUTCDay()];
  const monthName = MONTHS[month - 1];
  const hour12 = ((hour24 + 11) % 12) + 1;
  const ampm = hour24 < 12 ? 'AM' : 'PM';
  const minuteStr = String(minute).padStart(2, '0');
  return `${dayName}, ${monthName} ${day}, ${year} · ${hour12}:${minuteStr} ${ampm}`;
}

// Formats a full ISO UTC timestamp (e.g. from `new Date().toISOString()`)
// into Eastern time, human-readable, no milliseconds.
function formatTimestamp(isoUtc) {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return isoUtc;
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' ET';
}

// Shifts a <input type="datetime-local"> value by a number of minutes and
// hands it back in the same naive "YYYY-MM-DDTHH:mm:ss" shape — no timezone
// attached, no conversion. Used to build a calendar event's start and end
// from the time the customer actually typed.
//
// Why not just `new Date(value)`: on a server running in UTC (which Netlify
// is), Node reads a zone-less datetime string as UTC, so "11:38" becomes
// 11:38 UTC = 7:38 AM Eastern. Keeping the string naive and passing the
// timezone separately to Google is what preserves the intended wall-clock
// time. The Date.UTC below is only calendar arithmetic (so month and day
// rollovers work), never a real instant.
//
// On the two DST changeover days a year this can land on a wall-clock time
// that doesn't exist locally; Google Calendar resolves that on its end.
function shiftLocalDateTime(dateTimeLocal, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal || '');
  if (!m) return null;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const d = new Date(base + minutes * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

// Today's date where the business actually operates, as both a plain
// "2026-09-13" and the "2026-09" it belongs to. Used for the customer
// records, so a ride booked at 11pm Eastern counts toward that day and that
// month rather than tomorrow's (the server's clock runs on UTC).
function easternToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  const year = get('year'), month = get('month'), day = get('day');
  return { date: `${year}-${month}-${day}`, yearMonth: `${year}-${month}` };
}

// The reverse of formatRequestedDateTime. The sheet stores the pickup as
// "Fri, Sep 25, 2026 · 6:30 AM", which is the right thing for a human reading
// a spreadsheet and the wrong thing for sorting or for handing back to the
// fare calculator. This turns it back into "2026-09-25T06:30".
function parseRequestedDateTime(display) {
  const m = /([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}).*?(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(display || ''));
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (month === -1) return null;
  let hour = Number(m[4]) % 12;
  if (/PM/i.test(m[6])) hour += 12;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(month + 1)}-${pad(Number(m[2]))}T${pad(hour)}:${m[5]}`;
}

// Eastern is UTC-5, or UTC-4 while daylight saving is on. Rather than ship a
// timezone database, ask Intl what the offset actually is on that date.
function easternOffsetMinutes(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(date).find((p) => p.type === 'timeZoneName').value; // "GMT-4"
  const m = /GMT([+-]\d+)/.exec(name);
  return m ? Number(m[1]) * 60 : -300;
}

// A naive Eastern wall-clock string ("2026-09-17T22:39") as a real instant.
//
// BUG ONE (fixed): searching for an event at "22:39 UTC" when it sits at
// "22:39 Eastern" misses it by four hours. Anything comparing a typed time
// against a real timestamp has to come through here.
//
// BUG TWO (fixed): asking for the offset at the naive-as-UTC instant reads it
// four or five hours early, which lands on the WRONG SIDE of a daylight-saving
// change twice a year. On 8 March 2026 every pickup between about 03:00 and
// 07:00 came out an hour wrong — which is exactly the early airport run. So
// the offset is applied, then re-read at the corrected instant and applied
// again if it disagrees.
function easternToInstant(dateTimeLocal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(dateTimeLocal || ''));
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);

  const first = easternOffsetMinutes(new Date(naive));
  let instant = new Date(naive - first * 60000);
  const second = easternOffsetMinutes(instant);
  if (second !== first) instant = new Date(naive - second * 60000);
  return instant;
}


// ---- A BIRTHDAY THE SHEET CANNOT TURN INTO A NUMBER ----
//
// The booking form asks for a birthday and says "e.g. March 14", so people
// type March 14, 3/14, 09-20, or their whole date of birth. Whatever arrives
// used to go into the cell as typed, and Google Sheets did what Google Sheets
// does: it read a date and stored a day-count from 1899. Two customers ended
// up with 46235 and 33480 in that column - perfectly correct as dates, and
// unreadable to the code that has to find a month and a day in them. The
// birthday reward then never fires for those people, and nothing says so.
//
// So the value is normalised to MM-DD and written with a LEADING APOSTROPHE,
// which is what tells Sheets to leave a cell alone. The apostrophe never
// shows; the two numbers stay two numbers.
//
// THE YEAR IS THROWN AWAY ON PURPOSE. A car service has no business holding a
// customer's age, nothing in this codebase reads it, and a birth year sitting
// in a spreadsheet is a liability rather than a feature.
// MONTHS is already declared at the top of this file, three-letter and
// capitalised. Reused here rather than shadowed.
function monthDay(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // "March 14", "14 March", "Mar 14th"
  const named = MONTHS.findIndex((m) => new RegExp('\\b' + m, 'i').test(text));
  if (named !== -1) {
    // No \b after the digits: "Mar 14th" has no word boundary between the
    // 4 and the t, and "14th" is exactly how people write it.
    const day = (text.match(/(\d{1,2})/) || [])[1];
    if (day && +day >= 1 && +day <= 31) {
      return String(named + 1).padStart(2, '0') + '-' + String(+day).padStart(2, '0');
    }
    return null;
  }

  const nums = text.match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  let m, d;
  if (nums[0].length === 4 && nums.length >= 3) { m = +nums[1]; d = +nums[2]; }  // 1991-08-30
  else { m = +nums[0]; d = +nums[1]; }                                           // 9/20, 8-30-1991
  // Day first, the way much of the world writes it. There is no month 30, so
  // "30-09" can only mean the 30th of September and guessing is safe here.
  if (m > 12 && d <= 12) { const t = m; m = d; d = t; }
  if (!m || !d || m > 12 || d > 31) return null;
  return String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// What actually goes in the cell. Empty in, empty out; unreadable in, empty
// out - a birthday we cannot read is worse than none, because it looks filled.
function birthdayCell(raw) {
  const md = monthDay(raw);
  return md ? "'" + md : '';
}

// ---- A PHONE NUMBER THE SHEET CANNOT TURN INTO AN ERROR ----
//
// THE BUG THIS FIXES, 2026-10-25. Two rows in the Customers tab had #ERROR!
// in the phone column, and that one broken cell quietly switched the whole
// loyalty programme off for those two people:
//
//   * list-bookings skips any customer whose phone has no digits in it, so
//     they vanished from the Messages tab - no name to write to at all.
//   * set-ride-status looks the customer up by phone, found nobody, and
//     returned "No customer profile for that number yet", so marking the ride
//     Completed awarded no point, moved no counter and wrote no credit row.
//   * save-customer could not match them either, so the next booking would
//     have started a SECOND row for the same person.
//
// The cause is Google Sheets, not the number. A cell written with
// USER_ENTERED that begins with = + - or @ is a FORMULA, and "+1 203 506
// 1637" is not one it can parse, so the cell becomes #ERROR!. Typing a
// number with the country code in front - the ordinary way to write it - was
// enough to do it, whether from the booking form or by hand in the sheet.
//
// So nothing is ever written raw again. Ten digits come out as
// (203) 506-1637, which is readable, sorts the same, and starts with a
// bracket rather than a plus. Anything else keeps its characters but gets a
// leading apostrophe, the one thing that tells Sheets to leave a cell alone.
// Matching is unaffected either way: every lookup in this codebase strips the
// number down to its last ten digits before comparing.
// AHMED'S CHOICE, 2026-10-25: ten plain digits, 9084949256, the way he types
// them. So this does not reformat anything - it only stops the spreadsheet
// turning the cell into something the code cannot read.
//
// The leading apostrophe is the whole trick. It makes the cell TEXT, which
// means: no formula (a number typed with + in front is read as one and
// becomes #ERROR!), and no scientific notation (a 10-digit number in a column
// Sheets has decided is numeric can render as 9.08E+09). The apostrophe never
// shows on screen; the cell reads 9084949256, exactly as typed.
function phoneCell(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  // Ten digits, or eleven starting with the country code - same number.
  if (digits.length === 10) return "'" + digits;
  if (digits.length === 11 && digits[0] === '1') return "'" + digits.slice(1);
  // An extension, an international number, a note - keep every character and
  // just stop the spreadsheet reading it as arithmetic.
  return "'" + text;
}

module.exports = { monthDay, birthdayCell, phoneCell, easternOffsetMinutes, easternToInstant, formatRequestedDateTime, parseRequestedDateTime, formatTimestamp, shiftLocalDateTime, easternToday };
