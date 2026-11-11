# Strava Visualize

A web dashboard for runners to analyze Strava trends over a selected period.

## Local Development

Create `.env` from `.env.example`, then run:

```powershell
npm ci
npm start
```

Open `http://localhost:4173`.

Run the local regression checks with:

```powershell
npm test
```

Requires Node 22 or newer. Run the Chromium workflows with `npm run test:e2e`
(install once with `npx playwright install chromium`). `npm run test:e2e:all`
also runs Firefox; install it with `npx playwright install firefox`. CI installs
both browsers and runs the full suite. On Windows, Firefox also needs a working
Microsoft Visual C++ runtime; a side-by-side startup error is an environment
failure. Tests cover import decisions, calculations, saved plans, sync/reconnect,
units, keyboard use, mobile layout, and axe accessibility. Strava, weather, and
coach services are mocked in browser tests.

## Reviewing a training block

Connect Strava, import a JSON/CSV activity export, or select **Demo data**. The
overview combines the block comparison, mileage, pace, and run frequency with
an interactive trend. Select a chart period to open its runs. Empty calendar
periods remain visible; weekly metrics use the selected calendar window and
stay independent of the chart's grouping.

**Overview** opens with a readiness strip (today's readiness score, estimated
VO2 max, fitness and form) that links to **Fitness**. The trend chart draws the
current, unfinished week or month lighter and labelled "so far", so a partial
period never looks like a drop. Additive metrics also show a rolling 4-week
(or 3-month) average, and the latest complete period is labelled.

Below the readiness strip, **This week** shows distance and runs completed
against this week's saved plan (or your 4-week average when there is no plan),
with a Monday–Sunday strip of what you ran and what is still planned.

Every run gets an **effort-based type** (Easy, Recovery, Long, Quality, Race)
from heart rate (or pace relative to threshold) and distance, not from its name.
Types appear as chips in the Runs table, in run details, and as dot colours in
Pace vs distance. The Runs filter can select them.

On Plan, with the block intent on **Auto**, today's readiness steers the current
and next week. Below 35 the draft becomes a recovery week. Between 35 and 54 the
quality session becomes an easy run, and the draft says why. Your check-in and a
manual intent still take priority.

**Data & settings → Theme** offers Match system, Light, or Dark. Dark mode has
its own colour steps, and the chart colours are validated against the dark
surface.

**Charts & metrics** (on Overview) holds the secondary charts. Each one fills
its panel, uses round axis ticks in the units you have chosen, and has a legend
built from the same series as its marks:

- **Volume mix:** distance per week or month, split into the longest run and
  everything else.
- **Training calendar:** daily distance, one column per week, with a
  five-step scale.
- **Pace vs distance:** every run as a dot; select one to open it.
- **Rolling distance:** the last 7 days against the 28-day weekly average.
- **Where your distance comes from** and **Pace spread:** pace bins are sized to
  your own range.

In the trend chart, rates (pace, heart rate, climb per mile) are drawn as lines
on a fitted axis, and amounts are drawn as columns from zero.

**Fitness** collects the physiological view of your training:

- **Readiness to train** (0–100) combines form (40%), the 7-day vs 28-day load
  ramp (25%), time since your last hard run (20%) and your weekly check-in (15%).
  Each factor is shown with its own score, together with what to do today.
