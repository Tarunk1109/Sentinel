import "server-only";
import { getRuntimeStatus } from "@/lib/server/config";
import { getBudgetStatus } from "@/lib/server/ai-budget";
import { assertLocalRequest, errorResponse, session } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    return Response.json({ ...getRuntimeStatus(), intentModel: 'gpt-5.6-luna', aiBudget: await getBudgetStatus().catch(() => null) }, { headers: session(request).headers });
  } catch (error) { return errorResponse(error); }
}
