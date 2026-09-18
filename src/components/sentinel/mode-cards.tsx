"use client";

import { Hammer, ScanLine, Sparkles } from "lucide-react";
import type { Mode } from "@/lib/domain/types";

export function ModeCards({ active, onSelect }: { active: Mode; onSelect: (mode: Mode) => void }) {
  return <nav className="mode-nav" aria-label="SENTINEL modes">
    <button className={active === "request" ? "active" : ""} aria-current={active === "request" ? "page" : undefined} onClick={() => onSelect("request")}><Sparkles size={14} />Request</button>
    <button className={active === "inspect" ? "active" : ""} aria-current={active === "inspect" ? "page" : undefined} onClick={() => onSelect("inspect")}><ScanLine size={14} />Inspect</button>
    <button className={active === "build" ? "active" : ""} aria-current={active === "build" ? "page" : undefined} onClick={() => onSelect("build")}><Hammer size={14} />Build</button>
  </nav>;
}
