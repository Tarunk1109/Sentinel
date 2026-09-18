"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, LoaderCircle, Package, ShieldQuestion, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateBuildTotal, evaluateBuildDependencies, type BuildComponentRole, type BuildOutcome, type BuildComponentResult } from "@/lib/domain/build";
import type { BuildSessionView } from "@/lib/server/services/build";
import { displayPrice } from "./commerce-display";

const outcomeCopy: Record<Exclude<BuildOutcome, "ANALYZED">, string> = {
  NO_OBJECT_DETECTED: "SENTINEL could not identify a setup in this photo. Try a wider or clearer reference photo.",
  IMAGE_TOO_BLURRY: "This photo is too blurry to plan from reliably. Try a steadier, closer photo.",
  IMAGE_TOO_DARK: "This photo is too dark to make out the setup. Try a photo with better lighting.",
  UNSUPPORTED_IMAGE: "SENTINEL could not process this image. Try a different reference photo.",
};

const roleOrder: BuildComponentRole[] = ["ESSENTIAL", "RECOMMENDED", "OPTIONAL", "DECORATIVE"];
const roleLabel: Record<BuildComponentRole, string> = { ESSENTIAL: "ESSENTIAL", RECOMMENDED: "RECOMMENDED", OPTIONAL: "OPTIONAL", DECORATIVE: "DECORATIVE" };

function confidenceLabel(value: number): "High" | "Medium" | "Low" { return value >= 0.7 ? "High" : value >= 0.4 ? "Medium" : "Low"; }

function resultsById(session: BuildSessionView): Record<string, BuildComponentResult> {
  return Object.fromEntries(session.results.map(result => [result.componentId, result]));
}

