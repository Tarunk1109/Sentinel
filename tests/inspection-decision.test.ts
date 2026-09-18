import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildProductIntentFromInspection, inspectionAnalysisSchema, resolveInspectionStep } from '@/lib/domain/inspection';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';

const cableWithAdapter = inspectionFixtures['damaged-usb-cable-with-adapter'];
const singleCable = inspectionFixtures['damaged-single-cable'];
const bottle = inspectionFixtures['intact-water-bottle'];
const ambiguous = inspectionFixtures['ambiguous-desk-objects'];
const missingPart = inspectionFixtures['missing-part-visible'];
const blurry = inspectionFixtures['image-too-blurry'];
const irrelevant = inspectionFixtures['irrelevant-photo'];
const chairCaster = inspectionFixtures['broken-office-chair-caster'];

describe('Phase 4B regression: multi-object grounding (real failure 1 - USB-C cable + wall adapter)', () => {
  it('keeps the foreground cable and background adapter as two separate detected objects', () => {
    expect(cableWithAdapter.detectedObjects).toHaveLength(2);
    const cable = cableWithAdapter.detectedObjects.find(o => o.id === 'cable')!;
    const adapter = cableWithAdapter.detectedObjects.find(o => o.id === 'adapter')!;
    expect(cable.category).toBe('USB-C cable');
    expect(adapter.category).toBe('wall charger');
  });
  it('never merges the adapter’s AC prongs into the cable’s identity or evidence', () => {
    const cable = cableWithAdapter.detectedObjects.find(o => o.id === 'cable')!;
    const adapter = cableWithAdapter.detectedObjects.find(o => o.id === 'adapter')!;
    expect(cable.category.toLowerCase()).not.toContain('ac power cord');
    expect(cable.category.toLowerCase()).not.toContain('two-pin');
    for (const evidence of cable.visibleEvidence) expect(evidence.toLowerCase()).not.toContain('prong');
    for (const evidence of adapter.visibleEvidence) expect(evidence.toLowerCase()).not.toContain('usb-c');
  });
  it('selects the damaged cable as the primary subject, not the undamaged background adapter', () => {
    expect(cableWithAdapter.primarySubjectId).toBe('cable');
    expect(cableWithAdapter.primarySubjectAmbiguous).toBe(false);
  });
  it('produces a ProductIntent for the cable, never a fabricated combined "two-pin AC power cord"', () => {
    const intent = buildProductIntentFromInspection(cableWithAdapter);
    expect(intent.searchQuery.toLowerCase()).toContain('cable');
    expect(intent.searchQuery.toLowerCase()).not.toContain('two-pin');
    expect(intent.originalRequest.toLowerCase()).not.toContain('two-pin');
  });
  it('carries unknown electrical/compatibility facts forward rather than inventing them', () => {
    const intent = buildProductIntentFromInspection(cableWithAdapter);
    for (const unknown of cableWithAdapter.compatibilityRequirements.unknown) {
      expect(intent.compatibilityRequirements.some(r => r.includes(unknown))).toBe(true);
    }
  });
  it('flags the visible damage as a possible hazard using hedged, non-diagnostic language', () => {
    expect(cableWithAdapter.condition.status).toBe('POSSIBLE_HAZARD');
    expect(cableWithAdapter.warnings.some(w => /may|appears|suggests/i.test(w))).toBe(true);
  });
  it('still resolves a single damaged cable with no companion object (regression: single-object path unaffected)', () => {
    expect(singleCable.detectedObjects).toHaveLength(1);
    expect(resolveInspectionStep(singleCable, singleCable.primarySubjectId)).toBe('READY_TO_SEARCH');
    expect(() => buildProductIntentFromInspection(singleCable)).not.toThrow();
  });
});

describe('Phase 4B regression: no automatic replacement for an intact object (real failure 2 - water bottle)', () => {
  it('does not reach READY_TO_SEARCH for an intact object with no stated user intent', () => {
    expect(resolveInspectionStep(bottle, bottle.primarySubjectId)).toBe('ASK_USER_INTENT');
  });
  it('refuses to build a replacement ProductIntent automatically when nothing is wrong', () => {
    expect(() => buildProductIntentFromInspection(bottle)).toThrow(/explicit choice|problem/i);
  });
  it('the guard is enforced in code, not only in the model prompt: it fires even if recommendedAction were mistakenly a SEARCH_* value would not be needed to trip it', () => {
    // The gate keys off resolveInspectionStep, which is independent application logic -
    // it is exercised directly here without any model call.
    const step = resolveInspectionStep(bottle, bottle.primarySubjectId);
    expect(['ASK_USER_INTENT', 'ASK_CLARIFICATION', 'NO_ACTION', 'CHOOSE_SUBJECT']).toContain(step);
  });
  it('builds a valid "find similar" intent once the user explicitly asks for another one', () => {
    const intent = buildProductIntentFromInspection(bottle, {}, { userIntent: { action: 'FIND_SIMILAR' } });
    expect(intent.searchQuery.toLowerCase()).toContain('water bottle');
  });
  it('builds an upgrade-flavored intent once the user explicitly asks for an upgrade (Part 22: user intent overrides visual condition)', () => {
    const intent = buildProductIntentFromInspection(bottle, {}, { userIntent: { action: 'UPGRADE' } });
    expect(intent.searchQuery.toLowerCase()).toContain('premium');
    expect(intent.originalRequest.toLowerCase()).toContain('upgraded');
  });
  it('builds an accessory-flavored intent once the user explicitly asks for an accessory', () => {
    const intent = buildProductIntentFromInspection(bottle, {}, { userIntent: { action: 'ACCESSORY' } });
    expect(intent.searchQuery.toLowerCase()).toContain('accessories');
  });
  it('allows an explicit replacement request even though nothing looks damaged (Part 22)', () => {
    const intent = buildProductIntentFromInspection(bottle, {}, { userIntent: { action: 'REPLACE_ITEM', note: 'I want a bigger one' } });
    expect(intent.originalRequest).toContain('bigger one');
  });
});

