import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildProductIntentFromInspection, inspectionAnalysisSchema, type InspectionAnalysis } from '@/lib/domain/inspection';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';

const analyzed: InspectionAnalysis = inspectionFixtures['broken-office-chair-caster'];

describe('InspectionAnalysis schema', () => {
  it('accepts the development fixture as a valid, strict analysis', () => {
    expect(inspectionAnalysisSchema.safeParse(analyzed).success).toBe(true);
  });
  it('rejects an unknown outcome or extra fields (strict schema, no hallucinated shape)', () => {
    expect(inspectionAnalysisSchema.safeParse({ ...analyzed, outcome: 'MAYBE' }).success).toBe(false);
    expect(inspectionAnalysisSchema.safeParse({ ...analyzed, extra: true }).success).toBe(false);
  });
});

describe('buildProductIntentFromInspection', () => {
  it('converts an analysis into a Request-Mode-compatible ProductIntent, defaulting CA/CAD with no budget', () => {
    const intent = buildProductIntentFromInspection(analyzed);
    expect(intent.country).toBe('CA');
    expect(intent.budget).toEqual({ maxAmount: null, currency: 'CAD' });
    expect(intent.quantity).toBe(1);
    expect(intent.searchQuery).toBe(analyzed.searchIntent.searchQuery);
    expect(intent.originalRequest).toContain('office chair caster wheel');
    expect(intent.originalRequest.length).toBeGreaterThanOrEqual(3);
  });
  it('honestly carries unknown dimensions forward as caveats instead of dropping them', () => {
    const intent = buildProductIntentFromInspection(analyzed);
    for (const unknown of analyzed.compatibilityRequirements.unknown) {
      expect(intent.compatibilityRequirements.some(r => r.includes(unknown))).toBe(true);
      expect(intent.compatibilityRequirements.find(r => r.includes(unknown))).toContain('not confirmed by the uploaded photo');
    }
  });
  it('accepts an optional budget and clarification without requiring either', () => {
    const intent = buildProductIntentFromInspection(analyzed, { budgetMaxAmount: 45, clarification: "It's an Aeron", extraRequirement: 'safe for hardwood floors' });
    expect(intent.budget.maxAmount).toBe(45);
    expect(intent.originalRequest).toContain('Aeron');
    expect(intent.compatibilityRequirements.some(r => r.includes('Aeron'))).toBe(true);
    expect(intent.preferredFeatures).toContain('safe for hardwood floors');
  });
  it('refuses to synthesize an intent from an incomplete inspection', () => {
    expect(() => buildProductIntentFromInspection({ ...analyzed, outcome: 'IMAGE_TOO_BLURRY' })).toThrow();
  });
  it('never invents a brand: brandPreferences stays empty when the photo showed none', () => {
    expect(buildProductIntentFromInspection(analyzed).brandPreferences).toEqual([]);
  });
});
