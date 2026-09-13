// Sends a booking notification email to the business owner whenever a
// customer submits the booking form — regardless of payment method.
//
// Setup required in Netlify dashboard (Site settings → Environment variables):
//   RESEND_API_KEY   = your API key from resend.com (free tier: 100 emails/day)
//   OWNER_EMAIL      = thestandard.nj@yahoo.com  (where booking alerts go)
//   FROM_EMAIL       = onboarding@resend.dev  (works immediately with no setup;
//                       switch to a verified economyelite.com address later)

const { estimateFare, isOvernightPickup } = require('./_fare-calc');
const { formatRequestedDateTime } = require('./_format');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const {
      name, pickup, dropoff, dateTime, phone, notes, payMethod,
      passengers, carSeats, flight, temp, elderly, contact15, vehicle,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff || !phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const fare = estimateFare(pickup, dropoff, vehicle);
    const overnight = isOvernightPickup(dateTime);
    const hourly = !fare.matched;

    const fareRows = fare.matched && fare.total !== null
      ? `
        <tr><td style="padding:2px 12px 2px 0; color:#888;">Base fare</td><td>$${fare.base}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#888;">SUV fee</td><td>$${fare.suvFee}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#888; font-weight:bold;">Fare total</td><td style="font-weight:bold;">$${fare.total}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#888;">Toll</td><td>Add after the ride — not calculated automatically</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#888;">Waiting / late-pickup fee</td><td>Only if the driver waits past the free window — add after the ride</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#888;">Suggested tip (20%)</td><td>$${fare.tipSuggested}</td></tr>
      `
      : fare.matched
        ? `<tr><td style="padding:2px 12px 2px 0; color:#888; font-weight:bold;" colspan="2">${fare.totalDisplay} — matched: ${fare.label}</td></tr>`
        : `<tr><td colspan="2">${fare.display}</td></tr>`;

    const emailBody = `
      <h2>New booking request — The Standard</h2>
      <p><strong>Customer name:</strong> ${name || 'N/A'}</p>
      <p><strong>Pickup:</strong> ${pickup}</p>
      <p><strong>Drop-off:</strong> ${dropoff}</p>
      <p><strong>Requested time:</strong> ${formatRequestedDateTime(dateTime)}${overnight ? ' <span style="color:#c9a227;">(overnight pickup)</span>' : ''}</p>
      <p><strong>Vehicle:</strong> ${vehicle || 'SUV'}</p>
      <p><strong>Customer phone:</strong> ${phone}</p>
      ${passengers ? `<p><strong>Passengers:</strong> ${passengers}</p>` : ''}
      <p><strong>Car seats needed:</strong> ${carSeats && carSeats !== '0' ? carSeats : 'None'}</p>
      <p><strong>Elderly assistance needed:</strong> ${elderly ? 'Yes' : 'No'}</p>
      <p><strong>Flight number:</strong> ${flight || 'N/A'}</p>
      <p><strong>Cabin temperature:</strong> ${temp || 'No preference'}</p>
      <p><strong>Text/call 15 min before pickup:</strong> ${contact15 ? 'Yes' : 'No'}</p>
      <p><strong>Payment method:</strong> ${payMethod || 'N/A'}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
      <hr>
      <div style="background:#fff6dd; border-left:3px solid #c9a227; padding:10px 14px; font-size:0.95em;">
        <strong>Estimated fare breakdown</strong>
        <table style="margin-top:6px; border-collapse:collapse;">${fareRows}</table>
        <div style="margin-top:6px;">Overnight trip (12 AM–5:59 AM pickup): <strong>${overnight ? 'Yes' : 'No'}</strong> &nbsp;•&nbsp; Hourly job (no fixed route match): <strong>${hourly ? 'Yes' : 'No'}</strong></div>
        <div style="color:#888; font-size:0.85em; margin-top:6px;">Internal estimate only. Confirm the final number with the customer before it's locked in.</div>
      </div>
      <p style="color:#888; font-size:0.85em;">This booking is not yet confirmed with the customer — let them know the price as soon as possible.</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
        to: process.env.OWNER_EMAIL,
        subject: `New booking: ${pickup} → ${dropoff}`,
        html: emailBody,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Email send failed: ${errText}`);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
