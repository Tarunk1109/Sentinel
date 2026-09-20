"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createBrowserVoiceService, type BrowserVoiceService } from "@/lib/voice/browser-speech";
import type { VoiceCommand } from "@/lib/voice/commands";
import type { AutopilotPolicyView } from "@/lib/autopilot/service";
import type { AutopilotRun } from "@/lib/autopilot/run";

const example = "Keep Coke, Sprite and Fanta stocked every week and spend at most 70 Canadian dollars.";
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "This operation could not be completed.");
  return data;
}

export function AutopilotPanel({ onRequest }: { onRequest: (text: string) => void }) {
  const [text, setText] = useState("");
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [policies, setPolicies] = useState<AutopilotPolicyView[]>([]);
  const [runs, setRuns] = useState<Record<string, AutopilotRun>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const voice = useRef<BrowserVoiceService | null>(null);
  useEffect(() => {
    voice.current = createBrowserVoiceService();
    setSupported(voice.current.supported);
    let active = true;
    void api<{ autopilots: AutopilotPolicyView[] }>("/api/autopilot/policies").then(data => { if (active) setPolicies(data.autopilots); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; voice.current?.abort(); };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  }
  async function refresh() { setPolicies((await api<{ autopilots: AutopilotPolicyView[] }>("/api/autopilot/policies")).autopilots); }
  async function policyAction(id: string, action: "activate" | "pause" | "resume" | "evaluate") {
    const result = await api<{ run?: AutopilotRun }>(`/api/autopilot/policies/${id}/${action}`, action === "activate" || action === "resume" ? { confirm: true } : {});
    if (result.run) setRuns(current => ({ ...current, [id]: result.run! }));
    await refresh();
  }
  function listen() {
    setError("");
    if (listening) { voice.current?.stop(); return; }
    const result = voice.current?.start({ onStart: () => setListening(true), onEnd: () => setListening(false), onFinalTranscript: value => { setText(value); setCommand(null); }, onError: e => setError(e.message) }, { lang: "en-CA" });
    if (result && !result.ok) setError(result.error.message);
  }
  const draft = command?.type === "AUTOPILOT_CREATE" ? command.draft : null;
  return <section className="rounded-2xl border border-border bg-white p-5 sm:p-8" aria-label="Autopilot and Voice">
    <div className="flex items-center gap-3"><Workflow className="text-primary" /><h1 className="text-2xl font-semibold">Autopilot & Voice</h1></div>
    <p className="mt-2 text-muted-foreground">Describe a restock rule. Review its budget and items before activating it.</p>
    <p className="my-4 rounded-lg bg-secondary p-3 text-sm">Runtime demo: rules reset when the server restarts and may not persist across serverless instances. No background scheduler. Run now evaluates your policy; it does not purchase.</p>
    <label htmlFor="autopilot-transcript" className="text-sm font-medium">Your instruction or voice transcript</label>
    <Textarea id="autopilot-transcript" className="my-2" value={text} maxLength={1000} onChange={e => { setText(e.target.value); setCommand(null); }} placeholder={example} />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || listening || !text.trim()} onClick={() => void perform(async () => { setCommand(null); const data = await api<{ command: VoiceCommand }>("/api/voice/interpret", { transcript: text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setCommand(data.command); })}>Review instruction</Button>
      <Button variant="outline" disabled={!supported || busy} onClick={listen}>{listening ? <Square size={16} /> : <Mic size={16} />}{listening ? "Stop listening" : "Use voice"}</Button>
      <Button variant="ghost" disabled={busy || listening} onClick={() => { setText(example); setCommand(null); }}>Use café example</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{supported ? "SENTINEL stores no audio. Your browser may use its vendor’s speech service." : "Voice is unavailable in this browser. Type your instruction above."}</p>
    {error && <p role="alert" className="my-3 text-destructive">{error}</p>}
    <div aria-live="polite">
      {draft && <div className="my-5 rounded-xl border border-primary/30 p-5"><h2 className="font-semibold">Review your draft mandate</h2><p>{draft.goal}</p><p className="my-2">{draft.schedule.cadence} · {money(draft.budget.maximumPerWeekMinor)} weekly · {money(draft.budget.maximumPerRunMinor ?? draft.budget.maximumPerWeekMinor)} per run</p><p>{draft.items.map(item => `${item.quantity} × ${item.label}`).join(" · ")}</p><p className="my-2 text-sm text-muted-foreground">{draft.schedule.timeOfDay} · {draft.schedule.timezone}. Activation authorizes policy evaluation only; checkout remains separate.</p><Button disabled={busy} onClick={() => void perform(async () => { const data = await api<{ autopilot: AutopilotPolicyView }>("/api/autopilot/policies", draft); setCommand(null); await refresh(); await policyAction(data.autopilot.policy.id, "activate"); })}>Confirm mandate & activate</Button></div>}
      {(command?.type === "UNKNOWN" || command?.type === "NEEDS_CLARIFICATION") && <p className="my-4">{command.reason}</p>}
      {command?.type === "REQUEST" && <Button className="my-4" onClick={() => onRequest(command.text)}>Review in Request Mode</Button>}
      {command && (command.type === "AUTOPILOT_PAUSE" || command.type === "AUTOPILOT_RESUME" || command.type === "AUTOPILOT_RUN_NOW") && <Button className="my-4" disabled={busy} onClick={() => void perform(async () => { await policyAction(command.policy.id, command.type === "AUTOPILOT_PAUSE" ? "pause" : command.type === "AUTOPILOT_RESUME" ? "resume" : "evaluate"); setCommand(null); })}>{command.type === "AUTOPILOT_RESUME" ? "Confirm resume" : command.type === "AUTOPILOT_PAUSE" ? "Pause" : "Run now"}: {command.policy.name}</Button>}
    </div>
    <div className="mt-6 grid gap-4">{policies.map(({ policy, budget }) => <article key={policy.id} className="rounded-xl border p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{policy.name}</h2><span className="text-xs font-semibold">{policy.status}{policy.demo ? " · FIXTURE" : ""}</span></div><p className="my-2">{policy.goal}</p><p className="text-sm">{policy.items.map(item => item.label).join(" · ")}</p><p className="my-3 text-sm">{policy.schedule.cadence} · {money(budget.weeklyAuthorityMinor)} weekly · {money(budget.remainingMinor)} remaining · {money(budget.spentMinor)} spent</p><div className="flex flex-wrap gap-2">{policy.status === "ACTIVE" ? <><Button disabled={busy} onClick={() => void perform(() => policyAction(policy.id, "evaluate"))}>Run now</Button><Button variant="outline" disabled={busy} onClick={() => void perform(() => policyAction(policy.id, "pause"))}>Pause</Button></> : <Button disabled={busy} onClick={() => void perform(() => policyAction(policy.id, policy.status === "DRAFT" ? "activate" : "resume"))}>Confirm {policy.status === "DRAFT" ? "activation" : "resume"}</Button>}</div>{runs[policy.id] && <div role="status" className="mt-4 rounded-lg bg-secondary p-3 text-sm"><strong>{runs[policy.id].status.replaceAll("_", " ")}</strong>{runs[policy.id].events.map((event, index) => <p key={index}>{event.message}</p>)}<p className="mt-2 font-medium">No purchase executed.</p></div>}</article>)}</div>
  </section>;
}
