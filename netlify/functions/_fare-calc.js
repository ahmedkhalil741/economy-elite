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

// ---- TOLLS ----
// Charged to the customer as their own line, never buried in the base fare.
// The site promises "No surge pricing. No meter. No surprises", and a toll
// added after the ride is exactly the surprise that promise rules out. Naming
// the number before the car moves is what keeps it true.
//
// Only EASTBOUND crossings into New York are tolled — the drive home is free —
// so these are one-way figures for one crossing, not a round trip.
//
// Figures from the Port Authority and the MTA, September 2026:
//   Port Authority crossing (GWB, Lincoln, Holland)  $16.79 peak / $14.79 off
//   Manhattan below 60th St, congestion charge       $9 peak / $2.25 overnight
//   LGA and JFK are reached without entering the congestion zone, so they
//   carry the crossing only.
//   Newark and local trips cross nothing — Route 78 is free.
//
// THESE ARE ESTIMATES AND ARE LABELLED AS SUCH. Ahmed and Hany drive these
// routes and know what actually comes off the E-ZPass; when they say, replace
// these with their numbers.
const TOLLS = {
  ewr:    { standard: 0,  overnight: 0 },
  manh:   { standard: 26, overnight: 17 },
  lgajfk: { standard: 17, overnight: 15 },
};
const LOCAL_TOLL = 0;

// For work that isn't A to B — a night out, waiting between stops, errands.
// Ahmed's decision (2026-09-17): $60/hr, and no minimum. He'd rather take a
// short job than turn someone away over a two-hour floor.
const HOURLY_RATE = 60;
const HOURLY_MINIMUM_HOURS = 0;

