// Internal fare estimator — NOT shown to customers anywhere. Matches the
// pickup/drop-off text against known routes from the internal Fare Ledger
// and returns an itemized starting breakdown for the owner to confirm.
// Every fare is still confirmed with the customer directly before a ride
// is locked in; this just saves having to look the numbers up by hand.
//
// To change a rate, edit FARES or the two fee constants below — nothing
// else needs to change.
//
// Toll and waiting/late-pickup charges can't be known until the ride
// actually happens (they depend on the real route and real traffic), so
// they're never calculated here — they're filled in by hand afterwards.

const SUV_FEE = 35;

// Extra charge for a pickup between 12:00 AM and 5:59 AM. Set by Ahmed.
// Change this one number to change it everywhere — the fare total, the
// suggested tip, the owner email, the calendar event and the sheet all
// read from here.
const OVERNIGHT_FEE = 10;

const FARES = {
  hourlyRate: 60,       // $/hr, 2-hr minimum, all-inclusive (SUV included)
  localRange: [25, 35], // flat, nearby towns, all-inclusive (same either vehicle)

  // Order matters — first match wins. Keep specific airports above the
  // broader "local" list so e.g. "Newark, NJ" doesn't get caught by a
  // generic New Jersey pattern. `base` is the sedan fare; SUV adds
  // SUV_FEE on top of it.
  //
  // Airport/Manhattan zones check BOTH pickup and dropoff (the airport
  // could be either end of the trip — a drop-off or a pickup on the way
  // home). The local-town zone checks the drop-off ONLY: the pickup is
  // almost always a local town too (that's the home base), so matching it
  // there would call nearly every trip "local" regardless of where it's
  // actually going.
  zones: [
    { label: 'Newark Liberty Airport (EWR)', base: 70, field: 'combined', test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
    { label: 'Manhattan / New York City', base: 145, field: 'combined', test: /\bmanhattan\b|\bnew york,?\s*ny\b|\bnyc\b/i },
    { label: 'LaGuardia Airport (LGA)', base: 180, field: 'combined', test: /\blaguardia\b|\blga\b/i },
    { label: 'JFK Airport', base: 200, field: 'combined', test: /\bjfk\b|\bkennedy\s*airport\b/i },
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

// pickup/dropoff pick the route, vehicle decides whether the SUV fee
// applies, and dateTime decides whether the overnight fee applies.
function estimateFare(pickup, dropoff, vehicle, dateTime) {
  const combined = `${pickup || ''} ${dropoff || ''}`;
  const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';
  const suvFeeForVehicle = isSedan ? 0 : SUV_FEE;
  const overnightFee = isOvernightPickup(dateTime) ? OVERNIGHT_FEE : 0;
  const overnightNote = overnightFee ? ` + $${overnightFee} overnight` : '';

  for (const zone of FARES.zones) {
    const haystack = zone.field === 'dropoff' ? (dropoff || '') : combined;
    if (!zone.test.test(haystack)) continue;

    // Local trips are quoted as an all-inclusive range rather than a
    // single number, so there's no base/SUV split to report — but the
    // overnight fee still stacks on top of the range.
    if (zone.local) {
      const [lo, hi] = FARES.localRange;
      return {
        matched: true,
        label: zone.label,
        base: null,
        suvFee: null,
        overnightFee,
        total: null,
        totalDisplay: `$${lo + overnightFee}–${hi + overnightFee} flat (all-inclusive)${overnightNote}`,
        tipSuggested: Math.round((((lo + hi) / 2) + overnightFee) * 0.2),
        display: `$${lo + overnightFee}–${hi + overnightFee} flat (local, all-inclusive)${overnightNote}`,
      };
    }

    const total = zone.base + suvFeeForVehicle + overnightFee;
    const parts = [`$${zone.base} base`];
    if (suvFeeForVehicle) parts.push(`$${suvFeeForVehicle} SUV`);
    if (overnightFee) parts.push(`$${overnightFee} overnight`);

    return {
      matched: true,
      label: zone.label,
      base: zone.base,
      suvFee: suvFeeForVehicle,
      overnightFee,
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
    base: null,
    suvFee: null,
    overnightFee,
    total: null,
    totalDisplay: '',
    tipSuggested: null,
    display: `No route match — quote from the Fare Ledger, or $${FARES.hourlyRate}/hr (2-hr min) if it's not a known route.${overnightNote}`,
  };
}

module.exports = { estimateFare, isOvernightPickup, FARES, SUV_FEE, OVERNIGHT_FEE };
