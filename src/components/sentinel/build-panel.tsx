"use client";

import { Check, CircleDashed, Hammer, LockKeyhole, Radio, ShieldCheck, TriangleAlert } from "lucide-react";
import { InspectUpload } from "./inspect-upload";
import { BuildResults } from "./build-results";
import { useBuild, type BuildFormConstraints } from "@/hooks/use-build";
import type { BuildAnalysis } from "@/lib/domain/build";
import type { RuntimeStatus } from "@/lib/domain/commerce";
import type { BuildSessionView } from "@/lib/server/services/build";

const exampleHints = ["Gaming desk setup", "Home office", "Streaming setup", "Coffee station"];

function BuildConstraintsForm({ form, onChange, disabled }: { form: BuildFormConstraints; onChange: (patch: Partial<BuildFormConstraints>) => void; disabled: boolean }) {
  return <div className="build-constraints-form">
    <div className="inspect-constraints">
      <div><label htmlFor="build-budget-input">Budget (optional)</label><div className="inspect-budget-field"><span>C$</span><input id="build-budget-input" type="number" min={1} step={1} inputMode="decimal" disabled={disabled} value={form.budget} onChange={event => onChange({ budget: event.target.value })} placeholder="No limit" /></div></div>
      <div><label htmlFor="build-goal-input">Goal (optional)</label><input id="build-goal-input" type="text" maxLength={200} disabled={disabled} value={form.goal} onChange={event => onChange({ goal: event.target.value })} placeholder="e.g. gaming setup, home office, streaming desk" /></div>
    </div>
    <div className="inspect-constraints">
      <div><label htmlFor="build-own-input">Already own (optional)</label><input id="build-own-input" type="text" maxLength={300} disabled={disabled} value={form.alreadyOwn} onChange={event => onChange({ alreadyOwn: event.target.value })} placeholder="e.g. I already own the monitor" /></div>
      <div><label htmlFor="build-requirements-input">Additional requirements (optional)</label><input id="build-requirements-input" type="text" maxLength={300} disabled={disabled} value={form.requirements} onChange={event => onChange({ requirements: event.target.value })} placeholder="e.g. desk must fit a 120cm wall" /></div>
    </div>
  </div>;
}

function BuildActivity({ hasFile, isAnalyzing, session, analysisError, isSearching, searchingIds }: {
  hasFile: boolean; isAnalyzing: boolean; session: BuildSessionView | null; analysisError: string | null; isSearching: boolean; searchingIds: Set<string>;
}) {
  const analyzed = session !== null && session.analysis.outcome === "ANALYZED";
  const analysis: BuildAnalysis | null = analyzed ? session!.analysis : null;
  const essentialCount = analysis?.components.filter(c => c.role === "ESSENTIAL").length ?? 0;
  const ownedCount = analysis?.existingItems.length ?? 0;
  const unresolvedDependencies = analysis?.dependencies.length ?? 0;
  const hasResults = (session?.results.length ?? 0) > 0;

  type Row = { label: string; detail: string; status: "pending" | "active" | "complete" | "warning" | "error" };
  const rows: Row[] = [
    { label: "Uploading image", detail: hasFile ? "Image ready." : "Waiting for a photo.", status: hasFile ? "complete" : "pending" },
    { label: "Understanding scene", detail: analyzed ? `${analysis!.scene.title} identified.` : isAnalyzing ? "Running one bounded multimodal call." : analysisError ? analysisError : "Waiting to start.", status: analyzed ? "complete" : isAnalyzing ? "active" : analysisError ? "error" : "pending" },
  ];
  if (analyzed) {
    rows.push({ label: `${analysis!.components.length} components detected`, detail: `${essentialCount} essential component${essentialCount === 1 ? "" : "s"} identified.`, status: "complete" });
    if (ownedCount > 0) rows.push({ label: "Existing equipment excluded", detail: `${ownedCount} item${ownedCount === 1 ? "" : "s"} you already own were excluded from purchasing.`, status: "complete" });
    if (unresolvedDependencies > 0) rows.push({ label: "Compatibility details to verify", detail: `${unresolvedDependencies} dependency relationship${unresolvedDependencies === 1 ? "" : "s"} need real listing evidence.`, status: "warning" });
    if (!hasResults) rows.push({ label: "Waiting for your component selection", detail: "Review the plan, then choose Find Products.", status: "pending" });
    else {
      const remaining = session!.remainingIds.length;
      rows.push({ label: "Searching commerce network", detail: isSearching ? `Searching ${searchingIds.size} component${searchingIds.size === 1 ? "" : "s"}…` : `${session!.results.length} component${session!.results.length === 1 ? "" : "s"} searched.`, status: isSearching ? "active" : "complete" });
      rows.push({ label: remaining > 0 ? "More components pending" : "Ready to review build", detail: remaining > 0 ? `${remaining} selected component${remaining === 1 ? "" : "s"} still to search.` : "All selected components have results.", status: remaining > 0 ? "pending" : "complete" });
    }
  }

  return <section aria-labelledby="build-activity-title" className="activity-panel panel">
    <div className="panel-heading"><h2 id="build-activity-title"><Radio size={16} />SENTINEL activity</h2><span className={`activity-state ${isAnalyzing || isSearching ? "running" : ""}`}><i />{isAnalyzing || isSearching ? "Working" : analyzed ? "Ready for review" : "Standby"}</span></div>
    <div className="activity-body">
      <ol className="activity-timeline" aria-label="Build progress">
        {rows.map((row, index) => <li key={row.label} className={`step-${row.status === "warning" || row.status === "error" ? "blocked" : row.status}`}>
          <span className="step-node">{row.status === "complete" ? <Check size={13} /> : row.status === "active" ? <CircleDashed size={14} className="animate-spin motion-reduce:animate-none" /> : row.status === "warning" || row.status === "error" ? <TriangleAlert size={12} /> : String(index + 1).padStart(2, "0")}<span className="sr-only">{row.status}</span></span>
          <div><h3>{row.label}</h3><p>{row.detail}</p></div>
        </li>)}
      </ol>
      <div role="status" aria-live="polite" className="activity-footnote">{analyzed ? "No private reasoning is shown - only actions and results." : "No AI call runs until you press Analyze Image."}</div>
    </div>
    <div className="activity-safety"><ShieldCheck size={14} /><span>Real purchasing is disabled</span><LockKeyhole size={11} /></div>
  </section>;
}

