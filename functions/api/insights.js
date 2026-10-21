import { json } from "../_shared.js";
import services from "../../shared/services.cjs";
import limits from "../../shared/analysis-limits.cjs";
const { requestInsight } = services;
const { readBoundedJson, validateInsightInput, guardedAnalysis } = limits;
export async function onRequestPost({ env, request }) {
  try {
    const input = validateInsightInput(await readBoundedJson(request));
    return json(await guardedAnalysis(request, env, () => requestInsight(input, env, request.signal)));
  } catch (error) { return json({ error: error.message }, error.status || 502); }
}
