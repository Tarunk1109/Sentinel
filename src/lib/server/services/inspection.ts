import "server-only";
import type { InspectionAnalysis, InspectionResponse } from "@/lib/domain/inspection";
import { decodeAndValidateImage } from "../image-validation";
import { inspectionFixtures, isInspectionFixtureName } from "../demo/inspection-fixtures";
import { ProviderError } from "../provider-error";
import type { CallContext, ImageInspector } from "./live-contracts";

export class InspectionService {
  constructor(private readonly inspector: ImageInspector) {}
  /** Exactly one bounded multimodal call, or a clearly labelled DEVELOPMENT FIXTURE when explicitly configured. */
  async analyze(imageBase64: string, signal: AbortSignal): Promise<InspectionResponse> {
    const image = decodeAndValidateImage(imageBase64);
    const fixture = process.env.SENTINEL_INSPECT_FIXTURE?.trim();
    if (fixture) {
      if (!isInspectionFixtureName(fixture)) throw new ProviderError("INSPECT_FIXTURE_UNKNOWN", "The configured development fixture name is unknown.", 503);
      return { analysis: structuredClone(inspectionFixtures[fixture]) as InspectionAnalysis, source: "fixture" };
    }
    const usage = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
    const context: CallContext = { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), usage };
    const analysis = await this.inspector.analyzeInspectionImage(image, context);
    return { analysis, source: "live" };
  }
}
