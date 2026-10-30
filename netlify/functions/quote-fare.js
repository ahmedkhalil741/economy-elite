// What a trip costs, without booking anything.
//
// The website deliberately never shows a price — the promise is that a real
// person confirms your fare before the car moves. But when Ahmed is ON the
// phone with somebody, he needs that number in front of him, and working it
// out from a 77-row table while a customer waits is not realistic.
//
// So this answers the same question the booking functions answer internally,
// and writes nothing. No sheet row, no calendar entry, no email. Ask it as
// many times as you like while the address is still being typed.
//
// It is token-gated because it reveals the whole pricing model, which is not
// public. Same ADMIN_TOKEN as dispatch.

const { estimateFare, isOvernightPickup, HOURLY_RATE } = require('./_fare-calc');
const { FIRST_RIDE_CREDIT } = require('./_loyalty');
const { firstRideAvailable } = require('./_first-ride');

// Hours are an input to the price, not a correction of one, so they travel
// alongside the overrides rather than inside the caller's object.
function withHours(overrides, hours) {
  const base = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  return (hours === 0 || hours) ? Object.assign({}, base, { hours }) : base;
}

// Stops ride alongside the overrides for the same reason hours do: they are a
// property of the trip, not a price somebody typed over.
function withStops(overrides, stops) {
  const base = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  const list = Array.isArray(stops) ? stops.filter((x) => String(x || '').trim()) : [];
  return list.length ? Object.assign({}, base, { stops: list }) : base;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  try {
    const { token, pickup, dropoff, vehicle, dateTime, payMethod, overrides, hours, firstRide,
            cardOnFile, phone, stops,
            returnDateTime, returnPickup, returnDropoff } = JSON.parse(event.body || '{}');
    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

    if (!pickup || !dropoff) {
      return { statusCode: 200, body: JSON.stringify({ ready: false, reason: 'Need both a pickup and a drop-off.' }) };
    }

    // THE PREVIEW HAS TO AGREE WITH WHAT GETS SAVED.
    //
    // log-booking takes $10 off a new customer's first ride by itself, but
    // this preview knew nothing about it. So the dispatch showed one total and
    // the sheet recorded another ten dollars lower — and the number Ahmed read
    // out to the customer was the one on the screen in front of him. Same
    // credit, same place in the arithmetic, so the two can never disagree.
    //
    // A discount already typed in wins: a loyalty balance being redeemed is
    // not also owed the new-customer ten.
    //
    // THE BROWSER NO LONGER DECIDES THIS. The dispatch used to send a
    // `firstRide` flag it worked out from completed_rides, and completed_rides
    // is still zero while an earlier booking sits unridden - so a customer's
    // outbound AND their return both came up ten dollars off, every time Ahmed
    // entered a round trip. The sheet answers it now, exactly as log-booking
    // does, so the quote on screen and the row that gets saved cannot disagree.
    // The flag is still accepted as a fallback for when no phone has been typed
    // in yet.
    const asked = withStops(withHours(overrides, hours), stops);
    const earned = phone ? await firstRideAvailable(phone) : Boolean(firstRide);
    const withCredit = (earned && !asked.discount)
      ? Object.assign({}, asked, { discount: FIRST_RIDE_CREDIT })
      : asked;

    // Same rule as log-booking: a saved card is quoted at the keyed rate, so
    // the screen Ahmed reads out and the row that gets saved cannot disagree.
    const payFor = (cardOnFile && /^card$/i.test(String(payMethod || '').trim()))
      ? 'Card on file' : payMethod;

    const fare = estimateFare(pickup, dropoff, vehicle, dateTime, payFor, withCredit);

    // ---- THE RETURN LEG ----
    //
    // Ahmed's rule, 30 October: "same price for both ways if same address; if
    // the round trip address is different just add the normal prices we have."
    // So each leg is priced on its own merits and the two are added. Nothing
    // clever, and nothing to explain to a customer beyond "there and back".
    //
    // THE TOLL IS CHARGED ONCE, which is his instruction too - "we already
    // charge the customer both ways for the tolls so no need for any
    // additional". The $29 to Manhattan has always covered the car going in
    // and coming back out; charging it on both legs would bill the same four
    // crossings twice. So leg two is priced with toll: 0.
    //
    // The $10 first ride is not re-applied either: it belongs to the first
    // booking, and firstRideAvailable() above has already decided whether this
    // customer still has it.
    let back = null;
    if (returnDateTime) {
      const bPick = (returnPickup || '').trim() || dropoff;
      const bDrop = (returnDropoff || '').trim() || pickup;
      back = estimateFare(bPick, bDrop, vehicle, returnDateTime, payFor, { toll: 0 });
      back.from = bPick;
      back.to = bDrop;
    }

    // The parts, so a price can be EXPLAINED on the phone rather than just
    // stated. "Seventy-five, plus thirty-five because it's the Suburban."
    const lines = [];
    if (fare.matched) {
      // Four lines, never more. The vehicle surcharge, the city premium and
      // the overnight charge all live inside the fare now — see _fare-calc.js
      // for why. Tolls and the card fee keep their own lines because Ahmed
      // does not set either one.
      const shown = fare.fareBeforeDiscount !== undefined && fare.fareBeforeDiscount !== null
        ? fare.fareBeforeDiscount
        : fare.fare;
      if (shown) lines.push(`$${shown} fare`);
      // Said out loud, with a minus sign, because this line is for Ahmed and
      // for the customer. The driver never sees it — see _fare-calc.js.
      if (fare.discountApplied) lines.push(`\u2212 $${fare.discountApplied} discount`);
      if (fare.toll) lines.push(`$${fare.toll} tolls`);
      if (fare.cardFee) lines.push(`$${fare.cardFee.toFixed(2)} ${fare.cardFeeLabel} fee (${fare.cardFeeRate})`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ready: true,
        matched: fare.matched,
        // Both legs, and what the pair comes to. Null on a one-way, so the
        // page can simply test for it.
        roundTrip: back ? {
          matched: back.matched,
          from: back.from,
          to: back.to,
          label: back.label || null,
          fare: back.fare,
          cardFee: back.cardFee || 0,
          total: back.total,
          totalDisplay: back.totalDisplay || null,
          tip: back.tipSuggested || 0,
          bothTotal: (fare.total !== null && back.total !== null)
            ? Math.round((fare.total + back.total) * 100) / 100
            : null,
          bothTip: (fare.tipSuggested || 0) + (back.tipSuggested || 0),
        } : null,
        label: fare.label || null,
        zone: fare.zone || null,
        total: fare.totalDisplay || null,
        display: fare.display,
        lines,
        tip: fare.tipSuggested,
        toll: fare.toll || 0,
        agreedFare: fare.agreedFare ?? null,
        discount: fare.discountApplied || 0,
        firstRideOff: (earned && !asked.discount) ? (fare.discountApplied || 0) : 0,
        // Asked for more than the fare could take — the rest stays on their
        // balance, and the page says so rather than quietly swallowing it.
        discountUnused: fare.discountUnused || 0,
        discountNote: fare.discountNote || null,
        // The parts, so the page can prefill an editable box per line.
        parts: {
          // The fare BEFORE the discount, because that is the box the discount
          // is subtracted from on screen. Showing the discounted figure there
          // would subtract it twice.
          fare: fare.fareBeforeDiscount !== undefined && fare.fareBeforeDiscount !== null
            ? fare.fareBeforeDiscount
            : (fare.fare || 0),
          discount: fare.discountApplied || 0,
          toll: fare.toll || 0,
          cardFee: fare.cardFee || 0,
        },
        overnight: isOvernightPickup(dateTime),
        hourlyRate: HOURLY_RATE,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
