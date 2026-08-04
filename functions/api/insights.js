import { json } from "../_shared.js";

const DEFAULT_OLLAMA_URL = "https://ollama.jeer.rest";
const DEFAULT_OLLAMA_MODEL = "qwen3:0.6b";

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observations: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          tone: { type: "string", enum: ["positive", "neutral", "caution"] }
        },
        required: ["title", "detail", "tone"]
      }
    }
  },
  required: ["summary", "observations"]
};

const RUN_DIGEST_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    digest: { type: "string" },
    evidence: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          tone: { type: "string", enum: ["positive", "neutral", "caution"] }
        },
        required: ["label", "detail", "tone"]
      }
    },
    compareNext: { type: "string" }
  },
  required: ["headline", "digest", "evidence", "compareNext"]
};

function buildPrompt(input) {
  const summary = input.summary || {};
  const pace = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const periods = (input.buckets || []).map((period) =>
    `${period.period}: ${period.runs} runs, ${period.miles} mi, ${pace(period.averagePaceSeconds)}, long ${period.longRunMiles} mi, HR ${period.averageHr ?? "n/a"}, load ${period.trainingLoad}`
  );
  const runs = (input.recentRuns || []).map((run) =>
    `${run.date}: ${run.distanceMiles} mi, ${pace(run.paceSecondsPerMile)}, ${run.elevationFeet} ft, HR ${run.averageHr ?? "n/a"}, load ${run.trainingLoad}`
  );
  return [
    `Focus: ${input.focus || "balanced"}. Window: ${input.range?.start || "unknown"} to ${input.range?.end || "unknown"}.`,
    `Totals: ${summary.runCount} runs, ${summary.totalMiles} mi, average pace ${pace(summary.averagePaceSeconds)}, average ${summary.averageWeeklyMiles} mi/week and ${summary.averageRunsPerWeek} runs/week.`,
    `Signals: long run ${summary.longRunMiles} mi (${summary.longRunSharePercent}% of mileage), peak week ${summary.peakWeekMiles} mi, consistency ${summary.consistencyPercent}%, ramp ${summary.rampRatePercent}%, average HR ${summary.averageHr ?? "n/a"}, load ${summary.trainingLoad}, longest rest gap ${summary.longestRestGapDays} days.`,
    `Recent periods:\n${periods.join("\n")}`,
    `Recent runs:\n${runs.join("\n")}`,
    "Load is a rough estimate.",
    "Write athlete-facing prose, not labels, placeholders, plans, or a data dump.",
    "Summary: 1-2 sentences connecting at least two metrics.",
    "Observations: 3 distinct trends or comparisons; do not merely list individual runs.",
    "Do not invent numbers or diagnose health, injury, overtraining, or readiness."
  ].join("\n");
}

function insightHeadline(input) {
  const summary = input?.summary || {};
  const ramp = Number(summary.rampRatePercent) || 0;
  const consistency = Number(summary.consistencyPercent) || 0;
  if (ramp > 15) return "Volume is rising faster than your recent baseline";
  if (ramp < -15) return "Training volume has eased across this window";
  if ((Number(summary.longestRestGapDays) || 0) >= 7) return "Long recovery gaps are shaping this training block";
  if (consistency >= 80) return "Consistent training is anchoring this running block";
  return "Steady training with room to build consistency";
}

function safeNextStep(input) {
  const summary = input?.summary || {};
  const weeklyMiles = Math.max(0, Number(summary.averageWeeklyMiles) || 0);
  const runs = Math.max(1, Math.round(Number(summary.averageRunsPerWeek) || 1));
  const observedLongRun = Math.max(0, Number(summary.longRunMiles) || 0);
  const longRun = weeklyMiles ? Math.min(observedLongRun, weeklyMiles) : observedLongRun;
  return `Repeat roughly your recent baseline next week: about ${weeklyMiles.toFixed(1)} miles across ${runs} ${runs === 1 ? "run" : "runs"}, keep the longest effort at or below ${longRun.toFixed(1)} miles, and take an easy or rest day afterward.`;
}

function normalizeInsight(value, input) {
  const observations = Array.isArray(value?.observations)
    ? value.observations.slice(0, 4).map((item) => ({
      title: String(item?.title || "Training signal").slice(0, 100),
      detail: String(item?.detail || "").slice(0, 500),
      tone: ["positive", "neutral", "caution"].includes(item?.tone) ? item.tone : "neutral"
    }))
    : [];
  if (!value?.summary || observations.length < 3) {
    throw new Error("Ollama returned an incomplete analysis. Try again.");
  }
  return {
    headline: insightHeadline(input),
    summary: String(value.summary).slice(0, 700),
    observations,
    nextStep: safeNextStep(input),
    caution: "Pattern-based guidance from your run data, not medical advice."
  };
}

function compactNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "unavailable";
}

function compactPace(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/mi` : "unavailable";
}

function paceComparisonLine(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) return "Pace comparison is unavailable.";
  if (delta === 0) return "This run matched the comparable pace.";
  return `This run was ${Math.abs(Math.round(delta))} sec/mi ${delta < 0 ? "faster" : "slower"} than the comparable pace.`;
}

function loadComparisonLine(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) return "Load-per-mile comparison is unavailable.";
  if (delta === 0) return "This run matched the comparable load per mile.";
  return `This run's load per mile was ${Math.abs(Math.round(delta))}% ${delta > 0 ? "higher" : "lower"} than comparable efforts.`;
}

