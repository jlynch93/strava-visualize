# Strava Visualize

A web dashboard for runners to analyze Strava trends over a selected period.

## Local Development

Create `.env` from `.env.example`, then run:

```powershell
npm start
```

Open `http://localhost:4173`.

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

Connect Strava, import a JSON/CSV activity export, or select **Demo data**. The
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
Node 20 available.

## Cloudflare Workers

The app deploys as a Cloudflare Worker with static assets. Static files live in `public/`; Strava API routes are handled by `src/worker.js`.

Set these Worker secrets or environment variables:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
STRAVA_REDIRECT_URI=https://your-domain.example/auth/callback
OLLAMA_BASE_URL=https://ollama.jeer.rest
OLLAMA_MODEL=qwen3.5:0.8b
```

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
view link. Use `Disconnect` to clear the local token or hosted session cookies.
OAuth callbacks use a short-lived state cookie to prevent a login response from
being attached to the wrong browser session.

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

If `/auth/login` loads the dashboard instead of redirecting to Strava, make sure `wrangler.jsonc` includes `assets.run_worker_first` for `/auth/*` and `/api/*`, then redeploy.

## Cloudflare Pages

The repo also includes Pages Functions in `functions/` if you prefer a Pages project through Git integration. Use `public` as the output directory and leave the build command blank.
