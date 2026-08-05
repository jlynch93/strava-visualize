// Keep browser tests isolated from any developer server or Strava credentials.
process.env.PORT = process.env.PORT || "43174";
process.env.STRAVA_CLIENT_ID = "";
process.env.STRAVA_CLIENT_SECRET = "";

require("../server.js");
