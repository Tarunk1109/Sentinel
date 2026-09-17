import { Check, CircleDashed, LockKeyhole, Radio, ShieldCheck, X } from "lucide-react";
import type { ActivityStep, ProductIntent, RequestMission } from "@/lib/domain/commerce";

const standbySteps = [
  { label: "Understand your request", detail: "Your budget, preferences, and requirements." },
  { label: "Search the commerce network", detail: "Real products from merchant listings." },
  { label: "Verify the details", detail: "Check fit against available evidence." },
  { label: "Compare your options", detail: "A shortlist shaped by your constraints." },
  { label: "Review before checkout", detail: "You choose what happens next." },
];

export function ActivityPanel({ mission, steps, intent, isRunning }: { mission: RequestMission | null; steps: ActivityStep[]; intent: ProductIntent | null; isRunning: boolean }) {
  return <section aria-labelledby="activity-title" className="activity-panel panel">
    <div className="panel-heading"><h2 id="activity-title"><Radio size={16} />SENTINEL activity</h2><span className={`activity-state ${isRunning ? "running" : ""}`}><i />{isRunning ? "Working" : mission ? "Ready for review" : "Standby"}</span></div>
    <div className="activity-body">
      <p className="activity-intro">{isRunning ? "Following your request, one verified step at a time." : mission ? "The work is visible. The choice is yours." : "A transparent path to your next purchase."}</p>
      {steps.length === 0 ? <ol className="activity-timeline standby" aria-label="Upcoming workflow">{standbySteps.map((step, index) => <li key={step.label}><span className="step-node">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.label}</h3><p>{step.detail}</p></div></li>)}</ol> : <ol className="activity-timeline" aria-label="Agent progress">{steps.map((step, index) => <li key={step.id} className={`step-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}><span className="step-node">{step.status === "complete" ? <Check size={13} /> : step.status === "active" ? <CircleDashed size={14} className="animate-spin motion-reduce:animate-none" /> : step.status === "blocked" ? <LockKeyhole size={12} /> : step.status === "error" ? <X size={13} /> : String(index + 1).padStart(2, "0")}<span className="sr-only">{step.status}</span></span><div><h3>{step.label}</h3><p>{step.detail}</p></div></li>)}</ol>}
      {intent?.preferredFeatures.length ? <details className="activity-preferences"><summary>Your preferences</summary><p>{intent.preferredFeatures.join(" · ")}</p></details> : null}
      <div role="status" aria-live="polite" className="activity-footnote">{isRunning ? "Live server events · No automatic retries" : mission ? `${mission.cacheHit ? "Cached result · " : ""}${mission.usage.modelCalls} model calls · ${mission.usage.agnicCalls} Agnic calls` : "Ready when you are. Submit a request to begin."}</div>
    </div><div className="activity-safety"><ShieldCheck size={14} /><span>Real purchasing is disabled</span><LockKeyhole size={11} /></div>
  </section>;
}
