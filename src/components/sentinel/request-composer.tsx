"use client";

import { ArrowRight, CornerDownLeft, LoaderCircle, LockKeyhole, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RefObject } from "react";
import type { RuntimeStatus } from "@/lib/domain/commerce";

export const exampleRequests = [
  { label: "Portable monitor", prompt: "I need a portable monitor under C$200 for my MacBook, delivered in Canada." },
  { label: "Mechanical keyboard", prompt: "I need a mechanical keyboard under $150 CAD" },
  { label: "USB-C hub", prompt: "I need a USB-C hub under C$80 for my MacBook with HDMI, delivered in Canada." },
];

export function RequestComposer({ prompt, onPromptChange, onSubmit, isRunning, onCancel, error, inputRef, status }: {
  prompt: string; onPromptChange: (value: string) => void; onSubmit: () => void; isRunning: boolean;
  onCancel: () => void; error: string | null; inputRef: RefObject<HTMLTextAreaElement | null>; status: RuntimeStatus | null;
}) {
  const valid = prompt.trim().length >= 3 && prompt.length <= 1000;
  const unavailable = status !== null && (!status.aiEnabled || status.aiCredential === "missing" || status.agnicCredential === "missing");
  return <section id="request" className="composer" aria-labelledby="request-heading">
    <form onSubmit={event => { event.preventDefault(); if (valid && !isRunning && !unavailable) onSubmit(); }}>
      <div className={`prompt-shell ${isRunning ? "working" : ""}`}>
        <div className="composer-heading"><label htmlFor="mission-prompt" id="request-heading"><Sparkles size={15} />Your request</label><span>CANADA · CAD DEFAULT</span></div>
        <Textarea ref={inputRef} id="mission-prompt" name="prompt" className="mission-textarea" value={prompt} maxLength={1000} minLength={3} required disabled={isRunning} aria-describedby={error ? "prompt-help prompt-error" : "prompt-help"} aria-invalid={Boolean(error)} onChange={event => onPromptChange(event.target.value)} placeholder="I need a portable monitor under C$200 for my MacBook…" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (valid && !isRunning && !unavailable) onSubmit(); } }} />
        <div className="prompt-toolbar"><span id="prompt-help">Add a budget, device, or anything that matters.</span><div><span className="keyboard-hint">⌘ / Ctrl<CornerDownLeft size={12} /></span>{isRunning ? <><Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel request"><X /></Button><Button disabled className="launch-button"><LoaderCircle className="animate-spin motion-reduce:animate-none" />Finding your match</Button></> : <Button type="submit" disabled={!valid || unavailable} className="launch-button">Find my match<ArrowRight /></Button>}</div></div>
      </div>
      {error && <p className="error-message" role="alert" id="prompt-error">{error}</p>}
      {unavailable && <p className="configuration-note">{status?.aiEnabled === false ? "AI requests are disabled in the server configuration." : "A server API credential is missing. Open integration status for details."}</p>}
      <div className="example-row"><span>Try asking for</span><div>{exampleRequests.map(example => <button type="button" disabled={isRunning} key={example.label} onClick={() => { onPromptChange(example.prompt); inputRef.current?.focus(); }}>{example.label}<ArrowRight size={11} /></button>)}</div></div>
    </form>
    <p className="composer-assurance"><LockKeyhole size={12} />Nothing runs until you submit. No real purchases.</p>
  </section>;
}
