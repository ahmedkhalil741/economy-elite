// Internal fare estimator — NOT shown to customers anywhere. Matches the
// pickup/drop-off text against known routes from the internal Fare Ledger
// and returns an itemized starting breakdown for the owner to confirm.
// Every fare is still confirmed with the customer directly before a ride
// is locked in; this just saves having to look the numbers up by hand.
//
// To change a rate, edit FARES or the fee constants below — nothing else
// needs to change. The fares flow from here into the owner email, the
// calendar event and the Bookings sheet.
//
// ---- THE VEHICLE FEE ----
// Exactly ONE vehicle fee ever applies to a trip, and which one depends on
// where it goes:
//
//   Trip                     SUV              Sedan
//   New Jersey (EWR, local)  SUV_FEE  ($35)   nothing
//   New York (Manhattan,     SUV_FEE_NY ($50) SEDAN_FEE_NY ($35)
//     LGA, JFK)
//
// The New York fee REPLACES the standard SUV fee rather than stacking on
// it — a Manhattan SUV run is base + $50, not base + $35 + $50. Whichever
// fee doesn't apply comes back as null, which the sheet writes as "N/A".
//
// Toll and waiting/late-pickup charges can't be known until the ride
// actually happens, so they're never calculated here.

const { cardFeeFor } = require('./_card-fee');

const SUV_FEE = 35;       // SUV, New Jersey trips
const SUV_FEE_NY = 50;    // SUV, New York trips — replaces SUV_FEE
const SEDAN_FEE_NY = 35;  // Sedan, New York trips (sedans pay nothing in NJ)

// Extra charge for a pickup between 12:00 AM and 5:59 AM. Set by Ahmed.
const OVERNIGHT_FEE = 10;

const FARES = {
  hourlyRate: 60,       // $/hr, 2-hr minimum, all-inclusive
  localRange: [25, 35], // flat, nearby towns, all-inclusive (same either vehicle)

  // Order matters — first match wins. Keep specific airports above the
  // broader "local" list so e.g. "Newark, NJ" doesn't get caught by a
  // generic New Jersey pattern. `base` is the fare before any vehicle fee.
  // `ny: true` marks the destinations that sit in New York and therefore
  // carry the New York vehicle fee.
  //
  // `field` says which part of the trip the pattern is tested against:
  //
  //   'combined'  -> matches if EITHER end mentions it. Right for airports
  //                  and Manhattan, which can be the drop-off or the pickup
  //                  on the way home.
  //   'bothEnds'  -> matches only if BOTH ends match. Right for the local
  //                  flat rate, which is a price for going between nearby
  //                  towns and nothing else.
  //
  // The local zone used to test the DROP-OFF ONLY, on the assumption that
  // the pickup was always a local town anyway. That assumption was wrong
  // and it cost money: a booking from New Rochelle, NY to New Providence,
  // NJ — about 35 miles across two states — matched "new providence" on the
  // drop-off and was quoted $25–35 all-inclusive. Any long trip ENDING in a
  // local town was underpriced the same way. Both ends must match now.
  zones: [
    { label: 'Newark Liberty Airport (EWR)', base: 70, field: 'combined', test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
    { label: 'Manhattan / New York City', base: 145, ny: true, field: 'combined', test: /\bmanhattan\b|\bnew york,?\s*ny\b|\bnyc\b/i },
    { label: 'LaGuardia Airport (LGA)', base: 180, ny: true, field: 'combined', test: /\blaguardia\b|\blga\b/i },
    { label: 'JFK Airport', base: 200, ny: true, field: 'combined', test: /\bjfk\b|\bkennedy\s*airport\b/i },
    { label: 'Local (Berkeley Heights, Summit, Chatham, Millburn, Short Hills, Springfield, New Vernon, New Providence)', local: true, field: 'bothEnds', test: /\b(berkeley heights|summit|chatham|millburn|short hills|springfield|new vernon|new providence)\b/i },
  ],
};

// Requested pickup time falls between 12:00 AM and 5:59 AM -> overnight.
// dateTimeLocal is the raw value of an <input type="datetime-local">,
// e.g. "2026-09-13T02:15" — already the customer's own local wall-clock
// time, so no timezone conversion here (matches _format.js).
function isOvernightPickup(dateTimeLocal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal || '');
  if (!m) return false;
  const hour = Number(m[4]);
  return hour >= 0 && hour < 6;
}

// Decides whether a trip falls in a zone. See the `field` notes on FARES.zones:
// 'bothEnds' needs the pattern to hit the pickup AND the drop-off, everything
// else needs it to hit either end.
function zoneMatches(zone, pickup, dropoff, combined) {
  if (zone.field === 'bothEnds') {
    return zone.test.test(pickup || '') && zone.test.test(dropoff || '');
  }
  if (zone.field === 'dropoff') return zone.test.test(dropoff || '');
  return zone.test.test(combined);
}

