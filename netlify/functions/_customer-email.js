// The email the CUSTOMER gets, seconds after they press Book.
//
// WHY IT EXISTS. Until now a customer filled in the form, saw a line of text on
// the page, and then heard nothing. The system emailed Ahmed and nobody else.
// A first-time customer who has just handed over a 5am airport run to a company
// they have never used is left wondering whether any of it arrived. That gap is
// where people phone a competitor "just to be sure".
//
// WHAT IT CAREFULLY DOES NOT SAY. It never says "confirmed". A web booking is a
// REQUEST: Ahmed confirms the price, the driver and the timing himself. An
// email that says confirmed and is then followed by a different number is worse
// than no email, because the customer has already decided what they are paying.
// So: we have it, here is exactly what you asked for, here is what it should
// cost, Hany will come back to you.
//
// The price shown is the same one the customer saw on screen, broken the same
// way. The discount is shown - it is theirs and Ahmed's. Only the driver's copy
// hides it.

const { sendEmail } = require('./_email');
const { formatRequestedDateTime } = require('./_format');

const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;

// Deliberately strict rather than clever. A malformed address makes Resend
// reject the whole send, and this must never be the thing that breaks a
// booking, so anything doubtful is simply not emailed.
function looksLikeEmail(value) {
  const s = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length < 254;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function row(k, v, strong) {
  return `<tr>
    <td style="padding:7px 16px 7px 0;color:#8A8272;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td>
    <td style="padding:7px 0;color:${strong ? '#111' : '#333'};font-size:${strong ? '16px' : '14px'};font-weight:${strong ? '600' : '400'}">${v}</td>
  </tr>`;
}

function priceBlock(fare) {
  if (!fare || !fare.matched || fare.total === null || fare.total === undefined) {
    return `<p style="margin:0;color:#333;font-size:14px;line-height:1.6">
      This route isn't on our standard rate card, so Hany will work out the price
      and come back to you with it before anything is agreed.</p>`;
  }
  const shown = fare.fareBeforeDiscount ?? fare.fare;
  const lines = [];
  if (shown != null) lines.push(row('Fare', money(shown)));
  if (fare.discountApplied) lines.push(row('Your credit', `&minus; ${money(fare.discountApplied)}`));
  if (fare.toll) lines.push(row('Tolls', money(fare.toll)));
  if (fare.cardFee) lines.push(row(`${fare.cardFeeLabel || 'Card'} fee`, money(fare.cardFee)));
  lines.push(row('Total', money(fare.total), true));

  return `<table style="border-collapse:collapse">${lines.join('')}</table>
    ${fare.tipSuggested ? `<p style="margin:10px 0 0;color:#8A8272;font-size:13px;line-height:1.6">
      A tip is separate and never added for you &mdash; 20% of the fare is usual, about
      ${money(fare.tipSuggested)} on this trip.</p>` : ''}`;
}

// Never throws. A booking must not fail because an email did.
async function sendCustomerConfirmation(booking, fare) {
  const { email, name, pickup, dropoff, dateTime, vehicle, payMethod } = booking;
  if (!looksLikeEmail(email)) return { sent: false, reason: 'no usable email' };

  const first = String(name || '').trim().split(/\s+/)[0];
  const when = formatRequestedDateTime(dateTime);
  const phone = '(908) 494-9256';

  const html = `
  <div style="background:#F6F4EF;padding:28px 16px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
   <div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #E5E0D6;border-radius:10px;overflow:hidden">

    <div style="background:#0B0A08;padding:22px 26px">
      <div style="color:#F2EDE3;font-family:Georgia,serif;font-size:19px;font-weight:700">The Standard</div>
      <div style="color:#8A8272;font-size:10px;letter-spacing:.2em;text-transform:uppercase;margin-top:4px">Private Car Services</div>
    </div>

    <div style="padding:26px">
      <p style="margin:0 0 6px;font-size:17px;color:#111;font-weight:600">
        ${first ? `Thanks, ${esc(first)} &mdash; we&rsquo;ve got your request.` : 'We&rsquo;ve got your request.'}</p>
      <p style="margin:0 0 22px;color:#555;font-size:14px;line-height:1.65">
        Hany will text you shortly to confirm your driver and your total. Nothing is
        charged until then, and the price below is what we expect it to be.</p>

      <table style="border-collapse:collapse;width:100%">
        ${row('Pickup', esc(pickup))}
        ${row('Drop-off', esc(dropoff))}
        ${row('When', esc(when))}
        ${row('Vehicle', esc(vehicle || 'SUV'))}
        ${payMethod ? row('Paying by', esc(payMethod)) : ''}
      </table>

      <div style="margin:22px 0 0;padding:18px;background:#FAF8F4;border:1px solid #E5E0D6;border-radius:8px">
        <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8A8272;margin-bottom:10px">What it should come to</div>
        ${priceBlock(fare)}
      </div>

      <p style="margin:22px 0 0;color:#555;font-size:14px;line-height:1.65">
        Need to change something, or want to talk it through? Call or text
        <a href="tel:9084949256" style="color:#111;font-weight:600;text-decoration:none">${phone}</a>.
        Cancelling is free more than 2 hours before pickup.</p>
    </div>

    <div style="padding:16px 26px;background:#FAF8F4;border-top:1px solid #E5E0D6;color:#8A8272;font-size:12px;line-height:1.6">
      The Standard &middot; New Providence, NJ &middot;
      <a href="https://standardnj.com" style="color:#8A8272">standardnj.com</a>
    </div>

   </div>
  </div>`;

  try {
    await sendEmail({
      to: email.trim(),
      subject: `We've got your ride request — ${when}`,
      html,
      // So a customer hitting reply reaches Ahmed, not a no-reply void.
      replyTo: process.env.OWNER_EMAIL,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: String(err.message || err) };
  }
}

module.exports = { sendCustomerConfirmation, looksLikeEmail };
