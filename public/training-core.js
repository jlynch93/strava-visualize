/* Pure calculations shared by the dashboard and regression tests. Internal units are miles/seconds. */
(function (root) {
  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  function weekStart(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return date;
  }
  function rampRate(runs, start, end, parseDate) {
    if (!start || !end) return null;
    // Compare the latest two complete calendar weeks with the two before them.
    const finish = weekStart(end);
    if (end.getDay() === 0 && end.getHours() === 23 && end.getMinutes() === 59) finish.setDate(finish.getDate() + 7);
    const begin = new Date(finish); begin.setDate(begin.getDate() - 28);
    if (start > begin) return null;
    const middle = new Date(begin); middle.setDate(middle.getDate() + 14);
    let early = 0, late = 0;
    runs.forEach((run) => {
      const date = parseDate(run);
      if (date < begin || date >= finish) return;
      if (date < middle) early += Number(run.distance) || 0;
      else late += Number(run.distance) || 0;
    });
    return early > 0 ? (late - early) / early * 100 : null;
  }
  function freshCheckin(checkin, now = new Date()) {
    const age = now - new Date(checkin?.savedAt || 0);
    return age >= 0 && age < 7 * 86400000 ? checkin : {};
  }
  function mergeActivities(existing, incoming) {
    return [...new Map([...existing, ...incoming].map((run) => [String(run.id), run])).values()];
  }
  /* ---------- Editing a planned week ---------- */

  // The kinds of day a week can hold. Saved sessions keep their title and kind
  // (older plans have no type), so the type is read back from the title.
  const SESSION_TYPES = {
    rest: { label: "Rest", title: "Rest / mobility", detail: "Leave room to recover", kind: "rest" },
    easy: { label: "Easy", title: "Easy run", detail: "Conversational effort", kind: "run" },
    steady: { label: "Steady", title: "Steady run", detail: "Comfortably moderate", kind: "run" },
    quality: { label: "Quality", title: "Quality option", detail: "Intervals or tempo, if your check-in supports it", kind: "run" },
    long: { label: "Long", title: "Long run", detail: "Easy pace, time on your feet", kind: "run" },
    race: { label: "Race", title: "Race day", detail: "Race effort", kind: "run" }
  };
  // A race's own distance, for its day on the plan. "Other" has no known
  // distance, so the day keeps whatever the plan gave it.
  const RACE_MILES = { "5K": 5 / 1.609344, "10K": 10 / 1.609344, "Half marathon": 21.0975 / 1.609344, "Marathon": 42.195 / 1.609344 };
  function raceMiles(race) {
    const value = RACE_MILES[race?.distance];
    return value ? Number(value.toFixed(1)) : null;
  }
  function sessionType(session) {
    if (session && Object.hasOwn(SESSION_TYPES, session.type)) return session.type;
    if (!session || session.kind !== "run") return "rest";
    const title = String(session.title || "");
    if (/race/i.test(title)) return "race";
    if (/long/i.test(title)) return "long";
    if (/quality/i.test(title)) return "quality";
    if (/steady/i.test(title)) return "steady";
    return "easy";
  }
  // A new distance for a day that becomes a run: the week's typical run, so a
  // rest day turned into a run does not start at zero.
  function typicalRunMiles(sessions, except) {
    const runs = sessions.filter((session) => session !== except && session.kind === "run" && sessionType(session) !== "race" && session.miles > 0);
    return runs.length ? Number((runs.reduce((sum, session) => sum + session.miles, 0) / runs.length).toFixed(1)) : 3;
  }
  // Changing the type keeps the distance and status of a run that stays a run.
  // A rest day has no distance, status or matched activity.
  // A known race on that day (options.race) sets a race session's distance.
  function retypeSession(session, type, sessions = [], options = {}) {
    const spec = SESSION_TYPES[type];
    if (!spec) throw new Error(`Unknown session type: ${type}`);
    const next = { ...session, type, title: spec.title, detail: spec.detail, kind: spec.kind };
    const racing = type === "race" ? raceMiles(options.race) : null;
    if (spec.kind === "rest") Object.assign(next, { miles: 0, status: "planned", matchedId: "" });
    else if (racing !== null) next.miles = racing;
    else if (session.kind !== "run" || !(session.miles > 0)) next.miles = typicalRunMiles(sessions, session);
    return next;
  }
  // Moving a day onto another swaps the two, so a week always has one session
  // per day. Both lose a completed status and matched run: those belong to the
  // date the run actually happened.
  function moveSession(sessions, fromDate, toDate) {
    if (fromDate === toDate) return sessions.map((session) => ({ ...session }));
    return sessions.map((session) => {
      if (session.date !== fromDate && session.date !== toDate) return { ...session };
      const moved = { ...session, date: session.date === fromDate ? toDate : fromDate };
      if (moved.status === "completed") moved.status = "planned";
      moved.matchedId = "";
      return moved;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
  function setSessionMiles(session, miles) {
    if (session.kind !== "run") return { ...session };
    const value = Math.min(100, Math.max(0, Number(miles) || 0));
    return { ...session, miles: Number(value.toFixed(2)) };
  }
  function weekTotals(sessions) {
    const runs = sessions.filter((session) => session.kind === "run");
    const done = runs.filter((session) => session.status === "completed");
    const sum = (list) => Number(list.reduce((total, session) => total + (Number(session.miles) || 0), 0).toFixed(1));
    return { miles: sum(runs), runs: runs.length, completedMiles: sum(done), completedRuns: done.length, skippedRuns: runs.filter((session) => session.status === "skipped").length };
  }

  const api = { dayKey, weekStart, rampRate, freshCheckin, mergeActivities, SESSION_TYPES, raceMiles, sessionType, retypeSession, moveSession, setSessionMiles, weekTotals };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
