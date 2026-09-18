import "server-only";
import { randomUUID } from "node:crypto";
import type { UsageCounts } from "@/lib/domain/commerce";
import { broadenSearchQuery, createBuildPlan, integratedFeaturesOf, isBuildComponentResultLike, type BuildAnalysis, type BuildComponentResult, type BuildConstraints, type BuildPlan, type BuildSessionPayload, buildProductIntentFromComponent } from "@/lib/domain/build";
import { decodeAndValidateImage } from "../image-validation";
import { buildAnalysisFixtures, buildProductFixtures, isBuildFixtureName, type BuildFixtureName } from "../demo/build-fixtures";
import { buildSessionSigner, newSessionExpiry, type BuildSessionSigner } from "../build-session-token";
import { ProviderError } from "../provider-error";
import type { CallContext, SceneAnalyzer } from "./live-contracts";
import type { RequestMissionService } from "./request-mission";

const MAX_COMPONENTS_PER_BATCH = 3;

/**
 * The Build session is a signed token (`token`), not server-side state: `analysis`,
 * `constraints`, and `plan` here are always reconstructed from a verified token plus the
 * caller's current `selectedIds`, never read from a Map keyed by a previous request. This
 * is what makes analyze -> search work across separate route invocations, dev-server
 * module reloads, and (in production) separate worker processes - see
 * `lib/server/build-session-token.ts` and PHASE5_REPORT.md.
 */
export interface BuildSessionView {
  id: string;
  token: string;
  analysis: BuildAnalysis;
  constraints: BuildConstraints;
  plan: BuildPlan;
  source: "live" | "fixture";
  usage: UsageCounts;
  results: BuildComponentResult[];
  remainingIds: string[];
  expiresAt: string;
}

type SearchEmit = (event: { type: "component"; componentId: string; result: BuildComponentResult } | { type: "complete"; session: BuildSessionView } | { type: "error"; error: { code: string; message: string } }) => void;

function pendingIds(plan: BuildPlan, known: ReadonlySet<string>): string[] {
  return plan.items.filter(item => item.included && !item.owned && !known.has(item.componentId)).map(item => item.componentId);
}
function assertFixturesAllowed(): void {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") throw new ProviderError("BUILD_FIXTURE_DISABLED", "Build fixtures are only available in development or test environments.", 503);
}

export class BuildService {
  private activeAnalyze = new Set<string>();
  private activeSearch = new Map<string, Promise<BuildSessionView>>();
  constructor(
    private readonly analyzer: SceneAnalyzer,
    private readonly missions: Pick<RequestMissionService, "runFromIntent">,
    private readonly signer: Pick<BuildSessionSigner, "sign" | "verify"> = buildSessionSigner,
  ) {}

