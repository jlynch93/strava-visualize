import strava from "./strava.js";

// Each provider implements the same interface:
//   id, name
//   config(env, request)            -> { clientId, clientSecret, redirectUri } | { error, redirectUri }
//   authorizeUrl(config, state)     -> URL string to send the browser to
//   exchangeCode(config, { code, searchParams }) -> { tokens, account: { id, displayName, avatarUrl } }
//   refresh(config, tokens)         -> tokens
//   listActivities(accessToken, { after, before, perPage, maxPages }) -> { activities, truncated }
//   getActivity(accessToken, id)    -> activity
// Activities are returned in Strava's field shape, which the dashboard's
// normalizeActivity() already understands. Garmin will map onto it as well.
export const providers = { strava };

export function getProvider(id) {
  return Object.hasOwn(providers, id) ? providers[id] : null;
}
