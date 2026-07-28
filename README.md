# Strava Visualize

A web dashboard for runners to analyze Strava trends over a selected period.

## Local Development

Create `.env` from `.env.example`, then run:

```powershell
npm start
```

Open `http://localhost:4173`.

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
angles and the app turns those choices into copy from verified comparisons.
The `/api/insights` route sends compact, app-calculated fact sheets: either the
selected-window trends or the selected run with similar-distance comparisons
and its window baseline. It does not send route coordinates or the complete
Strava activity payload. The URL and model above are the defaults, so set the
Ollama variables only when you want to override them.

Then deploy:

```powershell
npx wrangler deploy
```

If `/api/status` returns `404`, Cloudflare is only serving static assets. Redeploy from this repo with `wrangler deploy` so `src/worker.js` is included.

If `/auth/login` loads the dashboard instead of redirecting to Strava, make sure `wrangler.jsonc` includes `assets.run_worker_first` for `/auth/*` and `/api/*`, then redeploy.

## Cloudflare Pages

The repo also includes Pages Functions in `functions/` if you prefer a Pages project through Git integration. Use `public` as the output directory and leave the build command blank.
