# CLIE - Customer Lifecycle Intelligence Engine

Internal admin tool for the operations team to monitor real estate buyer payments and documentation status, detect milestones, forecast upcoming ones, and send email alerts.

**Production:** https://customer-lifecycle-intelligence-engine.vercel.app

> Formerly **Filinvest Milestone Tracker**. Data saved by that release is migrated automatically on first load (see `src/lib/storage.ts`); the alert recipient and its default value are unchanged.

## Stack

React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui-style primitives + React Router + Recharts, deployed on Vercel.
There is no database. Server-side code is limited to two stateless Vercel functions: email alerts (`api/send-alert.ts`) and the prospect analysis (`api/prospect-analysis.py`).

## Where your data lives

- **Uploaded files are read, not kept.** The app reads the Sales Report or PAF in the browser and keeps only the
  extracted data. The file itself is never stored or uploaded anywhere.
- **The extracted data is saved in this browser** (`localStorage`, key `clie_data_v1`): clients, contracts, payment
  history, milestones, notifications, import history and PAF client profiles. It **stays after a refresh, closing the
  browser or restarting the computer**, until you remove the file on the Upload page or clear the browser's site data.
- **Automatic clean-up.** If CLIE isn't used for **14 days** (adjustable to 7 or 30 under Notifications → Data
  Retention), everything it stored on that computer is deleted the next time it opens, or within the hour if the tab
  is left open. After **15 minutes** without activity the screen is hidden until someone clicks or presses a key
  (nothing is deleted). **Clear all data now** wipes it immediately, e.g. before returning a laptop. The original
  files are unaffected: upload them again to restore.
- **Each browser keeps its own copy.** A different browser, computer, incognito window or web address (including each
  Vercel preview URL) starts empty. Nothing is shared between users or devices.
- **Storage is unencrypted and limited** to roughly 5 MB per browser. Don't use the app on shared computers.
- **What leaves the browser:** when a milestone is reached, the client name, milestone and payment % are sent to
  `api/send-alert.ts`, which emails them to the alert recipient through Resend. For the prospect analysis, client ids
  and contract figures (project, credit date, contract value, payment %) are sent to `api/prospect-analysis.py`, which
  returns scores and stores nothing. Names, PAF details and government ID numbers never leave the browser (ID numbers
  are not even imported).

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

## Prospect analysis (Python)

The dashboard's **High-Potential Prospect Profile** is produced by a statistical model rather than fixed rules
(design: `docs/design/prospect-analysis-python.md`):

1. It learns what customers who later bought again looked like **at their first purchase** (project, contract value,
   payment progress), controlling for how long they have been customers.
2. It checks its own accuracy with 5-fold cross-validation (AUC: 0.5 = coin flip, 1.0 = perfect).
3. It reports only factors whose 95% confidence interval excludes "no effect", e.g.
   *"First purchase in Bayview Residences — 2.8× as likely (2.1–3.7×)"*.
4. It scores single-contract customers: **high-potential** at 2× the average likelihood or more, **promising** at 1.25×.

The model runs in the Vercel Python function `api/prospect-analysis.py` (NumPy only; logic in `api/_prospects/`).
The browser sends **client ids and contract figures only** — never names, documents or PAF details — and nothing is
stored or logged on the server. The panel falls back to the rule-based profile, with a notice saying why, when:

- there are fewer than 30 repeat or 30 single-contract customers with 6+ months of history,
- the model's accuracy is below AUC 0.60, or
- the service can't be reached within 20 seconds.

### Run locally

`vite dev` doesn't run Vercel functions, so start the Python API alongside it (it proxies `/api/prospect-analysis`):

```bash
python3 -m pip install -r requirements-dev.txt
```

```bash
npm run dev:api
```

```bash
npm run dev
```

To analyse Sales Report exports from the command line (runs locally; names hidden unless `--show-names`):

```bash
python3 scripts/prospect_analysis.py path/to/sales_report.xls
```

Pass several reports oldest first. Options: `--as-of YYYY-MM-DD`, `--top N`, `--show-names`, `--json`.
Python tests: `npm run test:py`.

## Out of scope for v1

- Authentication / multi-user roles
- A backend database (everything lives in `localStorage`, per-browser)

## Deploy

This is a static SPA — deploy the `dist/` output anywhere static, or connect the GitHub repo to Vercel directly. `vercel.json` includes the SPA rewrite rule needed for client-side routes like `/clients/:id`.

Production is deployed on Vercel from the `main` branch: https://customer-lifecycle-intelligence-engine.vercel.app
