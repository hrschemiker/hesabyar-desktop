<div align="center">

<img src="renderer/assets/img/logo.svg" width="120" alt="HesabYar logo">

# HesabYar — حساب‌یار

**A full-featured Persian (Farsi) personal-accounting desktop app for Windows.**

Offline-first · Jalali calendar · multi-currency · assets, debts, loans & cheques · rich reports.
Optionally syncs both ways with its companion WordPress plugin.

<img src="docs/screenshot-dashboard.png" width="880" alt="HesabYar dashboard">

</div>

---

> **Note on language.** This README is in English, but the application itself is **entirely in Persian (RTL)** — exactly like the WordPress plugin it was ported from. It targets Iranian personal-finance workflows (Toman/Rial, Jalali dates, Persian numerals, TGJU market rates).

## Overview

HesabYar is a native-feeling Windows desktop application that reproduces **every feature and every business rule** of the "Personal Accounting" WordPress plugin, re-implemented as a standalone, offline app. Your data lives locally in a single SQLite database on your machine — no server, no account, no internet required for day-to-day use.

It is built with **Electron**. The UI is server-rendered locally (the same HTML/CSS/JS model as the original plugin) so the desktop app is a true 1:1 match of the web experience, while all data is stored on-device.

## Features

- **Dashboard** — monthly surplus/deficit hero, live USD & 18k-gold rates, KPIs (balances, current asset value with profit/loss, open receivables/debts, monthly income & expense), due-date reminders (loan installments, cheques, recurring), expense breakdown, recent transactions and upcoming obligations.
- **Accounts** — cash / bank / credit accounts, multi-currency (Toman, Rial, USD, EUR, …), opening balances, card/IBAN, per-account balance reconciliation, personal **journal**, **general ledger** and **monthly statements**.
- **Transactions** — 11 transaction types: income, expense, loan-installment payment, recurring debt, account-to-account transfer, person-to-person transfer, debt settlement, receivable settlement, cheque settlement, asset buy/sell. Category splitting, tags, receipts (image/PDF), amount hiding, duplicate detection, powerful filtering, and a step-by-step mobile-style entry wizard.
- **Categories** — income/expense categories with icon, flat color and an essential/non-essential flag used in reports.
- **Debts & obligations** — simple debts, **loans with auto-generated installment schedules** (incl. variable-amount installments), **cheques** (multi-count), **recurring payments** (rent, insurance, subscriptions), plus future-obligation and next-month pressure reports.
- **Receivables** — full and partial collection tracking.
- **Assets** — gold, silver, crypto, cash currency, property, car, valuables; financial **goals** with progress; **live market valuation** and unrealized/realized profit & loss.
- **Reports** — financial-health summary, savings & debt-to-asset ratios, money in/out routes, essential vs. non-essential spending, per-person breakdown, 6-month income/expense chart, spending-by-place, financial calendar, per-group asset P&L, and one-click **PDF export** (print) and **full JSON backup / restore**.
- **Rates** — currency, gold and crypto rates with one-click **online update** (TGJU) plus manual entry.
- **Settings** — light/dark theme, default currency, person labels, optional **PIN lock**, recycle bin (soft-delete restore), **site connection** (see below), and **Archive** — snapshot selected data groups (transactions, accounts, assets, debts, loans, cheques, receivables, or everything) and reset their figures to zero to start a new period; open obligations are preserved; each archive can be exported to **PDF**.
- **Recycle bin** — deletes are soft; restore anything from Settings.
- **Jalali (Shamsi) calendar** everywhere, with a built-in date picker and Persian numerals.

## Sync with the WordPress plugin

Settings → **اتصال به سایت (Site connection)** lets the app talk to the companion WordPress plugin's REST API (`/wp-json/hpa/v1`). After you enable *App connection* in the plugin's settings and sign in from the app, you can:

- **Pull** data from the site into the app,
- **Push** the app's data to the site,
- **Full sync** (two-way),
- **Test** the connection.

The desktop database schema mirrors the plugin's tables row-for-row, so records map cleanly in both directions. This channel is ready today and will keep working as the plugin is updated.

## Download & install

Grab the latest installer from the [**Releases**](../../releases) page:

- `HesabYar-Setup-x.y.z.exe` — Windows installer (choose install location, desktop & start-menu shortcuts).
- `HesabYar-x.y.z.exe` — portable single-file build (no installation).

Requires 64-bit Windows 10/11.

## Build from source

```bash
npm install          # install dependencies
npm start            # run the app in development
npm run dist         # build the Windows installer + portable into ./release
```

## Tech

- **Electron** shell with a local render server (`electron/server.js`).
- **SQLite** storage via `sql.js` (pure-WASM, no native build step).
- Faithful JavaScript port of the plugin's rendering and business logic (`electron/core.js`), Jalali date engine and money/rate math (`electron/util.js`).
- Fonts: **IRANSansX (FaNum)** for the UI and **Gramophone** for the wordmark.

## Screenshots

| Dashboard | Reports |
|---|---|
| ![Dashboard](docs/screenshot-dashboard.png) | ![Reports](docs/screenshot-reports.png) |
| **Assets** | **Debts & obligations** |
| ![Assets](docs/screenshot-assets.png) | ![Debts](docs/screenshot-debt.png) |
| **Archive (close period)** | **Transactions** |
| ![Archive](docs/screenshot-archive.png) | ![Transactions](docs/screenshot-transactions.png) |

## License

[MIT](LICENSE) © hrschemiker