export function BuildResults({ session, source, selectedIds, onToggle, onSearch, isSearching, searchingIds, searchError, searchDisabledReason }: {
  session: BuildSessionView; source: "live" | "fixture"; selectedIds: Set<string>; onToggle: (id: string) => void;
  onSearch: (clarification?: string) => void; isSearching: boolean; searchingIds: Set<string>; searchError: string | null; searchDisabledReason: string | null;
}) {
  const [clarification, setClarification] = useState("");
  const { analysis, plan } = session;
  if (analysis.outcome !== "ANALYZED") {
    return <section className="panel inspect-outcome-panel" aria-live="polite">
      <span className="inspect-outcome-icon"><AlertTriangle size={22} /></span>
      <h3>SENTINEL couldn’t plan this build</h3>
      <p>{analysis.outcomeMessage || outcomeCopy[analysis.outcome]}</p>
      {source === "fixture" && <span className="dev-fixture-badge">DEVELOPMENT FIXTURE</span>}
    </section>;
  }

  const results = resultsById(session);
  const dependencyEvaluations = evaluateBuildDependencies(plan.dependencies, results);
  const total = calculateBuildTotal(plan, results);
  const hasAnyResults = session.results.length > 0;
  const owned = plan.items.filter(item => item.owned);
  const pending = plan.items.filter(item => selectedIds.has(item.componentId) && !item.owned && !results[item.componentId]);

  return <section className="panel build-results-panel" aria-labelledby="build-results-title">
    <div className="panel-heading"><h2 id="build-results-title"><Package size={16} />{analysis.scene.title}</h2>{source === "fixture" && <span className="dev-fixture-badge">DEVELOPMENT FIXTURE</span>}</div>
    <div className="inspect-results-body">
      <p className="inspect-field-sub">{analysis.scene.description}</p>
      <div className="inspect-confidence-row"><div><span>Scene identification</span><strong>{confidenceLabel(analysis.scene.confidence)}</strong></div></div>
      {owned.length > 0 && <p className="inspect-scene-note">Already own, excluded from purchasing: {owned.map(item => item.name).join(", ")}.</p>}

      {roleOrder.map(role => {
        const items = plan.items.filter(item => analysis.components.find(c => c.id === item.componentId)?.role === role && !item.owned);
        if (items.length === 0) return null;
        return <div key={role} className="build-role-group">
          <p className="inspect-field-label">{roleLabel[role]}</p>
          <ul className="build-component-list">
            {items.map(item => {
              const component = analysis.components.find(c => c.id === item.componentId)!;
              const result = results[item.componentId];
              return <li key={item.componentId} className="build-component-row">
                <label>
                  <input type="checkbox" checked={selectedIds.has(item.componentId)} disabled={isSearching || Boolean(result)} onChange={() => onToggle(item.componentId)} />
                  <span>{component.name}{component.quantity > 1 ? ` × ${component.quantity}` : ""}</span>
                </label>
                {component.unknowns.length > 0 && <span className="build-unknown-badge"><ShieldQuestion size={11} />{component.unknowns.length} to verify</span>}
                {item.budgetAllocation && <span className="build-allocation">{displayPrice(item.budgetAllocation)} allocated</span>}
              </li>;
            })}
          </ul>
        </div>;
      })}

      {dependencyEvaluations.length > 0 && <div className="inspect-field">
        <p className="inspect-field-label">COMPATIBILITY TO VERIFY</p>
        <ul className="inspect-compatibility-list">
          {dependencyEvaluations.map(({ dependency, status, note }) => <li key={`${dependency.sourceComponentId}-${dependency.targetComponentId}`} className={status === "VERIFIED" ? "verified" : "unknown"}>
            {status === "VERIFIED" ? <Check size={13} /> : <ShieldQuestion size={13} />}
            {dependency.relationship} — {note}
          </li>)}
        </ul>
      </div>}

      {analysis.needsClarification && !hasAnyResults && <div className="inspect-clarification">
        <p className="inspect-field-label">A FEW QUESTIONS WOULD HELP</p>
        {analysis.clarificationQuestions.map(question => <p key={question} className="inspect-clarification-question">{question}</p>)}
        <label htmlFor="build-clarification-input">Optional detail (won’t block your search)</label>
        <input id="build-clarification-input" type="text" maxLength={300} value={clarification} onChange={event => setClarification(event.target.value)} placeholder="e.g. desk must fit a 120cm wall, prefer wireless" />
      </div>}

      {!hasAnyResults && <Button type="button" className="inspect-search-button" disabled={isSearching || selectedIds.size === 0} onClick={() => onSearch(clarification)}>
        {isSearching ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />Searching…</> : <>Find Products<ArrowRight /></>}
      </Button>}

      {hasAnyResults && <>
        {plan.items.filter(item => item.included && !item.owned).map(item => {
          const result = results[item.componentId];
          const searching = searchingIds.has(item.componentId);
          return <div key={item.componentId} className="build-component-results">
            <p className="inspect-field-label">{item.name.toUpperCase()}</p>
            {searching && <p className="build-searching-note"><LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" />Searching…</p>}
            {result?.error && <p className="error-message" role="alert">{result.error}</p>}
            {result && !result.error && result.products.length === 0 && <p className="inspect-honesty-note">No matches found for this component.</p>}
            {result && !result.error && result.products.length > 0 && <div className="build-product-options">
              {result.products.slice(0, 3).map((product, index) => <div key={product.id} className="build-product-option">
                {index === 0 && <span className="recommendation"><Sparkles size={11} />SENTINEL PICK</span>}
                <p className="build-product-name">{product.name}</p>
                <p className="build-product-price">{displayPrice(product.price)}</p>
                <p className="build-product-merchant">{product.merchantName}</p>
              </div>)}
            </div>}
          </div>;
        })}
        {pending.length > 0 && <Button type="button" className="inspect-search-button" disabled={isSearching} onClick={() => onSearch(clarification)}>
          {isSearching ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />Searching…</> : <>Find {Math.min(3, pending.length)} More Product{Math.min(3, pending.length) === 1 ? "" : "s"}<ArrowRight /></>}
        </Button>}
        <div className="build-total-row">
          <span>Browse total{total.subtotal ? "" : " (incomplete)"}</span>
          <strong>{total.subtotal ? displayPrice(total.subtotal) : "Pending remaining searches"}</strong>
        </div>
        {total.overBudget && <p className="error-message" role="alert">Your requested setup may exceed {plan.budget.maxAmount != null ? `C$${plan.budget.maxAmount}` : "your budget"}. Consider removing optional components or choosing a lower-cost option above.</p>}
        {plan.warnings.map(warning => <p key={warning} className="inspect-honesty-note">{warning}</p>)}
      </>}
      {searchError && <p className="error-message" role="alert">{searchError}</p>}
      {searchDisabledReason && <p className="configuration-note">{searchDisabledReason}</p>}
    </div>
  </section>;
}
