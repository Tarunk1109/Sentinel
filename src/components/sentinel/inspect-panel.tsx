"use client";

import { Check, CircleDashed, LockKeyhole, Radio, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { InspectUpload } from "./inspect-upload";
import { InspectResults } from "./inspect-results";
import { useInspection } from "@/hooks/use-inspection";
import { buildProductIntentFromInspection, type InspectionAnalysis } from "@/lib/domain/inspection";
import type { ProductIntent, RuntimeStatus } from "@/lib/domain/commerce";

type ActivityRow = { label: string; detail: string; status: "pending" | "active" | "complete" | "warning" | "error" };

function InspectActivity({ hasFile, isAnalyzing, analysis, analysisError }: { hasFile: boolean; isAnalyzing: boolean; analysis: InspectionAnalysis | null; analysisError: string | null }) {
  const analyzed = analysis !== null && analysis.outcome === "ANALYZED";
  const hasUnknowns = analyzed && analysis.compatibilityRequirements.unknown.length > 0;
  const rows: ActivityRow[] = [
    { label: "Uploading image", detail: hasFile ? "Image ready." : "Waiting for a photo.", status: hasFile ? "complete" : "pending" },
    { label: "Analyzing object", detail: analyzed ? `${analysis.object.probableName || analysis.object.category} identified.` : isAnalyzing ? "Running one bounded multimodal call." : analysisError ? analysisError : "Waiting to start.", status: analyzed ? "complete" : isAnalyzing ? "active" : analysisError ? "error" : "pending" },
    { label: "Inspecting visible issue", detail: analyzed ? analysis.observedCondition.summary : "Waiting for analysis.", status: analyzed ? "complete" : "pending" },
    { label: "Determining replacement", detail: analyzed ? `${analysis.searchIntent.productType} category identified.` : "Waiting for analysis.", status: analyzed ? "complete" : "pending" },
    { label: "Checking compatibility evidence", detail: analyzed ? (hasUnknowns ? "Some dimensions are not visible in this photo." : "No unresolved compatibility gaps found.") : "Waiting for analysis.", status: analyzed ? (hasUnknowns ? "warning" : "complete") : "pending" },
  ];
  return <section aria-labelledby="inspect-activity-title" className="activity-panel panel">
    <div className="panel-heading"><h2 id="inspect-activity-title"><Radio size={16} />SENTINEL activity</h2><span className={`activity-state ${isAnalyzing ? "running" : ""}`}><i />{isAnalyzing ? "Working" : analyzed ? "Ready for review" : "Standby"}</span></div>
    <div className="activity-body">
      <ol className="activity-timeline" aria-label="Inspection progress">
        {rows.map((row, index) => <li key={row.label} className={`step-${row.status === "warning" || row.status === "error" ? "blocked" : row.status}`}>
          <span className="step-node">{row.status === "complete" ? <Check size={13} /> : row.status === "active" ? <CircleDashed size={14} className="animate-spin motion-reduce:animate-none" /> : row.status === "warning" || row.status === "error" ? <TriangleAlert size={12} /> : String(index + 1).padStart(2, "0")}<span className="sr-only">{row.status}</span></span>
          <div><h3>{row.label}</h3><p>{row.detail}</p></div>
        </li>)}
      </ol>
      <div role="status" aria-live="polite" className="activity-footnote">{analyzed ? "Ready to search once you review the details." : "No AI call runs until you press Analyze Image."}</div>
    </div>
    <div className="activity-safety"><ShieldCheck size={14} /><span>Real purchasing is disabled</span><LockKeyhole size={11} /></div>
  </section>;
}

export function InspectPanel({ status, onSearch, isSearching }: { status: RuntimeStatus | null; onSearch: (intent: ProductIntent) => void; isSearching: boolean }) {
  const { file, previewUrl, validationError, selectFile, removeImage, analyze, analysis, source, isAnalyzing, analysisError } = useInspection();
  const unavailable = status !== null && (!status.aiEnabled || status.aiCredential === "missing");

  function handleSearch(constraints: { clarification: string; extraRequirement: string; budgetMaxAmount: number | null }) {
    if (!analysis || analysis.outcome !== "ANALYZED") return;
    const intent = buildProductIntentFromInspection(analysis, {
      clarification: constraints.clarification || undefined,
      extraRequirement: constraints.extraRequirement || undefined,
      budgetMaxAmount: constraints.budgetMaxAmount,
    });
    onSearch(intent);
  }

  return <>
    <section className="hero inspect-hero" aria-labelledby="inspect-hero-title">
      <div className="eyebrow"><ScanLine size={13} />INSPECT MODE</div>
      <h1 id="inspect-hero-title">See it. Understand it.<br className="mobile-break" /> Replace it<span>.</span></h1>
      <p className="hero-tagline">Upload a photo. SENTINEL identifies the issue and what to search for.</p>
    </section>
    <InspectUpload
      file={file} previewUrl={previewUrl} validationError={validationError}
      onSelectFile={selectFile} onRemove={removeImage} onAnalyze={() => void analyze()} isAnalyzing={isAnalyzing}
      disabled={unavailable}
      disabledReason={unavailable ? (status?.aiEnabled === false ? "AI requests are disabled in the server configuration." : "A server API credential is missing. Open integration status for details.") : null}
    />
    {analysisError && !isAnalyzing && <p className="error-message" role="alert">{analysisError}</p>}
    {analysis && <div className="workspace-grid inspect-analysis-grid">
      <InspectResults analysis={analysis} source={source ?? "live"} onSearch={handleSearch} isSearching={isSearching} searchDisabledReason={unavailable ? "Search uses the same server integrations as Request Mode; check integration status." : null} />
      <InspectActivity hasFile={Boolean(file)} isAnalyzing={isAnalyzing} analysis={analysis} analysisError={analysisError} />
    </div>}
  </>;
}
