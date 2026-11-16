import strava from "./strava.js";
import garmin from "./garmin.js";

// Each provider implements:
//   id, name
//   config(env, request)            -> { clientId, clientSecret, redirectUri } | { error, redirectUri }
//   authorizeUrl(config, state, pkce?) -> URL string to send the browser to
//   exchangeCode(config, { code, codeVerifier, searchParams }) -> { tokens, account: { id, displayName, avatarUrl } }
//   refresh(config, tokens)         -> tokens
// and either fetches activities on demand:
//   listActivities(accessToken, { after, before, perPage, maxPages }) -> { activities, truncated }
//   getActivity(accessToken, id)    -> activity
// or sets `storesActivities: true` when the provider pushes data that the
// app keeps in D1 (see src/webhooks.js).
//
// Optional:
//   pkce: true                      -> login sends a S256 code challenge
//   onConnected(env, config, tokens, userId) -> after a connection is saved
//   backfill: { windows } + requestBackfillWindow(accessToken, anchorEnd, index)
//                                   -> history import run as a background job
//                                      with retries (src/sync.js)
//   onDisconnect(config, accessToken)        -> before a connection is removed
//
// Activities use Strava's field names, which the dashboard's
// normalizeActivity() already understands.
export const providers = { strava, garmin };

export function getProvider(id) {
  return Object.hasOwn(providers, id) ? providers[id] : null;
}
