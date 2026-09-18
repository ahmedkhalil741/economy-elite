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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { statusCode: 503, body: JSON.stringify({ error: 'ADMIN_TOKEN is not set in Netlify.' }) };

  try {
    const { token, pickup, dropoff, vehicle, dateTime, payMethod, overrides } = JSON.parse(event.body || '{}');
    if (token !== expected) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong passcode.' }) };

    if (!pickup || !dropoff) {
      return { statusCode: 200, body: JSON.stringify({ ready: false, reason: 'Need both a pickup and a drop-off.' }) };
    }

    const fare = estimateFare(pickup, dropoff, vehicle, dateTime, payMethod, overrides);

    // The parts, so a price can be EXPLAINED on the phone rather than just
    // stated. "Seventy-five, plus thirty-five because it's the Suburban."
    const lines = [];
    if (fare.matched) {
      if (fare.agreedFare !== null && fare.agreedFare !== undefined) {
        lines.push(`$${fare.agreedFare} agreed with the customer`);
      } else if (fare.base) {
        lines.push(`$${fare.base} base fare`);
      }
      if (fare.suvFee) lines.push(`$${fare.suvFee} SUV`);
      if (fare.suvFeeNy) lines.push(`$${fare.suvFeeNy} SUV into New York`);
      if (fare.overnightFee) lines.push(`$${fare.overnightFee} overnight pickup`);
      // Said out loud, with a minus sign, because this line is for Ahmed and
      // for the customer. The driver never sees it — see _fare-calc.js.
      if (fare.discountApplied) lines.push(`\u2212 $${fare.discountApplied} discount`);
      if (fare.toll) lines.push(`$${fare.toll} tolls (estimated)`);
      if (fare.cardFee) lines.push(`$${fare.cardFee.toFixed(2)} ${fare.cardFeeLabel} fee (${fare.cardFeeRate})`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ready: true,
        matched: fare.matched,
        label: fare.label || null,
        total: fare.totalDisplay || null,
        display: fare.display,
        lines,
        tip: fare.tipSuggested,
        toll: fare.toll || 0,
        agreedFare: fare.agreedFare ?? null,
        discount: fare.discountApplied || 0,
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
            : (fare.agreedFare !== null && fare.agreedFare !== undefined
                ? fare.agreedFare
                : ((fare.base || 0) + (fare.suvFee || 0) + (fare.suvFeeNy || 0) + (fare.overnightFee || 0))),
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
