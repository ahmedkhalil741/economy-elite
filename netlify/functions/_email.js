// One place to send mail, so the booking notification, the customer-milestone
// alerts and the driver's ride sheet don't each carry their own copy of the
// Resend plumbing.
//
// Uses the same environment variables already set in Netlify:
//   RESEND_API_KEY, OWNER_EMAIL, FROM_EMAIL

// `attachments` is Resend's shape: [{ filename, content }] where content is
// base64. The driver's ride sheet uses it to carry a .ics calendar file.
async function sendEmail({ to, subject, html, attachments, replyTo }) {
  if (!to) throw new Error('No recipient.');

  const body = {
    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (attachments && attachments.length) body.attachments = attachments;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Email send failed: ${errText}`);
  }

  return true;
}

async function sendOwnerEmail(subject, html) {
  return sendEmail({ to: process.env.OWNER_EMAIL, subject, html });
}

module.exports = { sendEmail, sendOwnerEmail };
