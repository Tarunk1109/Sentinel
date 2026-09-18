"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, FlaskConical, LoaderCircle, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InspectionAnalysis } from "@/lib/domain/inspection";

function confidenceLabel(value: number): "High" | "Medium" | "Low" {
  return value >= 0.7 ? "High" : value >= 0.4 ? "Medium" : "Low";
}

const outcomeCopy: Record<Exclude<InspectionAnalysis["outcome"], "ANALYZED">, string> = {
  NO_OBJECT_DETECTED: "SENTINEL could not identify a clear object in this photo. Try a closer, well-lit photo of the item.",
  MULTIPLE_UNRELATED_OBJECTS: "This photo shows more than one unrelated item. Upload a photo of just the item that needs attention.",
  IMAGE_TOO_BLURRY: "This photo is too blurry to identify the item reliably. Try a steadier, closer photo.",
  IMAGE_TOO_DARK: "This photo is too dark to make out details. Try a photo with better lighting.",
  UNSUPPORTED_IMAGE: "SENTINEL could not process this image. Try a different photo of the item.",
  CANNOT_DETERMINE_NEED: "SENTINEL can see an object here but the damaged or missing part is not clear enough. Try a closer photo of the affected area.",
};

export function InspectResults({ analysis, source, onSearch, isSearching, searchDisabledReason }: {
  analysis: InspectionAnalysis; source: "live" | "fixture"; onSearch: (constraints: { clarification: string; extraRequirement: string; budgetMaxAmount: number | null }) => void;
  isSearching: boolean; searchDisabledReason: string | null;
}) {
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

  const confidence = confidenceLabel(analysis.object.confidence);
  const hasUnknowns = analysis.compatibilityRequirements.unknown.length > 0;
  const budgetValue = budget.trim() ? Number(budget) : null;
  const budgetValid = budgetValue === null || (Number.isFinite(budgetValue) && budgetValue > 0);

  return <section className="panel inspect-results-panel" aria-labelledby="inspect-results-title">
    <div className="panel-heading"><h2 id="inspect-results-title"><FlaskConical size={16} />SENTINEL inspection</h2>{source === "fixture" && <span className="dev-fixture-badge">DEVELOPMENT FIXTURE</span>}</div>
    <div className="inspect-results-body">
      <div className="inspect-field"><p className="inspect-field-label">OBJECT</p><p className="inspect-field-value">{analysis.object.probableName || analysis.object.category}</p><p className="inspect-field-sub">{analysis.object.brand ? `Brand: ${analysis.object.brand}` : "Brand: Unknown"}{analysis.object.model ? ` · Model: ${analysis.object.model}` : ""}</p></div>
      <div className="inspect-field"><p className="inspect-field-label">OBSERVED ISSUE</p><p className="inspect-field-value">{analysis.observedCondition.summary}</p>{analysis.observedCondition.visibleIssues.length > 0 && <ul className="inspect-issue-list">{analysis.observedCondition.visibleIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</div>
      <div className="inspect-field"><p className="inspect-field-label">WHAT YOU MAY NEED</p><p className="inspect-field-value">{analysis.searchIntent.productType}</p></div>
      <div className="inspect-field">
        <p className="inspect-field-label">COMPATIBILITY TO VERIFY</p>
        <ul className="inspect-compatibility-list">
          {analysis.compatibilityRequirements.verified.map(item => <li key={item} className="verified"><Check size={13} />{item}</li>)}
          {analysis.compatibilityRequirements.likely.map(item => <li key={item} className="likely"><Check size={13} />{item} (likely)</li>)}
          {analysis.compatibilityRequirements.unknown.map(item => <li key={item} className="unknown"><ShieldQuestion size={13} />{item}</li>)}
        </ul>
      </div>
      <div className="inspect-confidence-row">
        <div><span>Object identification</span><strong>{confidence}</strong></div>
        <div><span>Exact replacement specification</span><strong>{hasUnknowns ? "Needs verification" : "Established from photo evidence"}</strong></div>
      </div>
      {analysis.warnings.length > 0 && <p className="inspect-warning"><AlertTriangle size={13} />{analysis.warnings[0]}</p>}
      {analysis.needsUserClarification && <div className="inspect-clarification">
        <p className="inspect-field-label">A QUICK QUESTION WOULD HELP</p>
        {analysis.clarificationQuestions.map(question => <p key={question} className="inspect-clarification-question">{question}</p>)}
        <label htmlFor="inspect-clarification-input">Optional detail (brand, model, or anything you know)</label>
        <input id="inspect-clarification-input" type="text" maxLength={300} value={clarification} onChange={event => setClarification(event.target.value)} placeholder="e.g. It's a Herman Miller Aeron" />
      </div>}
      <div className="inspect-constraints">
        <div><label htmlFor="inspect-budget-input">Budget (optional)</label><div className="inspect-budget-field"><span>C$</span><input id="inspect-budget-input" type="number" min={1} step={1} inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} placeholder="No limit" /></div></div>
        <div><label htmlFor="inspect-requirement-input">Additional requirement (optional)</label><input id="inspect-requirement-input" type="text" maxLength={160} value={extraRequirement} onChange={event => setExtraRequirement(event.target.value)} placeholder="e.g. safe for hardwood floors" /></div>
      </div>
      {!budgetValid && <p className="error-message" role="alert">Enter a positive budget amount, or leave it blank.</p>}
      <p className="inspect-honesty-note">SENTINEL can search for a replacement now, but {hasUnknowns ? "exact compatibility may need verification before any listing is called a confirmed match." : "review the evidence on each result before choosing."}</p>
      <Button type="button" className="inspect-search-button" disabled={isSearching || !budgetValid} onClick={() => onSearch({ clarification, extraRequirement, budgetMaxAmount: budgetValid ? budgetValue : null })}>
        {isSearching ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />Searching…</> : <>Search for Replacement<ArrowRight /></>}
      </Button>
      {searchDisabledReason && <p className="configuration-note">{searchDisabledReason}</p>}
    </div>
  </section>;
}