export function BuildPanel({ status }: { status: RuntimeStatus | null }) {
  const { file, previewUrl, validationError, selectFile, removeImage, form, updateForm, analyze, isAnalyzing, analysisError, session, selectedIds, toggleComponent, search, isSearching, searchError, searchingIds } = useBuild();
  const unavailable = status !== null && (!status.aiEnabled || status.aiCredential === "missing");

  return <>
    <section className="hero inspect-hero" aria-labelledby="build-hero-title">
      <div className="eyebrow"><Hammer size={13} />BUILD MODE</div>
      <h1 id="build-hero-title">Show SENTINEL<br className="mobile-break" /> what you want to create<span>.</span></h1>
      <p className="hero-tagline">Upload a reference photo. SENTINEL turns it into a practical, compatible shopping plan.</p>
    </section>
    <InspectUpload
      id="build" icon={<Hammer size={16} />} heading="Show SENTINEL what you want to create"
      description="Upload a reference photo of a setup you want to build. SENTINEL will plan the components with you."
      exampleLabel="Try a reference photo of" exampleHints={exampleHints}
      analyzeLabel="Analyze Setup" analyzingLabel="Analyzing setup…" previewAlt="Uploaded reference setup"
      file={file} previewUrl={previewUrl} validationError={validationError}
      onSelectFile={selectFile} onRemove={removeImage} onAnalyze={() => void analyze()} isAnalyzing={isAnalyzing}
      disabled={unavailable}
      disabledReason={unavailable ? (status?.aiEnabled === false ? "AI requests are disabled in the server configuration." : "A server API credential is missing. Open integration status for details.") : null}
    />
    {file && !session && <BuildConstraintsForm form={form} onChange={updateForm} disabled={isAnalyzing} />}
    {analysisError && !isAnalyzing && <p className="error-message" role="alert">{analysisError}</p>}
    {session && <div className="workspace-grid inspect-analysis-grid">
      <BuildResults session={session} source={session.source} selectedIds={selectedIds} onToggle={toggleComponent} onSearch={clarification => void search(clarification)} isSearching={isSearching} searchingIds={searchingIds} searchError={searchError} searchDisabledReason={unavailable ? "Search uses the same server integrations as Request Mode; check integration status." : null} />
      <BuildActivity hasFile={Boolean(file)} isAnalyzing={isAnalyzing} session={session} analysisError={analysisError} isSearching={isSearching} searchingIds={searchingIds} />
    </div>}
  </>;
}
