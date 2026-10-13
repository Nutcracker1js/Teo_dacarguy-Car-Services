# Teo_dacarguy Car Services

The customer-facing site is plain HTML, CSS and browser JavaScript. Its Node.js API stores bookings, enquiries and their optional attachments in PostgreSQL and private disk storage.

## Project layout

Keep public website pages and browser assets at the repository root. The site build intentionally copies root-level HTML, CSS, JavaScript and public images into `dist/`, which is served by the API in production.

- `*.html`, `*.css` and browser `*.js`: customer pages, shared styling, and page-specific behavior.
- `admin.html`, `admin.css` and `admin.js`: the private staff booking centre.
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
5. Set `PUBLIC_SITE_URL` to the assigned HTTPS `onrender.com` URL. Set `PAYSTACK_SECRET_KEY` to enable online checkout. Add SMTP and WhatsApp Business credentials in the Render environment settings to enable business notifications. Until each provider is configured, its feature stays unavailable; saved booking references remain available through the site.

The deployment build copies only root website `.html`, `.js`, `.css` files and public `images/` into `dist/`; it does not publish `.env`, the repository, or private uploaded files. The database does not accept inbound public connections. Keep a separate backup policy for PostgreSQL and uploaded files, and use HTTPS for admin access.

## Live chat

The public pages load the Smartsupp widget through `smartsupp.js`; the staff admin page does not. The server Content Security Policy permits the Smartsupp chat, widget and connection hosts used by the integration. Keep the widget key associated with the Smartsupp account, and disclose the third-party chat service in the site's privacy notice before launch.

## API

- `POST /api/v1/enquiries` stores customer contact details, enquiry type, description and optional vehicle details.
- `POST /api/v1/bookings` requires a customer WhatsApp number and stores contact details, vehicle, service, preferred date/time and location. WhatsApp notification consent remains optional. Appointment times are reserved under a database lock so overlapping requests cannot both reserve the same slot.
- `GET /api/v1/availability?date=YYYY-MM-DD&service=MAINTENANCE` returns the available appointment times for the selected date and service.
- `GET /api/v1/reviews` lists up to 50 newest public customer reviews.
- `POST /api/v1/reviews` publishes a customer review immediately; submissions are limited to 5 per IP per hour.
- `GET /api/health` checks API and database connectivity.

Both submission endpoints accept JSON or `multipart/form-data`. Attachments use the `attachments` field: up to 6 JPG, PNG, WebP, MP4 or MOV files, maximum 15 MB each. The API checks file signatures rather than trusting filenames or browser MIME types. Uploads are stored outside the website directory with randomized names; original names and MIME types are stored as database metadata. Files are not publicly served. Do not move the private upload directory beneath a public web root.

Successful submissions return HTTP `201`, an opaque reference ID, `NEW` status, submission time and attachment count. Invalid input returns HTTP `400`; oversize uploads return `413`. Public submissions are limited to 20 requests per IP every 15 minutes. JSON request bodies are limited to 16 KB.

Reviews are stored in PostgreSQL and displayed on the homepage after submission and on later visits. Reviews are published immediately without moderation, so the service owner should monitor submissions.

## Business notifications

The API can notify the business by both email and WhatsApp after a request is stored. Configure the SMTP and WhatsApp variables in `.env`; leave a channel unconfigured to disable it. Provider errors are logged and returned as `failed` channel statuses without undoing the saved request.

- Email requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `NOTIFICATION_EMAIL`. SMTP uses TLS; `SMTP_SECURE=true` is for implicit-TLS providers (usually port 465), otherwise STARTTLS is required. Optionally set `SMTP_FROM`.
- WhatsApp requires a Meta WhatsApp Business Cloud API access token, phone number ID, recipient in international format, and an approved message template. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT`, `WHATSAPP_TEMPLATE_NAME` and (if needed) the template language / Graph API version. The approved template body must contain five text placeholders in this order: request type, customer name, customer phone, request reference, short service/enquiry summary.
- Customer booking messages are not sent automatically by the admin API. In booking details, the message choices open WhatsApp with a prefilled draft for the opted-in customer. The person using the admin page must review the draft and tap **Send** in WhatsApp; click-to-chat links cannot send messages automatically. Acceptance drafts include a link to `payment.html`; customers verify their booking with its reference and phone number before proceeding to the Paystack checkout prepared for the confirmed service amount. The booking form requires the customer's WhatsApp number and email, with a separate explicit optional WhatsApp opt-in.
- Business booking notifications can still be sent to the configured business WhatsApp recipient using an approved `WHATSAPP_TEMPLATE_NAME`. Custom customer drafts and payment-verified drafts do not require Meta message templates. Free-form messages can only be sent within WhatsApp's customer-service window, so WhatsApp may reject sending a draft outside that window.

Never commit provider credentials. Add them only to the ignored local `.env` file or the deployment's secret manager.

## Admin inbox

Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters on the API server. Open `admin.html` on the website, then sign in with those credentials. The booking centre provides database-backed attention metrics, booking search and filters, booking details, private notes and status history, separate payment/refund records, appointment calendar views, working hours, service durations, blocked dates/times, and customer review management. Mark a manual payment as paid only after setting its verification to verified. Paystack payments are verified directly with Paystack before the application records them as paid.

If no custom schedule has been saved, the booking page offers standard Monday–Saturday times from 8:00 AM to 7:00 PM, using a one-hour service duration. The API hides past, blocked and overlapping times and checks availability again when a booking is submitted. Teo can customize open days, hours and service durations under **Availability & calendar**; the backend enforces those settings. If the availability service cannot be reached, the form still displays standard times and rechecks the requested time at submission. Pending review, awaiting payment, awaiting approval, approved and confirmed appointments protect their chosen time. When a paid booking is declined or cancelled, the admin must choose rescheduling or mark a refund as initiated; the application records that resolution but does not issue an external refund.

Booking status and payment status are independent fields. A booking may have payment status **Paid** while its booking status remains **Awaiting approval**. Booking changes and payment updates are authenticated and recorded separately. Internal notes are visible only to staff; WhatsApp contact links open an external customer conversation.

Customers can check their booking on `booking-status.html` by entering their booking reference and the phone number used for the request. The page only reveals status and appointment details after both match. Customers can pay on `payment.html`, which verifies the same details, shows the approved service and confirmed amount, and enables checkout only for an approved, unpaid booking. The payment page reuses the checkout link prepared during approval or initializes one using the email saved with the booking. Listed-price options use their server-side catalog amount automatically; Teo enters a confirmed amount only for services that require a quote. Paystack callbacks are returned to the booking-status page, where the customer can verify the transaction using their booking reference and phone number.

Tint options on the services page start a booking request with the selected listed-price option. The API stores the option and derives its amount from the server-side pricing catalog; Teo does not need to enter that amount in admin. Other services without a fixed price remain manually quoted. Approval creates the checkout using the fixed listed price (or the entered quote for unpriced services). Run `npm run db:init` to apply schema updates, then set `PAYSTACK_SECRET_KEY` and an HTTPS `PUBLIC_SITE_URL` on the API server. Paystack initialization uses only the server-side confirmed booking amount; successful callbacks are verified against Paystack before payment status is marked paid. Booking approval remains independent of payment verification.

## Production readiness

Before accepting real customer information, deploy the API and PostgreSQL with HTTPS, set strong private database and admin credentials, configure email and WhatsApp provider secrets, use durable private storage outside the public web root, configure database and file backups, publish a privacy notice, and monitor API errors. Do not expose upload files or submission records except through the authenticated admin API.
