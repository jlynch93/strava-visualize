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
  const api = { dayKey, weekStart, rampRate, freshCheckin, mergeActivities };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
