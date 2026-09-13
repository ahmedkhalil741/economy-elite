// Internal fare estimator — NOT shown to customers anywhere. Matches the
// pickup/drop-off text against known routes from the internal Fare Ledger
// and returns a starting number for the owner to confirm. Every fare is
// still confirmed with the customer directly before a ride is locked in;
// this just saves having to look the number up by hand.
//
// To change a rate, edit FARES below — nothing else needs to change.

const FARES = {
  hourlyRate: 60,      // $/hr, 2-hr minimum
  localRange: [25, 35], // flat, nearby towns

  // Order matters — first match wins. Keep specific airports above the
  // broader "local" list so e.g. "Newark, NJ" doesn't get caught by a
  // generic New Jersey pattern.
  zones: [
    { label: 'Newark Liberty Airport (EWR)', amount: 105, test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
    { label: 'LaGuardia Airport (LGA)', amount: 215, test: /\blaguardia\b|\blga\b/i },
    { label: 'JFK Airport', amount: 235, test: /\bjfk\b|\bkennedy\s*airport\b/i },
    { label: 'Manhattan / New York City', amount: 180, test: /\bmanhattan\b|\bnew york,?\s*ny\b|\bnyc\b/i },
    { label: 'Local (Berkeley Heights, Summit, Chatham, Millburn, Short Hills, Springfield, New Vernon, New Providence)', amount: null, range: [25, 35], test: /\b(berkeley heights|summit|chatham|millburn|short hills|springfield|new vernon|new providence)\b/i },
  ],
};

function estimateFare(pickup, dropoff) {
  const combined = `${pickup || ''} ${dropoff || ''}`;

  for (const zone of FARES.zones) {
    if (zone.test.test(combined)) {
      if (zone.range) {
        return {
          matched: true,
          label: zone.label,
          amount: null,
          display: `$${zone.range[0]}–${zone.range[1]} flat (local)`,
        };
      }
      return {
        matched: true,
        label: zone.label,
        amount: zone.amount,
        display: `$${zone.amount} flat`,
      };
    }
  }

  return {
    matched: false,
    label: null,
    amount: null,
    display: `No route match — quote from the Fare Ledger, or $${FARES.hourlyRate}/hr (2-hr min) if it's not a known route.`,
  };
}

module.exports = { estimateFare, FARES };
