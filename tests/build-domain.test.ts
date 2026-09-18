import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { broadenSearchQuery, buildAnalysisSchema, buildProductIntentFromComponent, calculateBuildTotal, createBuildPlan, evaluateBuildDependencies, selectBuildPick, type BuildAnalysis, type BuildComponent, type BuildComponentResult } from '@/lib/domain/build';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';
import type { CompatibilityStatus } from '@/lib/domain/commerce';

const gaming: BuildAnalysis = buildAnalysisFixtures['gaming-desk-setup'];
const deskWithStorage: BuildAnalysis = buildAnalysisFixtures['desk-with-integrated-storage'];

function product(id: string, amountMinor: number, description = '', status: CompatibilityStatus = 'NEEDS_VERIFICATION'): BuildComponentResult['products'][number] {
  return { id, sku: `sku-${id}`, productGid: null, name: id, brand: null, description, merchantName: 'Test', merchantId: null, merchantUrl: null, productUrl: null, imageUrl: null, price: { amountMinor, currency: 'CAD' }, availability: 'available', country: 'CA', onboardRequired: false, metadata: {}, compatibility: { status, reasons: [], missingInformation: [] }, requiredConstraintsSatisfied: status === 'INCOMPATIBLE' ? false : null, score: 0, recommendation: '' };
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
    expect(plan.items.every(i => i.targetAllocation === null)).toBe(true);
  });
  it('allocates a budget by weighted functional priority, never equally, and never exceeds the total', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm']);
    const desk = plan.items.find(i => i.componentId === 'desk')!;
    const arm = plan.items.find(i => i.componentId === 'monitor-arm')!;
    expect(desk.targetAllocation!.amountMinor).toBeGreaterThan(arm.targetAllocation!.amountMinor); // ESSENTIAL outweighs RECOMMENDED
    const sum = plan.items.reduce((total, i) => total + (i.targetAllocation?.amountMinor ?? 0), 0);
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
    expect(monitor.owned).toBe(true); expect(monitor.included).toBe(false); expect(monitor.targetAllocation).toBeNull(); expect(monitor.intent).toBeNull();
    expect(plan.dependencies.some(d => d.targetComponentId === 'monitor')).toBe(true);
  });
  it('changing the selection invalidates the previous allocation for dropped/added items', () => {
    const before = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor']);
    const after = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'keyboard', 'mouse']);
    expect(before.items.find(i => i.componentId === 'desk')!.targetAllocation!.amountMinor)
      .not.toBe(after.items.find(i => i.componentId === 'desk')!.targetAllocation!.amountMinor);
  });
  it('refuses to build a plan from an analysis that did not complete', () => {
    expect(() => createBuildPlan({ ...gaming, outcome: 'IMAGE_TOO_BLURRY' }, {})).toThrow();
  });
});

