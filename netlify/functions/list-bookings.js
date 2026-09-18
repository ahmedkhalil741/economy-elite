// The upcoming rides, for the dispatch page.
//
// This hands back customer names, phone numbers and home addresses, so unlike
// every other function here it will not answer without a token. The PIN box on
// admin-booking.html is only a cover on a door — anyone who reads the page
// source can walk past it. A token checked HERE cannot be read out of the page.
//
// Netlify environment variable required:
//   ADMIN_TOKEN = any long random string you like. Treat it as a password.
//
// With ADMIN_TOKEN unset this function refuses every request rather than
// defaulting to open, because the failure nobody notices is the dangerous one.

const { google } = require('googleapis');
const { readTab, rowToObject } = require('./_sheet');
const { parseRequestedDateTime, easternToInstant } = require('./_format');
const { allDrivers } = require('./_drivers');
const L = require('./_loyalty');

const SHEET_TAB = 'Bookings';
const CUSTOMERS_TAB = 'Customers';

// WHAT THIS PAGE IS FOR decides what it shows. There are exactly two reasons
// to open it: to give a ride to a driver, and to mark one finished afterwards.
// Both of those live in a narrow window around today. A booking three months
// out needs nothing from anybody yet, and showing it from the day it is made
// just means scrolling past next month to find tonight.
//
// So the default window is yesterday to a week ahead, and `days=all` widens it
// to everything upcoming when you actually want to look further out.
const LOOK_BACK_HOURS = 30;      // yesterday, so last night's rides can still be marked
const DEFAULT_DAYS_AHEAD = 7;

