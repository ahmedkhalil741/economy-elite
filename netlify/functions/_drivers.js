// The drivers who can be assigned a ride.
//
// WHY THIS ISN'T A LIST IN THE CODE: this repository is on GitHub, and a
// driver's mobile number and personal email are not ours to publish. The list
// lives in a Netlify environment variable called DRIVERS instead, as JSON:
//
//   [{"key":"hany","name":"Hany","phone":"9084949256","email":"hany@standardnj.com"},
//    {"key":"sam","name":"Sam","phone":"9085550101","email":"sam@example.com"}]
//
// key    a short id used in URLs and the sheet. lowercase, no spaces.
// name   what appears on the ride sheet and in the calendar entry.
// phone  digits only is fine; it's cleaned up before use.
// email  where the ride sheet is sent. Optional — without it the driver can
//        still be assigned and texted, he just won't get the email.
//
// Adding a driver is editing that variable and redeploying. Nothing else.

function cleanPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function prettyPhone(raw) {
  const d = cleanPhone(raw);
  if (d.length !== 10) return String(raw || '');
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function allDrivers() {
  let parsed;
  try {
    parsed = JSON.parse(process.env.DRIVERS || '[]');
  } catch (err) {
    // A typo in the variable shouldn't take the dispatch page down with a
    // stack trace — it should say plainly that the list is unreadable.
    throw new Error('The DRIVERS setting is not valid JSON. Check it in Netlify.');
  }
  if (!Array.isArray(parsed)) throw new Error('The DRIVERS setting must be a list, e.g. [{"key":"hany",...}]');

  return parsed
    .filter((d) => d && d.name)
    .map((d) => ({
      key: String(d.key || d.name).trim().toLowerCase().replace(/\s+/g, '-'),
      name: String(d.name).trim(),
      phone: cleanPhone(d.phone),
      phoneDisplay: prettyPhone(d.phone),
      email: String(d.email || '').trim(),
    }));
}

function findDriver(key) {
  const wanted = String(key || '').trim().toLowerCase();
  return allDrivers().find((d) => d.key === wanted || d.name.toLowerCase() === wanted) || null;
}

module.exports = { allDrivers, findDriver, cleanPhone, prettyPhone };
