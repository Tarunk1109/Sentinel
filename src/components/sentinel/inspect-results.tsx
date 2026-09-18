"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, FlaskConical, HelpCircle, LoaderCircle, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDetectedObject, resolveInspectionStep, type InspectionAnalysis, type InspectionDecision, type UserIntentAction } from "@/lib/domain/inspection";

function confidenceLabel(value: number): "High" | "Medium" | "Low" {
  return value >= 0.7 ? "High" : value >= 0.4 ? "Medium" : "Low";
}

const outcomeCopy: Record<Exclude<InspectionAnalysis["outcome"], "ANALYZED">, string> = {
  NO_OBJECT_DETECTED: "SENTINEL could not identify a clear object in this photo. Try a closer, well-lit photo of the item.",
  MULTIPLE_UNRELATED_OBJECTS: "This photo shows more than one unrelated item. Upload a photo of just the item that needs attention.",
  IMAGE_TOO_BLURRY: "This photo is too blurry to identify the item reliably. Try a steadier, closer photo.",
  IMAGE_TOO_DARK: "This photo is too dark to make out details. Try a photo with better lighting.",
  UNSUPPORTED_IMAGE: "SENTINEL could not process this image. Try a different photo of the item.",
};

const userIntentCopy: Record<"FIND_SIMILAR" | "UPGRADE" | "ACCESSORY", string> = {
  FIND_SIMILAR: "Find another one",
  UPGRADE: "Find an upgrade",
  ACCESSORY: "Find an accessory",
};

const searchCtaLabel: Record<UserIntentAction, string> = {
  REPLACE_ITEM: "Search for Replacement",
  REPLACE_PART: "Search for Replacement Part",
  REFILL: "Search for Refill",
  UPGRADE: "Find an Upgrade",
  ACCESSORY: "Find an Accessory",
  FIND_SIMILAR: "Find a Similar Item",
};

