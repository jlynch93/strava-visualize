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
```

Then deploy:

```powershell
npx wrangler deploy
```

If `/api/status` returns `404`, Cloudflare is only serving static assets. Redeploy from this repo with `wrangler deploy` so `src/worker.js` is included.

## Cloudflare Pages

The repo also includes Pages Functions in `functions/` if you prefer a Pages project through Git integration. Use `public` as the output directory and leave the build command blank.