describe('Phase 4B: ambiguous primary subject', () => {
  it('requires the user to choose a subject before anything else', () => {
    expect(resolveInspectionStep(ambiguous, null)).toBe('CHOOSE_SUBJECT');
    expect(() => buildProductIntentFromInspection(ambiguous)).toThrow(/select which item/i);
  });
  it('does not guess a primary subject on its own', () => {
    expect(ambiguous.primarySubjectId).toBeNull();
    expect(ambiguous.primarySubjectAmbiguous).toBe(true);
  });
  it('proceeds using the chosen subject once the user selects one, and still requires explicit intent', () => {
    expect(resolveInspectionStep(ambiguous, 'lamp')).toBe('ASK_USER_INTENT');
    expect(() => buildProductIntentFromInspection(ambiguous, {}, { subjectId: 'lamp' })).toThrow(/explicit choice|problem/i);
    const intent = buildProductIntentFromInspection(ambiguous, {}, { subjectId: 'lamp', userIntent: { action: 'REPLACE_ITEM' } });
    expect(intent.originalRequest.toLowerCase()).toContain('lamp');
  });
  it('rejects a subject id that does not exist in this analysis', () => {
    expect(() => buildProductIntentFromInspection(ambiguous, {}, { subjectId: 'not-a-real-id', userIntent: { action: 'REPLACE_ITEM' } })).toThrow();
  });
});

describe('Phase 4B: condition vs. action separation for other real-world shapes', () => {
  it('a missing part is searchable automatically as a part, not a whole-item replacement', () => {
    expect(missingPart.condition.status).toBe('MISSING_PART');
    expect(missingPart.recommendedAction.action).toBe('SEARCH_PART');
    expect(resolveInspectionStep(missingPart, missingPart.primarySubjectId)).toBe('READY_TO_SEARCH');
    const intent = buildProductIntentFromInspection(missingPart);
    expect(intent.searchQuery.toLowerCase()).toContain('lid');
  });
  it('object category known but exact compatibility unknown still yields caveats, never invented specs', () => {
    const intent = buildProductIntentFromInspection(chairCaster);
    expect(chairCaster.compatibilityRequirements.unknown.length).toBeGreaterThan(0);
    for (const unknown of chairCaster.compatibilityRequirements.unknown) {
      expect(intent.compatibilityRequirements.some(r => r.includes(unknown) && r.includes('not confirmed'))).toBe(true);
    }
  });
  it('a non-shoppable or irrelevant subject yields NO_ACTION and blocks intent creation even with an override', () => {
    expect(irrelevant.recommendedAction.action).toBe('NO_ACTION');
    expect(resolveInspectionStep(irrelevant, irrelevant.primarySubjectId)).toBe('NO_ACTION');
    expect(() => buildProductIntentFromInspection(irrelevant)).toThrow(/does not show a problem/i);
    expect(() => buildProductIntentFromInspection(irrelevant, {}, { userIntent: { action: 'REPLACE_ITEM' } })).toThrow(/does not show a problem/i);
  });
  it('an outcome failure (too blurry to analyze) never reaches step resolution or intent creation', () => {
    expect(() => resolveInspectionStep(blurry, null)).toThrow(/did not complete/i);
    expect(() => buildProductIntentFromInspection(blurry)).toThrow(/did not complete/i);
  });
});

describe('Phase 4B: schema honesty guards', () => {
  it('rejects a detectedObjects entry with an unknown role', () => {
    const bad = { ...chairCaster, detectedObjects: [{ ...chairCaster.detectedObjects[0], role: 'MAIN' }] };
    expect(inspectionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a confidence outside the 0-1 range', () => {
    const bad = { ...chairCaster, detectedObjects: [{ ...chairCaster.detectedObjects[0], confidence: 1.5 }] };
    expect(inspectionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects an unknown recommendedAction value (no silent extension of the action vocabulary)', () => {
    const bad = { ...chairCaster, recommendedAction: { action: 'BUY_NOW', reason: 'x' } };
    expect(inspectionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects more than 2 clarification questions (Part 15: keep clarification concise)', () => {
    const bad = { ...bottle, needsUserClarification: true, clarificationQuestions: ['a', 'b', 'c'] };
    expect(inspectionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts every fixture as a strictly valid InspectionAnalysis', () => {
    for (const fixture of Object.values(inspectionFixtures)) expect(inspectionAnalysisSchema.safeParse(fixture).success).toBe(true);
  });
});
