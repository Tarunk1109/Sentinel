import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildAnalysisSchema, buildProductIntentFromComponent, calculateBuildTotal, createBuildPlan, evaluateBuildDependencies, type BuildAnalysis, type BuildComponentResult } from '@/lib/domain/build';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';

const gaming: BuildAnalysis = buildAnalysisFixtures['gaming-desk-setup'];

function product(id: string, amountMinor: number, description = ''): BuildComponentResult['products'][number] {
  return { id, sku: `sku-${id}`, productGid: null, name: id, brand: null, description, merchantName: 'Test', merchantId: null, merchantUrl: null, productUrl: null, imageUrl: null, price: { amountMinor, currency: 'CAD' }, availability: 'available', country: 'CA', onboardRequired: false, metadata: {}, compatibility: { status: 'NEEDS_VERIFICATION', reasons: [], missingInformation: [] }, requiredConstraintsSatisfied: null, score: 0, recommendation: '' };
}

describe('BuildAnalysis schema', () => {
  it('accepts every development fixture as a strictly valid analysis', () => {
    for (const fixture of Object.values(buildAnalysisFixtures)) expect(buildAnalysisSchema.safeParse(fixture).success).toBe(true);
  });
  it('rejects an unknown component role or extra fields', () => {
    expect(buildAnalysisSchema.safeParse({ ...gaming, components: [{ ...gaming.components[0], role: 'CRITICAL' }] }).success).toBe(false);
    expect(buildAnalysisSchema.safeParse({ ...gaming, extra: true }).success).toBe(false);
  });
});

describe('createBuildPlan', () => {
  it('defaults to selecting essential and recommended components, never decorative', () => {
    const plan = createBuildPlan(gaming, {});
    const included = plan.items.filter(i => i.included).map(i => i.componentId);
    expect(included).toContain('desk'); expect(included).toContain('monitor'); expect(included).toContain('monitor-arm');
    expect(included).not.toContain('led-lighting');
  });
  it('never allocates a budget when none was given', () => {
    const plan = createBuildPlan(gaming, {});
    expect(plan.items.every(i => i.budgetAllocation === null)).toBe(true);
  });
  it('allocates a budget by weighted functional priority, never equally, and never exceeds the total', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm']);
    const desk = plan.items.find(i => i.componentId === 'desk')!;
    const arm = plan.items.find(i => i.componentId === 'monitor-arm')!;
    expect(desk.budgetAllocation!.amountMinor).toBeGreaterThan(arm.budgetAllocation!.amountMinor); // ESSENTIAL outweighs RECOMMENDED
    const sum = plan.items.reduce((total, i) => total + (i.budgetAllocation?.amountMinor ?? 0), 0);
    expect(sum).toBeLessThanOrEqual(80000);
  });
  it('does not silently increase the budget when re-run with a larger selection', () => {
    const small = createBuildPlan(gaming, { budgetMaxAmount: 500 }, ['desk']);
    const large = createBuildPlan(gaming, { budgetMaxAmount: 500 }, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm', 'desk-mat', 'led-lighting']);
    expect(small.budget.maxAmount).toBe(500); expect(large.budget.maxAmount).toBe(500);
  });
  it('excludes an already-owned component from purchasing while keeping it for dependency context', () => {
    const owns: BuildAnalysis = { ...gaming, existingItems: ['Monitor'] };
    const plan = createBuildPlan(owns, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'monitor-arm']);
    const monitor = plan.items.find(i => i.componentId === 'monitor')!;
    expect(monitor.owned).toBe(true); expect(monitor.included).toBe(false); expect(monitor.budgetAllocation).toBeNull(); expect(monitor.intent).toBeNull();
    expect(plan.dependencies.some(d => d.targetComponentId === 'monitor')).toBe(true);
  });
  it('changing the selection invalidates the previous allocation for dropped/added items', () => {
    const before = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor']);
    const after = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'keyboard', 'mouse']);
    expect(before.items.find(i => i.componentId === 'desk')!.budgetAllocation!.amountMinor)
      .not.toBe(after.items.find(i => i.componentId === 'desk')!.budgetAllocation!.amountMinor);
  });
  it('refuses to build a plan from an analysis that did not complete', () => {
    expect(() => createBuildPlan({ ...gaming, outcome: 'IMAGE_TOO_BLURRY' }, {})).toThrow();
  });
});

