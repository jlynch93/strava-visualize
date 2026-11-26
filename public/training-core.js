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
    // A rest day has no workout; its notes stay.
    if (spec.kind === "rest") { Object.assign(next, { miles: 0, status: "planned", matchedId: "" }); delete next.workout; }
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

  /* ---------- Structured workouts ---------- */

  // A workout: an optional warm-up and cool-down around one or more sets of
  // repeats ("4 x 1 mi @ threshold, 75 s jog"). Amounts are distances (mi, km,
  // m) or times (min, s); intensities match the app's training paces.
  const WORKOUT_INTENSITIES = { easy: "easy", marathon: "marathon pace", threshold: "threshold", interval: "interval", repetition: "repetition" };
  const WORKOUT_UNITS = ["mi", "km", "m", "min", "s"];
  const RECOVERY_MODES = ["jog", "walk", "rest"];
  const WORKOUT_TEMPLATES = [
    { key: "threshold", label: "Threshold repeats", text: "2 mi warm-up, 4 x 1 mi threshold w/ 75 s jog, 2 mi cool-down" },
    { key: "tempo", label: "Tempo", text: "2 mi warm-up, 20 min tempo, 2 mi cool-down" },
    { key: "vo2", label: "VO2 intervals", text: "2 mi warm-up, 6 x 800 m interval w/ 400 m jog, 2 mi cool-down" },
    { key: "marathon", label: "Marathon pace", text: "2 mi warm-up, 6 mi marathon pace, 1 mi cool-down" },
    { key: "strides", label: "Easy + strides", text: "4 mi easy, 6 x 20 s repetition w/ 60 s walk" }
  ];
  // Fallback paces (seconds per mile) when there is no fitness estimate yet.
  const DEFAULT_PACE_PER_MILE = { easy: 600, marathon: 510, threshold: 480, interval: 450, repetition: 420, walk: 1000 };

  function cleanSegment(raw, withIntensity) {
    if (!raw || typeof raw !== "object") return null;
    const amount = Number(raw.amount);
    if (!(amount > 0) || amount > 1000 || !WORKOUT_UNITS.includes(raw.unit)) return null;
    const segment = { amount: Number(amount.toFixed(2)), unit: raw.unit };
    if (withIntensity) segment.intensity = Object.hasOwn(WORKOUT_INTENSITIES, raw.intensity) ? raw.intensity : "threshold";
    return segment;
  }
  // Saved workouts come back from storage and sync, so they are rebuilt from
  // known fields only; anything unusable is dropped rather than trusted.
  function sanitizeWorkout(raw) {
    if (!raw || typeof raw !== "object") return null;
    const sets = (Array.isArray(raw.sets) ? raw.sets : []).slice(0, 10).map((set) => {
      const work = cleanSegment(set?.work, true);
      if (!work) return null;
      const reps = Math.min(50, Math.max(1, Math.round(Number(set.reps) || 1)));
      const recovery = cleanSegment(set.recovery, false);
      return { reps, work, recovery: recovery ? { ...recovery, mode: RECOVERY_MODES.includes(set.recovery.mode) ? set.recovery.mode : "jog" } : null };
    }).filter(Boolean);
    const warmup = cleanSegment(raw.warmup, false);
    const cooldown = cleanSegment(raw.cooldown, false);
    return sets.length || warmup || cooldown ? { warmup, sets, cooldown } : null;
  }

  const UNIT_WORDS = [
    [/^(?:miles?|mi)$/, "mi"], [/^(?:kilometers?|kilometres?|km|k)$/, "km"], [/^(?:meters?|metres?|m)$/, "m"],
    [/^(?:minutes?|mins?|min)$/, "min"], [/^(?:seconds?|secs?|sec|s)$/, "s"]
  ];
  const AMOUNT = String.raw`(\d+(?:\.\d+)?|\d+:\d{2})\s*(miles?|mi|kilometers?|kilometres?|km|k|meters?|metres?|m|minutes?|mins?|min|seconds?|secs?|sec|s)\b`;
  function readAmount(number, word) {
    const unit = UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1];
    if (!unit) return null;
    // "1:30" is minutes and seconds.
    if (number.includes(":")) { const [minutes, seconds] = number.split(":").map(Number); return { amount: minutes * 60 + seconds, unit: "s" }; }
    return { amount: Number(number), unit };
  }
  function readIntensity(text) {
    if (/threshold|tempo|\blt\b|t[- ]pace/.test(text)) return "threshold";
    if (/interval|vo2|5k pace|i[- ]pace|\bhard\b/.test(text)) return "interval";
    if (/marathon|\bmp\b|m[- ]pace/.test(text)) return "marathon";
    if (/repetition|\breps? pace\b|mile pace|r[- ]pace|stride/.test(text)) return "repetition";
    if (/\beasy\b|e[- ]pace/.test(text)) return "easy";
    return null;
  }
  function readRecovery(text) {
    const match = text.match(new RegExp(`${AMOUNT}\\s*(?:of\\s*)?(jog|jogging|walk|walking|rest|standing|stand|float)?`));
    if (!match) return null;
    const amount = readAmount(match[1], match[2]);
    if (!amount) return null;
    const mode = /walk/.test(match[3] || "") ? "walk" : /rest|stand/.test(match[3] || text) && !/jog/.test(text) ? "rest" : "jog";
    return { ...amount, mode };
  }

  // Reads a plain description such as "2 mi warm-up, 4 x 1 mile threshold with
  // 75 sec jog recovery, 2 mi cool-down". Returns null when nothing is recognised.
  function parseWorkout(text) {
    const source = String(text || "").toLowerCase().replace(/×/g, "x").replace(/warm\s*-?\s*up|\bwu\b/g, "warm-up").replace(/cool\s*-?\s*down|\bcd\b/g, "cool-down")
      // "1:30" is minutes and seconds, with or without a unit after it.
      .replace(/\b(\d+):([0-5]\d)\b(?:\s*(?:minutes?|mins?|min)\b)?/g, (_, minutes, seconds) => `${Number(minutes) * 60 + Number(seconds)} s`);
    const parts = source.split(/[,;]|\bthen\b|\s\+\s/).map((part) => part.trim()).filter(Boolean);
    const workout = { warmup: null, sets: [], cooldown: null };
    for (const part of parts) {
      const first = part.match(new RegExp(AMOUNT));
      if (!first) continue;
      const amount = readAmount(first[1], first[2]);
      if (/warm-up/.test(part)) { workout.warmup = amount; continue; }
      if (/cool-down/.test(part)) { workout.cooldown = amount; continue; }
      const repeat = part.match(new RegExp(`(\\d+)\\s*x\\s*${AMOUNT}`));
      if (repeat) {
        const work = readAmount(repeat[2], repeat[3]);
        const rest = part.slice(part.indexOf(repeat[0]) + repeat[0].length);
        const reps = Number(repeat[1]);
        workout.sets.push({ reps, work: { ...work, intensity: readIntensity(rest) || (reps > 1 ? "interval" : "threshold") }, recovery: readRecovery(rest) });
        continue;
      }
      // A part that is only a recovery ("75 s jog") belongs to the set before it.
      if (workout.sets.length && /jog|walk|rest|recovery|standing|float/.test(part) && !readIntensity(part)) {
        workout.sets[workout.sets.length - 1].recovery ||= readRecovery(part);
        continue;
      }
      workout.sets.push({ reps: 1, work: { ...amount, intensity: readIntensity(part) || "threshold" }, recovery: null });
    }
    return sanitizeWorkout(workout);
  }

  function amountText({ amount, unit }) {
    const value = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
    return unit === "s" && value >= 120 && value % 60 === 0 ? `${value / 60} min` : `${value} ${unit}`;
  }
  function workoutSummary(raw) {
    const workout = sanitizeWorkout(raw);
    if (!workout) return "";
    const parts = [];
    if (workout.warmup) parts.push(`${amountText(workout.warmup)} warm-up`);
    for (const set of workout.sets) {
      const work = `${set.reps > 1 ? `${set.reps} × ` : ""}${amountText(set.work)} @ ${WORKOUT_INTENSITIES[set.work.intensity]}`;
      parts.push(set.recovery ? `${work}, ${amountText(set.recovery)} ${set.recovery.mode}` : work);
    }
    if (workout.cooldown) parts.push(`${amountText(workout.cooldown)} cool-down`);
    return parts.join(" · ");
  }

  // Seconds per meter for an intensity: the middle of the app's training-pace
  // range when there is one (FitnessCore.trainingPaces), else a fallback.
  function paceSecondsPerMeter(intensity, paces) {
    const range = paces?.[intensity];
    if (Array.isArray(range) && range[0] > 0 && range[1] > 0) return (range[0] + range[1]) / 2;
    return (DEFAULT_PACE_PER_MILE[intensity] || DEFAULT_PACE_PER_MILE.easy) / 1609.344;
  }
  function segmentMeters(segment, intensity, paces) {
    if (segment.unit === "mi") return segment.amount * 1609.344;
    if (segment.unit === "km") return segment.amount * 1000;
    if (segment.unit === "m") return segment.amount;
    const seconds = segment.unit === "min" ? segment.amount * 60 : segment.amount;
    return seconds / paceSecondsPerMeter(intensity, paces);
  }
  // Total distance in miles, timed parts converted at their intensity's pace.
  // Standing rest adds nothing; the last rep's recovery is not run.
  function workoutMiles(raw, paces = null) {
    const workout = sanitizeWorkout(raw);
    if (!workout) return 0;
    let meters = 0;
    if (workout.warmup) meters += segmentMeters(workout.warmup, "easy", paces);
    if (workout.cooldown) meters += segmentMeters(workout.cooldown, "easy", paces);
    for (const set of workout.sets) {
      meters += set.reps * segmentMeters(set.work, set.work.intensity, paces);
      if (set.recovery && set.recovery.mode !== "rest") meters += (set.reps - 1) * segmentMeters(set.recovery, set.recovery.mode === "walk" ? "walk" : "easy", paces);
    }
    return Number((meters / 1609.344).toFixed(1));
  }
  // The target pace for a set, as seconds per mile (or null without paces).
  function workoutTargetPace(intensity, paces) {
    const range = paces?.[intensity];
    return Array.isArray(range) ? range.map((value) => Math.round(value * 1609.344)) : null;
  }

  const api = { dayKey, weekStart, rampRate, freshCheckin, mergeActivities, SESSION_TYPES, raceMiles, sessionType, retypeSession, moveSession, setSessionMiles, weekTotals, WORKOUT_INTENSITIES, WORKOUT_UNITS, RECOVERY_MODES, WORKOUT_TEMPLATES, sanitizeWorkout, parseWorkout, workoutSummary, workoutMiles, workoutTargetPace };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
