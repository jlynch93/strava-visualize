# Runlore

**Every run adds to the story.** [runlore.app](https://runlore.app) turns a runner's
Strava or Garmin history into training trends, fitness, and a plan for the week
ahead.

## Brand

- **Name:** Runlore, written `runlore` in the wordmark and "Runlore" in prose.
  The domain is `runlore.app`.
- **Idea:** *lore* is the story your running builds over time. The mark is a
  pair of topographic contour rings rising to a lime summit: terrain and a trail
  map, layers of accumulated runs, and the latest run at the top.
- **Assets** (in `public/`): `brand/runlore-mark.svg` (master mark),
  `favicon.svg`, `apple-touch-icon.png`, `brand/icon-192.png`,
  `brand/icon-512.png`, `brand/og-image.png` (1200×630 share card) and
  `site.webmanifest`. Regenerate the PNGs after changing the mark with
  `node scripts/render-brand-assets.js`.
- **Colors:** the existing system tokens. Ink `#0e1a1f` tile, teal contours
  `#3d8f86` and `#5fb3a8`, lime summit `#c8f04a` (the `accent` token).
- **Voice:** plain, specific, encouraging. Tagline: "Every run adds to the story."

The Cloudflare Worker and D1 database keep their original `strava-visualize`
names: renaming the Worker would deploy a new one without its secrets,
bindings, or domain.

## Local Development

Requires Node 22.5 or later. Create `.env` from `.env.example`, then run:

```powershell
npm ci
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

Requires Node 22 or newer. Run the Chromium workflows with `npm run test:e2e`
(install once with `npx playwright install chromium`). `npm run test:e2e:all`
also runs Firefox; install it with `npx playwright install firefox`. CI installs
both browsers and runs the full suite. On Windows, Firefox also needs a working
Microsoft Visual C++ runtime; a side-by-side startup error is an environment
failure. Tests cover import decisions, calculations, saved plans, sync/reconnect,
units, keyboard use, mobile layout, and axe accessibility. Strava, weather, and
coach services are mocked in browser tests.

## Reviewing a training block

Sign in with Strava, import a JSON/CSV activity export, or select **Demo data**. The
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

**Races and the training cycle.** Plan → **Races** holds your season: name,
date, distance and priority. An **A** race is the goal the cycle builds toward,
a **B** race is a tune-up with a short taper and recovery, and a **C** race is
run through. The next A race sets the phase:

| Phase | When |
|---|---|
| Base | more than 12 weeks out |
| Build | 6 to 12 weeks out |
| Peak | the last 5 weeks before the taper |
| Taper | the final 7 days (5K, 10K), 10 days (half) or 14 days (marathon) |
| Race week | the final 7 days |
| Recovery | after any race, about a day per 3 km (less for B and C races) |

A B race inside its own short taper reads as a tune-up, and recovery takes
precedence over everything.

**Find a race** searches upcoming races on RunSignup: name and an optional
two-letter state. The Worker (`GET /api/races/search?q=&state=`, `src/races.js`)
calls RunSignup's public race API (no key) for the next year and keeps only
in-person running and walking events of at least 1 km. Virtual races,
memberships and kids' dashes are dropped. It maps distances such as
`3.1 Miles` or `21.097K` onto 5K/10K/half/marathon, caches answers for six
hours, and passes on only name, date, place, link and events. Choosing a
distance fills the form, and the race keeps its RunSignup link. Locally,
start the server with `NODE_USE_ENV_PROXY=1` if outbound requests go through
a proxy.

**RunSignup registration (required from January 1, 2027).** RunSignup will
reject API calls without an API caller registration. Register for free on
RunSignup's [API Keys page](https://runsignup.com/API/ApiKeys) ("Register as an
API caller", then "Create API Caller") and set the token and secret as Worker
secrets:

```bash
npx wrangler secret put RUNSIGNUP_API_REG_TOKEN
npx wrangler secret put RUNSIGNUP_API_REG_SECRET
```

Every RunSignup call (race search, race details, past results) then sends the
token as `rsu_api_reg` and the secret in the `X-RSU-API-REG-SECRET` header.
Until they are set, calls go out unregistered and the Worker logs a
`runsignup_unregistered` warning once.

**ACTIVE.com as a second source (optional).** With an ACTIVE.com Activity
Search API v2 key set as a Worker secret, race search also asks ACTIVE.com:

```bash
npx wrangler secret put ACTIVE_SEARCH_API_KEY
```

Only the **Search API** key is needed (ACTIVE issues several keys; the others
are for registration and campground systems). Both sources are asked at once;
a race listed on both appears once, from RunSignup, whose past results power
the projected place. ACTIVE listings are trimmed to in-person running races
within a year (virtual events, memberships, recreation-department classes and
kids' dashes are dropped), each links only to its active.com page, results show
where they came from, and races whose registration has closed say so. If
one source does not answer, the other's races still come back, flagged, and
that answer is not cached. Without the key nothing calls ACTIVE.

Readiness weighs fatigue against what the phase calls for. In a build, some
fatigue is expected and costs little. In a taper or race week, fatigue counts
for more, because the aim is to arrive fresh. Early in recovery, readiness never
reads "Primed", however fresh you feel. A **Training cycle** factor explains the
phase, and the advice changes with it.

Fitness shows a timeline from base to recovery, marking today and any tune-ups,
and Overview names the phase next to readiness. A race in the planned week
takes its day on the plan calendar. A goal race saved before the race calendar
moves over as the A race. Races sync with your account like goals and check-ins.
Without races, readiness works exactly as before.

Each race can carry an optional **goal time** (h:mm:ss or mm:ss). Race
predictions open with a card for each upcoming A or B race at a standard
distance: the predicted time and pace, whether it is on track for the goal (or
the VO2 max the goal needs), and how the prediction moved over six weeks.

A race added through **Find a race** also gets a **projected place**: where
the predicted time would have finished in the race's most recent edition with
posted results, overall and, once you give a birth year and gender, among
your gender and five-year age group. The Worker
(`GET /api/races/field?race=&km=`) reads RunSignup's public results for the
latest past in-person event at that distance (looking back up to three
editions), strips everything but finish time, gender and age, and caches the
answer. The place is computed in the browser, so predicted time never leaves the
app. Birth year and gender live in the runner's profile (**Account → About
you**), stored with max and resting heart rate under `run-trends-athlete-v1`:
synced to the account when signed in, kept on the device otherwise, and never
sent to RunSignup.

The fitness and fatigue chart marks today and every race in view, and with an A
race in the next six months it **projects to race day**: your usual daily load
(the last 28 days' average) until the taper starts, 65% of it in the taper and
45% in race week. The dashed lines and faded form bars are that projection, and
the note under the chart gives the race-day form and its assumptions.

**Installable app.** Runlore is a progressive web app: on an iPhone, Safari's
**Share → Add to Home Screen** gives a full-screen app with its own icon
(Account shows the steps, or an Install button where the browser offers one).
`public/site.webmanifest` describes it, and the service worker
(`public/sw.js`) keeps the app shell on the device so it opens instantly and
still opens offline. Requests to `/api`, `/auth` and `/webhooks` never pass
through its cache, so account data is always live and nothing private is
stored by it. Offline, the app says so and loads your runs when the
connection returns.

**On phones** (700px and narrower) the layout is rearranged so data comes first:

- The header is one row, with settings behind a gear icon and your account as initials.
- A tab bar for Overview, Fitness, Plan and Runs (or Walks) is pinned to the bottom.
- The Runs/Walks switch and the date range stay at the top of the screen while you scroll.
- Page titles are hidden visually but still read by screen readers.
- Sync confirmations appear briefly above the tab bar; errors stay until tapped.
- This week shows all seven days in a single row.
- The Runs list hides sort, type, export and copy link behind **Sort & filter**,
  and each run takes two lines.
- Plan opens on the week's sessions; goals and the check-in follow.

Desktop is unchanged; all of this lives in `public/mobile.css`.

**Runs and walks** are reviewed separately and processed the same way. When your
history includes walks or hikes (from Strava, Garmin, or an import), a **Runs /
Walks** switch appears beside the range. It shows how many of each you have.
Overview, the activity list, every chart, the block metrics, the This week card,
and the coach analysis then cover only the selected activity, with walk wording
and walk types (Walk, Long walk, Hike). Walks never enter run totals, pace, or
plans. The mode is part of the view link (`?activity=walk`).

Physiologically, one body does both: on **Fitness**, walks add to training load
on the same scale as runs, so fitness, fatigue and readiness include them, and
the load tooltips split each day into runs and walks. VO2 max, race predictions,
training paces and running metrics use runs only. Plans are running plans.

Every run gets an **effort-based type** (Easy, Recovery, Long, Quality, Race)
from heart rate (or pace relative to threshold) and distance, not from its name.
Types appear as chips in the Runs table, in run details, and as dot colours in
Pace vs distance. The Runs filter can select them.

On Plan, with the block intent on **Auto**, today's readiness steers the current
and next week. Below 35 the draft becomes a recovery week. Between 35 and 54 the
quality session becomes an easy run, and the draft says why. Your check-in and a
manual intent still take priority.

**Data & settings → Theme** offers Match system and ten themes. Five are
restrained: **Daylight** and **Trail** (light), **Midnight**, **Ember** and
**Ocean** (dark). Five are bolder and also change detail colours, and in two
cases the typeface: **Synthwave** (violet and hot pink), **Terminal** (green
on black, monospace), **Broadsheet** (salmon newsprint, serif headlines),
**Blossom** (pink and plum) and **Blueprint** (drafting blue with a grid).

**Aurora ✦** is the showpiece and has its own stylesheet (`public/theme-aurora.css`):
slowly drifting aurora light behind frosted-glass panels, large gradient
headlines, gradient chart bars (SVG gradients `#aurora-bar` that
`experience.js` adds to the page), glowing lines and gauge, a light that circles
the readiness panels, pill controls, panels that rise in on each view, a cursor
spotlight on cards, and a floating glass tab bar on phones. All motion stops
under the system's reduce-motion setting, and contrast is tested with it on.

