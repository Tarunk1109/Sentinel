"use client";

import { ArrowUpRight, Layers3, ScanLine, Search } from "lucide-react";
import type { Mode } from "@/lib/domain/types";

const modes = [
  { id: "request", label: "Request", description: "Discover products", icon: Search },
  { id: "inspect", label: "Inspect", description: "Find a replacement", icon: ScanLine },
  { id: "build", label: "Build", description: "Plan your project", icon: Layers3 },
] as const;

export function ModeCards({ active, onSelect }: { active: Mode; onSelect: (mode: Mode) => void }) {
  return <nav className="mode-nav" aria-label="SENTINEL modes">
    {modes.map(({ id, label, description, icon: Icon }) => <button key={id} type="button" className={active === id ? "active" : ""} aria-label={label} aria-current={active === id ? "page" : undefined} onClick={() => onSelect(id)}>
      <Icon size={18} aria-hidden="true" /><span className="mode-nav-copy"><strong>{label}</strong><span>{description}</span></span><ArrowUpRight className="mode-nav-arrow" size={14} aria-hidden="true" />
    </button>)}
  </nav>;
}
