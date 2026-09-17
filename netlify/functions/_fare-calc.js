// Internal fare estimator — NOT shown to customers as a public price list.
// It works out what a trip costs so the owner email, the calendar event and
// the Bookings sheet all agree, and so a price can be quoted instantly.
//
// ---- HOW PRICING WORKS ----
// Flat rates, never per-mile. The customer is told one number before the car
// moves. The site promises "No surge pricing. No meter. No surprises", and
// a meter would break that promise.
//
// A trip is priced from a TOWN and a DESTINATION:
//
//   town  -> the pickup or drop-off that isn't an airport or Manhattan
//   dest  -> Newark (EWR), Manhattan, LaGuardia or JFK
//
// TOWN_FARES below holds one price per town per destination. Those are SEDAN
// prices, all in. An SUV adds a surcharge on top: $35 to Newark, $50 to
// Manhattan, LaGuardia or JFK. A sedan adds nothing.
//
// Trips between two listed towns are the local flat rate, same either car.
// Anything else returns matched:false and is quoted by hand.
//
// ---- WHY THERE IS NO LONGER A "NEW YORK SEDAN FEE" ----
// There used to be a $35 surcharge on New York trips in a sedan, on top of
// the base. The town table replaced it, because these prices are already
// complete sedan prices — adding a sedan fee would charge it twice and put
// the sedan fares well above the local market. SEDAN_FEE_NY stays exported
// as null so the sheet's sedan_fee_ny column keeps writing "N/A".
//
// To change a price, edit TOWN_FARES. To add a town, copy a row. Nothing
// else needs to change.

const { cardFeeFor } = require('./_card-fee');

// SUV surcharges. A sedan pays neither.
const SUV_FEE = 35;        // to Newark
const SUV_FEE_NY = 50;     // to Manhattan, LaGuardia, JFK
const SEDAN_FEE_NY = null; // retired, see note above

// Pickup between 12:00 AM and 5:59 AM.
const OVERNIGHT_FEE = 10;

// Town to town, all-inclusive, same price either vehicle.
const LOCAL_RANGE = [25, 35];

// For work that isn't A to B — a night out, waiting between stops, errands.
// STILL UNCONFIRMED BY AHMED.
const HOURLY_RATE = 60;

