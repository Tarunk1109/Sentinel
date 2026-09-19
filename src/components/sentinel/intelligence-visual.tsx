import { Layers3, ScanLine, Search, ShieldCheck, Sparkles } from "lucide-react";

/** Ambient brand illustration, not a live agent status or commerce result. */
export function IntelligenceVisual() {
  return <div className="intelligence-visual" aria-hidden="true">
    <svg className="intelligence-links" viewBox="0 0 480 170" fill="none">
      <path d="M71 43C150 43 141 84 240 84S336 38 400 38M75 139C159 139 146 84 240 84S337 139 405 139" />
      <path className="intelligence-signal decorative-motion" d="M71 43C150 43 141 84 240 84S336 38 400 38M75 139C159 139 146 84 240 84S337 139 405 139" />
    </svg>
    <div className="intelligence-orbit decorative-motion"><span /><span /></div>
    <div className="intelligence-core"><div className="intelligence-core-material decorative-motion" /><span className="intelligence-core-mark"><Sparkles size={30} strokeWidth={1.4} /></span></div>
    <span className="intelligence-chip chip-request decorative-motion"><Search size={14} />Understand</span>
    <span className="intelligence-chip chip-inspect decorative-motion"><ScanLine size={14} />Compare</span>
    <span className="intelligence-chip chip-build decorative-motion"><Layers3 size={14} />Plan</span>
    <span className="intelligence-chip chip-approval decorative-motion"><ShieldCheck size={14} />You decide</span>
  </div>;
}
