import { json } from "../_shared.js";

const DEFAULT_OLLAMA_URL = "https://ollama.jeer.rest";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:0.8b";
const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
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
    },
    nextStep: { type: "string" }
  },
  required: ["headline", "summary", "observations", "nextStep"]
};

function buildPrompt(input) {
  const summary = input.summary || {};
  const question = String(input.question || "").trim().slice(0, 280);
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
  const trend = input.trend || null;
  const trendComparison = trend
    ? `App-calculated comparison (${trend.earlierPeriodCount} earlier periods vs ${trend.recentPeriodCount} recent periods): volume ${trend.earlierAverageMiles} to ${trend.recentAverageMiles} mi/period (${trend.volumeChangePercent >= 0 ? "+" : ""}${trend.volumeChangePercent}%); pace ${pace(trend.earlierAveragePaceSeconds)} to ${pace(trend.recentAveragePaceSeconds)} (${trend.paceChangeSeconds < 0 ? `${Math.abs(trend.paceChangeSeconds)} sec/mi faster` : trend.paceChangeSeconds > 0 ? `${trend.paceChangeSeconds} sec/mi slower` : "unchanged"}); HR ${trend.earlierAverageHr ?? "n/a"} to ${trend.recentAverageHr ?? "n/a"} bpm; load ${trend.earlierAverageLoad ?? "n/a"} to ${trend.recentAverageLoad ?? "n/a"}.`
    : "App-calculated earlier-vs-recent comparison is unavailable for this window.";
  return [
    `Focus: ${input.focus || "balanced"}. Window: ${input.range?.start || "unknown"} to ${input.range?.end || "unknown"}.`,
    `Athlete question: ${question || "No custom question; provide a focused review of the selected window."}`,
    `Totals: ${summary.runCount} runs, ${summary.totalMiles} mi, average pace ${pace(summary.averagePaceSeconds)}, average ${summary.averageWeeklyMiles} mi/week and ${summary.averageRunsPerWeek} runs/week.`,
    `Signals: long run ${summary.longRunMiles} mi (${summary.longRunSharePercent}% of mileage), peak week ${summary.peakWeekMiles} mi, consistency ${summary.consistencyPercent}%, ramp ${summary.rampRatePercent}%, average HR ${summary.averageHr ?? "n/a"}, load ${summary.trainingLoad}, longest rest gap ${summary.longestRestGapDays} days.`,
    trendComparison,
    "Load is a rough estimate.",
    "Consistency is the percentage of grouped periods containing at least one run; it does not measure discipline, plan adherence, recovery quality, or effort.",
    "Pace values are minutes per mile. Heart rate values are bpm. Never combine or relabel those units.",
    "Write only the athlete-facing training read. The app already calculated every metric and chart; never imply that you generated, measured, or verified them.",
    "Address the athlete question directly when one is provided. Do not use labels, placeholders, or a data dump.",
    "Use the app-calculated comparison for trend claims. Do not infer motivation, training phase, tapering, recovery status, readiness, or causation.",
    "Do not include digits, numeric quantities, or units in any response field. Describe the supplied changes qualitatively without recomputing or restating values.",
    "Treat the approved totals, signals, and app-calculated comparison above as exhaustive. If they cannot answer the question, say the supplied snapshot is insufficient.",
    "Headline: one concise sentence naming the most important pattern.",
    "Summary: 1-2 sentences connecting at least two metrics.",
    "Observations: 3 distinct trends or comparisons; do not merely list individual runs.",
    "Next step: one conservative, specific action grounded in the supplied baseline.",
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
    headline: String(value.headline || insightHeadline(input)).slice(0, 160),
    summary: String(value.summary).slice(0, 700),
    observations,
    nextStep: String(value.nextStep || safeNextStep(input)).slice(0, 500),
    caution: "Written by Ollama from app-calculated training metrics. Pattern guidance only—not medical advice."
  };
}

export async function onRequestPost({ env, request }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ error: "The training summary is too large." }, 413);
  const input = await request.json();
  if (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length) {
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
      format: INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: "Interpret only the supplied app-calculated running data. Preserve units, avoid causal or intent claims, and return only schema-valid JSON." },
        { role: "user", content: buildPrompt(input) }
      ],
      options: { temperature: 0, num_ctx: 8192, num_predict: 640 }
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
  return json({ insight: normalizeInsight(parsed, input), model });
}
