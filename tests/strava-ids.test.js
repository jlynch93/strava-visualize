// Strava ids become 64-bit after June 1, 2027. JSON.parse would round them, so
// the Worker and the browser keep them exact, as strings, end to end.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { LocalD1 } = require("../scripts/d1-sqlite.js");

const load = (file) => import(pathToFileURL(path.resolve(__dirname, file)).href);
const BIG_ACTIVITY = "9007199254740993"; // 2^53 + 1: JSON.parse would read 9007199254740992
const BIG_ATHLETE = "9223372036854775807"; // the largest 64-bit id
const NEIGHBOUR = "9223372036854775806"; // rounds to the same double as BIG_ATHLETE

test("JSON from providers keeps 64-bit integers exact and leaves other numbers alone", async () => {
  const { parseJsonExact } = await load("../src/http.js");
  assert.notEqual(String(JSON.parse(`{"id":${BIG_ACTIVITY}}`).id), BIG_ACTIVITY, "plain JSON.parse loses it");
  const data = parseJsonExact(`{"id":${BIG_ACTIVITY},"athlete":{"id":${BIG_ATHLETE}},"distance":10012.5,"moving_time":3600,"small":123,"neg":-5}`);
  assert.equal(data.id, BIG_ACTIVITY);
  assert.equal(data.athlete.id, BIG_ATHLETE);
  assert.equal(data.distance, 10012.5);
  assert.equal(data.moving_time, 3600);
  assert.equal(data.small, 123);
  assert.equal(data.neg, -5);
});

test("Strava activities and athletes use id_str when present, and string ids always", async () => {
  const { stravaId, normalizeStravaActivity } = await load("../src/providers/strava.js");
  assert.equal(stravaId({ id: 9007199254740992, id_str: BIG_ACTIVITY }), BIG_ACTIVITY);
  assert.equal(stravaId({ id: 123 }), "123");
  assert.equal(stravaId({}), "");
  const activity = normalizeStravaActivity({ id: 9007199254740992, id_str: BIG_ACTIVITY, athlete: { id: 1, id_str: BIG_ATHLETE }, name: "Run" });
  assert.equal(activity.id, BIG_ACTIVITY);
  assert.equal(activity.athlete.id, BIG_ATHLETE);
  assert.equal(activity.name, "Run");
});

test("64-bit athletes stay distinct and 64-bit activities round-trip through the Worker", async (t) => {
  const worker = (await load("../src/worker.js")).default;
  const env = {
    STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DB: new LocalD1(":memory:"), ASSETS: { fetch: async () => new Response("asset") }
  };
  let athlete = BIG_ATHLETE;
  // Raw JSON text, as Strava sends it: the ids are bare 64-bit numbers.
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const target = new URL(url);
    if (target.pathname === "/oauth/token") {
      const grant = new URLSearchParams(options.body).get("grant_type");
      const body = `{"access_token":"a","refresh_token":"r","expires_at":${Math.floor(Date.now() / 1000) + 3600}${grant === "authorization_code" ? `,"athlete":{"id":${athlete},"firstname":"Jo"}` : ""}}`;
      return new Response(body, { headers: { "content-type": "application/json" } });
    }
    if (target.pathname === "/api/v3/athlete/activities") return new Response(`[{"id":${BIG_ACTIVITY},"name":"Long run","start_date":"2027-06-02T07:00:00Z","distance":21100}]`);
    return new Response(`{"id":${BIG_ACTIVITY},"name":"Long run"}`);
  });
  const cookie = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
  const signIn = async () => {
    const login = await worker.fetch(new Request("https://example.test/auth/strava/login"), env);
    const state = new URL(login.headers.get("location")).searchParams.get("state");
    const callback = await worker.fetch(new Request(`https://example.test/auth/strava/callback?code=c&state=${state}&scope=read,activity:read_all`, { headers: { cookie: cookie(login, "sv_oauth_state") } }), env);
    return cookie(callback, "sv_session");
  };
  const first = await signIn();
  athlete = NEIGHBOUR;
  const second = await signIn();
  const me = async (session) => (await worker.fetch(new Request("https://example.test/api/me", { headers: { cookie: session } }), env)).json();
  const [one, two] = [await me(first), await me(second)];
  assert.notEqual(one.user.id, two.user.id, "two 64-bit athletes that round to the same number are different people");

  const list = await (await worker.fetch(new Request("https://example.test/api/activities?provider=strava", { headers: { cookie: first } }), env)).json();
  assert.equal(list.activities[0].id, BIG_ACTIVITY);
  const rows = await env.DB.prepare("SELECT provider_user_id FROM provider_connections ORDER BY provider_user_id").all();
  assert.deepEqual(rows.results.map((row) => row.provider_user_id), [NEIGHBOUR, BIG_ATHLETE]);
});
