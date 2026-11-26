/* Builds an iCalendar (.ics) file of saved plan weeks and races. Shared by the
   Worker's subscription feed (src/calendar.js) and the browser's one-off
   download, and covered by tests/calendar-core.test.js. Pure: no DOM, no I/O. */
(function (root) {
  const KM_PER_MILE = 1.609344;
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const octets = (text) => (encoder ? encoder.encode(text).length : unescape(encodeURIComponent(text)).length);

  // RFC 5545 3.3.11: backslash, semicolon, comma and newlines are escaped in text.
  function escapeText(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
  }

  // RFC 5545 3.1: lines longer than 75 octets continue on the next line after
  // a space, split between characters so multi-byte text stays intact.
  function foldLine(line) {
    if (octets(line) <= 75) return line;
    const parts = [];
    let current = "";
    let size = 0;
    for (const character of line) {
      const width = octets(character);
      if (size + width > 75) { parts.push(current); current = " "; size = 1; }
      current += character; size += width;
    }
    parts.push(current);
    return parts.join("\r\n");
  }

  const compactDate = (date) => date.replace(/-/g, "");
  function nextDate(date) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    return day.toISOString().slice(0, 10);
  }
  const stamp = (now) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));

  function distanceText(miles, units) {
    const value = Number(miles) || 0;
    return units === "metric" ? `${(value * KM_PER_MILE).toFixed(1)} km` : `${value.toFixed(1)} mi`;
  }

  const isRaceSession = (session) => session.type === "race" || /^race day$/i.test(String(session.title || ""));

  // Events for the saved weeks from `since` on, plus races from `since` on.
  // Rest days are left out: a calendar full of "Rest" is noise. A race day in
  // the plan is left out when the race itself is on the calendar that day.
  // A day's workout and notes go in the event's description. The workout text
  // comes from TrainingCore.workoutSummary, passed in (the Worker) or global
  // (the browser); without it, only notes are added.
  function calendarEvents({ plans = {}, races = [], units = "imperial", since = "", describeWorkout = root.TrainingCore?.workoutSummary } = {}) {
    const events = [];
    const raceDates = new Set();
    for (const race of Array.isArray(races) ? races : []) {
      if (!race || !validDate(race.date) || race.date < since) continue;
      raceDates.add(race.date);
      const name = String(race.name || race.distance || "Race").slice(0, 100);
      const distance = race.distance && race.distance !== "Other" && race.name ? ` · ${race.distance}` : "";
      const priority = race.priority === "A" ? "Goal race" : race.priority === "B" ? "Tune-up race" : "Training race";
      events.push({
        uid: `race-${String(race.id || `${race.date}-${name}`).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)}`,
        date: race.date,
        summary: `🏁 ${name}${distance}`,
        description: `${priority}${race.url ? `\n${race.url}` : ""}`
      });
    }
    const perDate = new Map();
    for (const [week, plan] of Object.entries(plans && typeof plans === "object" ? plans : {})) {
      if (!plan || !Array.isArray(plan.sessions)) continue;
      for (const session of plan.sessions) {
        if (!session || session.kind !== "run" || !validDate(session.date) || session.date < since) continue;
        if (isRaceSession(session) && raceDates.has(session.date)) continue;
        // Stable ids per day, so a moved or edited session updates in place.
        const count = (perDate.get(session.date) || 0) + 1;
        perDate.set(session.date, count);
        const done = session.status === "completed" ? "✓ " : "";
        const skipped = session.status === "skipped" ? " (skipped)" : "";
        events.push({
          uid: `plan-${session.date}${count > 1 ? `-${count}` : ""}`,
          date: session.date,
          summary: `${done}${String(session.title || "Run").slice(0, 100)} · ${distanceText(session.miles, units)}${skipped}`,
          description: [
            (describeWorkout && session.workout && describeWorkout(session.workout)) || session.detail,
            typeof session.notes === "string" && session.notes.trim() ? `Notes: ${session.notes.trim().slice(0, 2000)}` : "",
            `Week of ${week}`
          ].filter(Boolean).join("\n")
        });
      }
    }
    return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  }

  function buildPlanCalendar({ plans, races, units = "imperial", now = new Date(), since = "", name = "Runlore training plan", domain = "runlore.app", describeWorkout } = {}) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Runlore//Training plan//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(name)}`,
      "X-WR-CALDESC:Planned runs and races from Runlore",
      // Hints, not guarantees: Apple Calendar honours them; Google refreshes
      // subscribed calendars on its own schedule (often several hours).
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H"
    ];
    const dtstamp = stamp(now);
    for (const event of calendarEvents({ plans, races, units, since, ...(describeWorkout ? { describeWorkout } : {}) })) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${event.uid}@${domain}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
        `DTEND;VALUE=DATE:${compactDate(nextDate(event.date))}`,
        `SUMMARY:${escapeText(event.summary)}`,
        ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
        // All-day training notes should not mark the day as busy.
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return `${lines.map(foldLine).join("\r\n")}\r\n`;
  }

  const api = { escapeText, foldLine, calendarEvents, buildPlanCalendar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CalendarCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
