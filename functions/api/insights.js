import { json } from "../_shared.js";

const DEFAULT_OLLAMA_URL = "https://ollama.jeer.rest";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:0.8b";
const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    answerability: { type: "string", enum: ["strong", "partial", "insufficient"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    headlineFocus: { type: "string", enum: ["volume", "pace", "consistency", "load", "long_run", "spacing"] },
    summaryAngle: { type: "string", enum: ["trend", "baseline", "structure", "efficiency", "limits"] },
    relationshipFocus: { type: "string", enum: ["volume_pace", "volume_load", "pace_heart_rate", "load_spacing", "consistency_load", "long_run_balance", "terrain_pace", "none"] },
    analysisMode: { type: "string", enum: ["alignment", "divergence", "tradeoff", "stability", "insufficient"] },
    priority: { type: "string", enum: ["maintain", "monitor", "investigate", "compare_again"] },
    observations: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: ["volume", "pace", "consistency", "load", "long_run", "heart_rate", "spacing", "terrain"] }
    },
    nextFocus: { type: "string", enum: ["hold_baseline", "watch_load", "compare_pace", "protect_spacing", "long_run_balance"] },
    limitation: { type: "string", enum: ["none", "heart_rate_coverage", "load_estimate", "short_window", "no_comparison", "sparse_data"] }
  },
  required: ["answerability", "confidence", "headlineFocus", "summaryAngle", "relationshipFocus", "analysisMode", "priority", "observations", "nextFocus", "limitation"]
};

const RUN_INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    answerability: { type: "string", enum: ["strong", "partial", "insufficient"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    headlineFocus: { type: "string", enum: ["distance", "pace", "load", "effort", "context", "spacing"] },
    summaryAngle: { type: "string", enum: ["comparison", "baseline", "terrain", "spacing", "limited"] },
    relationshipFocus: { type: "string", enum: ["pace_load", "pace_heart_rate", "terrain_pace", "spacing_load", "distance_load", "none"] },
    analysisMode: { type: "string", enum: ["alignment", "divergence", "tradeoff", "stability", "insufficient"] },
    priority: { type: "string", enum: ["use_as_reference", "monitor_cost", "compare_context", "collect_more"] },
    signals: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", enum: ["distance", "pace", "load", "heart_rate", "terrain", "spacing"] }
    },
    watchFocus: { type: "string", enum: ["pace_effort", "terrain", "spacing", "heart_rate", "load_per_mile"] },
    limitation: { type: "string", enum: ["none", "similar_runs", "heart_rate", "load_estimate", "window_edge"] }
  },
  required: ["answerability", "confidence", "headlineFocus", "summaryAngle", "relationshipFocus", "analysisMode", "priority", "signals", "watchFocus", "limitation"]
};

function buildPrompt(input) {
  const question = String(input.question || "").trim().slice(0, 280);
  const packet = {
    task: "rank_app_calculated_training_signals",
    focus: input.focus || "balanced",
    question: question || "Identify the strongest supported pattern in this selected window.",
    range: input.range || {},
    coverage: input.coverage || {},
    candidates: Array.isArray(input.candidates) ? input.candidates : [],
    relationships: Array.isArray(input.relationships) ? input.relationships : [],
    summary: input.summary || {},
    comparison: input.comparison || null,
    trend: input.trend || null
  };
  return [
    JSON.stringify(packet),
    "Choose the primary signal, strongest supported relationship, analytical mode, action priority, 3-4 distinct observations, next comparison, answerability, confidence, and one limitation.",
    "Rank supplied signal and relationship candidates by relevance, strength, and coverage. Prefer relationships with higher strength when coverage is adequate.",
    "Keep the relationship on the requested focus: progression uses volume_pace or volume_load; recovery uses load_spacing or volume_load; consistency uses consistency_load or load_spacing; durability uses long_run_balance; efficiency uses pace_heart_rate, volume_pace, or terrain_pace.",
    "Use alignment when both measures meaningfully reinforce the same read, divergence when one is stable or they separate, tradeoff when one favorable movement accompanies a counter-movement, stability when both are near baseline, and insufficient only when no relationship is supported.",
    "Choose relationshipFocus only from supplied relationships. Match analysisMode to that relationship's supplied pattern; do not recalculate or reinterpret it.",
    "Do not select heart_rate when heartRatePercent is below 50. Treat load as estimated when directLoadPercent is below 80.",
    "Use no_comparison when comparison is null. Use sparse_data or short_window when the evidence cannot answer the question.",
    "Consistency means grouped periods with a run, not discipline or plan adherence.",
    "Return only allowed enum keys from the schema. Never write prose, numbers, dates, or units.",
    "Do not infer motivation, training phase, recovery, readiness, injury, causation, discipline, or plan adherence."
  ].join("\n");
}

