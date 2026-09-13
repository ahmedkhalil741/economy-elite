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
//   Square     2.6% + $0.15   EVERY card is tapped in the car on the Square
//                             reader — credit, debit, and phone wallets like
//                             Apple Pay all run through it at this rate
//   Venmo      1.9% + $0.10   business profile
//   Cash       nothing        no longer offered on the site, kept so phone
//                             bookings entered by hand don't get a fee
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
// The fee is worked out on the fare and then added, which leaves a few
// cents of the processor's cut uncovered (the processor also takes its
// percentage of the fee itself). That's deliberate: a surcharge must never
// exceed the actual cost of accepting the card, so erring low is the safe
// side.

const CARD_FEES = {
  cash: null,
  zelle: null,
  square: { rate: 0.026, fixed: 0.15, label: 'Square' },
  'apple pay': { rate: 0.026, fixed: 0.15, label: 'Apple Pay' },
  venmo: { rate: 0.019, fixed: 0.10, label: 'Venmo' },
};

// Returns { amount, label, rate, fixed } for a method that costs something,
// or null for cash, Zelle, an unrecognised method, or a fare with no single
// number to calculate against.
function cardFeeFor(payMethod, fareAmount) {
  const key = String(payMethod || '').trim().toLowerCase();
  const plan = CARD_FEES[key];
  if (!plan) return null;
  if (typeof fareAmount !== 'number' || !isFinite(fareAmount) || fareAmount <= 0) return null;

  const amount = Math.round((fareAmount * plan.rate + plan.fixed) * 100) / 100;
  return { amount, label: plan.label, rate: plan.rate, fixed: plan.fixed };
}

// "2.6% + $0.15" — for the owner email, so the number is never a mystery.
function cardFeeRateText(fee) {
  if (!fee) return '';
  return `${(fee.rate * 100).toFixed(1)}% + $${fee.fixed.toFixed(2)}`;
}

module.exports = { CARD_FEES, cardFeeFor, cardFeeRateText };
