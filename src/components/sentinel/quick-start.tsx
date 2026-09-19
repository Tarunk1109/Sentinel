"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Command, Hammer, Keyboard, Monitor, ScanLine, Search, Sparkles, Usb } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { exampleRequests } from "@/components/sentinel/request-composer";
import type { Mode } from "@/lib/domain/types";

const modeActions = [
  { mode: "request", title: "Describe what you need", description: "Find a product with a few words.", label: "Request", icon: Sparkles },
  { mode: "inspect", title: "Find a replacement", description: "Start with a photo of your item.", label: "Inspect", icon: ScanLine },
  { mode: "build", title: "Bring an idea to life", description: "Turn inspiration into a shopping list.", label: "Build", icon: Hammer },
] satisfies { mode: Mode; title: string; description: string; label: string; icon: typeof Sparkles }[];

const exampleIcons = [Monitor, Keyboard, Usb];

export function QuickStart({ onChooseMode, onUseExample, disabled = false }: {
  onChooseMode: (mode: Mode) => void;
  onUseExample: (prompt: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const handingOffFocus = useRef(false);
  const hasChosen = useRef(false);

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    if (next) {
      setQuery("");
      hasChosen.current = false;
      handingOffFocus.current = false;
    }
    setOpen(next);
  }

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (!disabled && !event.repeat && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        hasChosen.current = false;
        handingOffFocus.current = false;
        setOpen(current => !current);
      }
    }
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [disabled]);

  const normalizedQuery = query.trim().toLowerCase();
  const modes = modeActions.filter(action => `${action.label} ${action.title} ${action.description}`.toLowerCase().includes(normalizedQuery));
  const examples = exampleRequests.filter(example => `${example.label} ${example.prompt}`.toLowerCase().includes(normalizedQuery));

  function choose(action: () => void, focusMovesToInput = false) {
    if (disabled || hasChosen.current) return;
    hasChosen.current = true;
    handingOffFocus.current = focusMovesToInput;
    setOpen(false);
    action();
  }

  return <Dialog open={open && !disabled} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <button type="button" className="quick-start-trigger" disabled={disabled} aria-label="Quick start" aria-keyshortcuts="Meta+K Control+K">
        <Command size={14} aria-hidden="true" /><span>Quick start</span><kbd>⌘ K</kbd>
      </button>
    </DialogTrigger>
    <DialogContent className="quick-start-dialog" onCloseAutoFocus={event => {
      // The parent focuses the composer after populating an example.
      if (handingOffFocus.current) event.preventDefault();
      handingOffFocus.current = false;
    }}>
      <div className="quick-start-heading">
        <span className="quick-start-eyebrow">A GOOD PLACE TO START</span>
        <DialogTitle>What’s on your mind?</DialogTitle>
        <DialogDescription>Choose a direction. Make it yours from there.</DialogDescription>
      </div>
      <div className="quick-start-search">
        <Search size={19} aria-hidden="true" />
        <input aria-label="Search modes and examples" placeholder="Search an idea, item, or mode…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (modes[0]) choose(() => onChooseMode(modes[0].mode));
          else if (examples[0]) choose(() => onUseExample(examples[0].prompt), true);
        }} />
        <kbd aria-hidden="true">↵</kbd>
      </div>
      <div className="quick-start-options">
        {modes.length > 0 && <section aria-label="Ways to start">
          <h3>MAKE YOUR NEXT MOVE</h3>
          {modes.map(action => <button type="button" className={`quick-start-option quick-start-mode-${action.mode}`} key={action.mode} onClick={() => choose(() => onChooseMode(action.mode))}>
            <span className="quick-start-option-icon"><action.icon size={19} aria-hidden="true" /></span>
            <span className="quick-start-option-copy"><strong>{action.title}</strong><span>{action.description}</span></span>
            <span className="quick-start-mode-label">{action.label}</span><ArrowRight className="quick-start-option-arrow" size={16} aria-hidden="true" />
          </button>)}
        </section>}
        {examples.length > 0 && <section aria-label="Example requests">
          <h3>A LITTLE INSPIRATION</h3>
          {examples.map(example => {
            const Icon = exampleIcons[exampleRequests.indexOf(example)];
            return <button type="button" className="quick-start-option quick-start-example" key={example.label} onClick={() => choose(() => onUseExample(example.prompt), true)}>
              <span className="quick-start-option-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="quick-start-option-copy"><strong>{example.label}</strong><span>Try an example request</span></span>
              <ArrowRight className="quick-start-option-arrow" size={16} aria-hidden="true" />
            </button>;
          })}
        </section>}
        {modes.length === 0 && examples.length === 0 && <div className="quick-start-empty" role="status"><Search size={24} aria-hidden="true" /><strong>No matches just yet</strong><p>Try “monitor”, “photo”, or “build”.</p></div>}
      </div>
      <div className="quick-start-footer"><span>Examples fill your request. You choose when to search.</span><span><kbd>esc</kbd> to close</span></div>
    </DialogContent>
  </Dialog>;
}