// Works out which single vehicle fee applies. Everything that doesn't
// apply comes back null so the sheet can write "N/A" rather than a
// misleading 0.
function vehicleFeesFor(zone, isSedan) {
  if (zone.ny) {
    return isSedan
      ? { suvFee: null, suvFeeNy: null, sedanFeeNy: SEDAN_FEE_NY }
      : { suvFee: null, suvFeeNy: SUV_FEE_NY, sedanFeeNy: null };
  }
  return isSedan
    ? { suvFee: null, suvFeeNy: null, sedanFeeNy: null }
    : { suvFee: SUV_FEE, suvFeeNy: null, sedanFeeNy: null };
}

// pickup/dropoff pick the route, vehicle decides which vehicle fee applies,
// dateTime decides whether the overnight fee applies, and payMethod decides
// the card fee that gets added on top (see _card-fee.js).
function estimateFare(pickup, dropoff, vehicle, dateTime, payMethod) {
  const combined = `${pickup || ''} ${dropoff || ''}`;
  const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';
  const overnight = isOvernightPickup(dateTime) ? OVERNIGHT_FEE : 0;
  const overnightNote = overnight ? ` + $${overnight} overnight` : '';

  for (const zone of FARES.zones) {
    if (!zoneMatches(zone, pickup, dropoff, combined)) continue;

    // Local trips are quoted as an all-inclusive range rather than a single
    // number, so there's no fee breakdown to report — but the overnight fee
    // still stacks on top of the range.
    if (zone.local) {
      const [lo, hi] = FARES.localRange;
      return {
        matched: true,
        label: zone.label,
        newYork: false,
        base: null,
        suvFee: null,
        suvFeeNy: null,
        sedanFeeNy: null,
        overnightFee: overnight || null,
        // A range has no single number to take a percentage of, so the card
        // fee is worked out once the exact fare is agreed.
        cardFee: null,
        cardFeeLabel: null,
        cardFeeRate: null,
        total: null,
        totalDisplay: `$${lo + overnight}–${hi + overnight} flat (all-inclusive)${overnightNote}`,
        tipSuggested: Math.round((((lo + hi) / 2) + overnight) * 0.2),
        display: `$${lo + overnight}–${hi + overnight} flat (local, all-inclusive)${overnightNote}`,
      };
    }

    const fees = vehicleFeesFor(zone, isSedan);
    const vehicleFee = fees.suvFee || fees.suvFeeNy || fees.sedanFeeNy || 0;

    // The fare for the ride itself, before anything the processor takes.
    const rideFare = zone.base + vehicleFee + overnight;
    // Ahmed passes the card fee on, so it's added to what the customer pays.
    const card = cardFeeFor(payMethod, rideFare);
    const total = Math.round((rideFare + (card ? card.amount : 0)) * 100) / 100;

    const parts = [`$${zone.base} base`];
    if (fees.suvFee) parts.push(`$${fees.suvFee} SUV`);
    if (fees.suvFeeNy) parts.push(`$${fees.suvFeeNy} New York (SUV)`);
    if (fees.sedanFeeNy) parts.push(`$${fees.sedanFeeNy} New York (sedan)`);
    if (overnight) parts.push(`$${overnight} overnight`);
    if (card) parts.push(`$${card.amount.toFixed(2)} ${card.label} fee`);

    return {
      matched: true,
      label: zone.label,
      newYork: Boolean(zone.ny),
      base: zone.base,
      suvFee: fees.suvFee,
      suvFeeNy: fees.suvFeeNy,
      sedanFeeNy: fees.sedanFeeNy,
      overnightFee: overnight || null,
      cardFee: card ? card.amount : null,
      cardFeeLabel: card ? card.label : null,
      cardFeeRate: card ? `${(card.rate * 100).toFixed(1)}% + $${card.fixed.toFixed(2)}` : null,
      rideFare,
      total,
      totalDisplay: `$${total.toFixed(2).replace(/\.00$/, '')}`,
      // The tip is on the ride, not on the processor's cut.
      tipSuggested: Math.round(rideFare * 0.2),
      display: parts.length > 1
        ? `$${total} flat (${parts.join(' + ')})`
        : `$${total} flat (sedan, no extras)`,
    };
  }

  return {
    matched: false,
    label: null,
    newYork: false,
    base: null,
    suvFee: null,
    suvFeeNy: null,
    sedanFeeNy: null,
    overnightFee: overnight || null,
    cardFee: null,
    cardFeeLabel: null,
    cardFeeRate: null,
    total: null,
    totalDisplay: '',
    tipSuggested: null,
    display: `No route match — quote from the Fare Ledger, or $${FARES.hourlyRate}/hr (2-hr min) if it's not a known route.${overnightNote}`,
  };
}

module.exports = {
  estimateFare,
  isOvernightPickup,
  FARES,
  SUV_FEE,
  SUV_FEE_NY,
  SEDAN_FEE_NY,
  OVERNIGHT_FEE,
};