exports.handler = async function (event) {
  const token = (event.queryStringParameters || {}).token || '';
  const expected = process.env.ADMIN_TOKEN || '';

  if (!expected) {
    return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify. Set it, redeploy, and this page will work.' }) };
  }
  if (token !== expected) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };
  }

  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    const { headers, keys, rows } = await readTab(sheets, process.env.GOOGLE_SHEET_ID, SHEET_TAB);

    const daysParam = (event.queryStringParameters || {}).days || '';
    const showAll = String(daysParam).toLowerCase() === 'all';
    const daysAhead = /^\d+$/.test(daysParam) ? Number(daysParam) : DEFAULT_DAYS_AHEAD;

    const cutoff = Date.now() - LOOK_BACK_HOURS * 3600 * 1000;
    // Measured to the END of the last day, not to this moment plus N days.
    // "Today" asked at 10am must still include tonight's 9pm airport run,
    // which "now + 24 hours" would happen to catch and "now + 1 day" at 11pm
    // would not.
    const endOfToday = easternToInstant(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T23:59'
    );
    const horizon = showAll
      ? Infinity
      : endOfToday.getTime() + Math.max(0, daysAhead - 1) * 86400 * 1000;

    // Who each customer is, so every reservation carries their standing —
    // Ahmed's spec point 6. A missing Customers tab must not take the
    // dispatch page down with it.
    const byPhone = new Map();
    let customerColumns = [];
    try {
      const cust = await readTab(sheets, process.env.GOOGLE_SHEET_ID, CUSTOMERS_TAB);
      customerColumns = cust.headers;
      const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
      for (const row of cust.rows) {
        const c = rowToObject(cust.keys, row);
        const key = digits(c.phone);
        if (!key) continue;
        const points = parseInt(c.lifetime_points, 10) || 0;
        const completedRides = parseInt(c.completed_rides, 10) || 0;
        const status = L.statusFor(points, c.status);
        // Never ridden yet is not the same as gone quiet.
        const activity = completedRides === 0 ? '—' : L.activityFor(c.last_ride);
        byPhone.set(key, {
          status, activity, points, completedRides,
          creditOwed: parseFloat(c.credit_owed) || 0,
          firstRide: c.first_ride || '', lastRide: c.last_ride || '',
          standing: L.standingLine({ name: c.name, status, activity, points, completedRides }),
        });
      }
    } catch (err) {
      // leave byPhone empty; the rides still list
    }

    const rides = rows
      .map((row, i) => {
        const r = rowToObject(keys, row);
        const dateTime = parseRequestedDateTime(r.requested_datetime);
        return {
          rowNumber: i + 2,                 // 1 for the header, 1 because sheets count from 1
          dateTime,
          when: r.requested_datetime || '',
          name: r.name || '', phone: r.phone || '',
          pickup: r.pickup || '', dropoff: r.dropoff || '',
          vehicle: r.vehicle || r.car_type || '', passengers: r.passengers || '',
          carSeats: r.car_seats || '', flight: r.flight || '',
          temp: r.cabin_temp || '', elderly: r.elderly_assistance || '',
          notes: r.notes || '', payMethod: r.payment_method || '',
          fare: r.fare_total || '', driver: r.driver || '',
          // Ahmed's page, not the driver's — the driver gets a text with the
          // total to collect and nothing else. Showing the zone and any
          // discount here is also the only way to see, without opening the
          // sheet, that those columns are actually receiving values.
          zone: r.zone || '',
          discount: r.discount && r.discount !== 'N/A' ? r.discount : '',
          discountReason: r.discount_reason && r.discount_reason !== 'N/A' ? r.discount_reason : '',
          discountSpent: r.discount_spent && r.discount_spent !== 'N/A' ? r.discount_spent : '',
          email: r.email || '',
          rideStatus: r.ride_status || '',
          customer: byPhone.get(String(r.phone || '').replace(/\D/g, '').slice(-10)) || null,
        };
      })
      .filter((r) => r.pickup && r.dropoff)
      // Undated rows stay in — better a ride you have to look at than one that
      // silently vanished because its date cell was typed by hand.
      // `dateTime` is Eastern wall-clock. Sticking a Z on it calls it UTC and
      // shrinks this six-hour look-back to two — a ride the driver is on RIGHT
      // NOW then vanishes off the dispatch page. easternToInstant is the only
      // correct way to turn a typed time into a real one.
      .filter((r) => {
        // A row with an unreadable date stays in whatever the window is —
        // better a ride you have to look at than one that silently vanished
        // because somebody typed its date by hand.
        if (!r.dateTime) return true;
        const t = (easternToInstant(r.dateTime) || new Date(0)).getTime();
        return t > cutoff && t < horizon;
      })
      // Anything already finished or called off drops to the bottom. It is
      // still there to look at or undo, just not in the way of the rides that
      // still need something doing.
      .sort((a, b) => {
        const done = (r) => /^(completed|cancelled|no-?show)$/i.test(String(r.rideStatus || '').trim()) ? 1 : 0;
        const byDone = done(a) - done(b);
        if (byDone) return byDone;
        return String(a.dateTime || '').localeCompare(String(b.dateTime || ''));
      });

    // How many are outside the window, so the page can offer to show them
    // rather than pretending they don't exist.
    const beyond = showAll ? 0 : rows.reduce((n, row) => {
      const r = rowToObject(keys, row);
      if (!r.pickup || !r.dropoff) return n;
      const dt = parseRequestedDateTime(r.requested_datetime);
      if (!dt) return n;
      const t = (easternToInstant(dt) || new Date(0)).getTime();
      return (t >= horizon) ? n + 1 : n;
    }, 0);

    // Is there somewhere to keep the credit ledger?
    let creditsTab = 'missing';
    try {
      const cr = await readTab(sheets, process.env.GOOGLE_SHEET_ID, 'Credits');
      creditsTab = cr.keys.length ? 'ok' : 'no header row';
    } catch (err) { creditsTab = 'missing'; }

    let drivers = [];
    let driversError = null;
    let driversSource = 'none';
    try {
      const dt = await readTab(sheets, process.env.GOOGLE_SHEET_ID, 'Drivers');
      driversSource = dt.keys.length ? 'sheet' : 'tab has no header row';
    } catch (err) { driversSource = process.env.DRIVERS ? 'netlify setting (no Drivers tab yet)' : 'none'; }
    try { drivers = await allDrivers(sheets); } catch (err) { driversError = err.message; }

    return {
      statusCode: 200,
      body: JSON.stringify({
        rides,
        beyond,
        window: showAll ? 'all' : `${daysAhead} days`,
        drivers,
        driversError,
        hasDriverColumn: keys.includes('driver'),
        hasRideStatusColumn: keys.includes('ride_status'),
        // what the sheet's header row actually says, so an empty field on the
        // dispatch card points at a missing column rather than a mystery
        sheetColumns: headers,
        customerColumns,
        creditsTab,
        // Where the dropdown's names came from, so an empty dropdown points at
        // a missing tab rather than looking like a bug.
        driversFrom: driversSource,
        // Named so a blank field on a card points at a missing column instead
        // of being a mystery — the same mistake has cost hours twice already.
        missingColumns: {
          bookings: ['driver', 'ride_status', 'passengers', 'car_seats', 'elderly_assistance', 'email', 'referred_by']
            .filter((k) => !keys.includes(k)),
          customers: ['email', 'completed_rides', 'lifetime_points', 'activity', 'credit_owed', 'credit_history', 'referred_by', 'birthday', 'car_seats']
            .filter((k) => !customerColumns.map((h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_')).includes(k)),
        },
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
