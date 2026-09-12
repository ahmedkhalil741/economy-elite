# The Standard

The Standard is a side business project I created to target the middle class — people who want a trustworthy, professional, VIP-style ride experience without paying limousine prices.

The idea: pricing close to Uber, but with professional, trusted drivers who won't cancel on you last minute. A reliable, VIP-feeling ride without the limousine cost.

It's also about being fair to the driver — making sure they get what they deserve for their work, instead of working hard without respect like on platforms such as Uber. The client gets a luxurious ride at a fair price, and the driver gets treated fairly too.

## Status
Still in progress. Online prepayment (Stripe) is on hold for now since the site no longer quotes a live fare up front (see below) — `create-checkout.js` is still in the repo, unused, for whenever that comes back. Right now bookings are reservation requests: the owner confirms price, driver, and timing with the customer directly.

## Booking notifications & record-keeping

Every web booking now does four things automatically (see `netlify/functions/`):

1. **Emails the owner** (`send-booking-notification.js`) — sends a booking alert to `thestandard.nj@yahoo.com` via Resend.
2. **Adds it to Google Calendar** (`add-to-calendar.js`) — using a Google Service Account.
3. **Logs it to a Google Sheet** (`log-booking.js`) — one running spreadsheet of every reservation (name, route, passengers, car seats, elderly assistance, flight, drink preference, payment method, notes), so it can all be pulled together at year-end for taxes/analysis (opens in Excel, or loads into Python/pandas or SQL later).
4. **Saves/updates the customer's profile** (`save-customer.js`) — a separate "Customers" tab that remembers each customer's name and preferences (drink, cabin temperature, car seats, elderly assistance) across visits, so returning customers get recognized automatically the next time they book (see `get-customer.js`, which reads this back to prefill the booking form).

For bookings taken by **phone, text, or email** (not through the website), use the private quick-entry page at `admin-booking.html` instead of typing directly into the sheet. It has the exact same fields as the real booking form, plus a dropdown for how the booking came in (Phone / Text / Email), and it calls the same four functions above — so it lands in the sheet in the exact same format as a web booking, and updates the customer's saved profile the same way. It's gated by a simple PIN (see `ADMIN_PIN` near the bottom of that file to change it) — this is only a deterrent against a stumbled-on link, not real security, since the PIN lives in the page's own source code.

**Bookings sheet columns**, in order:

`Timestamp | Requested Date/Time | Pickup | Drop-off | Name | Phone | Passengers | Car Seats | Elderly Assistance | Flight | Drink Preference | Cabin Temperature | Text 15min Before | Payment Method | Notes | Source`

**Customers sheet** — a second tab in the same spreadsheet, named exactly `Customers`, with these columns:

`Phone | Name | Drink Preference | Cabin Temperature | Car Seats Needed | Elderly Assistance | Notes | Total Rides | First Ride | Last Ride`

Both tabs live in the one Google Sheet already set up for `GOOGLE_SHEET_ID` — no new environment variables needed for the Customers tab, it reuses the same service account.

### One-time setup required (Netlify dashboard → Site settings → Environment variables)

**Email notifications (Resend):**
- `RESEND_API_KEY` — from resend.com (free tier: 100 emails/day)
- `OWNER_EMAIL` = `thestandard.nj@yahoo.com`
- `FROM_EMAIL` = `onboarding@resend.dev` (works immediately; switch to a verified domain address later, once the new domain is set up)

**Calendar + Sheet logging (Google Service Account — shared by both):**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `GOOGLE_CALENDAR_ID` (for Calendar)
- `GOOGLE_SHEET_ID` (for the reservations log — see `log-booking.js` for the one-time steps: enable Google Sheets API, create the sheet, share it with the service account email, copy its ID)

**Payments (Stripe):**
- `STRIPE_SECRET_KEY`

### Not yet done
- No business phone number yet, so there's no SMS/text notification for bookings yet (email covers it for now). Once there's a number, we can add a Twilio SMS notification alongside the email one.
