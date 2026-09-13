// Sends a booking notification email to the business owner whenever a
// customer submits the booking form — regardless of payment method.
//
// Setup required in Netlify dashboard (Site settings → Environment variables):
//   RESEND_API_KEY   = your API key from resend.com (free tier: 100 emails/day)
//   OWNER_EMAIL      = thestandard.nj@yahoo.com  (where booking alerts go)
//   FROM_EMAIL       = onboarding@resend.dev  (works immediately with no setup;
//                       switch to a verified economyelite.com address later)

const { estimateFare } = require('./_fare-calc');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const {
      name, pickup, dropoff, dateTime, phone, notes, payMethod,
      passengers, carSeats, flight, temp, elderly, contact15,
    } = JSON.parse(event.body);

    if (!pickup || !dropoff || !phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const fare = estimateFare(pickup, dropoff);

    const emailBody = `
      <h2>New booking request — The Standard</h2>
      <p><strong>Customer name:</strong> ${name || 'N/A'}</p>
      <p><strong>Pickup:</strong> ${pickup}</p>
      <p><strong>Drop-off:</strong> ${dropoff}</p>
      <p><strong>Requested time:</strong> ${dateTime || 'Not specified'}</p>
      <p><strong>Customer phone:</strong> ${phone}</p>
      <p><strong>Passengers:</strong> ${passengers || 'N/A'}</p>
      <p><strong>Car seats needed:</strong> ${carSeats && carSeats !== '0' ? carSeats : 'None'}</p>
      <p><strong>Elderly assistance needed:</strong> ${elderly ? 'Yes' : 'No'}</p>
      <p><strong>Flight number:</strong> ${flight || 'N/A'}</p>
      <p><strong>Cabin temperature:</strong> ${temp || 'No preference'}</p>
      <p><strong>Text/call 15 min before pickup:</strong> ${contact15 ? 'Yes' : 'No'}</p>
      <p><strong>Payment method:</strong> ${payMethod || 'N/A'}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
      <hr>
      <p style="background:#fff6dd; border-left:3px solid #c9a227; padding:10px 14px; font-size:0.95em;">
        <strong>Estimated fare:</strong> ${fare.display}${fare.matched ? ` — matched: ${fare.label}` : ''}<br>
        <span style="color:#888; font-size:0.85em;">Internal estimate only — tolls, parking, and gratuity are additional. Confirm the final number with the customer before it's locked in.</span>
      </p>
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
