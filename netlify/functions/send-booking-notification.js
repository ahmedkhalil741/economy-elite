// Sends a booking notification email to the business owner whenever a
// customer submits the booking form — regardless of payment method.
//
// Setup required in Netlify dashboard (Site settings → Environment variables):
//   RESEND_API_KEY   = your API key from resend.com (free tier: 100 emails/day)
//   OWNER_EMAIL      = economyelite_NJ@yahoo.com  (where booking alerts go)
//   FROM_EMAIL       = onboarding@resend.dev  (works immediately with no setup;
//                       switch to a verified economyelite.com address later)

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pickup, dropoff, dateTime, phone, notes, fareText, payMethod } = JSON.parse(event.body);

    if (!pickup || !dropoff || !phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
    }

    const emailBody = `
      <h2>New EconomyElite booking request</h2>
      <p><strong>Pickup:</strong> ${pickup}</p>
      <p><strong>Drop-off:</strong> ${dropoff}</p>
      <p><strong>Requested time:</strong> ${dateTime || 'Not specified'}</p>
      <p><strong>Customer phone:</strong> ${phone}</p>
      <p><strong>Estimated fare:</strong> ${fareText || 'N/A'}</p>
      <p><strong>Payment method:</strong> ${payMethod || 'N/A'}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
      <hr>
      <p style="color:#888; font-size:0.85em;">This booking is not yet confirmed with the customer. Confirm as soon as possible, or the customer will be automatically notified of the estimated availability time.</p>
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