function buildRunPrompt(input) {
  const packet = {
    task: "rank_app_calculated_workout_signals",
    focus: input.focus || "balanced",
    run: input.run || {},
    comparison: input.comparison || {},
    baseline: input.baseline || {},
    context: input.context || {},
    relationships: Array.isArray(input.relationships) ? input.relationships : [],
    coverage: input.coverage || {}
  };
  return [
    JSON.stringify(packet),
    "Choose the primary angle, strongest supported relationship, analytical mode, action priority, 2-3 distinct signals, next comparison, answerability, confidence, and one limitation.",
    "Prioritize the requested focus: standout emphasizes percentile extremes; load emphasizes load per mile; spacing emphasizes surrounding-run context.",
    "Keep the relationship on the requested focus: standout uses distance_load or pace_load; load uses pace_load or distance_load; spacing uses spacing_load.",
    "Rank supplied relationship candidates by relevance, strength, and coverage. Choose relationshipFocus only from supplied relationships and match analysisMode to its supplied pattern.",
    "Use alignment when two measures reinforce the same read, divergence when they separate, tradeoff when an improved result accompanies higher cost or denser context, stability when both sit near benchmark, and insufficient only when no relationship is supported.",
    "Do not select heart_rate when similarHeartRatePercent is below 50. Use similar_runs when fewer than 5 similar runs exist.",
    "Use load_estimate when directLoad is false. Use window_edge when previous or next run context is missing.",
    "The app calculated every supplied value. Rank them; do not recalculate, invent, or write prose.",
    "Return only the allowed enum keys in the schema. Do not write numbers, dates, or units.",
    "Do not infer workout intent, fitness, recovery, readiness, injury, or causation."
  ].join("\n");
}

