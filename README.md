<div align="center">

# 🌿 TerraNova

**Precision irrigation for sugarcane estates** — live soil moisture, smart alerts, irrigation scheduling, recommendations and printable reports, all backed by MongoDB.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white&style=flat-square)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white&style=flat-square)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white&style=flat-square)
![Node](https://img.shields.io/badge/Node-%E2%89%A5%2020.19-339933?logo=nodedotjs&logoColor=white&style=flat-square)
![License](https://img.shields.io/badge/license-MIT-2D6A4F?style=flat-square)

<img src="docs/screenshots/overview.png" alt="TerraNova farm overview" width="92%">

</div>

## ✨ Highlights

- **Live farm overview** – every plot's moisture, NDVI and status at a glance, refreshing every 30 seconds.
- **Alerts that manage themselves** – opened for dry plots, silent sensors and low batteries; cleared automatically when fixed.
- **Recommendations** – worked out from moisture, 24 h trend, salinity and the weather forecast (rain coming? hold irrigation).
- **Irrigation & fertigation** – schedule, start, complete and audit every application, with litres computed from plot area and depth.
- **Reports** – 7/30/90-day summaries, a formatted Excel workbook, CSV files and a print-ready A4 PDF report.
- **MongoDB done properly** – schema validation, TTL and compound indexes, aggregation pipelines, views and a live Database panel.
- **Secure by default** – bcrypt passwords, signed tokens, server-enforced admin rights, rate limiting, CSP headers, audit log.
- **Light and dark themes**, custom accessible dropdowns, responsive layout.

## 📸 Screenshots

| Irrigation scheduling | Reports |
|:--:|:--:|
| <img src="docs/screenshots/irrigation-dropdown.png" alt="Irrigation page with themed dropdown"> | <img src="docs/screenshots/reports.png" alt="Reports page"> |

<div align="center"><img src="docs/screenshots/overview-dark.png" alt="Dark theme" width="70%"><br><sub>Dark theme</sub></div>

## 🏗️ Architecture

```mermaid
flowchart LR
    B["Browser<br/>React + TypeScript + Vite"] -- "Axios / JSON, JWT" --> A["Express API<br/>server/src"]
    D["Soil sensors<br/>(or demo simulator)"] -- "POST /api/ingest<br/>API key" --> A
    A -- "mongodb driver" --> M[("MongoDB<br/>12 collections, 3 views")]
    A -- "Open-Meteo" --> W["Weather forecast"]
    A -. "SMTP (optional)" .-> E["Alert &amp; invite emails"]
    C["MongoDB Compass"] -. "import database/ files" .-> M
```

```
web/       React + TypeScript + Vite website
server/    Express API + MongoDB layer (also serves the built website)
database/  MongoDB Compass connection file, setup script, demo queries and sample data
docs/      Screenshots used in this README
```

## 🧰 Tech stack

| Layer | Technology |
|---|---|
| Front end | React, TypeScript, Vite, React Router, Axios |
| Back end | Node.js, Express, JWT, bcrypt, exceljs, nodemailer |
| Database | MongoDB (native driver) with `$jsonSchema` validation, indexes, views |
| Tooling | Playwright-checked print layout, API test suite, GitHub Actions CI |

## 🚀 Quick start


You need [Node.js](https://nodejs.org) **20.19 or newer** and a running **[MongoDB](https://www.mongodb.com/try/download/community)** (the free Community Server, or an Atlas cluster). By default the server connects to `mongodb://127.0.0.1:27017/terranova`.

```bash
npm run setup     # installs both parts
npm run build     # builds the website into web/dist
npm start         # open http://localhost:4000
```

First start creates the `terranova` database (all collections, validation rules and indexes) and fills it with demo data if it is empty. To reset everything, drop the `terranova` database in MongoDB Compass and restart.

For development, run `npm run dev:server` and `npm run dev:web` in two terminals and open http://localhost:5173.

### Using MongoDB Compass

1. **Connections → Import saved connections** and pick `database/terranova-compass-connections.json`. This adds a "TerraNova Local" connection.
2. Connect to it. If the `terranova` database does not exist yet, either start the website once (it creates everything), or open the **MONGOSH** panel in Compass and paste `database/terranova-setup.js`.
3. `database/demo-queries.js` has ten example queries to run in the MONGOSH panel.
4. `database/collections/*.json` holds the same demo data, one file per collection, if you prefer **Add Data → Import JSON file**.

### Pointing it at another MongoDB

Set `MONGODB_URI` (for example `mongodb+srv://user:pass@cluster0.example.mongodb.net/terranova`) or edit `server/config/mongo.json`. The database name is the last part of the address, or `MONGODB_DB`.

## 🔑 Demo logins

| Role | Email | Password | Access |
|---|---|---|---|
| User | farmer@terranova.farm | farmer123 | Everything except the Admin area |
| Admin | admin@terranova.farm | admin123 | Everything, including Admin |

More people join through **Admin → Team → Create invitation**: you get a link (valid 7 days, single use), they choose their own password.

## 📋 Features

**Monitoring**
- **Overview**: KPIs, every plot with live status, irrigation queue, 5-day forecast, system status. Refreshes itself every 30 seconds.
- **Plot pages** (click any plot): moisture history chart (6h–30d) with your thresholds drawn on it, sensors on the plot, irrigation history, manual moisture readings, quick scheduling. Admins can edit or delete the plot.
- **Sensors**: online/offline, battery, signal, moisture/temperature/salinity/pH, and a history chart per metric.
- **Weather**: real forecast from Open-Meteo for your estate's coordinates (no API key). If it can't be reached, the page says "Sample data" instead of pretending.

**Acting on it**
- **Alerts**: opened automatically for plots below your thresholds, sensors that stop reporting, and low batteries. They clear on their own when fixed. Acknowledge them, browse history. Critical alerts can be emailed.
- **Recommendations**: worked out from live moisture, the 24-hour trend, salinity (EC) and the forecast. Heavy rain coming? Non-critical plots get a "hold irrigation" advisory instead. Schedule creates an irrigation event; Dismiss hides it for 24 hours.
- **Irrigation & fertigation**: schedule events, start them, record the litres actually applied, cancel, and browse paged history. Litres are computed from plot area, depth and your drip factor.
- **Reports**: 7/30/90 days of water applied, pumping cost, events, weekly chart and per-plot performance. Download a formatted Excel workbook or CSV files (plots, irrigation, alerts, sensor readings), or print / save a proper A4 report as PDF.

**Administration**
- **Alert rules**: moisture thresholds (saved automatically).
- **Team**: invitations with links (and email if configured), re-issue links, remove people (they are signed out immediately).
- **Plots & sensors**: add/delete plots, register sensors, assign them to plots.
- **Estate & data**: estate name, location, pumping cost, drip factor, target moisture, rain-hold level, offline and battery limits, demo simulator switch, device API key.
- **Activity log**: who changed what and when.
- **My account** (everyone): profile, notification choices, password, dark mode.

## 📡 Connecting real sensors

A device (or a gateway) posts readings with the estate API key from **Admin → Estate & data**. Register the sensor ID first.

```bash
curl -X POST http://YOUR-SERVER:4000/api/ingest \
  -H "X-API-Key: tn_live_..." -H "Content-Type: application/json" \
  -d '{"sensorId":"SNS-01","moisture":54.2,"temp":28.4,"ec":1.3,"ph":6.8,"battery":90}'
```

Send up to 100 at once as `{"readings":[{...},{...}]}`; add `"ts"` (epoch milliseconds) for older readings. Moisture is required; temp, ec, ph, battery and signal are optional.

**The demo simulator** makes the seeded sensors report invented readings every minute so the app looks alive. Turn it off in Admin → Estate & data once real devices report; sensors that then go quiet raise "offline" alerts.

## ⚙️ Settings (environment variables)

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 4000) |
| `MONGODB_URI` | MongoDB connection string (default `mongodb://127.0.0.1:27017/terranova`, or the `uri` in `server/config/mongo.json`) |
| `MONGODB_DB` | Database name, if it is not part of `MONGODB_URI` (default `terranova`) |
| `JWT_SECRET` | Signing secret for sign-in tokens. **Set this before going online.** |
| `SMTP_URL`, `MAIL_FROM` | Turns on email (alerts and invitations), e.g. `SMTP_URL=smtps://user:pass@smtp.example.com` |
| `APP_URL` | Public address used in invitation links, e.g. `https://farm.example.com` |
| `SIM_INTERVAL_MS` | How often the simulator ticks (default 60000) |

## 🖨️ Reports, exports and printing

The **Reports** page (7, 30 or 90 days) has two buttons in the top right.

- **Export data** opens a menu with an **Excel workbook (.xlsx)** (a formatted summary sheet plus Plots, Irrigation, Alerts and Sensor readings sheets, with frozen header rows, filters, colour-coded status cells and real Excel dates) and four **CSV** files. Times are written in your own time zone (`2026-11-08 23:36`), numbers are rounded sensibly and the files open correctly in Excel (UTF-8 with a byte-order mark).
- **Print / PDF** opens the browser's print dialog showing a purpose-built A4 report: header with estate, period and who generated it, key figures, a weekly water chart, a plot performance table with colour-coded status chips, recent irrigation, alerts in the period, and page numbers. Choose **Save as PDF** as the destination. It always prints in light colours, even if the website is in dark mode. In Chrome tick **Background graphics** if the bars look empty.

## 🍃 MongoDB features used

| Feature | Where | What it does |
|---|---|---|
| Schema validation (`$jsonSchema`) | every collection | MongoDB itself rejects wrong types, bad enum values and out-of-range numbers (for example sensor battery 250 %) |
| Unique and compound indexes | `users.login_email`, `readings (plot_id, ts)`, `irrigation (plot_id, scheduled_for)` ... | fast chart/list queries, no duplicate accounts |
| TTL indexes | `readings` (30 days), `invites` (when expired) | old data is deleted by MongoDB automatically |
| Aggregation pipeline | Reports summary (`$match`, `$facet`, `$group`, `$floor`), irrigation export (`$lookup`) | totals, weekly buckets and per-plot figures are computed inside the database |
| Views | `v_plot_overview`, `v_water_use_daily`, `v_open_alerts` | read-only joined/aggregated collections that appear in Compass next to the data |
| Atomic counters | `counters` + `findOneAndUpdate($inc)` | safe numeric ids without a SQL sequence |
| Live database panel | **Admin → Database** | connection status, latency, server version, documents, size, schema rules and indexes per collection |

```mermaid
erDiagram
    plots ||--o{ sensors : "has (sensors.plot_id)"
    plots ||--o{ readings : "measured in"
    sensors ||--o{ readings : "sends"
    plots ||--o{ irrigation : "irrigated by"
    users ||--o{ audit : "performs"
    team ||--o| users : "login (email)"
    team ||--o{ invites : "invited by email"
    alerts }o--|| plots : "subject (moisture alerts)"
    alerts }o--|| sensors : "subject (battery / offline)"
```

`database/demo-queries.js` holds ten ready-made queries (find, aggregation, `$lookup` join, `$facet`, time-series averages, views, validation, `explain`) to paste into the MONGOSH panel in Compass.

## 🔧 How it works

The website talks to the server with Axios (see `web/src/api.ts`). The database layer is `server/src/db.js`; the collections are described in `server/src/schema.js` and are the same ones `database/terranova-setup.js` creates (`users`, `settings`, `team`, `invites`, `plots`, `sensors`, `readings`, `irrigation`, `alerts`, `rec_state`, `audit`, plus a small `counters` collection for numeric ids). Passwords are stored as bcrypt hashes; sign-in returns a signed token (7 days). Changing a password signs out every other device. Admin-only actions are enforced on the server, not just hidden in the page. The server also sends security headers (CSP, no framing), rate-limits requests and sign-in attempts, and neutralises spreadsheet formulas in CSV exports.

Main API areas: `/api/auth/*`, `/api/bootstrap`, `/api/live`, `/api/plots`, `/api/sensors`, `/api/ingest`, `/api/irrigation`, `/api/recommendations`, `/api/alerts`, `/api/team`, `/api/reports`, `/api/settings`, `/api/audit`.

## ✅ Tests

`npm test` runs 23 groups of end-to-end API tests. By default they use a small in-memory stand-in for MongoDB, so no server is needed; to run them against a real MongoDB (a throw-away database that is dropped afterwards) use `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test`. They cover: permissions, validation, ingest, simulator, irrigation, recommendations (including the rain hold), alerts, invitations and email, password revocation, CSV and Excel exports, the Database tab, MongoDB views, audit log, that data survives a server restart, and that the app runs on a database loaded from the files in `database/`.

## 🌐 Before putting it online

Set `JWT_SECRET`, change the demo passwords, use a MongoDB with a password (or Atlas) and set `MONGODB_URI`, turn the simulator off, set up email, and serve the site over HTTPS (for example behind Nginx, or on a host like Render or Railway). SMS and push preferences are saved but not delivered yet.

## 👥 Team

| Name | GitHub |
|---|---|
| Sushant Samant | [@sushantsamant-616](https://github.com/sushantsamant-616) |
| Diva Shah | [@divashah05](https://github.com/divashah05) |
| Palak Sanklecha | [@pal1611](https://github.com/pal1611) |

Mini project (Full Stack Development), B.Tech Computer Engineering, K J Somaiya School of Engineering, under Dr. Shruti Jhavkar.

## 📄 License

Released under the [MIT License](LICENSE). Built by the team above.
