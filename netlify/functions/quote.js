// A price, asked for and given, with nothing written down.
//
// WHY THIS EXISTS. The fare has always been worked out on this server - but
// only ever inside log-booking, which means the only way a customer could
// learn what their ride cost was to hand over their name and phone number
// first and be told a figure afterwards. On a page whose whole argument is
// that nothing is hidden and nothing is added at the end, that was the one
// place the argument stopped being true.
//
// So: the same calculation, reachable before the booking. The customer puts
// in where they are going and gets the number back. If they don't like it
// they close the tab and we never knew they were here, which is the honest
// cost of doing it this way and worth paying.
//
// It writes nothing. No sheet row, no calendar entry, no customer profile,
// no email. Asking a price is not a booking and must never leave a trace
// that looks like one - a quote that created a row would fill the dispatch
// board with rides nobody asked for.
const { estimateFare } = require('./_fare-calc');
const { FIRST_RIDE_CREDIT } = require('./_loyalty');

// Hours are an input to the price, not a correction of one - same shape the
// booking function uses, so the two can never drift apart and quote a
// customer one number here and a different one when they book.
function withHours(overrides, hours) {
  const base = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  return (hours === 0 || hours) ? Object.assign({}, base, { hours }) : base;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pickup, dropoff, dateTime, vehicle, payMethod, hours, firstRide } =
      JSON.parse(event.body || '{}');

    if (!pickup || !dropoff) {
      return { statusCode: 200, body: JSON.stringify({ matched: false, reason: 'need both ends' }) };
    }

    // Somebody we have never driven sees the $10 already off, rather than a
    // full price here and a different number at the end of the form. The
    // page knows they are new because get-customer told it so; log-booking
    // checks the sheet again before it writes anything down.
    const firstRideOff = firstRide ? { discount: FIRST_RIDE_CREDIT } : undefined;
    const fare = estimateFare(pickup, dropoff, vehicle, dateTime, payMethod,
                              withHours(firstRideOff, hours));

    // Only the figures a quote is made of. Nothing about zones, nothing about
    // how the table decides - the customer is owed their price, not ours.
    if (!fare || !fare.matched) {
      return { statusCode: 200, body: JSON.stringify({ matched: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        matched: true,
        fare: fare.fare,
        toll: fare.toll || 0,
        cardFee: fare.cardFee || 0,
        cardFeeLabel: fare.cardFeeLabel || null,
        total: fare.total,
        tipSuggested: fare.tipSuggested || null,
        firstRideOff: fare.discountApplied || 0,
      }),
    };
  } catch (err) {
    // A quote that fails is a quote not shown, never a booking that breaks.
    return { statusCode: 200, body: JSON.stringify({ matched: false }) };
  }
};
