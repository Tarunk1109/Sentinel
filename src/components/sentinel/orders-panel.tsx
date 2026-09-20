"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock, LoaderCircle, Receipt, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProviderOrder } from "@/lib/domain/checkout";
import { displayPrice, publicUrl } from "./commerce-display";

const succeeded = (order: ProviderOrder) => order.status === "succeeded";
const inFlight = (order: ProviderOrder) => ["pending", "dispatched", "approval_required"].includes(order.status);

function statusLabel(order: ProviderOrder): string {
  if (succeeded(order)) return "Succeeded";
  if (inFlight(order)) return "Processing";
  return order.status.replace(/_/g, " ").replace(/^./, character => character.toUpperCase());
}

function formatTime(value: string | null): string {
  if (!value) return "Time not reported";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time not reported" : parsed.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function OrderRow({ order }: { order: ProviderOrder }) {
  const good = succeeded(order);
  const tone = good ? "border-success/30 bg-success/5" : inFlight(order) ? "border-border bg-muted/30" : "border-warning/25 bg-warning/5";
  const Icon = good ? CheckCircle2 : inFlight(order) ? Clock : CircleAlert;
  const link = publicUrl(order.orderUrl);
  return <li className={`rounded-xl border p-4 ${tone}`}>
    <div className="flex flex-wrap items-center gap-2">
      <Icon className={`size-4 shrink-0 ${good ? "text-success" : inFlight(order) ? "text-muted-foreground" : "text-warning"}`} aria-hidden="true" />
      <span className="text-sm font-semibold">{statusLabel(order)}</span>
    </div>
    <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      <div className="flex justify-between gap-3 sm:block">
        <dt className="text-muted-foreground sm:text-xs">Actual charge</dt>
        <dd className={`sm:mt-1 sm:text-base sm:font-semibold ${good ? "text-success" : ""}`}>{order.chargedAmount ? displayPrice(order.chargedAmount) : "Not charged"}</dd>
      </div>
      <div className="flex justify-between gap-3 sm:block">
        <dt className="text-muted-foreground sm:text-xs">Approved maximum</dt>
        <dd className="sm:mt-1 sm:text-base sm:font-semibold">{displayPrice(order.approvedAmount)}</dd>
      </div>
      <div className="flex justify-between gap-3 sm:block">
        <dt className="text-muted-foreground sm:text-xs">Placed</dt>
        <dd className="sm:mt-1 sm:font-medium"><time dateTime={order.timestamp ?? undefined}>{formatTime(order.timestamp)}</time></dd>
      </div>
    </dl>
    <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{order.id}</p>
    {order.errorCode && <p className="mt-2 text-xs text-warning">Agnic reported {order.errorCode.replace(/_/g, " ").toLowerCase()}. No charge was settled.</p>}
    {link && <a className="mt-2 inline-block text-xs font-medium text-primary underline underline-offset-4" href={link} target="_blank" rel="noopener noreferrer">Open provider record ↗</a>}
  </li>;
}

export function OrdersPanel() {
  const [orders, setOrders] = useState<ProviderOrder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/sandbox/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal });
      const data = await response.json().catch(() => null) as { orders?: ProviderOrder[]; error?: { message?: string } } | null;
      if (!response.ok || !data?.orders) throw new Error(data?.error?.message ?? "Agnic did not return the order history.");
      setOrders(data.orders);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "The order history could not be read.");
    } finally { if (!signal?.aborted) setBusy(false); }
  }, []);

  // Reading history is a plain GET-shaped call that never submits an order, so it starts
  // on mount. The read is queued rather than run inline to keep its first state change
  // out of the effect body.
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [load]);

  const settled = orders?.filter(succeeded) ?? [];
  const charged = settled.reduce((total, order) => total + (order.chargedAmount?.amountMinor ?? 0), 0);

  return <section className="orders-stage" aria-labelledby="orders-title">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold tracking-widest text-primary">PROVIDER RECORD</p>
        <h2 id="orders-title" className="mt-2 text-2xl font-semibold tracking-tight">Sandbox order history</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every row is read live from Agnic, not from this browser. SENTINEL only ever reports an order as succeeded
          when the provider does. No real money moved and no real goods will ship.
        </p>
      </div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {busy ? "Reading Agnic…" : "Refresh"}
      </Button>
    </div>

    {orders && orders.length > 0 && <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {[
        { label: "Orders on record", value: String(orders.length), icon: Receipt },
        { label: "Completed test orders", value: String(settled.length), icon: CheckCircle2 },
        { label: "Total test charges", value: displayPrice(charged > 0 ? { amountMinor: charged, currency: settled[0]?.chargedAmount?.currency ?? "CAD" } : null), icon: ShieldCheck },
      ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-border bg-card p-4">
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</span>
        <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      </div>)}
    </div>}

    {error && <p role="alert" className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">{error}</p>}
    {busy && !orders && <p className="mt-6 text-sm text-muted-foreground">Reading the order history from Agnic…</p>}
    {orders && orders.length === 0 && <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Agnic has no orders on this account yet. Complete a sandbox checkout and it will appear here.</p>}
    {orders && orders.length > 0 && <ol className="mt-4 space-y-3">{orders.map(order => <OrderRow key={order.id} order={order} />)}</ol>}
  </section>;
}