function buildRunDigestPrompt(input) {
  const run = input?.run || {};
  const comparison = input?.comparison || {};
  const context = input?.context || {};
  const weather = input?.weather || null;
  const allowedRunTypes = new Set(["Race", "Quality", "Long", "Easy", "Steady"]);
  const runType = allowedRunTypes.has(run.runType) ? run.runType : "Run";
  const paceComparison = paceComparisonLine(comparison.paceDeltaSeconds);
  const loadComparison = loadComparisonLine(comparison.loadPerMileDeltaPercent);
  const weatherLine = weather
    ? `Modeled weather at the rounded run start: ${compactNumber(weather.temperatureF)}°F, feels ${compactNumber(weather.feelsLikeF)}°F, humidity ${compactNumber(weather.humidityPercent)}%, wind ${compactNumber(weather.windSpeedMph)} mph, precipitation ${compactNumber(weather.precipitationInches, 2)} in.`
    : "Modeled weather was unavailable for this run.";
  return [
    "Write a concise, encouraging digest of this single running effort. Use only the supplied facts and return JSON matching the requested schema.",
    `Run type: ${runType}. Distance ${compactNumber(run.distanceMiles, 2)} mi. Moving time ${compactNumber(run.movingMinutes, 1)} min. Stopped ${compactNumber(run.stoppedMinutes, 1)} min. Pace ${compactPace(run.paceSecondsPerMile)}. Elevation ${compactNumber(run.elevationFeet)} ft (${compactNumber(run.elevationFeetPerMile)} ft/mi). Average heart rate ${compactNumber(run.averageHr)} bpm. Training load ${compactNumber(run.trainingLoad)} (${compactNumber(run.loadPerMile, 1)} per mile).`,
    `Comparable efforts: ${compactNumber(comparison.similarRunCount)} similar-distance runs. Comparable pace ${compactPace(comparison.similarPaceSecondsPerMile)}. ${paceComparison} Comparable load per mile ${compactNumber(comparison.similarLoadPerMile, 1)}. ${loadComparison} Prior-run gap ${compactNumber(comparison.daysSincePreviousRun)} days; next-run gap ${compactNumber(comparison.daysUntilNextRun)} days.`,
    `Selected-window context: ${compactNumber(context.selectedWindowRunCount)} runs. Distance percentile ${compactNumber(context.distancePercentile)}. Pace percentile ${compactNumber(context.pacePercentile)} where higher is faster. Load percentile ${compactNumber(context.loadPercentile)}.`,
    weatherLine,
    "Headline: one grounded sentence. Digest: one or two concise sentences. Evidence: 2 or 3 distinct items tied to the supplied facts. Compare next: one modest next comparison, not a prescription.",
    "Do not invent values, calculate new ratios or percentages, reverse comparison directions, infer workout intent, diagnose health, injury, overtraining, readiness, or make medical claims. Only call the run faster, slower, higher, or lower when it exactly agrees with the explicit comparison sentences. Weather is modeled context, not a causal explanation."
  ].join("\n");
}

function normalizeRunDigest(value, input) {
  const evidence = Array.isArray(value?.evidence)
    ? value.evidence.slice(0, 3).map((item) => ({
      label: String(item?.label || "Run signal").slice(0, 80),
      detail: String(item?.detail || "").slice(0, 280),
      tone: ["positive", "neutral", "caution"].includes(item?.tone) ? item.tone : "neutral"
    })).filter((item) => item.detail)
    : [];
  if (!value?.headline || !value?.digest || !value?.compareNext || evidence.length < 2) {
    throw new Error("Ollama returned an incomplete run digest. Try again.");
  }
  const similarCount = Math.max(0, Math.round(Number(input?.comparison?.similarRunCount) || 0));
  const caution = similarCount < 3
    ? `This read has only ${similarCount} similar-distance run${similarCount === 1 ? "" : "s"} for comparison. Treat it as a starting point, not a verdict.`
    : input?.weather
      ? "Weather is modeled context and does not establish why a run felt or performed a certain way. Pattern-based guidance only, not medical advice."
      : "Pattern-based guidance from your run data, not medical advice.";
  return {
    headline: String(value.headline).slice(0, 220),
    digest: String(value.digest).slice(0, 560),
    evidence,
    compareNext: String(value.compareNext).slice(0, 280),
    caution
  };
}

export async function onRequestPost({ env, request }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ error: "The training summary is too large." }, 413);
  const input = await request.json();
  const isRunDigest = input?.kind === "run" && input?.run;
  if (!isRunDigest && (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length)) {
    return json({ error: "No running data was supplied." }, 400);
  }
  const baseUrl = String(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: isRunDigest ? RUN_DIGEST_SCHEMA : INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: isRunDigest ? "Concise, grounded running coach. Return only schema-valid JSON." : "Concise running analyst. Return only schema-valid JSON." },
        { role: "user", content: isRunDigest ? buildRunDigestPrompt(input) : buildPrompt(input) }
      ],
      options: { temperature: 0.1, num_ctx: 8192, num_predict: isRunDigest ? 360 : 480 }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const data = await response.json();
  if (!response.ok) return json({ error: data.error || `Ollama returned HTTP ${response.status}.` }, 502);
  let parsed;
  try {
    parsed = JSON.parse(data.message?.content || "");
  } catch {
    return json({ error: "Ollama returned an unreadable analysis. Try again." }, 502);
  }
  try {
    return json({ insight: isRunDigest ? normalizeRunDigest(parsed, input) : normalizeInsight(parsed, input), model });
  } catch (error) {
    return json({ error: error.message || "Ollama returned an incomplete analysis. Try again." }, 502);
  }
}
