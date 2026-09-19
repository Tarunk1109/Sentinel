"use client";

import { useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, CircleDot, Hexagon, LockKeyhole, Plus, ShieldCheck, ShoppingBag, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QuickStart } from "./quick-start";
import { ModeCards } from "./mode-cards";
import { ModeOverview, SimpleJourney, WelcomeHero } from "./welcome";
import { RequestComposer } from "./request-composer";
import { InspectPanel } from "./inspect-panel";
import { BuildPanel } from "./build-panel";
import { ProductResults } from "./product-results";
import { ActivityPanel } from "./activity-panel";
import { ApprovalPanel } from "./approval-panel";
import { useMission } from "@/hooks/use-mission";
import type { Mode } from "@/lib/domain/types";
import type { ActivityStep, ProductCandidate } from "@/lib/domain/commerce";

type InfoDialog = "system" | "guide" | null;

function SentinelMark({ small = false }: { small?: boolean }) {
  return <span className={`sentinel-mark ${small ? "small" : ""}`} aria-hidden="true"><Hexagon strokeWidth={1.7} /><Check className="mark-check" strokeWidth={2.2} /></span>;
}

const modeNoun: Record<Mode, string> = { request: "request", inspect: "inspection", build: "build" };

export function Dashboard() {
  const [view, setView] = useState<Mode>("request");
  const [inspectKey, setInspectKey] = useState(0);
  const [buildKey, setBuildKey] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductCandidate | null>(null);
  const [info, setInfo] = useState<InfoDialog>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { mission, steps, intent, isRunning, error, run, runFromIntent, reset, cancel, status } = useMission();
  const [interactionSteps, setInteractionSteps] = useState<Record<string, ActivityStep>>({});
  const activitySteps = [
    ...steps.map(step => interactionSteps[step.id] ?? step),
    ...Object.values(interactionSteps).filter(step => !steps.some(existing => existing.id === step.id)),
  ];
  function recordStep(step: ActivityStep) { setInteractionSteps(current => ({ ...current, [step.id]: step })); }
  function focusRequest() {
    document.getElementById("request")?.scrollIntoView({ behavior: "smooth", block: "center" });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }
  function focusInspect() { document.getElementById("inspect-upload")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function focusBuild() { document.getElementById("build-upload")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function focusView(mode: Mode) { if (mode === "inspect") focusInspect(); else if (mode === "build") focusBuild(); else focusRequest(); }
  function newMission() {
    reset(); setPrompt(""); setSelectedProduct(null); setInteractionSteps({});
    setInspectKey(current => current + 1); setBuildKey(current => current + 1);
    focusView(view);
  }
  function chooseMode(mode: Mode) {
    setView(mode);
    setSelectedProduct(null); setInteractionSteps({});
    if (mode === view) requestAnimationFrame(() => focusView(mode));
    else requestAnimationFrame(() => document.getElementById("main")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function selectProduct(product: ProductCandidate) {
    setSelectedProduct(product);
    setInteractionSteps({ select: { id: "select", label: "Product selected", status: "complete", detail: `${product.name} is ready for checkout review.` } });
    requestAnimationFrame(() => document.getElementById("approval")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const credentialLabel = "System status";
  const hasWorkspace = Boolean(mission || isRunning || steps.length);

  return <div className={`app-shell view-${view}`}>
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="site-header"><div className="header-inner">
      <a href="#main" className="brand" aria-label="SENTINEL home"><SentinelMark /><span>SENTINEL</span><span className="brand-beta">BETA</span></a>
      <ModeCards active={view} onSelect={chooseMode} />
      <div className="header-actions"><QuickStart disabled={isRunning} onChooseMode={chooseMode} onUseExample={example => { chooseMode("request"); setPrompt(example); requestAnimationFrame(focusRequest); }} /><button aria-label="Integration status" className={`connection-button ${mission ? "connected" : ""}`} onClick={() => setInfo("system")}><span className="connection-dot" /><span>{credentialLabel}</span><ArrowUpRight size={13} /></button><Button variant="ghost" size="icon" className="help-button" onClick={() => setInfo("guide")} aria-label="Open quick guide"><CircleHelp size={18} /></Button></div>
    </div></header>
    <div className="test-banner"><div><span className="test-badge"><ShieldCheck size={13} />YOU’RE IN CONTROL</span><span className="banner-separator">·</span><span>You choose what happens next. Real purchases are disabled.</span></div><button onClick={() => setInfo("system")}>About this preview<ArrowUpRight size={12} /></button></div>
    <main id="main" tabIndex={-1} className="main-content"><div className="studio-wayfinding"><span>YOUR WORKSPACE<span>/</span>{view === "request" ? "DISCOVER" : view === "inspect" ? "INSPECT" : "CREATE"}</span><span className="studio-edition">A little intelligence for everyday life.</span></div>
      {view === "request" ? <div className="request-stage">
        <WelcomeHero />
        <RequestComposer prompt={prompt} onPromptChange={setPrompt} onSubmit={() => { setSelectedProduct(null); setInteractionSteps({}); void run(prompt.trim()); }} isRunning={isRunning} onCancel={cancel} error={error} inputRef={inputRef} status={status} />
      </div> : view === "inspect" ? <InspectPanel key={inspectKey} status={status} isSearching={isRunning} onSearch={intentValue => { setSelectedProduct(null); setInteractionSteps({}); void runFromIntent(intentValue); }} />
        : <BuildPanel key={buildKey} status={status} />}
      {view !== "build" && intent && <section className="intent-bar" aria-label="Understood request"><span className="intent-label"><Check size={13} />UNDERSTOOD</span><strong>{intent.productType}</strong><span>{intent.budget.maxAmount === null ? "No budget specified" : `Up to ${new Intl.NumberFormat("en-CA", { style: "currency", currency: intent.budget.currency, currencyDisplay: "code" }).format(intent.budget.maxAmount)}`}</span><span>{intent.country} · Qty {intent.quantity}</span>{intent.compatibilityRequirements.map(requirement => <span key={requirement}>{requirement}</span>)}{intent.requiredFeatures.length > 0 && <span>{intent.requiredFeatures.join(" · ")}</span>}</section>}
      {view !== "build" && hasWorkspace && <>
        <div className="workspace-toolbar"><div><span className="workspace-title">YOUR FINDS</span><span className="workspace-caption">A little closer to the right choice.</span></div><Button variant="ghost" size="sm" onClick={newMission}><Plus size={14} />New {modeNoun[view]}</Button></div>
        <div className="workspace-grid"><ProductResults mission={mission} isRunning={isRunning} selectedId={selectedProduct?.id ?? null} onSelect={selectProduct} /><ActivityPanel mission={mission} steps={activitySteps} intent={intent} isRunning={isRunning} /></div>
        {selectedProduct && <div className="checkout-section"><ApprovalPanel mission={mission} product={selectedProduct} onStep={recordStep} onClear={() => { setSelectedProduct(null); setInteractionSteps({}); }} /></div>}
      </>}
      {view === "request" && !hasWorkspace && <ModeOverview onSelect={chooseMode} />}
      {view !== "request" && <div className="mode-reset"><Button variant="ghost" size="sm" onClick={newMission}><Plus size={14} />New {modeNoun[view]}</Button></div>}
      {view !== "build" && !selectedProduct && <details className="checkout-disclosure"><summary><span><ShieldCheck size={15} />Checkout &amp; sandbox preview</span><ChevronDown size={15} /></summary><div className="checkout-section"><ApprovalPanel mission={mission} product={null} onStep={recordStep} onClear={() => { setSelectedProduct(null); setInteractionSteps({}); }} /></div></details>}
      <SimpleJourney />
      <footer className="workspace-footer"><span><SentinelMark small />A little intelligence. A lot of possibility.</span><button onClick={() => setInfo("system")}>Made with OpenAI + Agnic<ArrowUpRight size={12} /></button><span className="footer-security"><LockKeyhole size={12} />Real purchases locked</span></footer>
    </main>
    <Dialog open={info !== null} onOpenChange={open => { if (!open) setInfo(null); }}><DialogContent>
      {info === "system" ? <><span className="dialog-icon"><Workflow /></span><DialogTitle>Connected with care.</DialogTitle><DialogDescription>API credentials stay on the server. Credential detection does not prove authentication; a completed request confirms the providers responded. Real purchasing remains locked.</DialogDescription><div className="integration-list"><div><span><CircleDot size={16} />OpenAI reasoning</span><span>{mission ? "Connected for this request" : status ? `Credential ${status.aiCredential}` : "Status unavailable"}</span></div><div><span><ShoppingBag size={16} />Agnic discovery</span><span>{mission ? "Connected for this request" : status ? `Credential ${status.agnicCredential}` : "Status unavailable"}</span></div><div><span><LockKeyhole size={16} />Real purchase execution</span><span className="status-locked">Disabled</span></div></div>{status?.aiBudget && <p className="text-sm text-muted-foreground">AI usage accounted: C${status.aiBudget.spentCad.toFixed(3)} of C${status.aiBudget.limitCad.toFixed(2)}. Includes reservations; refresh to update. This app’s ledger does not track other account activity.</p>}<p className="text-sm leading-relaxed text-muted-foreground">Luna handles intent and simple ranking. Astra is reserved for technical compatibility when product specifications provide enough evidence. Up to two model calls per request, with no automatic retries.</p></> : <><span className="dialog-icon"><CircleHelp /></span><DialogTitle>From intent to informed choice.</DialogTitle><DialogDescription>Live products, visible progress, and an approval step that keeps you in control.</DialogDescription><ol className="guide-steps"><li><span>01</span><div><h3>Tell us what you need</h3><p>Type a request, upload a photo of something broken in Inspect, or upload a reference photo of something to create in Build. Only submitting starts a search.</p></div></li><li><span>02</span><div><h3>Review the evidence</h3><p>Compare real listings and read what supports each match. Missing specifications stay clearly marked.</p></div></li><li><span>03</span><div><h3>Check the checkout details</h3><p>Choose a product, prepare its merchant when needed, and request a live quote. Real purchases are disabled. Sandbox purchases require a verified test merchant and your explicit confirmation.</p></div></li></ol><Button onClick={() => setInfo(null)}>Start exploring<ArrowRight /></Button></>}
    </DialogContent></Dialog>
  </div>;
}
