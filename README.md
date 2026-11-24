# CLIE - Customer Lifecycle Intelligence Engine

Internal admin tool for the operations team to monitor real estate buyer payments and documentation status, detect milestones, forecast upcoming ones, and log (mocked) email alerts.

**Production:** https://customer-lifecycle-intelligence-engine.vercel.app

> Formerly **Filinvest Milestone Tracker**. Data saved by that release is migrated automatically on first load (see `src/lib/storage.ts`); the alert recipient and its default value are unchanged.

## Stack

React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui-style primitives + React Router + Recharts. All data persists in the browser's `localStorage` — no backend in v1.

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
- Milestones (`10% Payment`, `CREQ`) are detected by comparing the new state to each client's prior `milestones_reached`, and a mocked `Notification` (email_sent: true) is logged per newly crossed milestone

## Alert recipient

The email address that (mock) milestone alerts are sent to is configurable in-app under **Notifications → Alert Recipient**. Default seed value: `joseph.bagadiong@filinvestcity.com`.

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

- Real email delivery (queued/mocked only)
- Authentication / multi-user roles
- A backend database (everything lives in `localStorage`, per-browser)

## Deploy

This is a static SPA — deploy the `dist/` output anywhere static, or connect the GitHub repo to Vercel directly. `vercel.json` includes the SPA rewrite rule needed for client-side routes like `/clients/:id`.

Production is deployed on Vercel from the `main` branch: https://customer-lifecycle-intelligence-engine.vercel.app
