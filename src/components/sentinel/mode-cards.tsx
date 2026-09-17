"use client";

import { Layers3, ScanLine, Sparkles } from "lucide-react";
import type { Mode } from "@/lib/domain/types";

export function ModeCards({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return <nav className="mode-nav" aria-label="SENTINEL modes">
    <button className="active" aria-current="page" onClick={() => onSelect("request")}><Sparkles size={14} />Request</button>
    <button onClick={() => onSelect("inspect")} aria-label="Inspect mode, upcoming"><ScanLine size={14} />Inspect<span>SOON</span></button>
    <button onClick={() => onSelect("build")} aria-label="Build mode, upcoming"><Layers3 size={14} />Build<span>SOON</span></button>
  </nav>;
}