**Studio ◧** changes the layout rather than the colours (`public/theme-studio.css`).
On wide screens (1100px and up) the header becomes a dark sidebar with
icon-and-label navigation and the account at its foot; Overview becomes a
bento grid with a tall readiness tile beside the week and block review;
Fitness puts readiness beside the key numbers and pairs the VO2 max and load
charts; the run ledger becomes floating row cards; settings open beside the
sidebar. On phones it has a dark app bar and tab bar and turns the key numbers
into a strip that scrolls sideways. The sidebar is dark because the colour
tokens are redefined on the header itself, so everything inside it follows. A theme is
a base (`data-theme`: light or dark) plus an optional palette (`data-palette`)
that changes hue and accent only, keeping the base's lightness steps so text
contrast holds. Chart series colours stay the validated light or dark set.
The tests check contrast in every theme.

The fitness charts run through today even when the last activity was days ago
(fitness and fatigue keep moving on rest days), unless a custom range ends
earlier.

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
Set both in your profile (**Account → About you**, or **Edit heart rate** under
**Heart-rate profile & method**); they sync with your account when signed in.
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
The week is a board of seven days you can edit directly. Select a day to change
its session (rest, easy, steady, quality, long or race), adjust the distance with
the −/+ buttons, set it planned, done or skipped, match a recorded run, or move it
to another day, which swaps the two. Run days have a **Mark done** button on the
board itself, and on a computer you can drag one day onto another to swap them.
Changes save as you make them: the first edit turns the suggested draft into your
plan for that week (**Keep this plan** saves it unchanged), and later goal changes
do not rewrite it. **Reset to suggestion** returns the week to the current draft
after confirmation. A day turned from rest into a run starts at the week's
typical run distance; a run turned into rest drops its distance, status and
match; a moved day loses a completed status and match, since those belong to the
date it was run. Rest days never complete automatically. Returning to Plan opens
the current week's plan when one exists, previous/next week controls reopen saved
plans, and Copy copies the week shown.

