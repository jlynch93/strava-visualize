# Strava Visualize

A web dashboard for runners to analyze Strava trends over a selected period.

## Local Development

Requires Node 22.5 or later. Create `.env` from `.env.example`, then run:

```powershell
npm start
```

Open `http://localhost:4173`. `npm start` runs the production Worker
(`src/worker.js`) in Node, using `public/` for static files and a SQLite file in
`.data/` in place of Cloudflare D1. Migrations in `migrations/` are applied on
startup. If `TOKEN_ENCRYPTION_KEY` is unset, a local key is generated in
`.data/`. Add `http://localhost:4173/auth/strava/callback` to the Strava app's
allowed callback domain (`localhost`) to sign in locally.

Run the local regression checks with:

```powershell
npm test
```

Run the browser workflows with `npm run test:e2e` (install Chromium once with
`npx playwright install chromium`). The suite covers imports, date calculations,
search and pagination, chart keyboard navigation, CSV round trips, saved views,
planning preferences, and mobile layouts. It runs against an isolated local
server without Strava credentials.

## Reviewing a training block

Sign in with Strava, import a JSON/CSV activity export, or select **Demo data**. The
overview combines the block comparison, mileage, pace, and run frequency with
an interactive trend. Select a chart period to open its runs. Empty calendar
periods remain visible; weekly metrics use the selected calendar window and
stay independent of the chart's grouping.

**Plan** brings together goals, availability, the weekly check-in, and a draft
calendar. Open the goal or check-in disclosure to edit it. The draft reserves
an available long-run day, respects the weekly run limit, and gives a race
priority during race week. Its summary and copied text include the calendar.

**Runs** searches the entire selected history, with sorting and 15-row pages.
On mobile, each row emphasizes the run name, date, distance, and pace; open the
run for the remaining metrics. **Export CSV** downloads the entire selected
window, using meters for distance and elevation and seconds for duration.
**Copy view link** preserves range, grouping, trend, search, and sort settings.
The link contains no activity history; load the data separately when reopening.

Imported activities live only in the current tab. Goals, check-ins, and plan
statuses are saved in this browser. Demo history is clearly labeled and does
not include location coordinates or make weather requests.

## GitHub workflows

`Validate dashboard` runs on pushes to `main` and `codex/**` using a trusted
self-hosted runner. It cancels older validation runs for the same branch.

`Verify production` is manual and runs only from `main`. Dispatch it with the
public production URL after deployment; it checks the status endpoint, dashboard
HTML, cache headers, stylesheets, and client script. It does not deploy changes.
`Playwright smoke test` runs the browser suite on pushes and pull requests.

## Definition of done

The dashboard is ready to ship when the selected training block, race goal,
weekly check-in, and recommended calendar can be reviewed in one place. Goals,
check-ins, and plan states are intentionally stored only in the current
browser; exporting or syncing that coaching context remains a future enhancement.

The recommended calendar is a reviewable proposal. It uses the runner's saved
availability, long-run preference, selected intent, recent workload, and race
countdown. A planned session can be marked completed or skipped; an activity on
the same date is automatically recognized as completed. It is not medical
guidance or an autonomous training prescription.

`Validate dashboard` runs on branch pushes using a self-hosted runner. The workflow
runs the regression suite, JavaScript syntax checks for all deployment targets,
and a Git whitespace check. Ensure the runner is labeled `self-hosted` and has
Node 22 available.

## Accounts and providers

People sign in with an activity provider; there are no passwords. The first
sign-in creates a Run Trends profile, and signing in again with the same
provider account returns to it. From **Account**, a signed-in user can connect
another provider, disconnect one (the last one cannot be removed, because it is
how they sign in), sign out, or delete the account.

- Sessions are random tokens in an `HttpOnly` `sv_session` cookie. Only their
  SHA-256 hash is stored, and signing out deletes the session server-side.
- Provider access and refresh tokens are encrypted with AES-GCM using
  `TOKEN_ENCRYPTION_KEY` before they reach the database. Tokens are refreshed
  and re-saved when they are within a minute of expiry.
- A provider account can belong to only one profile. Connecting one that is
  already linked elsewhere is refused.