- **Estimated VO2 max** per run comes from the oxygen cost of your pace
  (Daniels' equation, with a hill correction) divided by the share of your
  heart-rate reserve used. The trend is the upper quartile of the last six
  weeks. **VDOT** from your best recent effort is plotted alongside it.
- **Fitness, fatigue and form** are the 42-day and 7-day weighted training load
  and the gap between them. Load uses heart rate (TRIMP) where available and
  pace otherwise; one hour at threshold is about 100 points.
- **Race predictions** and **training paces** come from current fitness.
- **Running metrics** show weekly aerobic efficiency (metres per heartbeat on
  easy runs), cadence, load, and easy pace.

Max heart rate is estimated from your runs. Resting heart rate defaults to 55 bpm.
Set both under **Heart-rate profile & method**; they are saved in this browser.
Readiness and today's numbers use your full history, and the charts follow the
review window. All of these figures are models for planning, not medical measurements.

**Plan** brings together goals, availability, the weekly check-in, and a draft
calendar. Overview, Runs and Plan are separate views sharing the same history.
Overview keeps the summary, three key metrics, and trend chart in view; training
signals, coach analysis, and supporting data expand when needed. **Data & settings**
holds imports, sync history, units, weather preferences, and backups.
Plan uses the current 28 days, independently of the historical review window.
Open the goal or check-in disclosure to edit it. Check-ins expire after seven
days; an undated legacy check-in must be refreshed. Scheduling misses preserve
the baseline, while recovery-related misses adapt the draft. The draft reserves
an available long-run day, respects the weekly run limit, and gives a race
priority during race week. Session distances reconcile to the draft total.
Save a draft to preserve that week's sessions, then edit distances, reschedule,
choose explicit statuses, and match recorded runs. Rest days never complete
automatically. Select a saved session to open its editor, then **Save session**
or **Cancel**. Returning to Plan opens the current week's saved plan when one exists.
Previous/next week controls reopen saved plans. Copy uses the
saved plan when present. Replacing a saved week requires confirmation.

**Runs** searches the entire selected history, with sorting and 15-row pages.
On mobile, each row emphasizes the run name, date, distance, and pace; open the
run for the remaining metrics. **Export CSV** downloads the entire selected
window. Run details show distance, moving pace, moving time, and available splits
first; comparisons, additional measurements, weather, and coach analysis expand
separately. **Export CSV** uses
meters for distance and elevation and seconds for duration.
**Copy view link** preserves range, grouping, trend, search, and sort settings.
The link contains no activity history; load the data separately when reopening.

Imports show a preview before merging or replacing history; duplicate IDs are
updated. Mark a file complete for its date range only if it includes all activity
history in that range. Comparison changes are withheld when preceding history
is incomplete. Imported activities stay in the current tab unless **Remember
imported history** is enabled. Remove saved history in **Data & settings**. Goals,
check-ins, and accepted plans are saved in this browser, with backup/restore in
Preferences. There is no account or cloud sync for that coaching context.

Preferences also controls metric/imperial units and modeled weather, which is off
by default. Enabling weather shares rounded run-start locations with Open-Meteo.
Coach analysis requires consent to the displayed service before the first request
or a change of service. It has elapsed time and cancellation controls. Summaries
exclude activity names, descriptions and route coordinates; optional goals,
check-in fields and the runner's question are included for block analysis.

Strava sync caches history in the current browser session, fetches recent changes
incrementally, and offers **Load older activities** and **Refresh loaded history**.
A completed queried interval replaces its cached interval so deleted activities
are removed. A refresh checks the last seven days; refresh loaded history to pick
up older edits/deletions. Reconnect is explicit when authorization expires.
Opening a Strava run loads and caches available splits/laps. Run details have
previous/next navigation, comparison-set selection, and an Open in Strava link.

## GitHub workflows

`Validate dashboard` runs on pushes to `main` and `codex/**` using a trusted
GitHub-hosted `ubuntu-latest` runner, matching Playwright. It cancels older
validation runs for the same branch.

`Verify production` is manual and runs only from `main`. Dispatch it with the
public production URL after deployment; it checks the status endpoint, dashboard
HTML, cache headers, stylesheets, and client script. It does not deploy changes.
`Playwright smoke test` runs the browser suite on pushes and pull requests.

## Definition of done

The dashboard is ready to ship when the selected training block, race goal,
weekly check-in, and recommended calendar can be reviewed in one place. Goals,
check-ins, and plan states are intentionally stored only in the current
browser; backups transfer that context between browsers manually.

The recommended calendar is a reviewable proposal. It uses the runner's saved
availability, long-run preference, selected intent, recent workload, and race
countdown. A planned session can be marked completed or skipped and explicitly
matched to an activity. It is not medical
guidance or an autonomous training prescription.

`Validate dashboard` runs on branch pushes using a GitHub-hosted Ubuntu runner. The workflow
runs the regression suite, JavaScript syntax checks for all deployment targets,
and a Git whitespace check. Node 22 is installed by the workflow; no local runner
is required.

## Cloudflare Workers

The app deploys as a Cloudflare Worker with static assets. Static files live in `public/`; Strava API routes are handled by `src/worker.js`.

Weather validation/normalization, analysis prompts and response normalization
are shared with Node and Pages through `shared/services.cjs`. Request validation
and resource limits live in `shared/analysis-limits.cjs`. Running time uses moving
minutes consistently; Relative Effort remains separate. The former distance/HR
"efficiency" metric is replaced with heart-rate coverage. Ramp compares the
latest two complete calendar weeks with the two before them and is independent
of chart grouping. Pace distributions describe run averages, not training zones.

Set these Worker secrets or environment variables:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
APP_BASE_URL=https://your-domain.example
OLLAMA_BASE_URL=https://ollama.jeer.rest
OLLAMA_MODEL=qwen3.5:0.8b
```

Connect Strava uses `APP_BASE_URL/auth/callback` as its OAuth callback. Set
`APP_BASE_URL` to your current public app URL (also supported in local `.env` and
Cloudflare Pages). Without it, hosted deployments use the request origin and the
local server uses localhost. `STRAVA_REDIRECT_URI`, if set, overrides this callback;
update or remove an old value when changing domains. Update the Authorization
Callback Domain in your Strava API application settings to match the new domain.

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

When weather is enabled, the overview samples up to ten runs and opening an
individual run fetches modeled start-time weather through
`/api/weather`. The endpoint uses the run's local start date/hour and a start
location rounded to two decimal places before querying Open-Meteo. It returns
temperature, apparent temperature, humidity, precipitation, and wind as
context—not as a replacement for a watch measurement—and uses a private
one-day cache.

The **Coach's read** is deliberately on demand. Its per-run request contains
only compact, allowlisted metrics (distance, pace, duration, elevation, heart
rate, load, comparable-run context, percentiles, and normalized weather). It
does not include activity names, descriptions, route points, or coordinates.

Build and deploy:

```powershell
npm run deploy
```

`npm run build` creates `.build/public` with content-hashed JS/CSS, an asset
manifest, and cache headers. Wrangler's custom build command runs this step
automatically, including when Cloudflare invokes `npx wrangler deploy` directly.
No separate Cloudflare build command is required. For local bundle validation
use `npx wrangler deploy --dry-run`.

Analysis bodies are capped at 64 KB while streaming, even without Content-Length.
The Worker rate-limit binding allows five requests per client IP per minute per
Cloudflare location. Each running process/isolate also limits concurrent analysis
to two requests. These are resource protections, not a global account quota.
Node and Pages use the process/isolate fallback; Pages can use an equivalent
`ANALYSIS_RATE_LIMITER` binding where configured. Cross-origin browser analysis
requests are rejected. Client cancellation propagates to upstream analysis.

If `/api/status` returns `404`, Cloudflare is only serving static assets. Redeploy from this repo with `wrangler deploy` so `src/worker.js` is included.

If `/auth/login` loads the dashboard instead of redirecting to Strava, make sure `wrangler.jsonc` includes `assets.run_worker_first` for `/auth/*` and `/api/*`, then redeploy.

## Cloudflare Pages

The repo also includes Pages Functions in `functions/` for Pages Git integration.
Set the build command to `npm run build` and output directory to `.build/public`.
For a CLI deployment use `npm run deploy:pages`; it builds automatically.
