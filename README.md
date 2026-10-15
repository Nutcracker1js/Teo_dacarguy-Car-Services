# Teo_dacarguy Car Services

The customer-facing site is plain HTML, CSS and browser JavaScript. Its Node.js API stores bookings, enquiries and their optional attachments in PostgreSQL and private disk storage.

## Project layout

Keep public website pages at the repository root so GitHub Pages URLs stay stable. Browser assets live under `assets/` and are copied into the API's generated `dist/` directory for production hosting.

- Root `*.html`: customer pages and the admin entry page. Keeping pages at the root preserves GitHub Pages URLs.
- `assets/css/`: shared styles, catalogue/project page styles, and isolated admin styles.
- `assets/js/`: shared site behavior, customer booking/payment scripts, the admin dashboard, and chat widget.
- `booking-status.html` and `payment.html` with their matching scripts: customer booking lookup and checkout.
- `api/`: Express server, API routes, database setup, integrations and automated tests. `schema.sql` defines the PostgreSQL schema.
- `images/`: public site images and media. Customer-submitted attachments are stored separately outside the public site.
- `dist/`: generated deployment output. Rebuild it with `npm run build:site`; do not edit it directly.
- `render.yaml`, `docker-compose.yml` and `.env.example`: deployment, local database and environment configuration.

## Project commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact dependencies recorded in `package-lock.json`. |
| `npm run db:up` | Start the local PostgreSQL service with Docker Compose. |
| `npm run db:init` | Create or update the database schema. |
| `npm run build:site` | Rebuild the public website in `dist/`. |
| `npm test` | Run the API and integration tests with Node's test runner. |
| `npm run dev` | Run the API and website with Node's file watcher. |
| `npm start` | Run the API and website for normal local or production hosting. |

## Run locally

Requirements: Node.js 20 or newer and PostgreSQL 17 or newer. Docker Desktop is an option for running the database locally.

1. Install dependencies: `npm ci`.
2. Copy `.env.example` to `.env`. Its credentials are for local development only; change them if the database is reachable by anyone else.
3. Start the local PostgreSQL database using Docker Desktop: `npm run db:up`. If PostgreSQL is already installed, configure the `DATABASE_URL` in `.env` to use it instead.
4. Create the tables: `npm run db:init`.
5. Set `SERVE_WEBSITE=true`, a private `ADMIN_USERNAME`, and a unique `ADMIN_PASSWORD` of at least 16 characters in `.env`.
6. Build the website files for local hosting: `npm run build:site`.
7. Start the combined website and API: `npm start` (or `npm run dev` during development). Confirm it responds at `http://localhost:3000/api/health`.
8. Open the admin booking centre at `http://localhost:3000/admin` (or `http://localhost:3000/admin.html`). The public website and form API now share the same origin.

Restart the API after changing `.env`. The recommended local address is `http://localhost:3000`, where the website and API share an origin. If the site is served separately from the API, add its exact origin (including port) to `CORS_ORIGINS` and set the `api-base-url` meta tag in `index.html`, `booking.html`, `consultation.html` and `admin.html` to the API's base URL. This is required for homepage reviews as well as form submissions. Common local preview ports are listed in `.env.example`. Opening pages with `file://` is not supported; use the combined HTTP server above.

## Deploy the online API and website to Render

This repository includes a Render Blueprint in `render.yaml` that creates one HTTPS web service for the site and API, a private PostgreSQL database, a persistent private-upload disk, and a generated admin password. Serving the website and API from the same service prevents static hosting from returning `405 Method Not Allowed` to form `POST` requests.