describe('buildProductIntentFromComponent', () => {
  it('produces a Request-Mode-compatible ProductIntent defaulting CA/CAD', () => {
    const monitor = gaming.components.find(c => c.id === 'monitor')!;
    const intent = buildProductIntentFromComponent(monitor, {}, null);
    expect(intent.country).toBe('CA'); expect(intent.budget).toEqual({ maxAmount: null, currency: 'CAD' });
    expect(intent.searchQuery).toBe('external monitor'); expect(intent.quantity).toBe(1);
  });
  it('carries unknown compatibility facts forward as caveats, never inventing exact values', () => {
    const arm = gaming.components.find(c => c.id === 'monitor-arm')!;
    const intent = buildProductIntentFromComponent(arm, {}, null);
    for (const unknown of arm.unknowns) expect(intent.compatibilityRequirements.some(r => r.includes(unknown) && r.includes('not confirmed'))).toBe(true);
  });
  it('never invents a brand: brandPreferences stays empty when none was visible', () => {
    const desk = gaming.components.find(c => c.id === 'desk')!;
    expect(buildProductIntentFromComponent(desk, {}, null).brandPreferences).toEqual([]);
  });
  it('turns a budget allocation into the intent’s own budget', () => {
    const desk = gaming.components.find(c => c.id === 'desk')!;
    const intent = buildProductIntentFromComponent(desk, {}, { amountMinor: 18000, currency: 'CAD' });
    expect(intent.budget.maxAmount).toBe(180);
  });
});

describe('evaluateBuildDependencies', () => {
  it('marks a dependency NEEDS_VERIFICATION when either side has no selected product', () => {
    const evaluations = evaluateBuildDependencies(gaming.dependencies, {});
    expect(evaluations.every(e => e.status === 'NEEDS_VERIFICATION')).toBe(true);
  });
  it('marks VERIFIED only when both listings share an actual quoted measurement, never by assumption', () => {
    const results: Record<string, BuildComponentResult> = {
      monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [product('m1', 24900, 'VESA 100x100mm mount, 5kg')] },
      'monitor-arm': { componentId: 'monitor-arm', source: 'agnic', mission: null, error: null, products: [product('a1', 7900, 'Supports VESA 100x100mm up to 9kg')] },
    };
    const [evaluation] = evaluateBuildDependencies([gaming.dependencies[0]], results);
    expect(evaluation.status).toBe('VERIFIED');
  });
  it('stays NEEDS_VERIFICATION when listings do not share a measurement, never hallucinating a match', () => {
    const results: Record<string, BuildComponentResult> = {
      monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [product('m1', 24900, 'A great monitor')] },
      'monitor-arm': { componentId: 'monitor-arm', source: 'agnic', mission: null, error: null, products: [product('a1', 7900, 'A sturdy arm')] },
    };
    const [evaluation] = evaluateBuildDependencies([gaming.dependencies[0]], results);
    expect(evaluation.status).toBe('NEEDS_VERIFICATION');
  });
});

describe('calculateBuildTotal', () => {
  it('sums real selected prices by quantity as the browse total, not a claimed final price', () => {
    const plan = createBuildPlan(gaming, {}, ['desk', 'monitor']);
    const results: Record<string, BuildComponentResult> = {
      desk: { componentId: 'desk', source: 'agnic', mission: null, error: null, products: [product('d1', 17900)] },
      monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [product('mo1', 24900)] },
    };
    const total = calculateBuildTotal(plan, results);
    expect(total.subtotal).toEqual({ amountMinor: 42800, currency: 'CAD' }); expect(total.missingComponentIds).toEqual([]);
  });
  it('flags missing prices instead of silently omitting them', () => {
    const plan = createBuildPlan(gaming, {}, ['desk', 'monitor']);
    const results: Record<string, BuildComponentResult> = { desk: { componentId: 'desk', source: 'agnic', mission: null, error: null, products: [product('d1', 17900)] } };
    const total = calculateBuildTotal(plan, results);
    expect(total.missingComponentIds).toEqual(['monitor']); expect(total.subtotal).toBeNull();
  });
  it('flags overBudget without silently increasing the budget', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 100 }, ['desk']);
    const results: Record<string, BuildComponentResult> = { desk: { componentId: 'desk', source: 'agnic', mission: null, error: null, products: [product('d1', 17900)] } };
    const total = calculateBuildTotal(plan, results);
    expect(total.overBudget).toBe(true); expect(plan.budget.maxAmount).toBe(100);
  });
});
