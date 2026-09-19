import { ArrowRight, Check, Layers3, ScanLine, Search, ShieldCheck } from "lucide-react";
import type { Mode } from "@/lib/domain/types";
import { ModeArt } from "./mode-art";
import { IntelligenceVisual } from "./intelligence-visual";

export function WelcomeHero() {
  return <section className="welcome-hero" aria-labelledby="hero-title">
    <div className="welcome-copy">
      <div className="eyebrow"><span className="eyebrow-line" />A LITTLE INTELLIGENCE. A LOT OF POSSIBILITY.</div>
      <h1 id="hero-title">Big ideas.<br /><span>Brilliant finds.</span></h1>
      <p>Describe it. Show it. Dream it. Your AI shopping partner turns what you have in mind into a clear next step.</p>
      <div className="welcome-promise"><span><Check size={14} />Your requirements</span><span><Check size={14} />Real options</span><span><Check size={14} />Your approval</span></div>
      <IntelligenceVisual />
    </div>
  </section>;
}

const modes = [
  { id: "request" as const, label: "Request", title: "Find your next essential", description: "Describe what you need. Compare products against your budget and requirements.", action: "Start with a request", icon: Search, detail: "Start a request", format: "TEXT TO SHORTLIST" },
  { id: "inspect" as const, label: "Inspect", title: "Find the right replacement", description: "Show us the item. Identify the problem and understand what a replacement needs.", action: "Inspect an item", icon: ScanLine, detail: "Inspect an item", format: "PHOTO TO ANSWERS" },
  { id: "build" as const, label: "Build", title: "Turn inspiration into a plan", description: "Start with a reference. Get a practical list of components for your next project.", action: "Plan your build", icon: Layers3, detail: "Plan a build", format: "REFERENCE TO PLAN" },
];

export function ModeOverview({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return <section className="mode-overview" aria-labelledby="modes-title">
    <div className="section-heading"><div><span className="section-kicker">BUILT AROUND YOUR INTENT</span><h2 id="modes-title">A starting point for every need.</h2></div><p>Choose how you’d like to begin.</p></div>
    <div className="mode-overview-grid">{modes.map(({ id, label, title, description, action, icon: Icon, detail, format }, index) => <button type="button" key={id} className={`mode-feature mode-feature-${id}`} onClick={() => onSelect(id)} aria-label={action}>
      <span className="mode-feature-top"><span className="mode-feature-label"><Icon size={15} />{label}</span><span className="mode-feature-number">0{index + 1}</span></span>
      <span className="mode-feature-visual"><ModeArt mode={id} /><span>{format}</span></span>
      <span className="mode-feature-copy"><span className="mode-feature-title">{title}</span><span className="mode-feature-description">{description}</span></span>
      <span className="mode-feature-detail">{detail}<span className="mode-feature-arrow"><ArrowRight size={16} /></span></span>
    </button>)}</div>
  </section>;
}

export function SimpleJourney() {
  return <section className="simple-journey" aria-label="How SENTINEL works">
    <div className="journey-heading"><ShieldCheck size={20} /><span>Intelligence at every step.<br /><em>Control stays with you.</em></span></div>
    <ol><li><span>01</span><div><strong>Define your need</strong><p>A request, an item, or an idea.</p></div></li><li><span>02</span><div><strong>Evaluate your options</strong><p>Compare evidence and compatibility.</p></div></li><li><span>03</span><div><strong>Review before checkout</strong><p>You decide what happens next.</p></div></li></ol>
  </section>;
}
