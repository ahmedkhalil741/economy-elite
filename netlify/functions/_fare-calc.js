// Internal fare estimator — NOT shown to customers anywhere. Matches the
// pickup/drop-off text against known routes from the internal Fare Ledger
// and returns an itemized starting breakdown for the owner to confirm.
// Every fare is still confirmed with the customer directly before a ride
// is locked in; this just saves having to look the numbers up by hand.
//
// To change a rate, edit FARES below — nothing else needs to change.
//
// Toll and waiting/late-pickup charges can't be known until the ride
// actually happens (they depend on the real route and real traffic), so
// this only returns a suggested tip and the pre-ride numbers — base fare,
// the SUV line, and the flat total. Toll and waiting/late fee are left
// for the owner to fill in by hand after the ride, in the Sheet.

const SUV_FEE = 35;

const FARES = {
  hourlyRate: 60,       // $/hr, 2-hr minimum, all-inclusive (SUV included)
  localRange: [25, 35], // flat, nearby towns, all-inclusive

  // Order matters — first match wins. Keep specific airports above the
  // broader "local" list so e.g. "Newark, NJ" doesn't get caught by a
  // generic New Jersey pattern. `base` is the sedan-equivalent portion;
  // `base + SUV_FEE` is the flat total actually charged (the fleet is
  // SUV-only, so this is really one price — split out only so it can be
  // itemized on the internal breakdown).
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

function estimateFare(pickup, dropoff) {
  const combined = `${pickup || ''} ${dropoff || ''}`;

  for (const zone of FARES.zones) {
    const haystack = zone.field === 'dropoff' ? (dropoff || '') : combined;
    if (!zone.test.test(haystack)) continue;

    if (zone.local) {
      const [lo, hi] = FARES.localRange;
      return {
        matched: true,
        label: zone.label,
        base: null,
        suvFee: null,
        total: null,
        totalDisplay: `$${lo}–${hi} flat (all-inclusive)`,
        tipSuggested: Math.round(((lo + hi) / 2) * 0.2),
        display: `$${lo}–${hi} flat (local, all-inclusive)`,
      };
    }

    const total = zone.base + SUV_FEE;
    return {
      matched: true,
      label: zone.label,
      base: zone.base,
      suvFee: SUV_FEE,
      total,
      totalDisplay: `$${total}`,
      tipSuggested: Math.round(total * 0.2),
      display: `$${total} flat ($${zone.base} base + $${SUV_FEE} SUV)`,
    };
  }

  return {
    matched: false,
    label: null,
    base: null,
    suvFee: null,
    total: null,
    totalDisplay: '',
    tipSuggested: null,
    display: `No route match — quote from the Fare Ledger, or $${FARES.hourlyRate}/hr (2-hr min) if it's not a known route.`,
  };
}

module.exports = { estimateFare, FARES, SUV_FEE };
