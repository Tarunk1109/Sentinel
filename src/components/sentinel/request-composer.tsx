"use client";

import { ArrowRight, CornerDownLeft, Keyboard, LoaderCircle, LockKeyhole, Monitor, Sparkles, Usb, X } from "lucide-react";
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
  const exampleIcons = [Monitor, Keyboard, Usb];
  return <section id="request" className="composer request-surface input-surface" aria-labelledby="request-heading">
    <form onSubmit={event => { event.preventDefault(); if (valid && !isRunning && !unavailable) onSubmit(); }}>
      <div className={`prompt-shell ${isRunning ? "working" : ""}`}>
        <div className="composer-heading"><div><span className="input-step-label">NEW REQUEST</span><label htmlFor="mission-prompt" id="request-heading">What are you looking for?</label></div><span className="input-region">Canada · CAD</span></div>
        <Textarea ref={inputRef} id="mission-prompt" name="prompt" className="mission-textarea" value={prompt} maxLength={1000} minLength={3} required disabled={isRunning} aria-describedby={error ? "prompt-help prompt-error" : "prompt-help"} aria-invalid={Boolean(error)} onChange={event => onPromptChange(event.target.value)} placeholder="I need a portable monitor under C$200 for my MacBook…" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (valid && !isRunning && !unavailable) onSubmit(); } }} />
        <div className="prompt-toolbar"><span id="prompt-help"><Sparkles size={14} />Include a budget, must-haves, and compatibility needs.</span><div><span className="keyboard-hint">⌘ / Ctrl<CornerDownLeft size={12} /></span>{isRunning ? <><Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel request"><X /></Button><Button disabled className="launch-button"><LoaderCircle className="animate-spin motion-reduce:animate-none" />Finding products</Button></> : <Button type="submit" disabled={!valid || unavailable} className="launch-button">Find products<ArrowRight /></Button>}</div></div>
        <div className="example-row"><span>Try an example</span><div>{exampleRequests.map((example, index) => { const Icon = exampleIcons[index]; return <button type="button" disabled={isRunning} key={example.label} onClick={() => { onPromptChange(example.prompt); inputRef.current?.focus(); }}><Icon size={14} aria-hidden="true" />{example.label}<ArrowRight size={12} /></button>; })}</div></div>
      </div>
      {error && <p className="error-message" role="alert" id="prompt-error">{error}</p>}
      {unavailable && <p className="configuration-note">{status?.aiEnabled === false ? "AI requests are disabled in the server configuration." : "A server API credential is missing. Open integration status for details."}</p>}
    </form>
    <p className="composer-assurance"><LockKeyhole size={13} />Search starts only when you submit. Your approval comes first.</p>
  </section>;
}
