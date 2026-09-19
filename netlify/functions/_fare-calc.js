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

// A number, or null. Zero is a real answer — "waive the card fee" is written
// as 0 and has to survive, so a plain falsy check would throw it away.
function numOrNull(v) {
  return ((v === 0 || v) && !isNaN(parseFloat(v))) ? Math.max(0, parseFloat(v)) : null;
}

// SUV surcharges. A sedan pays neither.
const SUV_FEE = 35;        // to Newark
const SUV_FEE_NY = 50;     // to Manhattan, LaGuardia, JFK

// Pickup between 12:00 AM and 5:59 AM.
const OVERNIGHT_FEE = 10;

// Town to town, all-inclusive, same price either vehicle.
const LOCAL_RANGE = [25, 35];

// ---- TOLLS ----
// Charged to the customer as their own line, never buried in the base fare.
// The site promises "No surge pricing. No meter. No surprises", and a toll
// added after the ride is exactly the surprise that promise rules out.
//
// THESE ARE AHMED'S FIXED FIGURES, not a live lookup, and they are ROUND TRIP.
// The passenger travels one way; the car does not. Sending a driver to JFK
// means paying to get there and paying to get back, and the customer who
// caused the journey pays for the journey. This is how black-car and limousine
// operators normally quote out-of-area work, and it is why these are roughly
// double a one-way published rate.
//
// It follows that the toll applies whether the trip GOES to New York or COMES
// FROM it - either way the car makes the round trip. The code already matches
// a destination at either end, so that falls out for free.
//
// Flat amounts, deliberately. Real tolls move with the hour and the crossing,
// but a number that changes while a customer is on the phone is worse than a
// number that is occasionally a dollar out.
const TOLLS = {
  ewr:    { standard: 0,  overnight: 0 },   // Route 78 is free
  manh:   { standard: 29, overnight: 29 },  // Manhattan, round trip
  lgajfk: { standard: 50, overnight: 50 },  // LaGuardia and JFK, round trip
};
const LOCAL_TOLL = 0;

// For work that isn't A to B — a night out, waiting between stops, errands.
// Ahmed's decision (2026-09-17): $60/hr, and no minimum. He'd rather take a
// short job than turn someone away over a two-hour floor.
const HOURLY_RATE = 60;
const HOURLY_MINIMUM_HOURS = 0;