1. Push the repository to GitHub, then in Render choose **New → Blueprint** and connect that repository.
2. Review the resources, regions, database and disk plan/costs in Render before approving creation. The Blueprint requests paid persistent resources so uploaded files and database data survive deploys.
3. After Render reports the service healthy, open the service's `onrender.com` URL. Its `/api/health` route confirms API and database connectivity; use `/admin.html` for the inbox.
4. Find the generated `ADMIN_PASSWORD` in the Render service's environment settings and sign in as `teo_admin`. Change the password after first sign-in by replacing the generated value with a unique secret of at least 16 characters.
5. Set `PUBLIC_SITE_URL` to the service's assigned HTTPS `onrender.com` URL (the current `render.yaml` is prefilled with this service URL). If it is unset on Render, the app uses Render's `RENDER_EXTERNAL_URL` as a fallback for customer links. Set the matching Paystack `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` to enable Inline checkout; the public key is intentionally sent to the browser, while the secret key must remain server-only. `render.yaml` includes the supplied test public key, so use a matching test secret for test transactions. For live payments, replace it with the live public key and configure the matching live secret in Render. To enable email, provide `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `NOTIFICATION_EMAIL`; `SMTP_PORT` defaults to `587`. To enable business WhatsApp notifications, provide `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT` and `WHATSAPP_TEMPLATE_NAME`. The separate approved booking message also requires `WHATSAPP_APPROVAL_TEMPLATE_NAME`. The Blueprint marks private provider credentials as secrets to enter during setup; it generates a private admin password automatically. Until each provider is configured, its feature stays unavailable; saved booking references remain available through the site.

If the existing Render service was created manually rather than from this Blueprint, syncing `render.yaml` will not automatically apply its settings. Add the environment variables in the Render service dashboard and redeploy. At minimum, set `SERVE_WEBSITE=true`, `PUBLIC_SITE_URL` to the service's HTTPS URL, `ADMIN_USERNAME=teo_admin`, and a unique `ADMIN_PASSWORD` of at least 16 characters. To enable payments, add both `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY`, ensuring both keys are from the same Paystack mode (test or live). Email and WhatsApp warnings remain until their provider credentials and approved WhatsApp template names are added. Never use the placeholder or example values as production credentials.

The GitHub Pages site at `https://nutcracker1js.github.io/Teo_dacarguy-Car-Services/` uses the Render API at `https://teo-dacarguy-car-services.onrender.com`. Browser scripts select that API automatically on the project's GitHub Pages host. The API must allow the exact origin `https://nutcracker1js.github.io` in `CORS_ORIGINS`; this origin is included in `render.yaml` and the server's built-in production allowlist. If the existing Render service was created manually, set `CORS_ORIGINS=https://nutcracker1js.github.io` in its Environment settings and redeploy the API. If GitHub Pages uses a custom domain later, add that domain's origin to `CORS_ORIGINS` as well.

The Render deployment build copies root website HTML, `assets/`, the public `images/` directory, and `tint-options.json` into `dist/`; it does not publish `.env`, the repository, or private uploaded files. The database does not accept inbound public connections. Keep a separate backup policy for PostgreSQL and uploaded files, and use HTTPS for admin access.

## Live chat


## API

- `POST /api/v1/enquiries` stores customer contact details, enquiry type, description and optional vehicle details.
- `POST /api/v1/bookings` requires a customer WhatsApp number and stores contact details, vehicle, service, preferred date/time and location. WhatsApp notification consent remains optional. Appointment times are reserved under a database lock so overlapping requests cannot both reserve the same slot.
- `GET /api/v1/availability?date=YYYY-MM-DD&service=MAINTENANCE` returns the available appointment times for the selected date and service.
- `GET /api/v1/reviews` lists up to 50 newest public customer reviews.
- `POST /api/v1/reviews` publishes a customer review immediately; submissions are limited to 5 per IP per hour.
- `GET /api/health` checks API and database connectivity.

The API applies an overall limit of 300 requests per IP per 15 minutes. More restrictive limits also apply: submissions 20 per 15 minutes, reviews 5 per hour, booking-status lookups 10 per 15 minutes, payments 5 per 15 minutes, and admin endpoints 120 per 15 minutes. Rate-limit responses use HTTP `429` and include standard rate-limit headers. When deployed behind Render's proxy, the API trusts one proxy hop to rate-limit by the originating client IP; keep that setting aligned with the hosting provider if the proxy topology changes. The in-memory counters reset on service restart and are not shared across multiple service instances.

Both submission endpoints accept JSON or `multipart/form-data`. Attachments use the `attachments` field: up to 6 JPG, PNG, WebP, MP4 or MOV files, maximum 15 MB each. The API checks file signatures rather than trusting filenames or browser MIME types. Uploads are stored outside the website directory with randomized names; original names and MIME types are stored as database metadata. Files are not publicly served. Do not move the private upload directory beneath a public web root.