  /** Exactly one bounded multimodal call per submitted image, or a clearly labelled
   * DEVELOPMENT FIXTURE when explicitly configured for development/test only. */
  async analyze(imageBase64: string, constraints: BuildConstraints, owner: string, signal: AbortSignal): Promise<BuildSessionView> {
    if (this.activeAnalyze.has(owner)) throw new ProviderError("BUILD_BUSY", "A build analysis is already running for this session. Wait for it to finish.", 429);
    const image = decodeAndValidateImage(imageBase64);
    this.activeAnalyze.add(owner);
    try {
      const fixture = process.env.SENTINEL_BUILD_FIXTURE?.trim();
      let analysis: BuildAnalysis; let source: "live" | "fixture"; let usage: UsageCounts; let fixtureName: BuildFixtureName | null = null;
      if (fixture) {
        assertFixturesAllowed();
        if (!isBuildFixtureName(fixture)) throw new ProviderError("BUILD_FIXTURE_UNKNOWN", "The configured development fixture name is unknown.", 503);
        analysis = structuredClone(buildAnalysisFixtures[fixture]) as BuildAnalysis;
        source = "fixture"; fixtureName = fixture; usage = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
      } else {
        usage = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
        const context: CallContext = { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), usage };
        analysis = await this.analyzer.analyzeBuildScene(image, constraints, context);
        source = "live";
      }
      const id = randomUUID();
      const { issuedAt, expiresAt } = newSessionExpiry();
      const payload: BuildSessionPayload = { v: 1, id, owner, analysis, constraints, source, fixtureName, usage, issuedAt, expiresAt };
      const token = await this.signer.sign(payload);
      const plan = createBuildPlan(analysis, constraints);
      return { id, token, analysis, constraints, plan, source, usage, results: [], remainingIds: pendingIds(plan, new Set()), expiresAt: new Date(expiresAt).toISOString() };
    } finally { this.activeAnalyze.delete(owner); }
  }

  /** Searches at most 3 pending, included, not-owned components using the existing Agnic
   * commerce pipeline unchanged - never a separate commerce client, never an extra vision
   * call. `token` is verified before any of its contents are trusted; `priorResults` is the
   * caller's own previous results, echoed back only so the returned view stays complete -
   * it is never used to decide what is owned, priced, or searched. */
  async search(owner: string, token: string, selectedIds: string[], priorResults: unknown[] | undefined, clarification: string | undefined, signal: AbortSignal, emit: SearchEmit = () => {}): Promise<BuildSessionView> {
    const running = this.activeSearch.get(token);
    if (running) return running;
    const job = this.runSearch(owner, token, selectedIds, priorResults ?? [], clarification, signal, emit).finally(() => this.activeSearch.delete(token));
    this.activeSearch.set(token, job);
    return job;
  }

  private async runSearch(owner: string, token: string, selectedIds: string[], priorResults: unknown[], clarification: string | undefined, signal: AbortSignal, emit: SearchEmit): Promise<BuildSessionView> {
    const payload = await this.signer.verify(token, owner);
    if (payload.source === "fixture") assertFixturesAllowed();
    const plan = createBuildPlan(payload.analysis, payload.constraints, selectedIds);
    const known = new Map<string, BuildComponentResult>();
    for (const candidate of priorResults) if (isBuildComponentResultLike(candidate) && plan.items.some(item => item.componentId === candidate.componentId)) known.set(candidate.componentId, candidate);
    const pending = pendingIds(plan, new Set(known.keys()));
    const batch = pending.slice(0, MAX_COMPONENTS_PER_BATCH);
    for (const componentId of batch) {
      signal.throwIfAborted();
      const item = plan.items.find(i => i.componentId === componentId)!;
      const componentDef = payload.analysis.components.find(c => c.id === componentId)!;
      let result: BuildComponentResult;
      if (payload.source === "fixture") {
        const products = payload.fixtureName && isBuildFixtureName(payload.fixtureName) ? buildProductFixtures[payload.fixtureName][componentId] ?? [] : [];
        result = { componentId, products, mission: null, source: "fixture", error: products.length ? null : "No development fixture products are configured for this component." };
      } else {
        try {
          const features = integratedFeaturesOf(componentDef, payload.analysis);
          const intent = clarification?.trim() ? buildProductIntentFromComponent(componentDef, { ...payload.constraints, requirements: [payload.constraints.requirements, clarification.trim()].filter(Boolean).join("; ") }, features) : (item.intent ?? buildProductIntentFromComponent(componentDef, payload.constraints, features));
          let mission = await this.missions.runFromIntent(intent, owner, signal);
          let broadenedTo: string | null = null;
          // At most one deterministic (non-AI) broader search when the exact search finds
          // nothing - never a loop, never a second AI call to invent the broader phrase.
          if (mission.products.length === 0) {
            const broaderQuery = broadenSearchQuery(intent.searchQuery);
            if (broaderQuery) {
              signal.throwIfAborted();
              mission = await this.missions.runFromIntent({ ...intent, searchQuery: broaderQuery, productType: broaderQuery }, owner, signal);
              broadenedTo = broaderQuery;
            }
          }
          result = { componentId, products: mission.products, mission, source: "agnic", error: null, broadenedTo };
        } catch (error) {
          result = { componentId, products: [], mission: null, source: "agnic", error: error instanceof ProviderError ? error.message : "This component could not be searched. Please try again." };
        }
      }
      known.set(componentId, result);
      emit({ type: "component", componentId, result });
    }
    const view: BuildSessionView = { id: payload.id, token, analysis: payload.analysis, constraints: payload.constraints, plan, source: payload.source, usage: payload.usage, results: [...known.values()], remainingIds: pending.slice(batch.length), expiresAt: new Date(payload.expiresAt).toISOString() };
    emit({ type: "complete", session: view });
    return view;
  }
}
