# Strava Visualize

A web dashboard for runners to analyze Strava trends over a selected period.

## Local Development

Create `.env` from `.env.example`, then run:

```powershell
npm start
```

Open `http://localhost:4173`.

## Cloudflare Pages

The static app lives in `public/`. Strava API routes are implemented as Cloudflare Pages Functions in `functions/`.

Set these Cloudflare Pages environment variables:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
STRAVA_REDIRECT_URI=https://your-pages-domain.pages.dev/auth/callback
```

Then deploy:

```powershell
npx wrangler pages deploy public --project-name strava-visualize
```