Successful submissions return HTTP `201`, an opaque, randomly generated booking reference, `NEW` status, submission time and attachment count. Invalid input returns HTTP `400`; oversize uploads return `413`. Public submissions are limited to 20 requests per IP every 15 minutes. JSON request bodies are limited to 16 KB.

Reviews are stored in PostgreSQL and displayed on the homepage after submission and on later visits. Reviews are published immediately without moderation, so the service owner should monitor submissions.

## Business notifications

The API can notify the business by both email and WhatsApp after a request is stored. Configure the SMTP and WhatsApp variables in `.env`; leave a channel unconfigured to disable it. Provider errors are logged and returned as `failed` channel statuses without undoing the saved request.

- Email requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `NOTIFICATION_EMAIL`. SMTP uses TLS; `SMTP_SECURE=true` is for implicit-TLS providers (usually port 465), otherwise STARTTLS is required. SMTP connections use IPv4 because the Render deployment reported unreachable IPv6 SMTP routes. Optionally set `SMTP_FROM`.
- WhatsApp requires a Meta WhatsApp Business Cloud API access token, phone number ID, recipient in international format, and an approved message template. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT`, `WHATSAPP_TEMPLATE_NAME` and (if needed) the template language / Graph API version. The approved template body must contain five text placeholders in this order: request type, customer name, customer phone, request reference, short service/enquiry summary.
- Customer booking messages are not sent automatically by the admin API. In booking details, the message choices open WhatsApp with a prefilled draft for the opted-in customer. The person using the admin page must review the draft and tap **Send** in WhatsApp; click-to-chat links cannot send messages automatically. Approval emails include a link to `payment.html`; customers verify their booking with its reference and phone number before opening the Paystack Inline checkout for the confirmed server-side amount. The booking form requires the customer's WhatsApp number and email, with a separate explicit optional WhatsApp opt-in.
- Business booking notifications can still be sent to the configured business WhatsApp recipient using an approved `WHATSAPP_TEMPLATE_NAME`. Custom customer drafts and payment-verified drafts do not require Meta message templates. Free-form messages can only be sent within WhatsApp's customer-service window, so WhatsApp may reject sending a draft outside that window.

Never commit provider credentials. Add them only to the ignored local `.env` file or the deployment's secret manager.

## Admin inbox

Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters on the API server. Open `admin.html` on the website, then sign in with those credentials. The booking centre provides database-backed attention metrics, booking search and filters, booking details, private notes and status history, separate payment/refund records, appointment calendar views, working hours, service durations, blocked dates/times, and customer review management. Only a successful server-side Paystack verification can mark a payment as paid; administrators cannot set that status manually.

If no custom schedule has been saved, the booking page offers standard Monday–Saturday times from 8:00 AM to 7:00 PM, using a one-hour service duration. The API hides past, blocked and overlapping times and checks availability again when a booking is submitted. Teo can customize open days, hours and service durations under **Availability & calendar**; the backend enforces those settings. If the availability service cannot be reached, the form still displays standard times and rechecks the requested time at submission. Pending review, awaiting payment, awaiting approval, approved and confirmed appointments protect their chosen time. When a paid booking is declined or cancelled, the admin must choose rescheduling or mark a refund as initiated; the application records that resolution but does not issue an external refund.

Booking status and payment status are independent fields. A booking may have payment status **Paid** while its booking status remains **Awaiting approval**. Booking changes and payment updates are authenticated and recorded separately. Internal notes are visible only to staff; WhatsApp contact links open an external customer conversation.

Customers can check their booking from the booking page or on `booking-status.html` by entering their booking reference and the phone number used for the request. New booking references are generated with 80 bits of cryptographic randomness so they cannot be guessed by trying a sequence of numbers. Older bookings keep their existing references so previously sent booking and payment links continue to work; older sequential references remain more guessable and should be handled carefully. The page only reveals status and appointment details after both the reference and phone number match. Customers can pay on `payment.html`, which verifies the same details, shows the approved service and confirmed amount, and enables checkout only for an approved, unpaid booking. The page uses Paystack Inline with a server-issued transaction reference and amount; the server remains responsible for verifying payments. Listed-price options use their server-side catalog amount automatically; Teo enters a confirmed amount only for services that require a quote.

The booking page saves an unfinished form plus up to 10 booking references and matching phone numbers in the browser's local storage, so returning on the same browser/device and website address can restore the form or refresh a saved booking's status. Browser storage is isolated by website origin, so Render and GitHub Pages do not share saved details. Attachments and policy acceptance are not saved. This information stays on that browser and is not encrypted or synchronized to other devices; customers should avoid saving it on a shared device and can clear it from the booking page at any time. Customers can still use the reference and matching phone number manually if browser storage is unavailable.

Tint options on the services page start a booking request with the selected listed-price option. The API stores the option and derives its amount from the server-side pricing catalog; Teo does not need to enter that amount in admin. Other services without a fixed price remain manually quoted. Approval creates the checkout using the fixed listed price (or the entered quote for unpriced services). Run `npm run db:init` to apply schema updates, then set `PAYSTACK_SECRET_KEY` and an HTTPS `PUBLIC_SITE_URL` on the API server. Paystack initialization uses only the server-side confirmed booking amount; successful callbacks are verified against Paystack before payment status is marked paid. Booking approval remains independent of payment verification.

## Booking, payment and customer notifications

New booking requests are held for review for 48 hours by default. Once approved for payment, the customer has 24 hours to pay. Set `BOOKING_REVIEW_TTL_HOURS` and `PAYMENT_EXPIRY_HOURS` to change those durations (whole hours from 1 to 720). The expiry worker releases a payment-held appointment only after Paystack confirms that the transaction failed or was abandoned; if Paystack is unavailable or the transaction is still pending, the appointment stays reserved.

The Paystack return page is not proof of payment. The API verifies the transaction with Paystack and checks its reference, booking association, NGN currency, and exact server-approved amount before recording payment. The `/api/v1/payments/webhook` endpoint also validates the Paystack signature and re-verifies events with Paystack. Repeated success events are processed idempotently. Booking confirmation remains a separate manual admin action after payment verification.

Customer emails are queued in PostgreSQL and tracked for delivery. Failed messages can be retried from the admin booking details. After final confirmation, customers receive a time-limited booking-slip link; the slip contains their appointment and payment summary. When an admin proposes a new appointment time, the customer can accept or decline using the expiring response link in the email.

## Render deployment checklist

The Render Blueprint creates the PostgreSQL database, runs `npm run db:init` as its pre-deploy command, builds the website, and starts the API. Before accepting bookings:

1. In the Render service environment, set `PAYSTACK_SECRET_KEY` to the private Paystack secret and confirm `PUBLIC_SITE_URL` is the HTTPS URL customers use. Configure the matching Paystack webhook URL as `https://<your-api-host>/api/v1/payments/webhook`.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `NOTIFICATION_EMAIL` for customer and business email. Add WhatsApp credentials only if that optional channel is enabled.
3. Keep `ADMIN_USERNAME` private and replace the generated or temporary `ADMIN_PASSWORD` with a unique password of at least 16 characters. Never put secrets in the repository or frontend.
4. Verify `DATABASE_URL` is the private Render database connection, `UPLOAD_DIR` points to the mounted private disk, and `CORS_ORIGINS` lists only the website origins that need API access.
5. Check `/api/health`, sign in to the admin inbox, submit a test booking, verify review expiry/payment approval, test a Paystack test-mode payment and webhook, and confirm the customer email and booking-slip link work before enabling live payments.
6. Arrange database and private-upload backups and test restoration. `npm run db:init` applies additive schema updates; review the SQL and take a backup before running it against production.

The review/payment expiry values default to 48/24 hours in both the API and Render Blueprint. No additional environment variables are needed for the new workflow beyond those already listed in `.env.example` and the Render setup above.

## Production readiness

Before accepting real customer information, deploy the API and PostgreSQL with HTTPS, set strong private database and admin credentials, configure email and WhatsApp provider secrets, use durable private storage outside the public web root, configure database and file backups, publish a privacy notice, and monitor API errors. Do not expose upload files or submission records except through the authenticated admin API.