describe('buildProductIntentFromComponent', () => {
  it('produces a Request-Mode-compatible ProductIntent defaulting CA/CAD', () => {
    const monitor = gaming.components.find(c => c.id === 'monitor')!;
    const intent = buildProductIntentFromComponent(monitor, {});
    expect(intent.country).toBe('CA'); expect(intent.budget).toEqual({ maxAmount: null, currency: 'CAD' });
    expect(intent.searchQuery).toBe('external monitor'); expect(intent.quantity).toBe(1);
  });
  it('carries unknown compatibility facts forward as caveats, never inventing exact values', () => {
    const arm = gaming.components.find(c => c.id === 'monitor-arm')!;
    const intent = buildProductIntentFromComponent(arm, {});
    for (const unknown of arm.unknowns) expect(intent.compatibilityRequirements.some(r => r.includes(unknown) && r.includes('not confirmed'))).toBe(true);
  });
  it('never invents a brand: brandPreferences stays empty when none was visible', () => {
    const desk = gaming.components.find(c => c.id === 'desk')!;
    expect(buildProductIntentFromComponent(desk, {}).brandPreferences).toEqual([]);
  });
  it('uses the user\'s overall stated build budget for the intent - never the component\'s own weighted target allocation, which would silently zero-out real search results priced only slightly above an internal planning split', () => {
    const desk = gaming.components.find(c => c.id === 'desk')!;
    const intent = buildProductIntentFromComponent(desk, { budgetMaxAmount: 800 });
    expect(intent.budget.maxAmount).toBe(800);
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

// Hardening after a real live test failed with "The model did not complete its structured
// response within the token limit." The schema itself now bounds worst-case output size
// (8 components, 3 evidence items per field, 120-char items) instead of relying on the
// model choosing to be concise. See PHASE5_REPORT.md.
describe('output-size bounds: components, evidence lists, and clarification questions', () => {
  it('accepts a realistic 8-component scene mixing every componentKind, and builds a correct plan from it', () => {
    const components: BuildComponent[] = [
      comp('desk', { name: 'Compact desk', category: 'desk', role: 'ESSENTIAL', visibleEvidence: ['Wooden desk surface', 'Cable grommet at the back'] }),
      comp('monitor', { name: 'Monitor', category: 'external monitor', role: 'ESSENTIAL', unknowns: ['Screen size', 'VESA pattern'] }),
      comp('keyboard', { name: 'Keyboard', category: 'keyboard', role: 'ESSENTIAL' }),
      comp('mouse', { name: 'Mouse', category: 'mouse', role: 'ESSENTIAL' }),
      comp('chair', { name: 'Office chair', category: 'office chair', role: 'ESSENTIAL' }),
      comp('monitor-arm', { name: 'Monitor arm', category: 'monitor arm', role: 'RECOMMENDED', componentKind: 'ACCESSORY', compatibilityRequirements: ['Monitor VESA pattern and weight'] }),
      comp('keyboard-tray', { name: 'Keyboard tray', category: 'keyboard tray', role: 'RECOMMENDED', componentKind: 'INTEGRATED_FEATURE', parentComponentId: 'desk', inferredRequirements: ['Must slide freely'] }),
      comp('plant', { name: 'Small plant', category: 'plant', role: 'DECORATIVE', componentKind: 'DECORATIVE' }),
    ];
    expect(components).toHaveLength(8);
    const analysis = analysisWith(components);
    expect(buildAnalysisSchema.safeParse(analysis).success).toBe(true);
    const plan = createBuildPlan(analysis, { budgetMaxAmount: 1000 });
    // 7 purchasable plan items: the 8th component (keyboard-tray) is an integrated
    // feature, excluded entirely.
    expect(plan.items).toHaveLength(7);
    expect(plan.items.some(i => i.componentId === 'keyboard-tray')).toBe(false);
  });

  it('rejects more than 8 components in a single analysis', () => {
    const nine = Array.from({ length: 9 }, (_, i) => comp(`c${i}`, { name: `Component ${i}`, category: 'item', role: 'OPTIONAL' }));
    expect(buildAnalysisSchema.safeParse(analysisWith(nine)).success).toBe(false);
  });

  it('accepts exactly 8 components (the boundary)', () => {
    const eight = Array.from({ length: 8 }, (_, i) => comp(`c${i}`, { name: `Component ${i}`, category: 'item', role: 'OPTIONAL' }));
    expect(buildAnalysisSchema.safeParse(analysisWith(eight)).success).toBe(true);
  });

  it('rejects more than 3 items in a per-component evidence/requirement field', () => {
    const tooMany = comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL', visibleEvidence: ['a', 'b', 'c', 'd'] });
    expect(buildAnalysisSchema.safeParse(analysisWith([tooMany])).success).toBe(false);
  });

  it('accepts exactly 3 items in a per-component evidence field (the boundary)', () => {
    const threeItems = comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL', visibleEvidence: ['a', 'b', 'c'] });
    expect(buildAnalysisSchema.safeParse(analysisWith([threeItems])).success).toBe(true);
  });

  it('rejects a per-component evidence item longer than 120 characters, keeping items concise rather than sentences', () => {
    const longItem = comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL', unknowns: ['x'.repeat(121)] });
    expect(buildAnalysisSchema.safeParse(analysisWith([longItem])).success).toBe(false);
  });

  it('rejects more than 3 clarificationQuestions', () => {
    const analysis: BuildAnalysis = { ...analysisWith([comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL' })]), needsClarification: true, clarificationQuestions: ['a?', 'b?', 'c?', 'd?'] };
    expect(buildAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it('accepts exactly 3 clarificationQuestions (the boundary)', () => {
    const analysis: BuildAnalysis = { ...analysisWith([comp('desk', { name: 'Desk', category: 'desk', role: 'ESSENTIAL' })]), needsClarification: true, clarificationQuestions: ['a?', 'b?', 'c?'] };
    expect(buildAnalysisSchema.safeParse(analysis).success).toBe(true);
  });
});

// Hardening after a real live search returned zero desk matches: the component's own
// weighted budget split was being used as a hard search-time price filter. See
// PHASE5_REPORT.md.
describe('broadenSearchQuery: deterministic, non-AI query broadening for a zero-result search', () => {
  it('test #5: is a plain synchronous string function - no AI/model call is possible in its implementation', () => {
    const result = broadenSearchQuery('black office desk');
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBe('office desk');
  });
  it('strips low-priority visual/style modifiers left to right, matching the required examples exactly', () => {
    expect(broadenSearchQuery('minimal black office desk')).toBe('office desk');
    expect(broadenSearchQuery('white wireless mechanical keyboard')).toBe('mechanical keyboard');
  });
  it('never broadens so far that the product category changes or disappears', () => {
    expect(broadenSearchQuery('desk')).toBeNull(); // a single word - nothing left to strip
    expect(broadenSearchQuery('office desk')).toBeNull(); // no recognized style/color modifier present
    expect(broadenSearchQuery('   ')).toBeNull();
  });
});

describe('selectBuildPick: SENTINEL PICK only when genuinely defensible; target is a preference, never a search-time filter', () => {
  it('returns NONE for an empty candidate list', () => {
    expect(selectBuildPick([], null)).toEqual({ product: null, label: 'NONE', aboveTarget: null });
  });
  it('test #7: prefers a within-target candidate over a pricier one when both share the same compatibility tier', () => {
    const top = product('top', 19999, '', 'LIKELY_COMPATIBLE');
    const withinTarget = product('cheaper', 15900, '', 'LIKELY_COMPATIBLE');
    const pick = selectBuildPick([top, withinTarget], { amountMinor: 16000, currency: 'CAD' });
    expect(pick.product?.id).toBe('cheaper');
    expect(pick.aboveTarget).toBeNull();
  });
  it('test #8: keeps the top-ranked candidate and shows an explicit "above target" amount when no comparably-verified within-target alternative exists', () => {
    const top = product('top', 19999, '', 'VERIFIED');
    const weakerButCheaper = product('weaker', 9900, '', 'NEEDS_VERIFICATION');
    const pick = selectBuildPick([top, weakerButCheaper], { amountMinor: 16000, currency: 'CAD' });
    expect(pick.product?.id).toBe('top');
    expect(pick.aboveTarget).toEqual({ amountMinor: 3999, currency: 'CAD' });
    expect(pick.label).toBe('TOP_MATCH'); // rule B: never silently SENTINEL_PICK when above target
  });
  it('test #11: SENTINEL PICK requires real compatibility evidence (VERIFIED or LIKELY_COMPATIBLE) - weak evidence gets TOP MATCH instead, even within target and even with no target set at all', () => {
    const weak = product('a', 10000, '', 'NEEDS_VERIFICATION');
    expect(selectBuildPick([weak], null).label).toBe('TOP_MATCH');
    const verified = product('b', 10000, '', 'VERIFIED');
    expect(selectBuildPick([verified], null).label).toBe('SENTINEL_PICK');
  });
  it('test #11 (unconditional rule): NEEDS_VERIFICATION never earns SENTINEL_PICK just because the component has no explicit compatibilityRequirements - real evidence is required regardless of component type', () => {
    // A "plain" component (e.g. a desk) still gets evaluate()'d by the shared pipeline
    // and can still land on NEEDS_VERIFICATION; this must not be quietly exempted, since
    // some of that same evaluation's caveats (like a user's room dimensions) could never
    // be resolved by any real listing regardless of component type.
    const plainDeskCandidate = product('desk', 10000, '', 'NEEDS_VERIFICATION');
    expect(selectBuildPick([plainDeskCandidate], null).label).toBe('TOP_MATCH');
  });
});

describe('component target allocation: a planning target, never a hard search-time cap', () => {
  it('test #6: intent.budget.maxAmount reflects the user\'s overall stated build budget, never this component\'s own weighted target allocation', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 800 }, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm']);
    const desk = plan.items.find(i => i.componentId === 'desk')!;
    expect(desk.targetAllocation!.amountMinor).toBeLessThan(80000); // desk's own weighted slice is well under the full $800
    expect(desk.intent!.budget.maxAmount).toBe(800); // but the search itself is never narrowed to that slice
  });
});

describe('build budget rebalancing: underspend can offset overspend; only the running total is a hard constraint', () => {
  it('test #9: underspend on one component offsets overspend on another - neither is individually enforced', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 320 }, ['monitor', 'keyboard']); // ~$160 target each
    const results: Record<string, BuildComponentResult> = {
      monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [product('m1', 19999)] }, // above its own ~$160 target
      keyboard: { componentId: 'keyboard', source: 'agnic', mission: null, error: null, products: [product('k1', 7568)] }, // well below its own ~$160 target
    };
    const total = calculateBuildTotal(plan, results);
    expect(total.overBudget).toBe(false); // 199.99 + 75.68 = 275.67, under the $320 total
    expect(total.subtotal!.amountMinor).toBe(19999 + 7568);
  });
  it('test #10: the total build budget cannot be silently exceeded - BUILD OVER BUDGET is flagged with the exact overage', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 300 }, ['monitor', 'keyboard']);
    const results: Record<string, BuildComponentResult> = {
      monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [product('m1', 19999)] },
      keyboard: { componentId: 'keyboard', source: 'agnic', mission: null, error: null, products: [product('k1', 12900)] },
    };
    const total = calculateBuildTotal(plan, results);
    expect(total.overBudget).toBe(true);
    expect(total.overBy).toEqual({ amountMinor: 19999 + 12900 - 30000, currency: 'CAD' });
  });
  it('calculateBuildTotal sums whatever selectBuildPick actually recommends, not blindly the top-ranked candidate', () => {
    const plan = createBuildPlan(gaming, { budgetMaxAmount: 160 }, ['monitor']);
    const top = product('top', 19999, '', 'LIKELY_COMPATIBLE');
    const withinTarget = product('cheaper', 15900, '', 'LIKELY_COMPATIBLE');
    const results: Record<string, BuildComponentResult> = { monitor: { componentId: 'monitor', source: 'agnic', mission: null, error: null, products: [top, withinTarget] } };
    const total = calculateBuildTotal(plan, results);
    expect(total.subtotal).toEqual({ amountMinor: 15900, currency: 'CAD' });
  });
});
