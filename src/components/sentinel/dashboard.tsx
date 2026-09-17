"use client";

import { useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CircleHelp, CircleDot, Hexagon, Layers3, LockKeyhole, Plus, ScanLine, ShieldCheck, ShoppingBag, Sparkles, Terminal, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ModeCards } from "./mode-cards";
import { RequestComposer } from "./request-composer";
import { ProductResults } from "./product-results";
import { ActivityPanel } from "./activity-panel";
import { ApprovalPanel } from "./approval-panel";
import { useMission } from "@/hooks/use-mission";
import type { Mode } from "@/lib/domain/types";
import type { ActivityStep, ProductCandidate } from "@/lib/domain/commerce";

type InfoDialog = "inspect" | "build" | "system" | "guide" | null;

function SentinelMark({ small = false }: { small?: boolean }) {
  return <span className={`sentinel-mark ${small ? "small" : ""}`} aria-hidden="true"><Hexagon strokeWidth={1.7} /><Check className="mark-check" strokeWidth={2.2} /></span>;
}

export function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductCandidate | null>(null);
  const [info, setInfo] = useState<InfoDialog>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { mission, steps, intent, isRunning, error, run, reset, cancel, status } = useMission();
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
  function newMission() { reset(); setPrompt(""); setSelectedProduct(null); setInteractionSteps({}); focusRequest(); }
  function chooseMode(mode: Mode) { if (mode !== "request") { setInfo(mode); return; } focusRequest(); }
  function selectProduct(product: ProductCandidate) {
    setSelectedProduct(product);
    setInteractionSteps({ select: { id: "select", label: "Product selected", status: "complete", detail: `${product.name} is ready for checkout review.` } });
    requestAnimationFrame(() => document.getElementById("approval")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const credentialLabel = mission ? "Providers connected" : status ? "Integration status" : "Checking integrations";

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to your request</a>
    <header className="site-header"><div className="header-inner">
      <a href="#main" className="brand" aria-label="SENTINEL home"><SentinelMark /><span>SENTINEL</span></a>
      <ModeCards onSelect={chooseMode} />
      <div className="header-actions"><button aria-label="Integration status" className={`connection-button ${mission ? "connected" : ""}`} onClick={() => setInfo("system")}><span className="connection-dot" /><span>{credentialLabel}</span><ArrowUpRight size={13} /></button><Button variant="ghost" size="icon" className="help-button" onClick={() => setInfo("guide")} aria-label="Open quick guide"><CircleHelp size={18} /></Button></div>
    </div></header>
    <div className="test-banner"><div><span className="test-badge"><ShieldCheck size={12} />TEST MODE</span><span>Real purchasing disabled</span><span className="banner-separator">·</span><span className="banner-detail">Your intent. Your approval. Always.</span></div><button onClick={() => setInfo("system")}>Safety controls<ArrowUpRight size={12} /></button></div>
    <main id="main" tabIndex={-1} className="main-content">
      <section className="hero" aria-labelledby="hero-title"><div className="eyebrow"><Sparkles size={13} /> YOUR AUTONOMOUS COMMERCE ASSISTANT</div><h1 id="hero-title">Tell SENTINEL<br className="mobile-break" /> what you need<span>.</span></h1><p className="hero-tagline">Understand. Verify. Purchase.</p><p className="hero-description">From a simple request to the right product.<br className="mobile-break" /> Evidence made clear. Every decision yours.</p></section>
      <RequestComposer prompt={prompt} onPromptChange={setPrompt} onSubmit={() => { setSelectedProduct(null); setInteractionSteps({}); void run(prompt.trim()); }} isRunning={isRunning} onCancel={cancel} error={error} inputRef={inputRef} status={status} />
      {intent && <section className="intent-bar" aria-label="Understood request"><span className="intent-label"><Check size={13} />UNDERSTOOD</span><strong>{intent.productType}</strong><span>{intent.budget.maxAmount === null ? "No budget specified" : `Up to ${new Intl.NumberFormat("en-CA", { style: "currency", currency: intent.budget.currency, currencyDisplay: "code" }).format(intent.budget.maxAmount)}`}</span><span>{intent.country} · Qty {intent.quantity}</span>{intent.compatibilityRequirements.map(requirement => <span key={requirement}>{requirement}</span>)}{intent.requiredFeatures.length > 0 && <span>{intent.requiredFeatures.join(" · ")}</span>}</section>}
      <div className="workspace-toolbar"><div><span className="workspace-title">YOUR WORKSPACE</span><span className="workspace-caption">A clear path from intent to outcome.</span></div><Button variant="ghost" size="sm" onClick={newMission}><Plus size={14} />New request</Button></div>
      <div className="workspace-grid"><ProductResults mission={mission} isRunning={isRunning} selectedId={selectedProduct?.id ?? null} onSelect={selectProduct} /><ActivityPanel mission={mission} steps={activitySteps} intent={intent} isRunning={isRunning} /></div>
      <div className="checkout-section"><ApprovalPanel mission={mission} product={selectedProduct} onStep={recordStep} onClear={() => { setSelectedProduct(null); setInteractionSteps({}); }} /></div>
      <footer className="workspace-footer"><span><SentinelMark small />Intelligent commerce. Human control.</span><button onClick={() => setInfo("system")}>Powered by OpenAI + Agnic<ArrowUpRight size={12} /></button><span className="footer-security"><LockKeyhole size={12} />Real purchases locked</span></footer>
    </main>
    <Dialog open={info !== null} onOpenChange={open => { if (!open) setInfo(null); }}><DialogContent>
      {info === "inspect" || info === "build" ? <><span className="dialog-icon">{info === "inspect" ? <ScanLine /> : <Layers3 />}</span><div><span className="dialog-eyebrow">UPCOMING MODE</span><DialogTitle>{info === "inspect" ? "See it. Understand it. Replace it." : "An idea becomes a parts list."}</DialogTitle></div><DialogDescription>{info === "inspect" ? "Inspect will analyze a photo of a broken or missing item, identify a replacement, and check compatibility before searching." : "Build will turn a reference image into a bill of materials, then help find the components to bring it to life."} Image uploads and analysis are not available yet.</DialogDescription><div className="dialog-callout"><Terminal size={18} /><p>Request Mode is ready for live product discovery.</p></div><Button onClick={() => { setInfo(null); setTimeout(focusRequest, 100); }}>Try Request Mode<ArrowRight /></Button></> : info === "system" ? <><span className="dialog-icon"><Workflow /></span><DialogTitle>Connected with care.</DialogTitle><DialogDescription>API credentials stay on the server. Credential detection does not prove authentication; a completed request confirms the providers responded. Real purchasing remains locked.</DialogDescription><div className="integration-list"><div><span><CircleDot size={16} />OpenAI reasoning</span><span>{mission ? "Connected for this request" : status ? `Credential ${status.aiCredential}` : "Status unavailable"}</span></div><div><span><ShoppingBag size={16} />Agnic discovery</span><span>{mission ? "Connected for this request" : status ? `Credential ${status.agnicCredential}` : "Status unavailable"}</span></div><div><span><LockKeyhole size={16} />Real purchase execution</span><span className="status-locked">Disabled</span></div></div>{status?.aiBudget && <p className="text-sm text-muted-foreground">AI usage accounted: C${status.aiBudget.spentCad.toFixed(3)} of C${status.aiBudget.limitCad.toFixed(2)}. Includes reservations; refresh to update. This app’s ledger does not track other account activity.</p>}<p className="text-sm leading-relaxed text-muted-foreground">Luna handles intent and simple ranking. Astra is reserved for technical compatibility when product specifications provide enough evidence. Up to two model calls per request, with no automatic retries.</p></> : <><span className="dialog-icon"><CircleHelp /></span><DialogTitle>From intent to informed choice.</DialogTitle><DialogDescription>Live products, visible progress, and an approval step that keeps you in control.</DialogDescription><ol className="guide-steps"><li><span>01</span><div><h3>Tell us what you need</h3><p>Include a product, budget, and compatibility details. Example chips fill the input; only submitting starts a search.</p></div></li><li><span>02</span><div><h3>Review the evidence</h3><p>Compare real listings and read what supports each match. Missing specifications stay clearly marked.</p></div></li><li><span>03</span><div><h3>Check the checkout details</h3><p>Choose a product, prepare its merchant when needed, and request a live quote. Real purchases are disabled. Sandbox purchases require a verified test merchant and your explicit confirmation.</p></div></li></ol><Button onClick={() => setInfo(null)}>Start exploring<ArrowRight /></Button></>}
    </DialogContent></Dialog>
  </div>;
}