**Workouts and notes.** A run day can hold a structured workout. Type it the
way you'd say it, such as `2 mi warm-up, 4 x 1 mile threshold with 75 sec jog
recovery, 2 mi cool-down`, `6x800m @ interval, 400m jog` or `10 x 1:30 hard w/
1:00 walk`, or start from a template (threshold repeats, tempo, VO2 intervals,
marathon pace, easy + strides). Then adjust it in the builder: warm-up, sets of
repeats (distance or time, at easy, marathon, threshold, interval or repetition
effort), recovery (jog, walk or standing rest) and cool-down. Each set shows a
target pace from your fitness estimate. The workout's distance is estimated, with
timed parts converted at their pace, and the day's distance follows it until you
set a distance yourself (**Use as distance** brings it back). An easy or steady
day given a hard workout becomes a quality day; a day turned into rest drops its
workout. Any day can have free-text notes. The board, Copy and the calendar feed
all show the workout and notes.

**Calendar** (in Plan) puts the plan in Apple Calendar, Google Calendar,
Outlook or any app that subscribes to a URL. Signed in, **Create calendar
link** makes a secret link (`/api/calendar/feed/<token>.ics`) that serves the
saved weeks from the last eight weeks onward and the races as all-day events,
in the runner's units; rest days are left out, and a plan's race day gives way
to the race itself. The calendar picks up changes when it next refreshes:
Apple Calendar about hourly (the feed asks for an hour; the app's setting
decides), Google Calendar on its own schedule, often several hours and up to a
day. A suggested week appears once it is saved (edit a day or **Keep this
plan**). **Make a new link** retires the old one, **Stop sharing** ends it,
and deleting the account removes it. The token is stored as a SHA-256 hash for
lookups and encrypted with `TOKEN_ENCRYPTION_KEY` so the link can be shown
again; it needs migration `0005_calendar_feeds.sql` applied
(`npx wrangler d1 migrations apply strava-visualize --remote`). Without an
account, **Download a calendar file** saves a one-off `.ics` snapshot built in
the browser. Both use `public/calendar-core.js`.

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

### Records, efficiency, pacing, search and recaps

These live in `public/extras.js` and `public/extras.css`; the calculations are
in `fitness-core.js` and covered by `tests/fitness-core.test.js`.

- **Your records** (Overview): longest run, fastest run at 5–10K, 10K–half and
  half+ lengths (average pace over the whole run), most climbing, biggest
  Monday-to-Sunday week and longest daily streak, across your whole history.
  A record set in the last two weeks that beat an earlier one gets a **New**
  badge and says what it beat. A record inside the review window opens its run.
  Runs only; hidden in walk mode.
- **Aerobic efficiency** (Fitness): distance per heartbeat on easy and steady
  runs of 20 minutes or more, with each metre climbed counted as six on the
  flat, as weekly medians. The summary compares the last eight weeks with the
  eight before: rising means more speed for the same effort.
- **Race-day pacing** (each goal race card): mile or kilometre splits for the
  goal time (or the predicted time), even and with a 2% negative split, each
  with the running total. Both land exactly on the target.
- **Search and commands**: <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> (or <kbd>/</kbd>)
  opens a palette to jump to a view, switch theme, range, units or runs/walks,
  import, edit the profile, share the week, or find a run in the window by
  name or date. Commands named by the query rank first.
- **Share week** (This week): draws a 1080×1350 recap image of the current
  week on the device (distance, runs, time, pace, climb, daily bars, longest
  run, readiness) to download or, where supported, share. Nothing is uploaded.

- **Yearly goal** (Overview): this calendar year's running distance, where
  it is heading at the pace so far, and, with a goal set, a marker for where
  goal pace would have you today and the weekly distance the rest of the year
  needs. Goals are stored per year, in miles, with the synced coaching context.
- **Intensity balance** (Fitness): running time over the last four weeks split
  into easy (easy, recovery, long) and hard (quality, race) by the effort-based
  run types, against the 80/20 guideline, with advice when it drifts.
- **Shoes** (Runs, below the ledger): add a pair with the date of its first
  run and a replacement distance; each run counts toward the newest pair in use
  that day. Bars turn amber from 85% and red past the limit; retire a pair to
  stop counting it. Synced with the coaching context.
- **How it felt** (each run's detail): effort from 1 to 10 and a short note,
  saved as you choose and synced with your account; the ledger shows the effort
  beside the run's name.
- **Year in review**: "Share your year" (or the palette) draws a 1080×1920
  story-sized image of the year: distance, runs, hours, days run, climb,
  monthly bars, the longest run, busiest month and records set, then up to
  eight **accolades** it earned: a distance club, marathon or ultra distance,
  records set that year, the longest daily streak, running every month (or most
  weeks), Everests climbed, half-marathon-plus runs, the biggest week, early-bird
  or night-owl runs (from local start times, when known) and the share of the
  way around the Earth. Facts come from `FitnessCore.yearHighlights`.
  The image comes in five styles, chosen above the preview (and remembered on
  the device), each with its own chart and accolades: **The year** (overview),
  **Distance** (weekly mileage bars, distance club, long-run feats, Everests,
  the Earth), **Speed** (the year's best pace in each run length, flagged when
  it is an all-time best, VO2 max change since January, pace by month, the
  fastest month), **Consistency** (a dot for every day of the year, streak,
  weeks and months with a run, runs a week) and **Habits** (runs by weekday and
  time of day, favourite and rest day, usual start time, typical run).

### Page structure

Each tab leads with what you act on today:

- **Overview**: readiness, this week, the block review with the distance trend,
  key runs, then records (one row, new bests first, the rest on request) and
  the yearly goal, then Charts & metrics and the coach. The page title is
  kept for screen readers only. The window's longest run is not repeated in key
  runs when it is also the all-time record shown below.
- **Fitness**: readiness and the training cycle (today), fitness, fatigue and
  form with the race-day projection and race predictions (what's coming),
  Progress as one tabbed panel for VO2 max, aerobic efficiency and intensity
  balance (the tab is remembered per device), then training paces beside
  running form (cadence and easy pace), and data notes inside the heart-rate
  disclosure.
- **Plan**: once a goal or saved plan exists, the draft comes before the setup.

### One run, in depth

Each run's detail opens with **What this run tells you**, worked out from the
run's own numbers (any source): training load (and its share of a usual week),
heart-rate zone from heart-rate reserve, distance per heartbeat against your
usual easy runs, stride length from pace and cadence, a VO2 max estimate, and
for quality sessions and races what the effort is worth over 5K, 10K, half and
marathon. For Strava runs, the detail adds **Pacing** from the recorded splits
in your units: negative, even or positive split, fastest and slowest split,
pace variation, heart-rate drift (aerobic decoupling), grade-adjusted pace, a
pace bar per split (the partial last split is faded) with every split in a
table, and Strava's best efforts with PR flags. The calculations are
`FitnessCore.runInsights`, `splitAnalysis` and `decodePolyline`.

**Share run** draws a 1080×1920 image of the run: name, date, type and zone,
distance, time, pace, climb and heart rate, pace by split (when Strava's detail
is loaded), and highlights such as records, PRs, a negative split, load, VO2
max, efficiency, the race equivalent and how it felt. The route shape is
opt-in and off by default, because a route can show where you live.

## GitHub workflows

`Validate dashboard` (unit tests, asset build, syntax and whitespace checks)
runs on pull requests and on pushes to `main` and `codex/**`, on the
self-hosted runner like the other workflows. It cancels older
validation runs for the same branch.

`Verify production` is manual and runs only from `main`. Dispatch it with the
public production URL after deployment; it checks the status endpoint, dashboard
HTML, cache headers, stylesheets, and client script. It does not deploy changes.
`Playwright smoke test` runs the browser suite on pushes and pull requests.

`AI review` runs [open-nitpick](https://github.com/jdziat/open-nitpick) (pinned
to v2.8.0) on pull requests, pushes to `main`, and on demand. On a pull request
it posts inline review comments; on a push to `main` it writes its review of the
pushed commits to the run's job summary. It is advisory (`fail-on: none`) and
never fails a build for its findings. Choose the model with repository
variables (Settings → Secrets and variables → Actions → Variables):

- Ollama on the self-hosted runner: `NITPICK_PROVIDER` = `ollama`,
  `NITPICK_MODEL` = a model from `ollama list`. No key. If Ollama runs on a
  different machine from the runner, set `OLLAMA_BASE_URL` too, e.g.
  `http://192.168.1.20:11434/v1`. For small hardware the workflow sends only
  the changed lines, one file and one request at a time (about 6k tokens), and
  allows up to an hour. Give Ollama an 8k context (`OLLAMA_CONTEXT_LENGTH=8192`
  where Ollama runs); a smaller default cuts the request short. Model size
  matters more than anything else: on a test pull request with five planted
  bugs (SQL injection, a token in a log, unescaped HTML, a 64-bit id as a
  number, seconds used as minutes), `qwen2.5-coder:3b` found none,
  `qwen2.5-coder:7b` pointed at four but misexplained two, and
  `qwen3-coder:30b` found all five.
- A hosted provider: the `NITPICK_API_KEY` secret (OpenRouter's
  `z-ai/glm-5.3-flash` unless the variables say otherwise, well under a cent a
  review).

`.nitpick.yaml` deliberately names no model: the workflows pass the variables
as `LLM_PROVIDER`/`LLM_MODEL`, which nitpick uses only when the file names none,
so every command uses the same model. With neither a key nor Ollama, the jobs
are skipped with a notice. What the reviewer checks for in this codebase
(private data, escaping, D1 parameters, 64-bit ids, units) is in
`.nitpick.yaml` under `instructions`; preview the exact prompt without spending
anything with `LLM_PROVIDER=ollama LLM_MODEL=<model> nitpick explain-config -path src/races.js`,
and review uncommitted changes locally with
`LLM_PROVIDER=ollama LLM_MODEL=<model> nitpick review`.

To keep the local model from repeating work, the review skips changes that touch
only docs or images, a push to `main` whose commit is already an open pull
request's head (that pull request's review covers it), and "Merge pull request"
pushes (already reviewed in the pull request). Add `[skip review]` to a commit
message or pull request title to skip it by hand. A new push cancels the review
still running for the same pull request or branch. Ollama answers one request at
a time, so with two runners it helps to give reviews one lane: add a label such
as `ollama` to one runner (Settings → Actions → Runners → the runner → Labels),
then set the repository variable `AI_RUNS_ON` to `ollama`. Reviews and replies
then queue on that runner, and the other stays free for tests.

`AI review replies` lets you talk to the reviewer on a pull request. Reply under
one of its findings to explain or disagree, and it resolves the thread if the
reason holds. `@open-nitpick <question>` asks about the change,
`@open-nitpick review` and `@open-nitpick restart-review` review again, and
`@open-nitpick resolve` closes a thread. Only the owner and collaborators can
start it, it never runs pull request code, and it uses the same model and
runner as the review. The review can also resolve its own findings once the
code they point at is fixed, which is why both workflows have
`contents: write`: GitHub refuses to resolve a review thread without it.

### Self-hosted runner

Every workflow runs on a self-hosted runner (`runs-on: self-hosted`). To fall
back to GitHub's runners, for example while that machine is off, set the
repository variable `RUNS_ON` to `ubuntu-latest`; delete it to go back. Jobs
queued while no runner is online wait (up to 24 hours) rather than fail.
Pull requests from forks never run on the self-hosted machine: their browser
tests use GitHub's runners and they get no AI review.

One-time setup on the runner machine (Linux):

1. Register it: Settings → Actions → Runners → New self-hosted runner, and
   follow the download and `./config.sh` steps shown there.
2. Run it as a service so it survives logouts and reboots (from the runner
   folder): `sudo ./svc.sh install && sudo ./svc.sh start`.
   `sudo ./svc.sh status` checks it.
3. Install the browsers' system libraries once (the workflow installs the
   browsers but cannot use sudo): `sudo npx playwright install-deps chromium firefox`
   from a checkout of this repository after `npm ci`.
4. Make sure `git`, `curl`, `python3` and `unzip` exist. Node 22 is installed by
   the workflows themselves.
5. For AI review with Ollama: `ollama serve` running and the model pulled
   (`ollama pull <model>`), reachable from the runner.

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

`Validate dashboard` runs on pull requests and branch pushes, on the self-hosted
runner (see "Self-hosted runner"). The workflow runs the regression suite,
JavaScript syntax checks for all deployment targets, and a Git whitespace check.
Node 22 is installed by the workflow.

## Accounts and providers

People sign in with an activity provider; there are no passwords. The first
sign-in creates a Runlore profile, and signing in again with the same
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
| `POST /webhooks/garmin/:secret` | Garmin activity, deregistration and permission notifications |

`/auth/login` and `/auth/callback` remain as aliases for Strava so existing
Strava app settings keep working.

### Strava 64-bit ids (from June 1, 2027)

Strava's activity and athlete ids become 64-bit integers, which JavaScript
numbers cannot hold exactly. Runlore keeps them exact end to end:

- `parseJsonExact` (`src/http.js`, and in `public/script.js` for API replies and
  imported JSON files) keeps any integer above 2^53 as its exact digits, using
  the JSON.parse reviver's source text.
- The Strava provider uses `id_str` when Strava sends it and always stores ids
  as strings (`stravaId`, `normalizeStravaActivity`), for activities, their
  athlete and the signed-in athlete. The database columns were already text.
- The browser prefers `id_str` and treats every activity id as a string.

`tests/strava-ids.test.js` covers two athletes whose ids round to the same
number staying separate accounts, and a 64-bit activity id round-tripping.

### Garmin

Garmin needs approval through the Garmin Connect Developer Program (Activity
API). Unlike Strava, Garmin does not let apps list activities on demand: it
pushes them to a webhook, so Garmin activities are stored in the D1
`activities` table (`migrations/0002_activities.sql`) as summaries already
mapped to Strava's field names. No GPS routes or samples are stored.

- **Sign-in** uses OAuth 2.0 with PKCE. The code verifier is kept in a
  10-minute `HttpOnly` cookie.
- **Webhook:** in Garmin's developer portal, set the Activity, Activity
  Details, Manually Updated Activities, Deregistration and User Permissions
  endpoints to `https://<your-domain>/webhooks/garmin/<GARMIN_WEBHOOK_SECRET>`.
  Both push (data in the body) and ping (callback URL) modes are handled. The
  secret in the path is what authenticates Garmin's requests, so use a long
  random value.
- **History import (background job):** connecting Garmin starts a job
  (`sync_jobs`, `migrations/0004_sync_jobs.sql`) that asks Garmin for about a
  year of history in four 90-day windows. Sign-in does not wait: the requests
  run after the redirect is sent (`ctx.waitUntil`). Each window is recorded
  as it succeeds; a failed one (for example, rate limiting) is retried by the
  `*/10 * * * *` cron trigger, which resumes where it stopped, up to six
  attempts before the job reports `failed`. The history itself arrives
  through the webhook over the following minutes.
- **Live arrivals:** `/api/activities` accepts `changed_since=<cursor>`
  (arrival time, not start time, so backfilled history is found) and returns
  `sync: { state, cursor, windowsDone, windowsTotal, stored }`. While `state`
  is `importing`, the dashboard checks for arrivals every 15 seconds (45 after
  five minutes) and shows "Importing history… N so far". Afterwards it keeps
  checking every 3 minutes, so new Garmin uploads appear on their own. Checks
  pause while the tab is hidden. Strava, fetched on demand under a shared
  rate limit, is never polled; it refreshes quietly when you return to the
  tab after 15 minutes.
- **Disconnecting** Garmin, deleting the account, a Garmin deregistration, or
  removing the `ACTIVITY_EXPORT` permission deletes the stored activities. A
  deregistration also deletes the profile if Garmin was its only sign-in.

The Garmin URLs in `src/providers/garmin.js` follow Garmin's published OAuth 2.0
PKCE and Activity API documentation. Confirm them against the documentation you
receive with your keys.

### Privacy policy

`public/privacy.html` (served at `/privacy`) describes exactly what the app
stores and sends, including the operator (Runlore, Ohio, USA) and the privacy
contact. Garmin requires one. Update it whenever data handling changes.

## Production

### Account-synced settings

When a runner is signed in, goals, check-ins, saved plans, the heart-rate
profile and display preferences are saved to the account (`user_state` table,
`migrations/0003_user_state.sql`) through `GET /api/state` and
`PUT /api/state/:key`. Only the four keys in `src/state.js` are accepted, each
up to 256 KB. On sign-in the account's copy is applied; settings that exist only
on the device are uploaded once. Signing out or deleting the account removes
goals, plans and the fitness profile from the browser (theme and units stay).
Imported activity files never leave the browser.

### Hardening

- **Security headers** on every response: a strict Content Security Policy
  (no inline scripts, no third-party origins), `frame-ancestors 'none'`,
  `nosniff`, a strict referrer policy and a locked-down permissions policy.
  HSTS is sent over HTTPS only. Worker responses get them from
  `src/security.js`; static files get the same values from the `_headers`
  file that `scripts/build-assets.js` writes. A test keeps the two in step.
- **Errors:** unexpected failures return a generic message and are logged as
  structured JSON (`event: "request_failed"`). `observability` is enabled in
  `wrangler.jsonc`, so they appear in Workers Logs.
- **Session cleanup:** a daily cron trigger (`03:17 UTC`) deletes expired
  sessions.
- **Strava rate limits** are app-wide (every runner's requests count together).
  A 429 is shown as "try again in a few minutes" and the runner's loaded
  history stays on screen. Syncs are incremental, so a returning runner usually
  costs one Strava request. Before opening the app widely, ask Strava to raise
  the app's athlete capacity and rate limits.

### Go-live checklist

1. Apply migrations: `npx wrangler d1 migrations apply strava-visualize --remote`
   (0001 accounts, 0002 activities, 0003 synced settings).
2. Set secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
   `TOKEN_ENCRYPTION_KEY`, and `APP_BASE_URL=https://runlore.app`.