- OAuth `state` is bound to the browser and to the provider that started
  sign-in.

The code is in `src/`: `auth.js` (sign-in, callbacks, account routes),
`session.js`, `db.js`, `crypto.js`, and `providers/`. Each provider module
implements the interface described in `src/providers/index.js` and returns
activities in the field shape `normalizeActivity()` in `public/script.js`
expects. Strava is the first provider. Garmin will be added as another module.

| Route | Purpose |
| --- | --- |
| `GET /auth/:provider/login`, `/auth/:provider/callback` | Sign in, or connect a provider when already signed in |
| `GET /auth/logout` | Sign out |
| `GET /api/status` | Provider configuration and whether the browser is signed in |
| `GET /api/me`, `DELETE /api/me` | Profile and connections; delete the account |
| `DELETE /api/connections/:provider` | Disconnect a provider |
| `GET /api/activities?provider=`, `/api/activities/:id?provider=` | Activities from a connected provider |

`/auth/login` and `/auth/callback` remain as aliases for Strava so existing
Strava app settings keep working.

## Cloudflare Workers

The app deploys as a Cloudflare Worker with static assets and a D1 database.
Static files live in `public/`; API and auth routes are handled by `src/worker.js`.

The `DB` binding in `wrangler.jsonc` points at the `strava-visualize` D1
database. Apply migrations whenever `migrations/` changes:

```powershell
npx wrangler d1 migrations apply strava-visualize --remote
```

Set these Worker secrets or environment variables:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
TOKEN_ENCRYPTION_KEY=<32 random bytes, base64>
STRAVA_REDIRECT_URI=https://your-domain.example/auth/strava/callback   (optional)
OLLAMA_BASE_URL=https://ollama.jeer.rest
OLLAMA_MODEL=qwen3.5:0.8b
```

Generate the encryption key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Keep it stable: changing it makes stored tokens unreadable, and users then need
to reconnect.

The dashboard metrics and SVG charts are calculated in the app. Ollama guides
the on-demand selected-window training read and the focused run read shown when
an individual workout is opened. The model selects the most useful analysis
angles, answerability, confidence, and evidence limitations; the app turns
those choices into copy from verified comparisons. The coach uses the active
comparison mode and data-coverage gates, while individual workouts can be read
through overall, standout, load, or spacing lenses.
The `/api/insights` route sends compact, app-calculated fact sheets: either the
selected-window trends or the selected run with similar-distance comparisons
and its window baseline. Range, comparison, grouping, and chart choices are
stored in the page URL so a view can be copied and reopened. It does not send
route coordinates or the complete
Strava activity payload. The URL and model above are the defaults, so set the
Ollama variables only when you want to override them.

The dashboard can also import Strava JSON or CSV exports, download the selected
window as a normalized CSV, and preserve the run-browser filters in a copied
view link.

`qwen3.5:0.8b` is the default workout-analysis model. The request keeps
reasoning hidden and asks for concise schema-valid JSON so the UI receives only
the final training read.

## Run-detail enrichment

Opening an individual run fetches modeled start-time weather through
`/api/weather`. The endpoint uses the run's local start date/hour and a start
location rounded to two decimal places before querying Open-Meteo. It returns
temperature, apparent temperature, humidity, precipitation, and wind as
context—not as a replacement for a watch measurement—and uses a private
one-day cache.

The **Coach's read** is deliberately on demand. Its per-run request contains
only compact, allowlisted metrics (distance, pace, duration, elevation, heart
rate, load, comparable-run context, percentiles, and normalized weather). It
does not include activity names, descriptions, route points, or coordinates.

Then deploy:

```powershell
npx wrangler deploy
```

If `/api/status` returns `404`, Cloudflare is only serving static assets. Redeploy from this repo with `wrangler deploy` so `src/worker.js` is included.

If `/auth/strava/login` loads the dashboard instead of redirecting to Strava, make sure `wrangler.jsonc` includes `assets.run_worker_first` for `/auth/*` and `/api/*`, then redeploy.

If `/api/status` reports that the D1 database or `TOKEN_ENCRYPTION_KEY` is
missing, sign-in stays disabled until both are configured.