// The four destinations the table prices. LaGuardia and JFK share a column.
const DESTINATIONS = [
  { key: 'ewr',    zone: 'Newark',    label: 'Newark Liberty Airport (EWR)', ny: false, test: /\bnewark\s*(liberty)?\s*(international)?\s*airport\b|\bewr\b/i },
  // "New York" on its own is how Google labels a Manhattan address once the
  // street and the state have been stripped off ("350 5th Ave, New York, NY").
  { key: 'manh',   zone: 'Manhattan', label: 'Manhattan / New York City',    ny: true,  test: /\bmanhattan\b|^\s*new york\s*$|\bnew york,?\s*ny\b|\bnyc\b/i },
  { key: 'lgajfk', zone: 'LaGuardia', label: 'LaGuardia Airport (LGA)',      ny: true,  test: /\blaguardia\b|\blga\b/i },
  // Google writes it out in full: "John F Kennedy International Airport".
  { key: 'lgajfk', zone: 'JFK',       label: 'JFK Airport',                  ny: true,  test: /\bjfk\b|\bjohn f\.?\s*kennedy\b|\bkennedy\s+(international\s+)?airport\b/i },
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


// A route with no listed price still has a destination most of the time — it
// is the TOWN that's missing, not the airport. Carrying the zone through means
// a hand-quoted JFK run still counts as JFK at year-end instead of landing in
// "Other" and quietly understating what the airports earn.
function noMatch(overnight, note, zone) {
  return {
    matched: false,
    label: null,
    zone: zone || 'Other',
    newYork: false,
    fare: null,
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
function agreedResult(agreed, toll, payMethod, label, setCard, zone) {
  const rideFare = agreed + toll;
  const auto = cardFeeFor(payMethod, rideFare);
  // A hand-set card fee wins, including a deliberate zero — waiving it is a
  // real decision and has to be expressible.
  const cardAmount = setCard !== null && setCard !== undefined ? setCard : (auto ? auto.amount : null);
  const total = Math.round((rideFare + (cardAmount || 0)) * 100) / 100;

  const bits = [`$${agreed} fare`];
  if (toll) bits.push(`$${toll} tolls`);
  if (cardAmount) bits.push(`$${cardAmount.toFixed(2)} ${auto ? auto.label : 'card'} fee`);

  return {
    matched: true, label: label || 'Agreed by phone', zone: zone || 'Other', newYork: false,
    agreedFare: agreed, fare: agreed,
    toll: toll || null, tollEstimated: Boolean(toll),
    cardFee: cardAmount,
    cardFeeLabel: cardAmount ? (auto ? auto.label : 'Card') : null,
    cardFeeRate: cardAmount && auto ? `${(auto.rate * 100).toFixed(1)}% + $${auto.fixed.toFixed(2)}` : null,
    rideFare, total,
    totalDisplay: `$${total.toFixed(2).replace(/\.00$/, '')}`,
    tipSuggested: Math.round(agreed * 0.2),
    display: `$${total.toFixed(2).replace(/\.00$/, '')} flat (${bits.join(' + ')})`,
    driverDisplay: `$${total.toFixed(2).replace(/\.00$/, '')} flat (${bits.join(' + ')})`,
  };
}

// `agreedFare` overrides the DRIVING charge — base, vehicle fee and overnight
// all together — for a price settled on the phone. It does not override the
// toll or the card fee, because those are pass-throughs: the bridge and Square
// charge what they charge whatever was agreed. They are added on top and shown
// separately, so the number Ahmed typed stays visible as the number he typed.
// `overrides` lets a person replace ANY line of the bill, not just the total:
//   { fare, toll, cardFee }
// Each is optional. Whatever is left out is calculated as normal, so changing
// the toll alone leaves the rate card in charge of the fare, and waiving the
// card fee leaves everything else untouched.
//
// This started life as a single "agreed fare" number. That was not enough:
// Ahmed's real tolls differ from the table, customers get the card fee waived,
// and a price settled on the phone still needs the toll on top. A plain number
// is still accepted and means { fare }.
// A job charged BY THE HOUR rather than A to B. It is priced before the route
// is even looked at, because the route is not what is being sold: an evening
// held open, several stops, a driver waiting. $60 an hour, no minimum, same
// either car.
//
// The tolls still apply if one end is New York — the bridge does not care how
// the fare was worked out — so the destination is still read, only for that.
function hourlyResult(hours, dest, payMethod, setCard) {
  const driving = Math.round(HOURLY_RATE * hours * 100) / 100;
  const toll = dest ? ((TOLLS[dest.key] || {}).standard || 0) : 0;
  const rideFare = driving + toll;
  const auto = cardFeeFor(payMethod, rideFare);
  const cardAmount = (setCard !== null && setCard !== undefined) ? setCard : (auto ? auto.amount : null);
  const total = Math.round((rideFare + (cardAmount || 0)) * 100) / 100;

  const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
  const bits = [`${money(driving)} fare`];
  if (toll) bits.push(`${money(toll)} tolls`);
  if (cardAmount) bits.push(`${money(cardAmount)} ${auto ? auto.label : 'card'} fee`);
  const shown = `${money(total)} flat (${bits.join(' + ')})`;

  const hoursLabel = `${hours} hour${hours === 1 ? '' : 's'} at $${HOURLY_RATE}/hr`;

  return {
    matched: true,
    label: `Hourly — ${hoursLabel}`,
    zone: 'Hourly',
    newYork: Boolean(dest && dest.ny),
    agreedFare: null,
    hours,
    hourlyAmount: driving,
    fare: driving,
    toll: toll || null,
    tollEstimated: Boolean(toll),
    cardFee: cardAmount,
    cardFeeLabel: cardAmount ? (auto ? auto.label : 'Card') : null,
    cardFeeRate: cardAmount && auto ? `${(auto.rate * 100).toFixed(1)}% + $${auto.fixed.toFixed(2)}` : null,
    rideFare,
    total,
    totalDisplay: money(total),
    tipSuggested: Math.round(driving * 0.2),
    display: shown,
    driverDisplay: shown,
  };
}

function priceRide(pickup, dropoff, vehicle, dateTime, payMethod, overrides) {
  const ov = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  const setFare = numOrNull(ov.fare);
  const setToll = numOrNull(ov.toll);
  const setCard = numOrNull(ov.cardFee);
  const anySet = setFare !== null || setToll !== null || setCard !== null;
  const agreed = setFare;
  const isSedan = (vehicle || '').trim().toLowerCase() === 'sedan';
  const overnight = isOvernightPickup(dateTime) ? OVERNIGHT_FEE : 0;
  const overnightNote = overnight ? ` + $${overnight} overnight` : '';

  const destAtPickup = findDestination(pickup);
  const destAtDropoff = findDestination(dropoff);

  // Hourly wins over the rate card. Somebody who has booked three hours is not
  // buying a trip to an airport even if the airport is one of the stops.
  const hours = numOrNull(ov.hours);
  if (hours && hours > 0 && setFare === null) {
    return hourlyResult(hours, destAtDropoff || destAtPickup, payMethod, setCard);
  }

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
      if (anySet) return agreedResult(agreed !== null ? agreed : 0, setToll !== null ? setToll : destToll, payMethod, `Agreed — ${dest.label}`, setCard, dest.zone);
      return noMatch(overnight, `${dest.label} — no listed price for that town. Quote it by hand, then tell Claude the number and it gets added.${overnightNote}`, dest.zone);
    }

    // One driving charge, not a stack of fees.
    //
    // Ahmed's decision, 2026-09-18: the customer, the driver and the sheet all
    // see the same four numbers — fare, tolls, card fee, total. The SUV
    // surcharge and the overnight charge are added here and never shown apart.
    //
    // A $35 city premium was added to every Manhattan, LaGuardia and JFK price
    // earlier the same day and taken back out again the same evening, at
    // Ahmed's call. The prices below are the originals. Nothing else changed
    // with it: the premium only ever lived in this table, which is exactly why
    // reversing it was one edit and not a hunt through five files. The reason is that a number living in two places is a
    // number that can disagree with itself: the old sedan New York fee sat in
    // the code AND in the table, and New York sedan trips were billed twice
    // for weeks before anyone noticed. Tolls and the card fee stay on their
    // own lines because Ahmed does not set them — those are pass-throughs.
    const base = town[dest.key];
    const vehicleFee = isSedan ? 0 : (dest.ny ? SUV_FEE_NY : SUV_FEE);

    const toll = destToll;

    if (anySet) return agreedResult(agreed !== null ? agreed : (base + vehicleFee + overnight), setToll !== null ? setToll : toll, payMethod, `Agreed — ${town.town} to ${dest.label}`, setCard, dest.zone);
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

    const parts = [`$${driving} fare`];
    if (toll) parts.push(`$${toll} tolls`);
    if (card) parts.push(`$${card.amount.toFixed(2)} ${card.label} fee`);

    return {
      matched: true,
      label: `${town.town} — ${dest.label}`,
      zone: dest.zone,
      newYork: Boolean(dest.ny),
      agreedFare: agreed,
      fare: driving,
      toll: toll || null,
      tollEstimated: Boolean(toll),
      cardFee: card ? card.amount : null,
      cardFeeLabel: card ? card.label : null,
      cardFeeRate: card ? `${(card.rate * 100).toFixed(1)}% + $${card.fixed.toFixed(2)}` : null,
      rideFare,
      total,
      totalDisplay: `$${total.toFixed(2).replace(/\.00$/, '')}`,
      tipSuggested: Math.round(tippable * 0.2),
      display: `$${total.toFixed(2).replace(/\.00$/, '')} flat (${parts.join(' + ')})`,
      driverDisplay: `$${total.toFixed(2).replace(/\.00$/, '')} flat (${parts.join(' + ')})`,
    };
  }

  // No airport or Manhattan involved. Both ends listed towns -> local rate.
  const townA = findTown(pickup);
  const townB = findTown(dropoff);
  if (townA && townB && anySet) {
    return agreedResult(agreed !== null ? agreed : 0, setToll !== null ? setToll : 0, payMethod,
                        `Agreed — ${townA.town} to ${townB.town}`, setCard, 'Local');
  }
  if (townA && townB) {
    const [lo, hi] = LOCAL_RANGE;
    return {
      matched: true,
      label: `Local — ${townA.town} to ${townB.town}`,
      zone: 'Local',
      newYork: false,
      // A range, not a number — the overnight charge is inside the figures
      // below rather than on a line of its own.
      fare: null,
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
  if (anySet) return agreedResult(agreed !== null ? agreed : 0, setToll !== null ? setToll : 0, payMethod, 'Agreed by phone', setCard, 'Other');

  return noMatch(overnight, `No listed price for this route. Quote it by hand, or $${HOURLY_RATE}/hr (no minimum) if it isn't a straight A-to-B trip.${overnightNote}`);
}

// ---- DISCOUNTS ----
//
// A discount comes off the DRIVING charge and off nothing else. Two rules
// decide that, and both are about money actually moving:
//
//   The toll is never discounted. The bridge charges what the bridge charges,
//   and knocking money off it means Ahmed pays the difference to the Port
//   Authority out of his own pocket rather than giving the customer a gift.
//
//   The card fee is worked out AFTER the discount, never before. Square takes
//   its percentage of what is actually swiped, so a $20 discount has to shrink
//   the fee too. Discounting after the fee would have him handing a processor
//   a cut of money he never collected.
//
// The discount can never be larger than the driving charge — a $50 credit on a
// $35 local run takes the fare to zero and stops there. The leftover stays on
// the customer's balance for next time rather than turning into cash.
//
// Two versions of the breakdown come back. `display` says the discount out
// loud, and that one is for Ahmed. `driverDisplay` folds it silently into the
// fare, and that is the one the driver and the calendar see, because a driver
// reading "$15 discount" next to a number he has to collect is a question he
// should never have to ask.
function applyDiscount(result, discountRaw, payMethod, setCard) {
  const asked = numOrNull(discountRaw);
  if (!asked) return result;

  // A local range or an unmatched route has no single number to take money
  // off. Record what was asked for so nothing is silently lost, and let the
  // price get settled first.
  if (typeof result.rideFare !== 'number' || !isFinite(result.rideFare)) {
    return Object.assign({}, result, {
      discount: asked,
      discountApplied: 0,
      discountNote: 'Settle the fare first — a discount needs a number to come off.',
    });
  }

  const toll = result.toll || 0;
  const driving = Math.round((result.rideFare - toll) * 100) / 100;
  const applied = Math.round(Math.min(asked, Math.max(0, driving)) * 100) / 100;
  const unused = Math.round((asked - applied) * 100) / 100;

  const newDriving = Math.round((driving - applied) * 100) / 100;
  const rideFare = Math.round((newDriving + toll) * 100) / 100;

  const auto = cardFeeFor(payMethod, rideFare);
  // A hand-set card fee survives the discount. Waiving the fee is a separate
  // decision and the discount has no business undoing it.
  const cardAmount = (setCard !== null && setCard !== undefined)
    ? setCard
    : (auto ? auto.amount : null);
  const total = Math.round((rideFare + (cardAmount || 0)) * 100) / 100;

  const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
  const tail = [];
  if (toll) tail.push(`${money(toll)} tolls`);
  if (cardAmount) tail.push(`${money(cardAmount)} ${result.cardFeeLabel || (auto ? auto.label : 'card')} fee`);

  const openWith = `${money(driving)} fare − ${money(applied)} discount`;
  const quietly = `${money(newDriving)} fare`;

  return Object.assign({}, result, {
    discount: asked,
    discountApplied: applied,
    discountUnused: unused || 0,
    discountNote: unused
      ? `${money(unused)} of the credit is more than the fare — it stays on their balance.`
      : null,
    fareBeforeDiscount: driving,
    fare: newDriving,
    rideFare,
    cardFee: cardAmount,
    cardFeeLabel: cardAmount ? (result.cardFeeLabel || (auto ? auto.label : 'Card')) : null,
    cardFeeRate: cardAmount && auto ? `${(auto.rate * 100).toFixed(1)}% + $${auto.fixed.toFixed(2)}` : result.cardFeeRate,
    total,
    totalDisplay: `${money(total)} flat`,
    // The tip follows what they actually pay for the driving, not what it
    // would have been. Nobody tips on a discount they were given.
    tipSuggested: Math.round(newDriving * 0.2),
    display: `${money(total)} flat (${[openWith].concat(tail).join(' + ')})`,
    driverDisplay: `${money(total)} flat (${[quietly].concat(tail).join(' + ')})`,
  });
}

// The public estimator. It prices the ride exactly as it always has, then
// takes the discount off the answer.
function estimateFare(pickup, dropoff, vehicle, dateTime, payMethod, overrides) {
  const ov = (typeof overrides === 'object' && overrides !== null) ? overrides : { fare: overrides };
  const priced = priceRide(pickup, dropoff, vehicle, dateTime, payMethod, ov);
  // Anything that never had a discount still needs driverDisplay, or the
  // calendar has nothing to print.
  const base = Object.assign({ discount: 0, discountApplied: 0, driverDisplay: priced.display }, priced);
  return applyDiscount(base, ov.discount, payMethod, numOrNull(ov.cardFee));
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
  OVERNIGHT_FEE,
  TOLLS,
};
