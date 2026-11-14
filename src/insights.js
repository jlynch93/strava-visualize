import { json } from "./http.js";
import services from "../shared/services.cjs";
import limits from "../shared/analysis-limits.cjs";

const { requestInsight } = services;
const { readBoundedJson, validateInsightInput, guardedAnalysis } = limits;

export async function handleInsights(env, request) {
  try {
    const input = validateInsightInput(await readBoundedJson(request));
    const result = await guardedAnalysis(request, env, () => requestInsight(input, env, request.signal));
    return json(result);
  } catch (error) {
    const status = error.status || 502;
    // Configuration and upstream failures go to Workers Logs with the model
    // and server involved; the runner only sees the plain message.
    if (status >= 500) console.error(JSON.stringify(error.log || { event: "analysis_failed", status, message: error.message }));
    return json({ error: error.message }, status);
  }
}