// The four destinations the table prices. LaGuardia and JFK share a column.
const DESTINATIONS = [
  { key: 'ewr',    label: 'Newark Liberty Airport (EWR)', ny: false, test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
  { key: 'manh',   label: 'Manhattan / New York City',    ny: true,  test: /\bmanhattan\b|\bnew york,?\s*ny\b|\bnyc\b/i },
  { key: 'lgajfk', label: 'LaGuardia Airport (LGA)',      ny: true,  test: /\blaguardia\b|\blga\b/i },
  { key: 'lgajfk', label: 'JFK Airport',                  ny: true,  test: /\bjfk\b|\bkennedy\s*airport\b/i },
];

// One row per town. `names` holds every spelling worth matching — Google
// formats addresses its own way, and the source list abbreviates ("W. Orange",
// "Seaside Hghts"). Longest match wins, so "South Bound Brook" beats
// "Bound Brook" and "New Providence" beats "Union".
const TOWN_FARES = [
  { town: 'Allentown',        names: ['allentown'],                              ewr: 150, manh: 210, lgajfk: 260 },
  { town: 'Asbury Park',      names: ['asbury park'],                            ewr: 120, manh: 180, lgajfk: 230 },
  { town: 'Avenel',           names: ['avenel'],                                 ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Basking Ridge',    names: ['basking ridge'],                          ewr: 105, manh: 165, lgajfk: 215 },
  { town: 'Bayonne',          names: ['bayonne'],                                ewr: 80,  manh: 140, lgajfk: 190 },
  { town: 'The Hills',        names: ['the hills'],                              ewr: 110, manh: 170, lgajfk: 220 },
  { town: 'Bedminster',       names: ['bedminster'],                             ewr: 115, manh: 175, lgajfk: 220 },
  { town: 'Belle Mead',       names: ['belle mead', 'bellmead'],                 ewr: 130, manh: 190, lgajfk: 240 },
  { town: 'Berkeley Heights', names: ['berkeley heights'],                       ewr: 80,  manh: 140, lgajfk: 185 },
  { town: 'Bound Brook',      names: ['bound brook'],                            ewr: 80,  manh: 150, lgajfk: 190 },
  { town: 'Bernardsville',    names: ['bernardsville'],                          ewr: 115, manh: 175, lgajfk: 225 },
  { town: 'Branchburg',       names: ['branchburg'],                             ewr: 115, manh: 175, lgajfk: 225 },
  { town: 'Bridgewater',      names: ['bridgewater'],                            ewr: 115, manh: 165, lgajfk: 215 },
  { town: 'Chatham',          names: ['chatham'],                                ewr: 80,  manh: 140, lgajfk: 185 },
  { town: 'Chester',          names: ['chester'],                                ewr: 145, manh: 200, lgajfk: 250 },
  { town: 'Clinton',          names: ['clinton'],                                ewr: 150, manh: 210, lgajfk: 260 },
  { town: 'Convent Station',  names: ['convent station'],                        ewr: 90,  manh: 150, lgajfk: 200 },
  { town: 'Dunellen',         names: ['dunellen'],                               ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'East Hanover',     names: ['east hanover'],                           ewr: 85,  manh: 150, lgajfk: 195 },
  { town: 'Edison',           names: ['edison'],                                 ewr: 75,  manh: 130, lgajfk: 180 },
  { town: 'Far Hills',        names: ['far hills'],                              ewr: 115, manh: 165, lgajfk: 225 },
  { town: 'Flanders',         names: ['flanders'],                               ewr: 125, manh: 185, lgajfk: 235 },
  { town: 'Flemington',       names: ['flemington'],                             ewr: 130, manh: 190, lgajfk: 240 },
  { town: 'Florham Park',     names: ['florham park'],                           ewr: 80,  manh: 140, lgajfk: 190 },
  { town: 'Gillette',         names: ['gillette'],                               ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Gladstone',        names: ['gladstone', 'gladestone'],                ewr: 130, manh: 190, lgajfk: 235 },
  { town: 'Green Brook',      names: ['green brook', 'greenbrook'],              ewr: 90,  manh: 150, lgajfk: 195 },
  { town: 'Green Village',    names: ['green village'],                          ewr: 95,  manh: 155, lgajfk: 200 },
  { town: 'Hillsborough',     names: ['hillsborough'],                           ewr: 120, manh: 180, lgajfk: 230 },
  { town: 'Hoboken',          names: ['hoboken'],                                ewr: 80,  manh: 140, lgajfk: 190 },
  { town: 'Jersey City',      names: ['jersey city'],                            ewr: 75,  manh: 125, lgajfk: 185 },
  { town: 'Lebanon',          names: ['lebanon'],                                ewr: 130, manh: 190, lgajfk: 240 },
  { town: 'Liberty Corner',   names: ['liberty corner'],                         ewr: 110, manh: 170, lgajfk: 215 },
  { town: 'Livingston',       names: ['livingston'],                             ewr: 80,  manh: 140, lgajfk: 190 },
  { town: 'Long Valley',      names: ['long valley'],                            ewr: 95,  manh: 155, lgajfk: 205 },
  { town: 'Madison',          names: ['madison'],                                ewr: 105, manh: 165, lgajfk: 215 },
  { town: 'Martinsville',     names: ['martinsville'],                           ewr: 115, manh: 175, lgajfk: 225 },
  { town: 'Meyersville',      names: ['meyersville'],                            ewr: 95,  manh: 145, lgajfk: 205 },
  { town: 'Mendham',          names: ['mendham'],                                ewr: 125, manh: 185, lgajfk: 235 },
  { town: 'Mountain Lakes',   names: ['mountain lakes'],                         ewr: 125, manh: 185, lgajfk: 235 },
  { town: 'Millburn',         names: ['millburn'],                               ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Millington',       names: ['millington'],                             ewr: 95,  manh: 150, lgajfk: 200 },
  { town: 'Morristown',       names: ['morristown'],                             ewr: 100, manh: 160, lgajfk: 210 },
  { town: 'Mountainside',     names: ['mountainside'],                           ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Murray Hill',      names: ['murray hill', 'murray hills'],            ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'New Brunswick',    names: ['new brunswick'],                          ewr: 95,  manh: 145, lgajfk: 205 },
  { town: 'New Providence',   names: ['new providence'],                         ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'New Vernon',       names: ['new vernon'],                             ewr: 95,  manh: 155, lgajfk: 205 },
  { town: 'North Plainfield', names: ['north plainfield', 'n. plainfield'],      ewr: 85,  manh: 140, lgajfk: 190 },
  { town: 'Oldwick',          names: ['oldwick'],                                ewr: 110, manh: 170, lgajfk: 220 },
  { town: 'Parsippany',       names: ['parsippany'],                             ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Peapack',          names: ['peapack'],                                ewr: 130, manh: 190, lgajfk: 240 },
  { town: 'Phillipsburg',     names: ['phillipsburg', 'philipsburg'],            ewr: 180, manh: 240, lgajfk: 290 },
  { town: 'Piscataway',       names: ['piscataway'],                             ewr: 100, manh: 160, lgajfk: 210 },
  { town: 'Princeton',        names: ['princeton'],                              ewr: 155, manh: 215, lgajfk: 265 },
  { town: 'Sayreville',       names: ['sayreville'],                             ewr: 90,  manh: 150, lgajfk: 195 },
  { town: 'Scotch Plains',    names: ['scotch plains', 'scotch plain'],          ewr: 80,  manh: 140, lgajfk: 190 },
  { town: 'Seaside Heights',  names: ['seaside heights', 'seaside hghts'],       ewr: 185, manh: 245, lgajfk: 295 },
  { town: 'Short Hills',      names: ['short hills'],                            ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'South Bound Brook',names: ['south bound brook', 's. bound brook'],    ewr: 85,  manh: 145, lgajfk: 190 },
  { town: 'Springfield',      names: ['springfield'],                            ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Somerville',       names: ['somerville'],                             ewr: 125, manh: 195, lgajfk: 235 },
  { town: 'South Plainfield', names: ['south plainfield', 's. plainfield'],      ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Stirling',         names: ['stirling'],                               ewr: 90,  manh: 150, lgajfk: 200 },
  { town: 'Summit',           names: ['summit'],                                 ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Trenton',          names: ['trenton'],                                ewr: 160, manh: 220, lgajfk: 270 },
  { town: 'Toms River',       names: ['toms river'],                             ewr: 175, manh: 235, lgajfk: 285 },
  { town: 'Union',            names: ['union'],                                  ewr: 75,  manh: 135, lgajfk: 185 },
  { town: 'Warren',           names: ['warren'],                                 ewr: 95,  manh: 155, lgajfk: 205 },
  { town: 'Watchung',         names: ['watchung'],                               ewr: 90,  manh: 150, lgajfk: 200 },
  { town: 'West Orange',      names: ['west orange', 'w. orange'],               ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Westfield',        names: ['westfield'],                              ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Whippany',         names: ['whippany'],                               ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'Whitehouse',       names: ['whitehouse station', 'whitehouse'],       ewr: 145, manh: 205, lgajfk: 255 },
  { town: 'Woodbridge',       names: ['woodbridge'],                             ewr: 90,  manh: 150, lgajfk: 200 },
];

// Requested pickup time falls between 12:00 AM and 5:59 AM -> overnight.
// dateTimeLocal is the raw value of an <input type="datetime-local">, already
// the customer's own wall-clock time, so no timezone conversion here.
function isOvernightPickup(dateTimeLocal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal || '');
  if (!m) return false;
  const hour = Number(m[4]);
  return hour >= 0 && hour < 6;
}

// Longest match wins. "New Providence, Union County" must not price as Union,
// and "South Bound Brook" must not price as Bound Brook.
function findTown(text) {
  const hay = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  let best = null;
  let bestLen = 0;
  for (const row of TOWN_FARES) {
    for (const name of row.names) {
      let from = 0;
      let idx;
      while ((idx = hay.indexOf(name, from)) !== -1) {
        const before = hay[idx - 1] || ' ';
        const after = hay[idx + name.length] || ' ';
        // Only count it when the name stands alone, not inside a longer word.
        if (!/[a-z]/.test(before) && !/[a-z]/.test(after) && name.length > bestLen) {
          best = row;
          bestLen = name.length;
        }
        from = idx + 1;
      }
    }
  }
  return best;
}

function findDestination(text) {
  const s = String(text || '');
  for (const d of DESTINATIONS) if (d.test.test(s)) return d;
  return null;
}

function noMatch(overnight, note) {
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
    rideFare: null,
    total: null,
    totalDisplay: '',
    tipSuggested: null,
    display: note,
  };
}

// pickup/dropoff pick the route, vehicle decides the SUV surcharge, dateTime
// decides the overnight fee, and payMethod decides the card fee added on top.
function estimateFare(pickup, dropoff, vehicle, dateTime, payMethod) {
  const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';
  const overnight = isOvernightPickup(dateTime) ? OVERNIGHT_FEE : 0;
  const overnightNote = overnight ? ` + $${overnight} overnight` : '';

  const destAtPickup = findDestination(pickup);
  const destAtDropoff = findDestination(dropoff);

  // Exactly one end should be an airport or Manhattan. Both ends being
  // destinations (EWR to JFK) isn't in the table and gets quoted by hand.
  let dest = null;
  let townSide = null;
  if (destAtDropoff && !destAtPickup) { dest = destAtDropoff; townSide = pickup; }
  else if (destAtPickup && !destAtDropoff) { dest = destAtPickup; townSide = dropoff; }

  if (dest) {
    const town = findTown(townSide);
    if (!town) {
      return noMatch(overnight, `${dest.label} — no listed price for that town. Quote it by hand, then tell Claude the number and it gets added.${overnightNote}`);
    }

    const base = town[dest.key];
    const suvFee = isSedan ? null : (dest.ny ? null : SUV_FEE);
    const suvFeeNy = isSedan ? null : (dest.ny ? SUV_FEE_NY : null);
    const vehicleFee = suvFee || suvFeeNy || 0;

    const rideFare = base + vehicleFee + overnight;
    const card = cardFeeFor(payMethod, rideFare);
    const total = Math.round((rideFare + (card ? card.amount : 0)) * 100) / 100;

    const parts = [`$${base} ${town.town}`];
    if (suvFee) parts.push(`$${suvFee} SUV`);
    if (suvFeeNy) parts.push(`$${suvFeeNy} SUV (New York)`);
    if (overnight) parts.push(`$${overnight} overnight`);
    if (card) parts.push(`$${card.amount.toFixed(2)} ${card.label} fee`);

    return {
      matched: true,
      label: `${town.town} — ${dest.label}`,
      newYork: Boolean(dest.ny),
      base,
      suvFee,
      suvFeeNy,
      sedanFeeNy: SEDAN_FEE_NY,
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
        ? `$${total.toFixed(2).replace(/\.00$/, '')} flat (${parts.join(' + ')})`
        : `$${total.toFixed(2).replace(/\.00$/, '')} flat (${town.town}, sedan)`,
    };
  }

  // No airport or Manhattan involved. Both ends listed towns -> local rate.
  const townA = findTown(pickup);
  const townB = findTown(dropoff);
  if (townA && townB) {
    const [lo, hi] = LOCAL_RANGE;
    return {
      matched: true,
      label: `Local — ${townA.town} to ${townB.town}`,
      newYork: false,
      base: null,
      suvFee: null,
      suvFeeNy: null,
      sedanFeeNy: SEDAN_FEE_NY,
      overnightFee: overnight || null,
      // A range has no single number to take a percentage of, so the card fee
      // is worked out once the exact fare is agreed.
      cardFee: null,
      cardFeeLabel: null,
      cardFeeRate: null,
      rideFare: null,
      total: null,
      totalDisplay: `$${lo + overnight}–${hi + overnight} flat (all-inclusive)`,
      tipSuggested: Math.round((((lo + hi) / 2) + overnight) * 0.2),
      display: `$${lo + overnight}–${hi + overnight} flat (local, all-inclusive, either vehicle${overnight ? `, includes $${overnight} overnight` : ''})`,
    };
  }

  return noMatch(overnight, `No listed price for this route. Quote it by hand, or $${HOURLY_RATE}/hr (2-hr minimum) if it isn't a straight A-to-B trip.${overnightNote}`);
}

module.exports = {
  estimateFare,
  isOvernightPickup,
  findTown,
  findDestination,
  TOWN_FARES,
  DESTINATIONS,
  LOCAL_RANGE,
  HOURLY_RATE,
  SUV_FEE,
  SUV_FEE_NY,
  SEDAN_FEE_NY,
  OVERNIGHT_FEE,
};
