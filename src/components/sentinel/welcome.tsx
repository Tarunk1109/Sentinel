import { ArrowRight, Check, Layers3, ScanLine, Search, Sparkles } from "lucide-react";
import type { Mode } from "@/lib/domain/types";
import { ModeArt } from "./mode-art";

export function WelcomeHero() {
  return <section className="welcome-hero" aria-labelledby="hero-title">
    <div className="welcome-copy">
      <div className="eyebrow"><span className="eyebrow-star"><Sparkles size={13} /></span> YOUR PERSONAL SHOPPING AGENT</div>
      <h1 id="hero-title">Less searching.<br /><span>More finding.</span></h1>
      <p>For the things you need. And the ideas you can’t stop thinking about. Find your next right thing with a little intelligence on your side.</p>
      <div className="welcome-promise"><span><Check size={13} />Your budget</span><span><Check size={13} />Real products</span><span><Check size={13} />Your decision</span></div>
      <div className="welcome-signature" aria-hidden="true"><span className="signature-line" /><Sparkles size={17} strokeWidth={1.3} /><span>Thoughtfully found.</span></div>
    </div>
  </section>;
}

const modes = [
  { id: "request" as const, label: "Request", title: "Find your next favorite.", description: "A need, a budget, a few details. We’ll turn them into a shortlist worth exploring.", action: "Start with a request", icon: Search, detail: "Tell us what you need" },
  { id: "inspect" as const, label: "Inspect", title: "Make it work again.", description: "Show us what needs attention. Understand the problem and find what fits.", action: "Inspect an item", icon: ScanLine, detail: "Start with a photo" },
  { id: "build" as const, label: "Build", title: "Make that idea happen.", description: "Bring a reference you love. Get a practical plan for bringing it to life.", action: "Plan your build", icon: Layers3, detail: "Bring your inspiration" },
];

export function ModeOverview({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return <section className="mode-overview" aria-labelledby="modes-title">
    <div className="section-heading"><div><span className="section-kicker">ONE ASSISTANT. A WORLD OF POSSIBILITIES.</span><h2 id="modes-title">Where would you like to start?</h2></div><p>From “I need” to “that’s the one.”</p></div>
    <div className="mode-overview-grid">{modes.map(({ id, label, title, description, action, icon: Icon, detail }, index) => <button type="button" key={id} className={`mode-feature mode-feature-${id}`} onClick={() => onSelect(id)} aria-label={action}>
      <span className="mode-feature-top"><span className="mode-feature-label"><Icon size={14} />{label}</span><span className="mode-feature-number">0{index + 1}</span></span>
      <ModeArt mode={id} />
      <span className="mode-feature-copy"><span className="mode-feature-title">{title}</span><span className="mode-feature-description">{description}</span></span>
      <span className="mode-feature-detail">{detail}<span className="mode-feature-arrow"><ArrowRight size={16} /></span></span>
    </button>)}</div>
  </section>;
}

export function SimpleJourney() {
  return <section className="simple-journey" aria-label="How SENTINEL works">
    <div className="journey-heading"><Sparkles size={18} /><span>Good choices.<br /><em>Less guesswork.</em></span></div>
    <ol><li><span>01</span><div><strong>Share what you need</strong><p>A sentence or a photo is all it takes.</p></div></li><li><span>02</span><div><strong>See the whole picture</strong><p>Real options. Clear evidence. Honest unknowns.</p></div></li><li><span>03</span><div><strong>Make it your choice</strong><p>Review every detail. You’re always in control.</p></div></li></ol>
  </section>;
}
