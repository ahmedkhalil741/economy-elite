// This function runs on Netlify's server, never in the customer's browser.
// The Stripe SECRET key lives here (as an environment variable) and is never exposed.
//
// Setup required in Netlify dashboard (Site settings → Environment variables):
//   STRIPE_SECRET_KEY = sk_test_... (or sk_live_... when you go live)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pickup, dropoff, fareCents, customerEmail } = JSON.parse(event.body);

    if (!pickup || !dropoff || !fareCents || fareCents < 50) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid booking details.' }) };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'EconomyElite ride',
              description: `${pickup} → ${dropoff}`,
            },
            unit_amount: fareCents, // Stripe uses cents, e.g. $18.50 -> 1850
          },
          quantity: 1,
        },
      ],
      customer_email: customerEmail || undefined,
      success_url: `${process.env.URL}/?booking=success`,
      cancel_url: `${process.env.URL}/?booking=cancelled`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