3. Add `runlore.app` as the Worker's custom domain, and set Strava's
   Authorization Callback Domain to `runlore.app`.
4. Point `ollama.runlore.app` at the analysis server (it is the default
   `OLLAMA_BASE_URL`).
5. After deploying, run the "Verify production" workflow against
   `https://runlore.app`.

## Cloudflare Workers

The app deploys as a Cloudflare Worker with static assets and a D1 database.
Static files live in `public/`; API and auth routes are handled by `src/worker.js`.

The `DB` binding in `wrangler.jsonc` points at the `strava-visualize` D1
database. Apply migrations whenever `migrations/` changes:

```powershell
npx wrangler d1 migrations apply strava-visualize --remote
```

Weather validation/normalization, analysis prompts and response normalization
are shared by the Worker (and the local server, which runs it) through `shared/services.cjs`. Request validation
and resource limits live in `shared/analysis-limits.cjs`. Running time uses moving
minutes consistently; Relative Effort remains separate. The former distance/HR
"efficiency" metric is replaced with heart-rate coverage. Ramp compares the
latest two complete calendar weeks with the two before them and is independent
of chart grouping. Pace distributions describe run averages, not training zones.

Set these Worker secrets or environment variables:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
TOKEN_ENCRYPTION_KEY=<32 random bytes, base64>
STRAVA_REDIRECT_URI=https://your-domain.example/auth/strava/callback   (optional)
APP_BASE_URL=https://your-domain.example
OLLAMA_BASE_URL=https://ollama.runlore.app
OLLAMA_MODEL=qwen3.5:0.8b
```

For Garmin, also set `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` and
`GARMIN_WEBHOOK_SECRET` (and optionally `GARMIN_REDIRECT_URI`). Garmin stays
listed as "Not available yet" until all three are present.

Generate the encryption key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Keep it stable: changing it makes stored tokens unreadable, and users then need
to reconnect.

Strava and Garmin use `APP_BASE_URL/auth/<provider>/callback` as their OAuth
callbacks. Set `APP_BASE_URL` to your current public app URL (also supported in
local `.env`). Without it, the request origin is used. `STRAVA_REDIRECT_URI` and
`GARMIN_REDIRECT_URI`, if set, override these; update or remove an old value when
changing domains, and update the Authorization Callback Domain in your Strava
API application settings to match.

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
The local server uses the process fallback; the Worker also uses the
`ANALYSIS_RATE_LIMITER` binding. Cross-origin browser analysis
requests are rejected. Client cancellation propagates to upstream analysis.

If `/api/status` returns `404`, Cloudflare is only serving static assets. Redeploy from this repo with `wrangler deploy` so `src/worker.js` is included.

If `/auth/strava/login` loads the dashboard instead of redirecting to Strava, make sure `wrangler.jsonc` includes `assets.run_worker_first` for `/auth/*` and `/api/*`, then redeploy.

If `/api/status` reports that the D1 database or `TOKEN_ENCRYPTION_KEY` is
missing, sign-in stays disabled until both are configured.
