# EconomyElite

EconomyElite is a side business project I created to target the middle class — people who want a trustworthy, professional, VIP-style ride experience without paying limousine prices.

The idea: pricing close to Uber, but with professional, trusted drivers who won't cancel on you last minute. A reliable, VIP-feeling ride without the limousine cost.

It's also about being fair to the driver — making sure they get what they deserve for their work, instead of working hard without respect like on platforms such as Uber. The client gets a luxurious ride at a fair price, and the driver gets treated fairly too.

## Status
Still in progress. Online prepayment (Stripe) is on hold for now since the site no longer quotes a live fare up front (see below) — `create-checkout.js` is still in the repo, unused, for whenever that comes back. Right now bookings are reservation requests: the owner confirms price, driver, and timing with the customer directly.

## Booking notifications & record-keeping

Every web booking now does three things automatically (see `netlify/functions/`):

1. **Emails the owner** (`send-booking-notification.js`) — sends a booking alert to `economyelite_NJ@yahoo.com` via Resend.
2. **Adds it to Google Calendar** (`add-to-calendar.js`) — using a Google Service Account.
3. **Logs it to a Google Sheet** (`log-booking.js`) — one running spreadsheet of every reservation (route, passengers, car seats, elderly assistance, flight, drink preference, payment method, notes), so it can all be pulled together at year-end for taxes/analysis (opens in Excel, or loads into Python/pandas or SQL later).

For bookings taken by **phone or email** (not through the website), add a row to that same Google Sheet by hand so everything ends up in one place. Use these columns, in this order:

`Timestamp | Requested Date/Time | Pickup | Drop-off | Phone | Passengers | Car Seats | Elderly Assistance | Flight | Drink Preference | Text 15min Before | Payment Method | Notes | Source`

(Set `Source` to `Phone` or `Email` for those rows, so you can filter web vs. phone vs. email bookings later.)

### One-time setup required (Netlify dashboard → Site settings → Environment variables)

**Email notifications (Resend):**
- `RESEND_API_KEY` — from resend.com (free tier: 100 emails/day)
- `OWNER_EMAIL` = `economyelite_NJ@yahoo.com`
- `FROM_EMAIL` = `onboarding@resend.dev` (works immediately; switch to a verified economyelite.com address later)

**Calendar + Sheet logging (Google Service Account — shared by both):**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `GOOGLE_CALENDAR_ID` (for Calendar)
- `GOOGLE_SHEET_ID` (for the reservations log — see `log-booking.js` for the one-time steps: enable Google Sheets API, create the sheet, share it with the service account email, copy its ID)

**Payments (Stripe):**
- `STRIPE_SECRET_KEY`

### Not yet done
- No business phone number yet, so there's no SMS/text notification for bookings yet (email covers it for now). Once there's a number, we can add a Twilio SMS notification alongside the email one.
