import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildAnalysisSchema, buildProductIntentFromComponent, calculateBuildTotal, createBuildPlan, evaluateBuildDependencies, type BuildAnalysis, type BuildComponent, type BuildComponentResult } from '@/lib/domain/build';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';

const gaming: BuildAnalysis = buildAnalysisFixtures['gaming-desk-setup'];
const deskWithStorage: BuildAnalysis = buildAnalysisFixtures['desk-with-integrated-storage'];

function product(id: string, amountMinor: number, description = ''): BuildComponentResult['products'][number] {
  return { id, sku: `sku-${id}`, productGid: null, name: id, brand: null, description, merchantName: 'Test', merchantId: null, merchantUrl: null, productUrl: null, imageUrl: null, price: { amountMinor, currency: 'CAD' }, availability: 'available', country: 'CA', onboardRequired: false, metadata: {}, compatibility: { status: 'NEEDS_VERIFICATION', reasons: [], missingInformation: [] }, requiredConstraintsSatisfied: null, score: 0, recommendation: '' };
}
function comp(id: string, overrides: Partial<BuildComponent> & Pick<BuildComponent, 'name' | 'category' | 'role'>): BuildComponent {
  return { id, brand: null, model: null, confidence: 0.75, visibleEvidence: [], inferredRequirements: [], compatibilityRequirements: [], unknowns: [], quantity: 1, componentKind: 'PURCHASABLE', parentComponentId: null, ...overrides };
}
function analysisWith(components: BuildComponent[], dependencies: BuildAnalysis['dependencies'] = []): BuildAnalysis {
  return { ...deskWithStorage, components, dependencies, existingItems: [] };
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

// Regression coverage for the real-image bug: a desk's built-in keyboard tray and storage
// compartment were misclassified as separate RECOMMENDED purchasable components instead of
// integrated features of the desk.
describe('componentKind: integrated features are never a separate purchasable component', () => {
  it('test #1: a desk with a built-in keyboard tray excludes the tray from the plan entirely', () => {
    const plan = createBuildPlan(deskWithStorage, { budgetMaxAmount: 800 });
    expect(plan.items.some(i => i.componentId === 'keyboard-shelf')).toBe(false);
  });

  it('test #2: a desk with integrated storage excludes the storage compartment from the plan entirely', () => {
    const plan = createBuildPlan(deskWithStorage, { budgetMaxAmount: 800 });
    expect(plan.items.some(i => i.componentId === 'storage-compartment')).toBe(false);
  });

  it('test #3: a standalone keyboard tray accessory (no parent) is purchasable, unlike the same feature built into a desk', () => {
    const analysis = analysisWith([
      comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL' }),
      comp('keyboard-tray', { name: 'Standalone keyboard tray', category: 'keyboard tray', role: 'RECOMMENDED', componentKind: 'ACCESSORY' }),
    ]);
    const plan = createBuildPlan(analysis, {}, ['desk', 'keyboard-tray']);
    expect(plan.items.find(i => i.componentId === 'keyboard-tray')?.included).toBe(true);
  });

  it('test #4: a monitor and a separately purchasable monitor stand both remain their own plan items', () => {
    const analysis = analysisWith([
      comp('monitor', { name: 'Monitor', category: 'external monitor', role: 'ESSENTIAL' }),
      comp('monitor-stand', { name: 'Monitor stand', category: 'monitor stand', role: 'RECOMMENDED', componentKind: 'ACCESSORY' }),
    ]);
    const plan = createBuildPlan(analysis, {}, ['monitor', 'monitor-stand']);
    expect(plan.items.map(i => i.componentId).sort()).toEqual(['monitor', 'monitor-stand']);
  });

  it('test #5: a chair\'s attached armrests are an integrated feature, excluded from the plan and folded into the chair\'s intent', () => {
    const analysis = analysisWith([
      comp('chair', { name: 'Office chair', category: 'office chair', role: 'ESSENTIAL' }),
      comp('armrests', { name: 'Attached armrests', category: 'armrests', role: 'RECOMMENDED', componentKind: 'INTEGRATED_FEATURE', parentComponentId: 'chair', inferredRequirements: ['Must be height-adjustable'] }),
    ]);
    const plan = createBuildPlan(analysis, {}, ['chair']);
    expect(plan.items.some(i => i.componentId === 'armrests')).toBe(false);
    expect(plan.items.find(i => i.componentId === 'chair')!.intent!.requiredFeatures).toContain('Attached armrests');
  });

  it('test #6: a shelving unit\'s built-in shelves are an integrated feature, not a separate purchasable component', () => {
    const analysis = analysisWith([
      comp('shelving-unit', { name: 'Shelving unit', category: 'shelving unit', role: 'ESSENTIAL' }),
      comp('shelves', { name: 'Built-in shelves', category: 'shelf', role: 'RECOMMENDED', componentKind: 'INTEGRATED_FEATURE', parentComponentId: 'shelving-unit' }),
    ]);
    const plan = createBuildPlan(analysis, {}, ['shelving-unit']);
    expect(plan.items.map(i => i.componentId)).toEqual(['shelving-unit']);
  });

  it('test #7: an integrated feature never receives a budget allocation, even when explicitly forced into selectedIds', () => {
    const plan = createBuildPlan(deskWithStorage, { budgetMaxAmount: 800 }, ['desk', 'keyboard-shelf', 'storage-compartment', 'chair']);
    // Forcing the feature ids into the selection has no effect: they can never become a
    // plan item, so there is no row to attach a budget to in the first place.
    expect(plan.items).toHaveLength(2);
    expect(plan.items.map(i => i.componentId).sort()).toEqual(['chair', 'desk']);
  });

  it('test #9: an integrated feature\'s name and inferred requirements propagate into the parent desk\'s ProductIntent', () => {
    const plan = createBuildPlan(deskWithStorage, {}, ['desk']);
    const intent = plan.items.find(i => i.componentId === 'desk')!.intent!;
    expect(intent.requiredFeatures).toContain('Pull-out keyboard/work shelf');
    expect(intent.requiredFeatures).toContain('Lower storage compartment');
    expect(intent.requiredFeatures).toContain('Must slide freely beneath the desktop');
    expect(intent.searchQuery.toLowerCase()).toContain('pull-out keyboard/work shelf');
    expect(intent.searchQuery.toLowerCase()).toContain('lower storage compartment');
  });

  it('test #10: the purchasable component count and browse total exclude integrated features', () => {
    const plan = createBuildPlan(deskWithStorage, {}, ['desk', 'chair']);
    expect(plan.items).toHaveLength(2);
    const results: Record<string, BuildComponentResult> = {
      desk: { componentId: 'desk', source: 'agnic', mission: null, error: null, products: [product('d1', 15000)] },
      chair: { componentId: 'chair', source: 'agnic', mission: null, error: null, products: [product('c1', 4000)] },
    };
    const total = calculateBuildTotal(plan, results);
    // If the two integrated features had wrongly remained plan items, this total would
    // stay permanently null (waiting on prices that will never arrive) instead of
    // completing from just the two real purchasable components.
    expect(total.subtotal).toEqual({ amountMinor: 19000, currency: 'CAD' });
    expect(total.missingComponentIds).toEqual([]);
  });

  it('a DECORATIVE-kind component, unlike an integrated feature, still gets its own plan item and stays purchasable if the user opts in', () => {
    const analysis = analysisWith([
      comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL' }),
      comp('plant', { name: 'Decorative plant', category: 'plant', role: 'DECORATIVE', componentKind: 'DECORATIVE' }),
    ]);
    const defaultPlan = createBuildPlan(analysis, {});
    expect(defaultPlan.items.find(i => i.componentId === 'plant')?.included).toBe(false); // not auto-selected
    const optedInPlan = createBuildPlan(analysis, {}, ['desk', 'plant']);
    expect(optedInPlan.items.find(i => i.componentId === 'plant')?.included).toBe(true); // but still purchasable if chosen
  });

  it('drops a dependency edge naming an integrated feature, since it will never have its own search result to verify against', () => {
    const analysis = analysisWith(
      [
        comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL' }),
        comp('keyboard-shelf', { name: 'Keyboard shelf', category: 'keyboard shelf', role: 'RECOMMENDED', componentKind: 'INTEGRATED_FEATURE', parentComponentId: 'desk' }),
      ],
      [{ sourceComponentId: 'keyboard-shelf', targetComponentId: 'desk', relationship: 'Must fit under the desktop.', importance: 'REQUIRED' }],
    );
    const plan = createBuildPlan(analysis, {});
    expect(plan.dependencies).toHaveLength(0);
  });
});