export function InspectResults({ analysis, source, onReady, isSearching, searchDisabledReason }: {
  analysis: InspectionAnalysis; source: "live" | "fixture";
  onReady: (decision: InspectionDecision, constraints: { clarification: string; extraRequirement: string; budgetMaxAmount: number | null }) => void;
  isSearching: boolean; searchDisabledReason: string | null;
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(analysis.outcome === "ANALYZED" ? analysis.primarySubjectId : null);
  const [resolvedIntent, setResolvedIntent] = useState<UserIntentAction | null>(null);
  const [clarification, setClarification] = useState("");
  const [extraRequirement, setExtraRequirement] = useState("");
  const [budget, setBudget] = useState("");

  if (analysis.outcome !== "ANALYZED") {
    return <section className="panel inspect-outcome-panel" aria-live="polite">
      <span className="inspect-outcome-icon"><AlertTriangle size={22} /></span>
      <h3>SENTINEL couldn’t complete this inspection</h3>
      <p>{analysis.outcomeMessage || outcomeCopy[analysis.outcome]}</p>
      {source === "fixture" && <span className="dev-fixture-badge">DEVELOPMENT FIXTURE</span>}
    </section>;
  }

  const step = resolveInspectionStep(analysis, selectedSubjectId);
  const subject = getDetectedObject(analysis, selectedSubjectId);
  const secondaryObjects = subject ? analysis.detectedObjects.filter(o => o.id !== subject.id) : [];
  const hasCompatInfo = analysis.compatibilityRequirements.verified.length > 0 || analysis.compatibilityRequirements.likely.length > 0 || analysis.compatibilityRequirements.unknown.length > 0;
  const hasUnknowns = analysis.compatibilityRequirements.unknown.length > 0;
  const ready = step === "READY_TO_SEARCH" || resolvedIntent !== null;
  const effectiveAction: UserIntentAction | null = resolvedIntent ?? (step === "READY_TO_SEARCH" ? (analysis.recommendedAction.action === "SEARCH_PART" ? "REPLACE_PART" : analysis.recommendedAction.action === "SEARCH_REFILL" ? "REFILL" : "REPLACE_ITEM") : null);
  const budgetValue = budget.trim() ? Number(budget) : null;
  const budgetValid = budgetValue === null || (Number.isFinite(budgetValue) && budgetValue > 0);

  function chooseSubject(id: string) { setSelectedSubjectId(id); setResolvedIntent(null); }
  function search() {
    if (!ready) return;
    onReady(
      { subjectId: selectedSubjectId ?? undefined, userIntent: resolvedIntent ? { action: resolvedIntent } : undefined },
      { clarification, extraRequirement, budgetMaxAmount: budgetValid ? budgetValue : null },
    );
  }

  return <section className="panel inspect-results-panel" aria-labelledby="inspect-results-title">
    <div className="panel-heading"><h2 id="inspect-results-title"><FlaskConical size={16} />SENTINEL inspection</h2>{source === "fixture" && <span className="dev-fixture-badge">DEVELOPMENT FIXTURE</span>}</div>
    <div className="inspect-results-body">
      {step === "CHOOSE_SUBJECT" ? <>
        <div className="inspect-field"><p className="inspect-field-label">MULTIPLE ITEMS DETECTED</p><p className="inspect-field-value">{analysis.recommendedAction.reason}</p></div>
        <p className="inspect-question"><HelpCircle size={13} />Which one would you like me to inspect?</p>
        <div className="inspect-subject-picker">{analysis.detectedObjects.map(object => <button key={object.id} type="button" className="inspect-subject-option" onClick={() => chooseSubject(object.id)}>{object.label}</button>)}</div>
      </> : subject && <>
        <div className="inspect-field"><p className="inspect-field-label">WHAT I CAN SEE</p><p className="inspect-field-value">{subject.label}</p><p className="inspect-field-sub">{subject.brand ? `Brand: ${subject.brand}` : "Brand: Unknown"}{subject.model ? ` · Model: ${subject.model}` : ""}</p></div>
        {secondaryObjects.length > 0 && <p className="inspect-scene-note">Also visible in this photo: {secondaryObjects.map(o => o.label).join(", ")}. Only {subject.label.toLowerCase()} drove this recommendation.</p>}
        <div className="inspect-field"><p className="inspect-field-label">CONDITION</p><p className="inspect-field-value">{analysis.condition.summary}</p>{analysis.condition.visibleIssues.length > 0 && <ul className="inspect-issue-list">{analysis.condition.visibleIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</div>

        {step === "NO_ACTION" && <p className="inspect-honesty-note">{analysis.recommendedAction.reason} Upload a different photo, or describe what you need directly in Request Mode.</p>}

        {step === "ASK_USER_INTENT" && !resolvedIntent && <div className="inspect-field">
          <p className="inspect-field-label">WHAT WOULD YOU LIKE HELP WITH?</p>
          <p className="inspect-field-sub">No visible problem was found, so SENTINEL won’t search automatically. Tell it what you’re after.</p>
          <div className="inspect-intent-options">{(Object.keys(userIntentCopy) as (keyof typeof userIntentCopy)[]).map(action => <button key={action} type="button" className="inspect-intent-option" onClick={() => setResolvedIntent(action)}>{userIntentCopy[action]}</button>)}</div>
        </div>}

        {step === "ASK_CLARIFICATION" && !resolvedIntent && <div className="inspect-clarification">
          <p className="inspect-field-label">A QUICK QUESTION WOULD HELP</p>
          {analysis.clarificationQuestions.map(question => <p key={question} className="inspect-clarification-question">{question}</p>)}
          <label htmlFor="inspect-clarification-input">Optional detail</label>
          <input id="inspect-clarification-input" type="text" maxLength={300} value={clarification} onChange={event => setClarification(event.target.value)} placeholder="e.g. brand, model, size, or anything else you know" />
          <Button type="button" variant="outline" size="sm" onClick={() => setResolvedIntent("REPLACE_ITEM")}>Search Anyway — Mark Unverified</Button>
        </div>}

        {hasCompatInfo && step === "READY_TO_SEARCH" && <div className="inspect-field">
          <p className="inspect-field-label">DETAILS I CAN VERIFY</p>
          <ul className="inspect-compatibility-list">
            {analysis.compatibilityRequirements.verified.map(item => <li key={item} className="verified"><Check size={13} />{item}</li>)}
            {analysis.compatibilityRequirements.likely.map(item => <li key={item} className="likely"><Check size={13} />{item} (likely)</li>)}
            {analysis.compatibilityRequirements.unknown.map(item => <li key={item} className="unknown"><ShieldQuestion size={13} />{item}</li>)}
          </ul>
        </div>}

        <div className="inspect-confidence-row">
          <div><span>Object identification</span><strong>{confidenceLabel(subject.confidence)}</strong></div>
          <div><span>Condition assessment</span><strong>{confidenceLabel(analysis.condition.confidence)}</strong></div>
        </div>

        {analysis.warnings.map(warning => <p key={warning} className="inspect-warning"><AlertTriangle size={13} />{warning}</p>)}

        {step === "READY_TO_SEARCH" && analysis.needsUserClarification && <div className="inspect-clarification">
          <p className="inspect-field-label">A QUICK QUESTION WOULD HELP</p>
          {analysis.clarificationQuestions.map(question => <p key={question} className="inspect-clarification-question">{question}</p>)}
          <label htmlFor="inspect-clarification-input">Optional detail (won’t block your search)</label>
          <input id="inspect-clarification-input" type="text" maxLength={300} value={clarification} onChange={event => setClarification(event.target.value)} placeholder="e.g. brand, model, size, or anything else you know" />
        </div>}

        {ready && <>
          <div className="inspect-constraints">
            <div><label htmlFor="inspect-budget-input">Budget (optional)</label><div className="inspect-budget-field"><span>C$</span><input id="inspect-budget-input" type="number" min={1} step={1} inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} placeholder="No limit" /></div></div>
            <div><label htmlFor="inspect-requirement-input">Additional requirement (optional)</label><input id="inspect-requirement-input" type="text" maxLength={160} value={extraRequirement} onChange={event => setExtraRequirement(event.target.value)} placeholder="e.g. a specific size, color, or feature" /></div>
          </div>
          {!budgetValid && <p className="error-message" role="alert">Enter a positive budget amount, or leave it blank.</p>}
          <p className="inspect-honesty-note">{hasUnknowns && step === "READY_TO_SEARCH" ? "SENTINEL can search for a replacement now, but exact compatibility may need verification before any listing is called a confirmed match." : "Review the evidence on each result before choosing."}</p>
          <Button type="button" className="inspect-search-button" disabled={isSearching || !budgetValid} onClick={search}>
            {isSearching ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />Searching…</> : <>{effectiveAction ? searchCtaLabel[effectiveAction] : "Search"}<ArrowRight /></>}
          </Button>
          {searchDisabledReason && <p className="configuration-note">{searchDisabledReason}</p>}
        </>}
      </>}
    </div>
  </section>;
}
