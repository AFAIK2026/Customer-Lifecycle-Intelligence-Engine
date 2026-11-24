# CLIE - Customer Lifecycle Intelligence Engine

Internal admin tool for the operations team to monitor real estate buyer payments and documentation status, detect milestones, forecast upcoming ones, and send email alerts.

**Production:** https://customer-lifecycle-intelligence-engine.vercel.app

> Formerly **Filinvest Milestone Tracker**. Data saved by that release is migrated automatically on first load (see `src/lib/storage.ts`); the alert recipient and its default value are unchanged.

## Stack

React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui-style primitives + React Router + Recharts, deployed on Vercel.
There is no database. The only server-side code is a Vercel serverless function for email alerts (`api/send-alert.ts`).

## Where your data lives

- **Uploaded files are read, not kept.** The app reads the Sales Report or PAF in the browser and keeps only the
  extracted data. The file itself is never stored or uploaded anywhere.
- **The extracted data is saved in this browser** (`localStorage`, key `clie_data_v1`): clients, contracts, payment
  history, milestones, notifications, import history and PAF client profiles. It **stays after a refresh, closing the
  browser or restarting the computer**, until you remove the file on the Upload page or clear the browser's site data.
- **Each browser keeps its own copy.** A different browser, computer, incognito window or web address (including each
  Vercel preview URL) starts empty. Nothing is shared between users or devices.
- **Storage is unencrypted and limited** to roughly 5 MB per browser. Don't use the app on shared computers.
- **What leaves the browser:** when a milestone is reached, the client name, milestone and payment % are sent to
  `api/send-alert.ts`, which emails them to the alert recipient through Resend. Nothing else is sent; PAF details and
  government ID numbers never leave the browser (ID numbers are not even imported).

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## CSV format

```csv
name,contract_value,payment_to_date,documents_submitted
Maria Santos,5000000,475000,Valid ID;Proof of Income;Tax Returns
```

- Documents are separated with `;`
- `payment_percentage` is computed automatically
- Existing clients are matched by name (case-insensitive) and updated; unmatched names create new client records
- Milestones (`10% Payment`, `CREQ`) are detected by comparing the new state to each client's prior `milestones_reached`, and a `Notification` is logged per newly crossed milestone and emailed to the alert recipient (see below)

## Alert recipient

The email address that milestone alerts are sent to is configurable in-app under **Notifications → Alert Recipient**. Alerts are delivered by the `api/send-alert.ts` Vercel function through [Resend](https://resend.com) and require the `RESEND_API_KEY` environment variable on Vercel; without it, alerts stay marked **Queued**. Default seed value: `joseph.bagadiong@filinvestcity.com`.

## Purchase Application Forms (client details)

**Upload PAF** imports the PAF workbook (`.xlsx`) with a *Customer Details* sheet and optional
*Spouse Details* / *Corporate Buyer Template* sheets. Rows are matched to clients by
Contract Number, then by Customer Name; forms for customers not yet in the Sales Report are kept
and attach automatically later. Each client page then shows a **Client Profile** (Personal,
Contact, Buyer & Employment, Spouse, Corporate) and a **Recommended Actions** card, and the
dashboard raises "Birthday within N days" touchpoints from the PAF birthdate.

- TIN and government ID numbers are never imported (only the ID type is kept).
- PAF details are masked on screen while "Customer names hidden" is on.
- Like all app data, PAF details live only in this browser's storage, unencrypted. Don't use the
  app on shared computers.
- Design: `docs/design/paf-client-details.md`.

## Prospect analysis (Python) — Stage 1

The High-Potential Prospect Profile is moving from fixed rules to a statistical model
(design: `docs/design/prospect-analysis-python.md`). Stage 1 is the analysis engine
(`api/_prospects/`) plus a command-line runner you can use on real Sales Reports.
Everything runs locally and nothing is sent anywhere.

```bash
python3 -m pip install -r requirements-dev.txt
python3 scripts/prospect_analysis.py path/to/sales_report.tsv
```

Pass several reports oldest first; later files update the same contract numbers.
Options: `--as-of YYYY-MM-DD`, `--top N`, `--show-names` (names are hidden by default), `--json`.
Run the Python tests with `npm run test:py`.

The runner prints the model's accuracy (cross-validated AUC: 0.5 = coin flip, 1.0 = perfect).
Stage 2 (API endpoint and dashboard panel) goes ahead only if real data reaches **0.60 or higher**.

## Out of scope for v1

- Authentication / multi-user roles
- A backend database (everything lives in `localStorage`, per-browser)

## Deploy

This is a static SPA — deploy the `dist/` output anywhere static, or connect the GitHub repo to Vercel directly. `vercel.json` includes the SPA rewrite rule needed for client-side routes like `/clients/:id`.

Production is deployed on Vercel from the `main` branch: https://customer-lifecycle-intelligence-engine.vercel.app
