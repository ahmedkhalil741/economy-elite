// What each payment method costs to accept, and therefore what gets added
// to the customer's bill as the card fee.
//
// Ahmed's decision (2026-09-13): the card fee is PASSED ON to the customer
// rather than absorbed. So it's added on top of the fare and included in
// fare_total — the customer pays fare + card fee.
//
// ---- RATES ----
// Looked up September 2026. Check these against a real payout statement
// once money starts moving, and correct them here — processors change
// their pricing and the rate can depend on the specific account.
//
//   Zelle      nothing — bank to bank, no merchant fee
//   Card       2.6% + $0.15   EVERY card is tapped in the car on the Square
//                             reader — credit, debit, and phone wallets like
//                             Apple Pay all run through it at this rate. The
//                             customer only ever sees the word "Card".
//   Venmo      nothing — Ahmed's call, 2026-10-06. Only card costs the
//                             customer anything now.
//   Cash       nothing
//
// ---- TWO THINGS TO KNOW ABOUT SURCHARGING ----
// 1. It has to be disclosed before the customer books, not sprung on them
//    at payment. The booking form says so.
// 2. Card network rules permit surcharging CREDIT cards but NOT debit
//    cards. Ahmed's decision (2026-09-13) is to charge the fee on every
//    card including debit. That's a rule set by Visa/Mastercard rather
//    than by law, and the consequence lands with Square — fines or losing
//    card acceptance — so it's worth confirming directly with them. To
//    stop surcharging a method, set its entry below to null.
//
// ---- WHY THE FEE IS DIVIDED BY (1 - rate) ----
//
// Square charges its percentage on the WHOLE amount swiped, and the surcharge
// is part of that amount. Work the fee out on the fare alone and Square then
// takes a percentage of the fee as well, so the fare arrives short: 5c on a
// $75 Newark run, 25c on a Philadelphia one. Small, and it was left that way
// on purpose, because a surcharge must never exceed the real cost of
// accepting the card and erring low is the safe side of that line.
//
// Ahmed's call, 23 October: cover it exactly instead. Dividing by (1 - rate)
// lands the fee precisely on the cost rather than under it — on the line, not
// over it, which is what the rule asks. Checked at every rate and amount on
// the card: what Square deducts and what the customer paid come out equal to
// the cent, and the fare lands whole.
//
// ---- THE TIP, AND WHEN IT COUNTS ----
//
// It was left out of this entirely until 30 October, on the reasoning that a
// price quoted before the customer has decided anything cannot include a
// gratuity. That half still holds, and the booking page still quotes fare and
// tolls alone.
//
// What was wrong was the other half. Square's percentage comes off the WHOLE
// amount swiped, tip included, so on a $110 ride with a $22 tip the fee
// collected on $110 leaves about 60c of Square's cut being paid by Ahmed
// rather than recovered. His call, and the arithmetic is on his side.
//
// So the fee base takes an optional tip - see _fare-calc.js. It is an
// override, never an assumption: the dispatch fills it in once there is a
// real figure to charge, and everything else carries on as before.

const CARD_FEES = {
  cash: null,
  zelle: null,
  // "Card" is what the customer, the driver and the sheet all say now.
  // Ahmed's decision, 2026-09-18: naming the processor told nobody anything
  // useful and made the bill read like an advert for somebody else. Square is
  // still what actually runs the payment, and the privacy policy still says
  // so, because that is a disclosure rather than a label.
  //
  // `square` and `apple pay` stay as aliases. Every booking taken before this
  // change has "Square" in its payment_method cell, and a stored value that
  // no longer prices is a silent zero-fee ride.
  card: { rate: 0.026, fixed: 0.15, label: 'Card' },
  // A SAVED CARD COSTS MORE, and it is worth knowing by how much.
  //
  // A card kept on file is card-not-present, the same family as typing the
  // number in, so Square charges the higher rate. The customer is still
  // quoted the tapped price - Ahmed's call, and the right one: everybody pays
  // the same and nobody is penalised for how the reader happened to behave.
  // This entry exists so the difference can be COUNTED at year end rather
  // than guessed at.
  //
  // THE CARD NUMBER ITSELF IS NEVER STORED HERE, or anywhere in this project.
  // A card on file lives in Square, which keeps it and charges it; this
  // codebase only ever records that a saved card was used.
  'card on file': { rate: 0.035, fixed: 0.15, label: 'Card on file' },
  square: { rate: 0.026, fixed: 0.15, label: 'Card' },
  'apple pay': { rate: 0.026, fixed: 0.15, label: 'Card' },
  // Was 1.9% + $0.10 on a Venmo business profile. Set to null on Ahmed's
  // instruction — cash, Zelle and Venmo all cost the customer nothing, and
  // card is the only method that adds anything.
  venmo: null,
};

// Returns { amount, label, rate, fixed } for a method that costs something,
// or null for cash, Zelle, an unrecognised method, or a fare with no single
// number to calculate against.
function cardFeeFor(payMethod, fareAmount) {
  const key = String(payMethod || '').trim().toLowerCase();
  const plan = CARD_FEES[key];
  if (!plan) return null;
  if (typeof fareAmount !== 'number' || !isFinite(fareAmount) || fareAmount <= 0) return null;

  const amount = Math.round(((fareAmount * plan.rate + plan.fixed) / (1 - plan.rate)) * 100) / 100;
  return { amount, label: plan.label, rate: plan.rate, fixed: plan.fixed };
}

// "2.6% + $0.15" — for the owner email, so the number is never a mystery.
function cardFeeRateText(fee) {
  if (!fee) return '';
  return `${(fee.rate * 100).toFixed(1)}% + $${fee.fixed.toFixed(2)}`;
}

module.exports = { CARD_FEES, cardFeeFor, cardFeeRateText };