// The four destinations the table prices. LaGuardia and JFK share a column.
const DESTINATIONS = [
  { key: 'ewr',    label: 'Newark Liberty Airport (EWR)', ny: false, test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
  // "New York" on its own is how Google labels a Manhattan address once the
  // street and the state have been stripped off ("350 5th Ave, New York, NY").
  { key: 'manh',   label: 'Manhattan / New York City',    ny: true,  test: /\bmanhattan\b|^\s*new york\s*$|\bnew york,?\s*ny\b|\bnyc\b/i },
  { key: 'lgajfk', label: 'LaGuardia Airport (LGA)',      ny: true,  test: /\blaguardia\b|\blga\b/i },
  // Google writes it out in full: "John F Kennedy International Airport".
  { key: 'lgajfk', label: 'JFK Airport',                  ny: true,  test: /\bjfk\b|\bjohn f\.?\s*kennedy\b|\bkennedy\s+(international\s+)?airport\b/i },
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
  { town: 'Plainfield',       names: ['plainfield'],       ewr: 85,  manh: 145, lgajfk: 195 },
  { town: 'North Plainfield', names: ['north plainfield', 'n. plainfield'],      ewr: 85,  manh: 140, lgajfk: 190 },
  { town: 'Orange',           names: ['orange'],           ewr: 80,  manh: 140, lgajfk: 190 },
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
// ---- READING AN ADDRESS -------------------------------------------------
//
// THE BUG THIS EXISTS TO PREVENT (found by audit, 2026-09-18): the old code
// scanned the WHOLE address string for a town name. In New Jersey, street
// names ARE town names, so:
//
//   "123 Madison Ave, Lakewood, NJ"  ->  priced as Madison, $105
//                                        Lakewood is 55 miles away
//   "45 Summit Ave, Hackensack, NJ"  ->  priced as Summit, $75
//   "9 Westfield Ave, Elizabeth, NJ" ->  priced as Westfield, $85
//   "10 Manhattan Ave, Union, NJ"    ->  priced as a MANHATTAN run, $135,
//                                        for a six-mile local hop
//   "Cranford, Union County, NJ"     ->  priced as Union, off the COUNTY name
//
// Every one of those is a wrong price on a real booking, in both directions,
// with nothing in the sheet looking odd afterwards.
//
// The fix: only ever look at the parts of an address that name a PLACE.
// Google formats addresses as comma-separated parts —
// "24 Gales Dr, New Providence, NJ 07974, USA" — so the street is the first
// part, and it goes in the bin along with the state, the ZIP, the country and
// anything ending in "County".

const QUALIFIERS = ['east', 'west', 'north', 'south', 'new', 'old', 'upper',
                    'lower', 'port', 'mount', 'mt', 'glen', 'little', 'big'];

// Deliberately NOT including "New York": that is how Google labels a
// Manhattan address ("350 5th Ave, New York, NY 10118"), and treating it as a
// state name threw the whole Manhattan destination away. The state itself
// always shows up as the two-letter "NY" in a formatted address.
const STATES = /^(nj|ny|pa|ct|de|md|new jersey|pennsylvania|connecticut|delaware|maryland)\b/i;

// The parts of an address that could name a town. Everything else is dropped.
function placeParts(text) {
  const raw = String(text || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!raw.length) return [];

  const kept = raw.filter((part) => {
    if (/^(usa|united states|us)$/i.test(part)) return false;
    if (/\bcounty\b/i.test(part)) return false;          // "Union County"
    if (STATES.test(part)) return false;                  // "NJ 07974", "New York"
    if (/^\d{5}(-\d{4})?$/.test(part)) return false;      // a bare ZIP
    return true;
  });

  // Street lines, dropped by shape rather than by position: a leading house
  // number, a unit, or a street-type word. "JFK Blvd" and "Springfield Ave"
  // are streets as surely as "24 Gales Dr" is, and each one would otherwise
  // be read as a place. Only dropped while something else survives — a bare
  // "Summit" typed on its own has to keep working.
  const street = /^\d|\b(apt|suite|ste|unit|floor|fl)\b|\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|pkwy|parkway|ct|court|pl|place|ter|terrace|hwy|highway|cir|circle|trl|trail)\.?$/i;
  const places = kept.filter((part) => !street.test(part));
  return places.length ? places : kept;
}

function findTown(text) {
  const parts = placeParts(text);
  if (!parts.length) return null;

  // every spelling of every town, so a qualified pair can be checked for
  const known = new Set();
  for (const row of TOWN_FARES) for (const n of row.names) known.add(n);

  let best = null, bestLen = 0;

  for (const part of parts) {
    const hay = ` ${part.toLowerCase().replace(/\s+/g, ' ')} `;
    for (const row of TOWN_FARES) {
      for (const name of row.names) {
        let from = 0, idx;
        while ((idx = hay.indexOf(name, from)) !== -1) {
          from = idx + 1;
          const before = hay[idx - 1] || ' ';
          const after = hay[idx + name.length] || ' ';
          if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;  // mid-word
          if (name.length <= bestLen) continue;

          // "East Orange" must not be priced as "Orange". West Orange and
          // North Plainfield have rows of their own, so they survive this
          // and win on length.
          const lead = hay.slice(0, idx).trim().split(' ').pop().replace(/[^a-z]/g, '');
          if (QUALIFIERS.includes(lead) && !known.has(`${lead} ${name}`)) continue;

          best = row; bestLen = name.length;
        }
      }
    }
  }
  return best;
}

function findDestination(text) {
  // Street names carry airport names too: "100 JFK Blvd, Jersey City" is a
  // Jersey City address, not a JFK run, and "10 Manhattan Ave, Union" is a
  // local hop. Same filtering as findTown, for the same reason.
  const parts = placeParts(text);
  if (!parts.length) return null;
  for (const dest of DESTINATIONS) {
    if (parts.some((part) => dest.test.test(part))) return dest;
  }
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
    toll: null,
    tollEstimated: false,
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
// Builds the result for a price settled by hand. Used wherever an agreed fare
// is given, because the routes you most often agree by phone are precisely the
// ones with no listed price — so it has to work when the town is unknown, not
// only when it is known.
function agreedResult(agreed, toll, payMethod, label) {
  const rideFare = agreed + toll;
  const card = cardFeeFor(payMethod, rideFare);
  const total = Math.round((rideFare + (card ? card.amount : 0)) * 100) / 100;

  const bits = [`$${agreed} agreed`];
  if (toll) bits.push(`$${toll} tolls`);
  if (card) bits.push(`$${card.amount.toFixed(2)} ${card.label} fee`);

  return {
    matched: true, label: label || 'Agreed by phone', newYork: false,
    agreedFare: agreed, base: agreed, suvFee: null, suvFeeNy: null,
    sedanFeeNy: SEDAN_FEE_NY, overnightFee: null,
    toll: toll || null, tollEstimated: Boolean(toll),
    cardFee: card ? card.amount : null,
    cardFeeLabel: card ? card.label : null,
    cardFeeRate: card ? `${(card.rate * 100).toFixed(1)}% + $${card.fixed.toFixed(2)}` : null,
    rideFare, total,
    totalDisplay: `$${total.toFixed(2).replace(/\.00$/, '')}`,
    // The tip is on the driving only — never on the toll or the card fee.
    tipSuggested: Math.round(agreed * 0.2),
    display: `$${total.toFixed(2).replace(/\.00$/, '')} flat (${bits.join(' + ')})`,
  };
}

// `agreedFare` overrides the DRIVING charge — base, vehicle fee and overnight
// all together — for a price settled on the phone. It does not override the
// toll or the card fee, because those are pass-throughs: the bridge and Square
// charge what they charge whatever was agreed. They are added on top and shown
// separately, so the number Ahmed typed stays visible as the number he typed.
function estimateFare(pickup, dropoff, vehicle, dateTime, payMethod, agreedFare) {
  const agreed = (agreedFare === 0 || agreedFare) && !isNaN(parseFloat(agreedFare))
    ? Math.max(0, parseFloat(agreedFare)) : null;
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
    const tollFor = TOLLS[dest.key] || { standard: 0, overnight: 0 };
    const destToll = overnight ? tollFor.overnight : tollFor.standard;

    const town = findTown(townSide);
    if (!town) {
      // No listed price — but if one was agreed on the phone, that IS the
      // price, and the toll for this destination still applies.
      if (agreed !== null) return agreedResult(agreed, destToll, payMethod, `Agreed — ${dest.label}`);
      return noMatch(overnight, `${dest.label} — no listed price for that town. Quote it by hand, then tell Claude the number and it gets added.${overnightNote}`);
    }

    const base = town[dest.key];
    const suvFee = isSedan ? null : (dest.ny ? null : SUV_FEE);
    const suvFeeNy = isSedan ? null : (dest.ny ? SUV_FEE_NY : null);
    const vehicleFee = suvFee || suvFeeNy || 0;

    const toll = destToll;

    if (agreed !== null) return agreedResult(agreed, toll, payMethod, `Agreed — ${town.town} to ${dest.label}`);
    const driving = base + vehicleFee + overnight;

    // The card fee is worked out on everything going through the card,
    // INCLUDING the toll — Square takes its percentage of the whole amount
    // swiped, so leaving the toll out would quietly under-recover the fee.
    const rideFare = driving + toll;
    const card = cardFeeFor(payMethod, rideFare);
    const total = Math.round((rideFare + (card ? card.amount : 0)) * 100) / 100;

    // The tip is on the DRIVING, not on the toll and not on the processor's
    // cut. Nobody tips twenty per cent of a bridge.
    const tippable = driving;

    const parts = agreed !== null
      ? [`$${agreed} agreed`]
      : [`$${base} ${town.town}`];
    if (agreed === null && suvFee) parts.push(`$${suvFee} SUV`);
    if (agreed === null && suvFeeNy) parts.push(`$${suvFeeNy} SUV (New York)`);
    if (agreed === null && overnight) parts.push(`$${overnight} overnight`);
    if (toll) parts.push(`$${toll} tolls`);
    if (card) parts.push(`$${card.amount.toFixed(2)} ${card.label} fee`);

    return {
      matched: true,
      label: `${town.town} — ${dest.label}`,
      newYork: Boolean(dest.ny),
      agreedFare: agreed,
      base: agreed !== null ? agreed : base,
      suvFee: agreed !== null ? null : suvFee,
      suvFeeNy: agreed !== null ? null : suvFeeNy,
      sedanFeeNy: SEDAN_FEE_NY,
      overnightFee: agreed !== null ? null : (overnight || null),
      toll: toll || null,
      tollEstimated: Boolean(toll),
      cardFee: card ? card.amount : null,
      cardFeeLabel: card ? card.label : null,
      cardFeeRate: card ? `${(card.rate * 100).toFixed(1)}% + $${card.fixed.toFixed(2)}` : null,
      rideFare,
      total,
      totalDisplay: `$${total.toFixed(2).replace(/\.00$/, '')}`,
      tipSuggested: Math.round(tippable * 0.2),
      display: parts.length > 1
        ? `$${total.toFixed(2).replace(/\.00$/, '')} flat (${parts.join(' + ')})`
        : `$${total.toFixed(2).replace(/\.00$/, '')} flat (${town.town}, sedan)`,
    };
  }

  // No airport or Manhattan involved. Both ends listed towns -> local rate.
  const townA = findTown(pickup);
  const townB = findTown(dropoff);
  if (townA && townB && agreed !== null) {
    return agreedResult(agreed, 0, payMethod, `Agreed — ${townA.town} to ${townB.town}`);
  }
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
      toll: LOCAL_TOLL || null,
      tollEstimated: false,
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

  // Nothing matched at all, but a price was agreed — no destination, so no
  // toll to add.
  if (agreed !== null) return agreedResult(agreed, 0, payMethod, 'Agreed by phone');

  return noMatch(overnight, `No listed price for this route. Quote it by hand, or $${HOURLY_RATE}/hr (no minimum) if it isn't a straight A-to-B trip.${overnightNote}`);
}

module.exports = {
  estimateFare,
  isOvernightPickup,
  findTown,
  findDestination,
  placeParts,
  TOWN_FARES,
  DESTINATIONS,
  LOCAL_RANGE,
  HOURLY_RATE,
  HOURLY_MINIMUM_HOURS,
  SUV_FEE,
  SUV_FEE_NY,
  SEDAN_FEE_NY,
  OVERNIGHT_FEE,
  TOLLS,
};
