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
  // Airport/Manhattan zones check BOTH pickup and dropoff (the airport
  // could be either end of the trip — a drop-off or a pickup on the way
  // home). The local-town zone checks the drop-off ONLY: the pickup is
  // almost always a local town too (that's the home base), so matching it
  // there would call nearly every trip "local" regardless of where it's
  // actually going.
  zones: [
    { label: 'Newark Liberty Airport (EWR)', base: 70, field: 'combined', test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
    { label: 'Manhattan / New York City', base: 145, ny: true, field: 'combined', test: /\bmanhattan\b|\bnew york,?\s*ny\b|\bnyc\b/i },
    { label: 'LaGuardia Airport (LGA)', base: 180, ny: true, field: 'combined', test: /\blaguardia\b|\blga\b/i },
    { label: 'JFK Airport', base: 200, ny: true, field: 'combined', test: /\bjfk\b|\bkennedy\s*airport\b/i },
    { label: 'Local (Berkeley Heights, Summit, Chatham, Millburn, Short Hills, Springfield, New Vernon, New Providence)', local: true, field: 'dropoff', test: /\b(berkeley heights|summit|chatham|millburn|short hills|springfield|new vernon|new providence)\b/i },
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
// and dateTime decides whether the overnight fee applies.
function estimateFare(pickup, dropoff, vehicle, dateTime) {
  const combined = `${pickup || ''} ${dropoff || ''}`;
  const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';
  const overnight = isOvernightPickup(dateTime) ? OVERNIGHT_FEE : 0;
  const overnightNote = overnight ? ` + $${overnight} overnight` : '';

  for (const zone of FARES.zones) {
    const haystack = zone.field === 'dropoff' ? (dropoff || '') : combined;
    if (!zone.test.test(haystack)) continue;

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
        total: null,
        totalDisplay: `$${lo + overnight}–${hi + overnight} flat (all-inclusive)${overnightNote}`,
        tipSuggested: Math.round((((lo + hi) / 2) + overnight) * 0.2),
        display: `$${lo + overnight}–${hi + overnight} flat (local, all-inclusive)${overnightNote}`,
      };
    }

    const fees = vehicleFeesFor(zone, isSedan);
    const vehicleFee = fees.suvFee || fees.suvFeeNy || fees.sedanFeeNy || 0;
    const total = zone.base + vehicleFee + overnight;

    const parts = [`$${zone.base} base`];
    if (fees.suvFee) parts.push(`$${fees.suvFee} SUV`);
    if (fees.suvFeeNy) parts.push(`$${fees.suvFeeNy} New York (SUV)`);
    if (fees.sedanFeeNy) parts.push(`$${fees.sedanFeeNy} New York (sedan)`);
    if (overnight) parts.push(`$${overnight} overnight`);

    return {
      matched: true,
      label: zone.label,
      newYork: Boolean(zone.ny),
      base: zone.base,
      suvFee: fees.suvFee,
      suvFeeNy: fees.suvFeeNy,
      sedanFeeNy: fees.sedanFeeNy,
      overnightFee: overnight || null,
      total,
      totalDisplay: `$${total}`,
      tipSuggested: Math.round(total * 0.2),
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
