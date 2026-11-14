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
    return json({ error: error.message }, error.status || 502);
  }
}
