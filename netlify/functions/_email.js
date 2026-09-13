// One place to send mail to the business owner, so the booking notification
// and the customer-milestone alerts don't each carry their own copy of the
// Resend plumbing.
//
// Uses the same environment variables already set in Netlify:
//   RESEND_API_KEY, OWNER_EMAIL, FROM_EMAIL

async function sendOwnerEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
      to: process.env.OWNER_EMAIL,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Email send failed: ${errText}`);
  }

  return true;
}

module.exports = { sendOwnerEmail };
