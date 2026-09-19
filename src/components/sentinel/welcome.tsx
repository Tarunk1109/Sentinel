import { ArrowRight, Check, Command, Layers3, ScanLine, Search, Sparkles } from "lucide-react";
import type { Mode } from "@/lib/domain/types";

/** Decorative product silhouettes, never presented as a product result or a live quote. */
function DiscoveryIllustration() {
  return <div className="discovery-art" aria-hidden="true">
    <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
    <div className="art-spark spark-one"><Sparkles size={22} strokeWidth={1.3} /></div>
    <div className="art-spark spark-two"><span /></div>
    <div className="art-tile art-headphones">
      <svg viewBox="0 0 150 150" fill="none"><path d="M37 86V69a38 38 0 0 1 76 0v17" stroke="#534267" strokeWidth="12" strokeLinecap="round" /><path d="M37 72v-5a38 38 0 0 1 76 0v5" stroke="#C6B2DB" strokeWidth="6" strokeLinecap="round" /><rect x="26" y="76" width="25" height="43" rx="11" fill="#9B7FB3" /><rect x="99" y="76" width="25" height="43" rx="11" fill="#9B7FB3" /><rect x="41" y="77" width="10" height="41" rx="5" fill="#E7DDED" /><rect x="99" y="77" width="10" height="41" rx="5" fill="#E7DDED" /></svg>
    </div>
    <div className="art-tile art-monitor">
      <svg viewBox="0 0 230 190" fill="none"><path d="M104 135h24l7 27H97l7-27Z" fill="#9DADAA" /><rect x="74" y="159" width="83" height="8" rx="4" fill="#819893" /><rect x="20" y="28" width="190" height="119" rx="12" fill="#57766C" /><rect x="26" y="34" width="178" height="104" rx="7" fill="#D2E3D9" /><path d="M26 118c29-50 57-59 84-25 29 36 47-15 94-18v56a7 7 0 0 1-7 7H33a7 7 0 0 1-7-7v-13Z" fill="#A0C3B2" /><path d="M26 135c37-26 59-13 98-29 38-16 55 13 80-1v26a7 7 0 0 1-7 7H33a7 7 0 0 1-7-3Z" fill="#729E89" /><circle cx="150" cy="67" r="17" fill="#F4F1D8" /></svg>
      <span className="art-check"><Check size={15} strokeWidth={2.5} /></span>
    </div>
    <div className="art-tile art-lamp">
      <svg viewBox="0 0 130 145" fill="none"><path d="M69 54v64" stroke="#BD8169" strokeWidth="6" /><path d="M45 119h48" stroke="#BD8169" strokeWidth="8" strokeLinecap="round" /><path d="M49 22h38l19 43H30l19-43Z" fill="#E3A38A" /><path d="M31 65h74" stroke="#BC7A64" strokeWidth="4" strokeLinecap="round" /><path d="M54 27h5L48 60H39l15-33Z" fill="#F2C6AE" /></svg>
    </div>
    <div className="art-search"><Search size={16} /><span>A little help finding your thing.</span><span className="art-search-arrow"><ArrowRight size={14} /></span></div>
    <span className="art-dot dot-one" /><span className="art-dot dot-two" />
  </div>;
}

export function WelcomeHero() {
  return <section className="welcome-hero" aria-labelledby="hero-title">
    <div className="welcome-copy">
      <div className="eyebrow"><span className="eyebrow-star"><Sparkles size={13} /></span> A LITTLE HELP. A BETTER CHOICE.</div>
      <h1 id="hero-title">Less searching.<br /><span>More finding.</span></h1>
      <p>Your next right thing, made simple. Tell SENTINEL what you need—we’ll find the options and help you choose.</p>
      <div className="welcome-promise"><span><Check size={13} />Your budget</span><span><Check size={13} />Real products</span><span><Check size={13} />Your decision</span></div>
    </div>
    <DiscoveryIllustration />
  </section>;
}

const modes = [
  { id: "request" as const, label: "Request", title: "Something in mind?", description: "Tell us what you need. Get a shortlist that fits your budget and preferences.", action: "Start with a request", icon: Search, detail: "A monitor for my MacBook…" },
  { id: "inspect" as const, label: "Inspect", title: "Something needs a fix?", description: "Take a photo. Understand the problem and find the right replacement.", action: "Inspect an item", icon: ScanLine, detail: "A photo. A clearer next step." },
  { id: "build" as const, label: "Build", title: "Something to bring to life?", description: "Share your inspiration. Turn a reference photo into a practical shopping plan.", action: "Plan your build", icon: Layers3, detail: "From inspiration to ingredients." },
];

export function ModeOverview({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return <section className="mode-overview" aria-labelledby="modes-title">
    <div className="section-heading"><div><span className="section-kicker">MADE FOR YOUR EVERYDAY</span><h2 id="modes-title">Three ways to get there.</h2></div><p>A need, a problem, or a little inspiration.</p></div>
    <div className="mode-overview-grid">{modes.map(({ id, label, title, description, action, icon: Icon, detail }) => <button type="button" key={id} className={`mode-feature mode-feature-${id}`} onClick={() => onSelect(id)} aria-label={action}>
      <div className="mode-feature-top"><span className="mode-feature-icon"><Icon size={23} strokeWidth={1.5} /></span><span className="mode-feature-label">{label}</span><ArrowRight className="mode-feature-arrow" size={18} /></div>
      <h3>{title}</h3><p>{description}</p><span className="mode-feature-detail"><Command size={12} />{detail}</span>
    </button>)}</div>
  </section>;
}

export function SimpleJourney() {
  return <section className="simple-journey" aria-label="How SENTINEL works">
    <div className="journey-heading"><Sparkles size={18} /><span>A thoughtful little process.</span></div>
    <ol><li><span>01</span><div><strong>Share what you need</strong><p>A sentence or a photo is all it takes.</p></div></li><li><span>02</span><div><strong>Explore your options</strong><p>See the matches and what needs checking.</p></div></li><li><span>03</span><div><strong>You make the call</strong><p>Review every detail before checkout.</p></div></li></ol>
  </section>;
}
