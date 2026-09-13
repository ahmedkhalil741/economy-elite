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

module.exports = { formatRequestedDateTime, formatTimestamp };
