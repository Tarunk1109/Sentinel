"use client";

import { ArrowRight, Check, CircleDashed, LockKeyhole, Radio, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { InspectUpload } from "./inspect-upload";
import { InspectResults } from "./inspect-results";
import { useInspection } from "@/hooks/use-inspection";
import { buildProductIntentFromInspection, getDetectedObject, resolveInspectionStep, type InspectionAnalysis, type InspectionDecision } from "@/lib/domain/inspection";
import type { ProductIntent, RuntimeStatus } from "@/lib/domain/commerce";

type ActivityRow = { label: string; detail: string; status: "pending" | "active" | "complete" | "warning" | "error" | "waiting" };

function InspectActivity({ hasFile, isAnalyzing, analysis, analysisError }: { hasFile: boolean; isAnalyzing: boolean; analysis: InspectionAnalysis | null; analysisError: string | null }) {
  const analyzed = analysis !== null && analysis.outcome === "ANALYZED";
  const subject = analyzed ? getDetectedObject(analysis, analysis.primarySubjectId) : null;
  const step = analyzed ? resolveInspectionStep(analysis, analysis.primarySubjectId) : null;

  const rows: ActivityRow[] = [
    { label: "Uploading image", detail: hasFile ? "Image ready." : "Waiting for a photo.", status: hasFile ? "complete" : "pending" },
    { label: "Detecting objects", detail: analyzed ? `${analysis.detectedObjects.length} item${analysis.detectedObjects.length === 1 ? "" : "s"} detected.` : isAnalyzing ? "Running one bounded multimodal call." : analysisError ? analysisError : "Waiting to start.", status: analyzed ? "complete" : isAnalyzing ? "active" : analysisError ? "error" : "pending" },
  ];
  if (analyzed) {
    rows.push(subject
      ? { label: "Identifying primary subject", detail: `${subject.label} identified.`, status: "complete" }
      : { label: "Identifying primary subject", detail: "Multiple comparably prominent items found; your choice is needed.", status: "warning" });
    if (subject) rows.push({ label: "Assessing condition", detail: analysis.condition.summary, status: analysis.condition.status === "UNCERTAIN" ? "warning" : "complete" });
    const final: Record<NonNullable<typeof step>, ActivityRow> = {
      READY_TO_SEARCH: { label: "Ready to search", detail: "Evidence supports a search.", status: "complete" },
      ASK_USER_INTENT: { label: "Waiting for your intent", detail: "No visible problem found - tell SENTINEL what you're after.", status: "waiting" },
      ASK_CLARIFICATION: { label: "One question needs an answer", detail: "Uncertain whether this is actually a problem.", status: "warning" },
      CHOOSE_SUBJECT: { label: "Waiting for your selection", detail: "Choose which item to inspect.", status: "waiting" },
      NO_ACTION: { label: "No action needed", detail: analysis.recommendedAction.reason, status: "complete" },
    };
    if (step) rows.push(final[step]);
  }

  return <section aria-labelledby="inspect-activity-title" className="activity-panel panel">
    <div className="panel-heading"><h2 id="inspect-activity-title"><Radio size={16} />SENTINEL activity</h2><span className={`activity-state ${isAnalyzing ? "running" : ""}`}><i />{isAnalyzing ? "Working" : analyzed ? "Ready for review" : "Standby"}</span></div>
    <div className="activity-body">
      <ol className="activity-timeline" aria-label="Inspection progress">
        {rows.map((row, index) => <li key={row.label} className={`step-${row.status === "warning" || row.status === "error" ? "blocked" : row.status === "waiting" ? "pending" : row.status}`}>
          <span className="step-node">{row.status === "complete" ? <Check size={13} /> : row.status === "active" ? <CircleDashed size={14} className="animate-spin motion-reduce:animate-none" /> : row.status === "warning" || row.status === "error" ? <TriangleAlert size={12} /> : row.status === "waiting" ? <ArrowRight size={12} /> : String(index + 1).padStart(2, "0")}<span className="sr-only">{row.status}</span></span>
          <div><h3>{row.label}</h3><p>{row.detail}</p></div>
        </li>)}
      </ol>
      <div role="status" aria-live="polite" className="activity-footnote">{analyzed ? "Ready for your review." : "No AI call runs until you press Analyze Image."}</div>
    </div>
    <div className="activity-safety"><ShieldCheck size={14} /><span>Real purchasing is disabled</span><LockKeyhole size={11} /></div>
  </section>;
}

export function InspectPanel({ status, onSearch, isSearching }: { status: RuntimeStatus | null; onSearch: (intent: ProductIntent) => void; isSearching: boolean }) {
  const { file, previewUrl, validationError, selectFile, removeImage, analyze, analysis, source, analysisId, isAnalyzing, analysisError } = useInspection();
  const unavailable = status !== null && (!status.aiEnabled || status.aiCredential === "missing");

  function handleReady(decision: InspectionDecision, constraints: { clarification: string; extraRequirement: string; budgetMaxAmount: number | null }) {
    if (!analysis || analysis.outcome !== "ANALYZED") return;
    const intent = buildProductIntentFromInspection(analysis, {
      clarification: constraints.clarification || undefined,
      extraRequirement: constraints.extraRequirement || undefined,
      budgetMaxAmount: constraints.budgetMaxAmount,
    }, decision);
    onSearch(intent);
  }

  return <>
    <section className="hero inspect-hero" aria-labelledby="inspect-hero-title">
      <div className="eyebrow"><ScanLine size={13} />INSPECT MODE</div>
      <h1 id="inspect-hero-title">See it. Understand it.<br className="mobile-break" /> Decide what’s next<span>.</span></h1>
      <p className="hero-tagline">Upload a photo. SENTINEL tells you what it sees - not just what to buy.</p>
    </section>
    <InspectUpload
      file={file} previewUrl={previewUrl} validationError={validationError}
      onSelectFile={selectFile} onRemove={removeImage} onAnalyze={() => void analyze()} isAnalyzing={isAnalyzing}
      disabled={unavailable}
      disabledReason={unavailable ? (status?.aiEnabled === false ? "AI requests are disabled in the server configuration." : "A server API credential is missing. Open integration status for details.") : null}
    />
    {analysisError && !isAnalyzing && <p className="error-message" role="alert">{analysisError}</p>}
    {analysis && <div className="workspace-grid inspect-analysis-grid">
      <InspectResults key={analysisId} analysis={analysis} source={source ?? "live"} onReady={handleReady} isSearching={isSearching} searchDisabledReason={unavailable ? "Search uses the same server integrations as Request Mode; check integration status." : null} />
      <InspectActivity hasFile={Boolean(file)} isAnalyzing={isAnalyzing} analysis={analysis} analysisError={analysisError} />
    </div>}
  </>;
}