function normalizeInsight(value, input) {
  const summary = input.summary || {};
  const trend = input.trend || null;
  const coverage = input.coverage || {};
  const relationshipCandidates = Array.isArray(input.relationships) ? input.relationships : [];
  const focusRelationshipIds = {
    progression: ["volume_pace", "volume_load"],
    recovery: ["load_spacing", "volume_load"],
    consistency: ["consistency_load", "load_spacing"],
    durability: ["long_run_balance"],
    efficiency: ["pace_heart_rate", "volume_pace", "terrain_pace"]
  }[input.focus] || [];
  const focusedRelationships = relationshipCandidates.filter((candidate) => focusRelationshipIds.includes(candidate.id));
  const requestedRelationship = relationshipCandidates.find((candidate) => candidate.id === value?.relationshipFocus);
  const relationship = (requestedRelationship && (!focusRelationshipIds.length || focusRelationshipIds.includes(requestedRelationship.id)))
    ? requestedRelationship
    : [...(focusedRelationships.length ? focusedRelationships : relationshipCandidates)].sort((a, b) => Number(b.strength) - Number(a.strength))[0] || null;
  const comparisonName = trend?.comparisonLabel || input.range?.comparisonLabel || "comparison period";
  const pace = (seconds) => {
    const rounded = Math.max(0, Math.round(Number(seconds) || 0));
    return rounded ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const volumeChange = trend ? Number(trend.volumeChangePercent) : null;
  const paceChange = trend?.paceChangeSeconds !== null && trend?.paceChangeSeconds !== undefined ? Number(trend.paceChangeSeconds) : null;
  const loadChange = trend && Number(trend.earlierAverageLoad) > 0
    ? ((Number(trend.recentAverageLoad) - Number(trend.earlierAverageLoad)) / Number(trend.earlierAverageLoad)) * 100
    : null;
  const volumePhrase = volumeChange === null
    ? "The selected window does not contain a usable comparison for volume."
    : Math.abs(volumeChange) <= 5 ? `Weekly volume stayed close to the ${comparisonName}.` : volumeChange > 0 ? `Weekly volume was higher than the ${comparisonName}.` : `Weekly volume was lower than the ${comparisonName}.`;
  const pacePhrase = paceChange === null
    ? "Pace does not have a usable comparison in this view."
    : Math.abs(paceChange) <= 3 ? `Average pace stayed close to the ${comparisonName}.` : paceChange < 0 ? `Average pace was faster than the ${comparisonName}.` : `Average pace was slower than the ${comparisonName}.`;
  const loadPhrase = loadChange === null
    ? "Training load can be read as a selected-window estimate, but not against a comparison."
    : Math.abs(loadChange) <= 8 ? `Estimated training load stayed close to the ${comparisonName}.` : loadChange > 0 ? `Estimated training load was higher than the ${comparisonName}.` : `Estimated training load was lower than the ${comparisonName}.`;
  const consistency = Number(summary.consistencyPercent) || 0;
  const consistencyPhrase = consistency >= 80 ? "Running appeared in most grouped periods across the selected window." : consistency >= 55 ? "Running was present in more than half of the grouped periods." : "The selected window contains wider gaps between active grouped periods.";
  const longShare = Number(summary.longRunSharePercent) || 0;
  const longRunPhrase = longShare > 50 ? "Long efforts account for a large share of the selected mileage." : longShare >= 25 ? "Long efforts contribute a balanced share of the selected mileage." : "Long efforts contribute a smaller share of the selected mileage.";
  const longestGap = Number(summary.longestRestGapDays) || 0;
  const spacingPhrase = longestGap >= 7 ? "The selected window includes at least one wider gap between runs." : longestGap <= 3 ? "The longest gap between runs stayed relatively compact in this window." : "Run spacing varied across the selected window.";
  const earlierHr = Number(trend?.earlierAverageHr) || 0;
  const recentHr = Number(trend?.recentAverageHr) || 0;
  const hrPhrase = earlierHr && recentHr
    ? Math.abs(recentHr - earlierHr) <= 3 ? `Average heart rate stayed close to the ${comparisonName}.` : recentHr > earlierHr ? `Average heart rate was higher than the ${comparisonName}.` : `Average heart rate was lower than the ${comparisonName}.`
    : "Heart-rate comparison is limited by the available activity data.";
  const terrainPhrase = Number(summary.elevationFeetPerMile) >= 100 ? "The selected mileage has a notably hilly profile." : Number(summary.elevationFeetPerMile) >= 55 ? "Rolling terrain is part of the selected-window context." : "The selected mileage has a relatively flatter profile.";
  const relationshipNames = {
    volume_pace: "Volume × pace",
    volume_load: "Volume × load",
    pace_heart_rate: "Pace × heart rate",
    load_spacing: "Load × spacing",
    consistency_load: "Consistency × load",
    long_run_balance: "Long-run balance",
    terrain_pace: "Terrain × pace"
  };
  const patternNames = {
    alignment: "Alignment",
    divergence: "Divergence",
    tradeoff: "Tradeoff",
    stability: "Stable relationship",
    insufficient: "Limited evidence"
  };
  const changeClause = (label, change, stableThreshold, higher, lower, unit) => {
    if (change === null || !Number.isFinite(Number(change))) return `${label} had no usable comparison`;
    if (Math.abs(change) <= stableThreshold) return `${label} stayed near the ${comparisonName}`;
    return `${label} was ${change > 0 ? higher : lower} by ${Math.abs(Math.round(change))}${unit}`;
  };
  const volumeClause = changeClause("Weekly volume", volumeChange, 5, "higher", "lower", "%");
  const paceClause = changeClause("average pace", paceChange, 3, "slower", "faster", " sec/mi");
  const loadClause = changeClause("estimated load", trend ? Number(trend.loadChangePercent) : null, 8, "higher", "lower", "%");
  const heartRateClause = changeClause("average heart rate", trend ? Number(trend.heartRateChangeBpm) : null, 3, "higher", "lower", " bpm");
  const consistencyClause = changeClause("grouped-period consistency", trend ? Number(trend.consistencyChangePoints) : null, 5, "higher", "lower", " points");
  const spacingClause = changeClause("the longest gap", trend ? Number(trend.longestGapChangeDays) : null, 1, "longer", "shorter", " days");
  const terrainClause = changeClause("elevation per mile", trend ? Number(trend.terrainChangeFeetPerMile) : null, 15, "higher", "lower", " ft/mi");
  const longRunChange = trend && Number.isFinite(Number(trend.longRunShareChangePoints)) ? Number(trend.longRunShareChangePoints) : null;
  const relationshipCopy = {
    volume_pace: `${volumeClause}, while ${paceClause}. Read those together before treating either headline metric as a complete progression signal.`,
    volume_load: `${volumeClause}, while ${loadClause}. The gap between those movements shows whether the selected workload changed roughly in proportion to mileage.`,
    pace_heart_rate: `${paceClause}, while ${heartRateClause}. This is an association within the selected data, not evidence that one change caused the other.`,
    load_spacing: `${loadClause}, while ${spacingClause}. Together they describe whether workload was spread differently across the window.`,
    consistency_load: `${consistencyClause}, while ${loadClause}. This separates a change in training presence from a change in overall workload.`,
    long_run_balance: `Long efforts supplied ${longShare}% of selected mileage${longRunChange !== null ? `, a ${Math.abs(longRunChange)}-point ${longRunChange >= 0 ? "increase" : "decrease"} versus the ${comparisonName}` : ""}. That concentration is best judged alongside total volume, not in isolation.`,
    terrain_pace: `${terrainClause}, while ${paceClause}. The terrain shift is useful context for the pace comparison, without assigning causation.`
  };
  const relationshipPattern = relationship?.pattern && patternNames[relationship.pattern] ? relationship.pattern : "insufficient";
  const analysisLabel = relationship
    ? `${relationshipNames[relationship.id] || "Relationship"} · ${patternNames[relationshipPattern]}`
    : "Relationship · Limited evidence";
  const analysis = relationship
    ? relationshipCopy[relationship.id] || "The selected relationship is supported by the supplied app-calculated metrics."
    : "No supported metric relationship is available in this view. Activate a comparison or expand the selected window.";
  const signalCopy = {
    volume: { title: "Volume direction", detail: volumePhrase, tone: volumeChange !== null && Math.abs(volumeChange) > 25 ? "caution" : "neutral" },
    pace: { title: "Pace direction", detail: pacePhrase, tone: paceChange !== null && paceChange < -3 ? "positive" : "neutral" },
    consistency: { title: "Training consistency", detail: consistencyPhrase, tone: consistency >= 80 ? "positive" : "neutral" },
    load: { title: "Load direction", detail: loadPhrase, tone: loadChange !== null && loadChange > 25 ? "caution" : "neutral" },
    long_run: { title: "Long-run balance", detail: longRunPhrase, tone: longShare > 50 ? "caution" : "neutral" },
    heart_rate: { title: "Heart-rate context", detail: hrPhrase, tone: "neutral" },
    spacing: { title: "Run spacing", detail: spacingPhrase, tone: longestGap >= 7 ? "caution" : "neutral" },
    terrain: { title: "Terrain context", detail: terrainPhrase, tone: Number(summary.elevationFeetPerMile) >= 100 ? "caution" : "neutral" }
  };
  const requested = Array.isArray(value?.observations) ? value.observations : [];
  const signalKeys = [...new Set(requested.filter((key) => signalCopy[key] && (key !== "heart_rate" || Number(coverage.heartRatePercent) >= 50)))].slice(0, 4);
  ["volume", "pace", "consistency"].forEach((key) => {
    if (signalKeys.length < 3 && !signalKeys.includes(key)) signalKeys.push(key);
  });
  const prioritizedSignal = { progression: "volume", recovery: "load", consistency: "consistency", durability: "long_run", efficiency: "pace" }[input.focus];
  if (prioritizedSignal && !signalKeys.includes(prioritizedSignal)) {
    if (signalKeys.length >= 4) signalKeys.pop();
    signalKeys.unshift(prioritizedSignal);
  }
  const observations = signalKeys.map((key) => signalCopy[key]);
  const focusFallback = { progression: "volume", recovery: "load", consistency: "consistency", durability: "long_run", efficiency: "pace", balanced: "volume" };
  const headlineCopy = { volume: volumePhrase, pace: pacePhrase, consistency: consistencyPhrase, load: loadPhrase, long_run: longRunPhrase, spacing: spacingPhrase };
  const summaryCopy = {
    trend: `${volumePhrase} ${pacePhrase}`,
    baseline: `The full-window baseline is ${Number(summary.averageWeeklyMiles || 0).toFixed(1)} miles and ${Number(summary.averageRunsPerWeek || 0).toFixed(1)} runs per week at ${pace(summary.averagePaceSeconds)}.`,
    structure: `${consistencyPhrase} ${longRunPhrase}`,
    efficiency: `${pacePhrase} ${hrPhrase}`,
    limits: "This snapshot can describe running patterns, but it cannot establish intent, readiness, recovery quality, or causation."
  };
  const nextCopy = {
    hold_baseline: `Use the current baseline of ${Number(summary.averageWeeklyMiles || 0).toFixed(1)} miles across ${Number(summary.averageRunsPerWeek || 0).toFixed(1)} runs per week as the next comparison point.`,
    watch_load: `Compare the next grouped period with the current ${Number(summary.loadPerMile || 0).toFixed(1)} load-per-mile baseline before drawing a trend conclusion.`,
    compare_pace: `Compare another similar window with the current ${pace(summary.averagePaceSeconds)} average rather than judging a single run.`,
    protect_spacing: `Keep the current ${longestGap}-day longest gap visible when comparing run frequency in the next window.`,
    long_run_balance: `Compare the next window with the current ${longShare}% share of mileage from long efforts.`
  };
  const preferredSummary = { progression: "trend", recovery: "trend", consistency: "structure", durability: "structure", efficiency: "efficiency" };
  const preferredNext = { progression: "hold_baseline", recovery: "watch_load", consistency: "protect_spacing", durability: "long_run_balance", efficiency: "compare_pace" };
  const relationshipNext = {
    volume_pace: "compare_pace",
    volume_load: "watch_load",
    pace_heart_rate: "compare_pace",
    load_spacing: "protect_spacing",
    consistency_load: "protect_spacing",
    long_run_balance: "long_run_balance",
    terrain_pace: "compare_pace"
  };
  const headlineFocus = input.focus !== "balanced"
    ? focusFallback[input.focus] || "volume"
    : headlineCopy[value?.headlineFocus] ? value.headlineFocus : "volume";
  const summaryAngle = preferredSummary[input.focus] || value?.summaryAngle;
  const nextFocus = preferredNext[input.focus] || relationshipNext[relationship?.id] || value?.nextFocus;
  const allowedAnswerability = ["strong", "partial", "insufficient"];
  const allowedConfidence = ["high", "medium", "low"];
  let answerability = allowedAnswerability.includes(value?.answerability) ? value.answerability : "partial";
  let confidence = allowedConfidence.includes(value?.confidence) ? value.confidence : "medium";
  let limitation = ["none", "heart_rate_coverage", "load_estimate", "short_window", "no_comparison", "sparse_data"].includes(value?.limitation)
    ? value.limitation
    : "none";
  if (
    (limitation === "no_comparison" && trend)
    || (limitation === "short_window" && Number(coverage.completePeriods) >= 2)
    || (limitation === "sparse_data" && Number(summary.runCount) >= 8)
    || (limitation === "heart_rate_coverage" && Number(coverage.heartRatePercent) >= 50)
    || (limitation === "load_estimate" && Number(coverage.directLoadPercent) >= 80)
  ) limitation = "none";
  if (Number(summary.runCount) < 4) {
    answerability = "insufficient";
    confidence = "low";
    limitation = "sparse_data";
  } else if (!trend) {
    if (answerability === "strong") answerability = "partial";
    if (confidence === "high") confidence = "medium";
    limitation = "no_comparison";
  } else if (Number(coverage.completePeriods) < 2) {
    if (confidence === "high") confidence = "medium";
    limitation = "short_window";
  } else if (input.focus === "efficiency" && Number(coverage.heartRatePercent) < 50) {
    answerability = "partial";
    confidence = "low";
    limitation = "heart_rate_coverage";
  } else if (input.focus === "recovery" && Number(coverage.directLoadPercent) < 80) {
    if (confidence === "high") confidence = "medium";
    limitation = "load_estimate";
  } else if (trend && Number(summary.runCount) >= 8 && Number(coverage.comparisonRuns) >= 8 && Number(coverage.completePeriods) >= 3) {
    if (confidence === "low") confidence = "medium";
  }
  if (answerability === "insufficient" && limitation === "none") answerability = "partial";
  if (answerability === "insufficient") confidence = "low";
  if (answerability === "partial" && confidence === "high") confidence = "medium";
  const limitationCopy = {
    none: "The selected data supports this comparison without a major coverage flag.",
    heart_rate_coverage: `Heart-rate context is limited because ${Math.round(Number(coverage.heartRatePercent) || 0)}% of runs include it.`,
    load_estimate: "Some training-load values are estimates rather than source activity scores.",
    short_window: "Only a small number of complete grouped periods are available.",
    no_comparison: "No comparison window is active, so this read describes the selected baseline only.",
    sparse_data: "There are too few runs in this view for a strong pattern conclusion."
  };
  const answerabilityCopy = { strong: "Strong", partial: "Partial", insufficient: "Limited" };
  const confidenceCopy = { high: "High", medium: "Medium", low: "Low" };
  return {
    headline: headlineCopy[headlineFocus],
    summary: summaryCopy[summaryAngle] || summaryCopy.trend,
    analysisLabel,
    analysis,
    observations,
    nextStep: nextCopy[nextFocus] || nextCopy.hold_baseline,
    answerability: answerabilityCopy[answerability],
    confidence: confidenceCopy[confidence],
    limitation: limitation === "none" ? "" : limitationCopy[limitation],
    caution: "Ollama-guided read from app-calculated training metrics. Pattern guidance only—not medical advice."
  };
}

function normalizeRunInsight(value, input) {
  const run = input.run || {};
  const comparison = input.comparison || {};
  const coverage = input.coverage || {};
  const relationshipCandidates = Array.isArray(input.relationships) ? input.relationships : [];
  const focusRelationshipIds = {
    load: ["pace_load", "distance_load"],
    spacing: ["spacing_load"],
    standout: ["distance_load", "pace_load"]
  }[input.focus] || [];
  const focusedRelationships = relationshipCandidates.filter((candidate) => focusRelationshipIds.includes(candidate.id));
  const requestedRelationship = relationshipCandidates.find((candidate) => candidate.id === value?.relationshipFocus);
  const relationship = (requestedRelationship && (!focusRelationshipIds.length || focusRelationshipIds.includes(requestedRelationship.id)))
    ? requestedRelationship
    : [...(focusedRelationships.length ? focusedRelationships : relationshipCandidates)].sort((a, b) => Number(b.strength) - Number(a.strength))[0] || null;
  const rankPhrase = (rank, high, middle, low) => rank >= 75 ? high : rank <= 25 ? low : middle;
  const paceVsSimilar = comparison.similarRunCount
    ? Math.abs(comparison.paceDifferenceSeconds || 0) <= 5 ? "Pace closely matched your similar-distance benchmark." : comparison.paceDifferenceSeconds < 0 ? "Pace was faster than your similar-distance benchmark." : "Pace was slower than your similar-distance benchmark."
    : "Pace needs more similar-distance runs before it has a useful benchmark.";
  const loadVsSimilar = comparison.similarRunCount && comparison.similarLoadPerMile
    ? Math.abs(comparison.loadPerMileDifferencePercent || 0) <= 8 ? "Load per mile was close to your comparable-run pattern." : comparison.loadPerMileDifferencePercent < 0 ? "Load per mile was lower than on comparable runs." : "Load per mile was higher than on comparable runs."
    : "Load is shown against the selected window because a direct benchmark is limited.";
  const distancePhrase = rankPhrase(comparison.distancePercentile, "This was one of the longer efforts in the selected window.", "Distance sat near your usual range.", "This was one of the shorter efforts in the selected window.");
  const pacePhrase = rankPhrase(comparison.pacePercentile, "Its pace also sat toward the faster end of the window.", "Its pace sat near the middle of the window.", "Its pace sat toward the slower end of the window.");
  const terrainPhrase = run.elevationFeetPerMile >= 100 ? "The route was hillier than a flat-effort comparison would assume." : run.elevationFeetPerMile >= 60 ? "Rolling terrain adds useful context to the pace comparison." : "The flatter terrain makes pace easier to compare with similar efforts.";
  const spacingPhrase = comparison.daysSincePreviousRun === null ? "There is no earlier run inside this window for spacing context." : comparison.daysSincePreviousRun <= 1 ? "This effort followed closely after the previous run in the window." : comparison.daysSincePreviousRun >= 5 ? "This effort had a wider gap after the previous run in the window." : "This effort had moderate spacing after the previous run in the window.";
  const hrDifference = comparison.heartRateDifference;
  const heartRatePhrase = hrDifference === null || !comparison.similarAverageHr ? "Heart-rate comparison is limited by the available activity data." : Math.abs(hrDifference) <= 3 ? "Average heart rate closely matched similar-distance efforts." : hrDifference < 0 ? "Average heart rate was lower than on similar-distance efforts." : "Average heart rate was higher than on similar-distance efforts.";
  const loadRankPhrase = rankPhrase(
    comparison.loadPercentile,
    "Total load sat toward the higher end of this selected window.",
    "Total load sat near the middle of this selected window.",
    "Total load sat toward the lower end of this selected window."
  );
  const relationshipNames = {
    pace_load: "Pace × load",
    pace_heart_rate: "Pace × heart rate",
    terrain_pace: "Terrain × pace",
    spacing_load: "Spacing × load",
    distance_load: "Distance × load"
  };
  const patternNames = {
    alignment: "Alignment",
    divergence: "Divergence",
    tradeoff: "Tradeoff",
    stability: "Stable relationship",
    insufficient: "Limited evidence"
  };
  const relationshipCopy = {
    pace_load: `${paceVsSimilar} ${loadVsSimilar} Reading both together distinguishes a faster or slower result from the estimated cost per mile.`,
    pace_heart_rate: `${paceVsSimilar} ${heartRatePhrase} The pairing describes this effort against comparable runs without making a fitness or causation claim.`,
    terrain_pace: `${terrainPhrase} ${paceVsSimilar} This keeps the like-for-like pace result anchored to route profile.`,
    spacing_load: `${spacingPhrase} ${loadRankPhrase} That combination shows where this effort sat inside its immediate training context.`,
    distance_load: `${distancePhrase} ${loadRankPhrase} Their relative percentiles show whether total load broadly tracked the run's distance profile.`
  };
  const relationshipPattern = relationship?.pattern && patternNames[relationship.pattern] ? relationship.pattern : "insufficient";
  const analysisLabel = relationship
    ? `${relationshipNames[relationship.id] || "Relationship"} · ${patternNames[relationshipPattern]}`
    : "Relationship · Limited evidence";
  const analysis = relationship
    ? relationshipCopy[relationship.id] || "The selected relationship is supported by the supplied app-calculated workout metrics."
    : "This effort needs more comparable runs before a metric relationship is strong enough to prioritize.";
  const signalCopy = {
    distance: { title: "Distance profile", detail: distancePhrase, tone: comparison.distancePercentile >= 75 ? "positive" : "neutral" },
    pace: { title: "Pace comparison", detail: paceVsSimilar, tone: comparison.paceDifferenceSeconds < -5 ? "positive" : "neutral" },
    load: { title: "Relative load", detail: loadVsSimilar, tone: comparison.loadPerMileDifferencePercent > 15 ? "caution" : "neutral" },
    heart_rate: { title: "Heart-rate context", detail: heartRatePhrase, tone: "neutral" },
    terrain: { title: "Terrain context", detail: terrainPhrase, tone: run.elevationFeetPerMile >= 100 ? "caution" : "neutral" },
    spacing: { title: "Run spacing", detail: spacingPhrase, tone: comparison.daysSincePreviousRun !== null && comparison.daysSincePreviousRun <= 1 ? "caution" : "neutral" }
  };
  const requestedSignals = Array.isArray(value?.signals) ? value.signals : [];
  const signalKeys = [...new Set(requestedSignals.filter((key) => signalCopy[key] && (key !== "heart_rate" || Number(coverage.similarHeartRatePercent) >= 50)))].slice(0, 3);
  ["pace", "load", "distance"].forEach((key) => {
    if (signalKeys.length < 2 && !signalKeys.includes(key)) signalKeys.push(key);
  });
  const prioritizedSignal = { load: "load", spacing: "spacing", standout: comparison.pacePercentile >= comparison.distancePercentile ? "pace" : "distance" }[input.focus];
  if (prioritizedSignal && !signalKeys.includes(prioritizedSignal)) {
    if (signalKeys.length >= 3) signalKeys.pop();
    signalKeys.unshift(prioritizedSignal);
  }
  const signals = signalKeys.map((key) => signalCopy[key]);
  if (signals.length < 2) {
    throw new Error("Ollama returned an incomplete run analysis. Try again.");
  }
  const headlineCopy = {
    distance: distancePhrase, pace: paceVsSimilar, load: loadVsSimilar,
    effort: `${distancePhrase} ${pacePhrase}`,
    context: comparison.similarRunCount ? "This run has a useful like-for-like benchmark." : "This run is best read against the broader selected window.",
    spacing: spacingPhrase
  };
  const comparisonSummary = value?.headlineFocus === "pace"
    ? `${loadVsSimilar} Together with the pace comparison, that makes this a clean reference point for another similar effort.`
    : value?.headlineFocus === "load"
      ? `${paceVsSimilar} Together with the load comparison, that makes this a clean reference point for another similar effort.`
      : `${paceVsSimilar} ${loadVsSimilar}`;
  const summaryCopy = {
    comparison: comparisonSummary, baseline: `${distancePhrase} ${pacePhrase}`,
    terrain: `${terrainPhrase} ${paceVsSimilar}`, spacing: `${spacingPhrase} ${loadVsSimilar}`,
    limited: `${distancePhrase} More similar-distance efforts would make the comparison stronger.`
  };
  const watchCopy = {
    pace_effort: "Compare pace and load per mile on another run of similar distance.",
    terrain: "Compare this with another run over similarly rolling terrain.",
    spacing: "Compare a similar effort after a different gap between runs.",
    heart_rate: "Compare average heart rate on another similar-distance effort.",
    load_per_mile: "Watch whether load per mile stays near this pattern on a comparable run."
  };
  const focusHeadline = { load: "load", spacing: "spacing" }[input.focus];
  const focusSummary = { load: "comparison", spacing: "spacing", standout: "baseline" }[input.focus];
  const focusWatch = { load: "load_per_mile", spacing: "spacing", standout: "pace_effort" }[input.focus];
  const relationshipWatch = {
    pace_load: "load_per_mile",
    pace_heart_rate: "heart_rate",
    terrain_pace: "terrain",
    spacing_load: "spacing",
    distance_load: "load_per_mile"
  };
  const allowedAnswerability = ["strong", "partial", "insufficient"];
  const allowedConfidence = ["high", "medium", "low"];
  let answerability = allowedAnswerability.includes(value?.answerability) ? value.answerability : "partial";
  let confidence = allowedConfidence.includes(value?.confidence) ? value.confidence : "medium";
  let limitation = ["none", "similar_runs", "heart_rate", "load_estimate", "window_edge"].includes(value?.limitation)
    ? value.limitation
    : "none";
  if (Number(coverage.similarRunCount) < 5) {
    answerability = Number(coverage.similarRunCount) < 2 ? "insufficient" : "partial";
    confidence = "low";
    limitation = "similar_runs";
  } else if (input.focus === "load" && !coverage.directLoad) {
    if (confidence === "high") confidence = "medium";
    limitation = "load_estimate";
  } else if (input.focus === "spacing" && (!coverage.hasPreviousRun || !coverage.hasNextRun)) {
    if (answerability === "strong") answerability = "partial";
    if (confidence === "high") confidence = "medium";
    limitation = "window_edge";
  } else if (value?.signals?.includes("heart_rate") && Number(coverage.similarHeartRatePercent) < 50) {
    answerability = "partial";
    confidence = "low";
    limitation = "heart_rate";
  }
  const limitationCopy = {
    none: "The selected window provides a useful like-for-like workout comparison.",
    similar_runs: `Only ${Number(coverage.similarRunCount) || 0} similar-distance runs are available for this benchmark.`,
    heart_rate: `Heart-rate comparison is limited to ${Math.round(Number(coverage.similarHeartRatePercent) || 0)}% of similar runs.`,
    load_estimate: "This workout’s load is estimated because no source activity score was supplied.",
    window_edge: "This run sits near an edge of the selected window, so surrounding-run context is incomplete."
  };
  const answerabilityCopy = { strong: "Strong", partial: "Partial", insufficient: "Limited" };
  const confidenceCopy = { high: "High", medium: "Medium", low: "Low" };
  return {
    headline: headlineCopy[focusHeadline || value?.headlineFocus] || headlineCopy.effort,
    read: summaryCopy[focusSummary || value?.summaryAngle] || summaryCopy.comparison,
    analysisLabel,
    analysis,
    signals,
    watchNext: watchCopy[focusWatch || relationshipWatch[relationship?.id] || value?.watchFocus] || watchCopy.pace_effort,
    answerability: answerabilityCopy[answerability],
    confidence: confidenceCopy[confidence],
    limitation: limitation === "none" ? "" : limitationCopy[limitation],
    caution: "Ollama-guided read from app-calculated workout context. Pattern guidance only—not medical advice."
  };
}

export async function onRequestPost({ env, request }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ error: "The training summary is too large." }, 413);
  const input = await request.json();
  const hasRunInput = input?.kind === "run" && input.run;
  const hasWindowInput = input?.kind !== "run" && Number(input?.summary?.runCount) > 0 && Array.isArray(input?.candidates);
  if (!hasRunInput && !hasWindowInput) {
    return json({ error: "No running data was supplied." }, 400);
  }
  const baseUrl = String(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const isRunInsight = input.kind === "run";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: isRunInsight ? RUN_INSIGHT_SCHEMA : INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: "Act as a conservative running-data analyst. Rank only the supplied app-calculated signals and relationships by relevance, strength, and coverage. Distinguish alignment, divergence, tradeoff, and stability; never infer causation, intent, readiness, recovery, fitness, or injury. Return only schema-valid JSON enum keys." },
        { role: "user", content: isRunInsight ? buildRunPrompt(input) : buildPrompt(input) }
      ],
      options: { temperature: 0, num_ctx: 4096, num_predict: isRunInsight ? 150 : 190 }
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
  return json({ insight: isRunInsight ? normalizeRunInsight(parsed, input) : normalizeInsight(parsed, input), model });
}
