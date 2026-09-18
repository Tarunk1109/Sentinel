"use client";

import { Layers3, ScanLine, Sparkles } from "lucide-react";
import type { Mode } from "@/lib/domain/types";

export function ModeCards({ active, onSelect }: { active: Mode; onSelect: (mode: Mode) => void }) {
  return <nav className="mode-nav" aria-label="SENTINEL modes">
    <button className={active === "request" ? "active" : ""} aria-current={active === "request" ? "page" : undefined} onClick={() => onSelect("request")}><Sparkles size={14} />Request</button>
    <button className={active === "inspect" ? "active" : ""} aria-current={active === "inspect" ? "page" : undefined} onClick={() => onSelect("inspect")}><ScanLine size={14} />Inspect</button>
    <button onClick={() => onSelect("build")} aria-label="Build mode, upcoming"><Layers3 size={14} />Build<span>SOON</span></button>
  </nav>;
}
