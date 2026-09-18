import "server-only";
import { randomUUID } from "node:crypto";
import type { UsageCounts } from "@/lib/domain/commerce";
import { createBuildPlan, type BuildAnalysis, type BuildComponentResult, type BuildConstraints, type BuildPlan, buildProductIntentFromComponent } from "@/lib/domain/build";
import { decodeAndValidateImage } from "../image-validation";
import { buildAnalysisFixtures, buildProductFixtures, isBuildFixtureName, type BuildFixtureName } from "../demo/build-fixtures";
import { ProviderError } from "../provider-error";
import type { CallContext, SceneAnalyzer } from "./live-contracts";
import type { RequestMissionService } from "./request-mission";

const TTL = 15 * 60_000;
const MAX_COMPONENTS_PER_BATCH = 3;

export interface BuildSessionView {
  id: string;
  analysis: BuildAnalysis;
  constraints: BuildConstraints;
  plan: BuildPlan;
  source: "live" | "fixture";
  usage: UsageCounts;
  results: BuildComponentResult[];
  remainingIds: string[];
  expiresAt: string;
}
interface StoredSession { owner: string; analysis: BuildAnalysis; constraints: BuildConstraints; plan: BuildPlan; source: "live" | "fixture"; fixtureName: BuildFixtureName | null; usage: UsageCounts; results: Map<string, BuildComponentResult>; expiresAt: string }

type SearchEmit = (event: { type: "component"; componentId: string; result: BuildComponentResult } | { type: "complete"; session: BuildSessionView } | { type: "error"; error: { code: string; message: string } }) => void;

function pendingIds(plan: BuildPlan, results: Map<string, BuildComponentResult>): string[] {
  return plan.items.filter(item => item.included && !item.owned && !results.has(item.componentId)).map(item => item.componentId);
}
function toView(id: string, stored: StoredSession): BuildSessionView {
  return { id, analysis: stored.analysis, constraints: stored.constraints, plan: stored.plan, source: stored.source, usage: stored.usage, results: [...stored.results.values()], remainingIds: pendingIds(stored.plan, stored.results), expiresAt: stored.expiresAt };
}

export class BuildService {
  private sessions = new Map<string, StoredSession>();
  private activeAnalyze = new Set<string>();
  private activeSearch = new Map<string, Promise<BuildSessionView>>();
  constructor(private readonly analyzer: SceneAnalyzer, private readonly missions: Pick<RequestMissionService, "runFromIntent">) {}

  private evictExpired(): void {
    for (const [id, stored] of this.sessions) if (Date.parse(stored.expiresAt) <= Date.now()) this.sessions.delete(id);
  }

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
        if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") throw new ProviderError("BUILD_FIXTURE_DISABLED", "Build fixtures are only available in development or test environments.", 503);
        if (!isBuildFixtureName(fixture)) throw new ProviderError("BUILD_FIXTURE_UNKNOWN", "The configured development fixture name is unknown.", 503);
        analysis = structuredClone(buildAnalysisFixtures[fixture]) as BuildAnalysis;
        source = "fixture"; fixtureName = fixture; usage = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
      } else {
        usage = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
        const context: CallContext = { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), usage };
        analysis = await this.analyzer.analyzeBuildScene(image, constraints, context);
        source = "live";
      }
      this.evictExpired();
      const id = randomUUID();
      const plan = createBuildPlan(analysis, constraints);
      const stored: StoredSession = { owner, analysis, constraints, plan, source, fixtureName, usage, results: new Map(), expiresAt: new Date(Date.now() + TTL).toISOString() };
      if (this.sessions.size >= 40) this.sessions.delete(this.sessions.keys().next().value!);
      this.sessions.set(id, stored);
      return toView(id, stored);
    } finally { this.activeAnalyze.delete(owner); }
  }

  private getOwned(owner: string, planId: string): StoredSession {
    this.evictExpired();
    const stored = this.sessions.get(planId);
    if (!stored || stored.owner !== owner) throw new ProviderError("BUILD_SESSION_EXPIRED", "This build session has expired or is unavailable. Analyze the image again.", 409);
    return stored;
  }

  getSession(owner: string, planId: string): BuildSessionView { return toView(planId, this.getOwned(owner, planId)); }

  /** Searches at most 3 pending, included, not-owned components using the existing Agnic
   * commerce pipeline unchanged - never a separate commerce client, never an extra vision call. */
  async search(owner: string, planId: string, selectedIds: string[], clarification: string | undefined, signal: AbortSignal, emit: SearchEmit = () => {}): Promise<BuildSessionView> {
    const running = this.activeSearch.get(planId);
    if (running) return running;
    const job = this.runSearch(owner, planId, selectedIds, clarification, signal, emit).finally(() => this.activeSearch.delete(planId));
    this.activeSearch.set(planId, job);
    return job;
  }
  private async runSearch(owner: string, planId: string, selectedIds: string[], clarification: string | undefined, signal: AbortSignal, emit: SearchEmit): Promise<BuildSessionView> {
    const stored = this.getOwned(owner, planId);
    stored.plan = createBuildPlan(stored.analysis, stored.constraints, selectedIds);
    const batch = pendingIds(stored.plan, stored.results).slice(0, MAX_COMPONENTS_PER_BATCH);
    for (const componentId of batch) {
      signal.throwIfAborted();
      const item = stored.plan.items.find(i => i.componentId === componentId)!;
      const componentDef = stored.analysis.components.find(c => c.id === componentId)!;
      let result: BuildComponentResult;
      if (stored.source === "fixture") {
        const products = stored.fixtureName ? buildProductFixtures[stored.fixtureName][componentId] ?? [] : [];
        result = { componentId, products, mission: null, source: "fixture", error: products.length ? null : "No development fixture products are configured for this component." };
      } else {
        try {
          const intent = clarification?.trim() ? buildProductIntentFromComponent(componentDef, { ...stored.constraints, requirements: [stored.constraints.requirements, clarification.trim()].filter(Boolean).join("; ") }, item.budgetAllocation) : (item.intent ?? buildProductIntentFromComponent(componentDef, stored.constraints, item.budgetAllocation));
          const mission = await this.missions.runFromIntent(intent, owner, signal);
          result = { componentId, products: mission.products, mission, source: "agnic", error: null };
        } catch (error) {
          result = { componentId, products: [], mission: null, source: "agnic", error: error instanceof ProviderError ? error.message : "This component could not be searched. Please try again." };
        }
      }
      stored.results.set(componentId, result);
      emit({ type: "component", componentId, result });
    }
    const view = toView(planId, stored);
    emit({ type: "complete", session: view });
    return view;
  }
}
