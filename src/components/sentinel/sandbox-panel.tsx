"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCheckout } from "@/hooks/use-checkout";
import type { CheckoutSession, SandboxInfo } from "@/lib/domain/checkout";
import { VERIFIED_SANDBOX_ORDER_ID } from "@/lib/domain/sandbox";
import type { ActivityStep, ProductCandidate } from "@/lib/domain/commerce";
import { displayPrice } from "./commerce-display";
import { CheckoutReview } from "./approval-panel";

function SandboxCheckout({ product, onStep }: { product: ProductCandidate; onStep: (step: ActivityStep) => void }) {
  const state = useCheckout({ mode: "sandbox", productId: product.id }, onStep);
  // A selected product starts one non-purchase server workflow. This intentionally
  // runs only for the keyed product component, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void state.autoQuote(); }, []);
  return <CheckoutReview product={product} quantity={1} state={state} />;
}

function VerifiedSandboxOrder({ product }: { product: ProductCandidate }) {
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/sandbox/order-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, orderId: VERIFIED_SANDBOX_ORDER_ID }),
      signal: controller.signal,
      cache: "no-store",
    }).then(async response => {
      const value = await response.json().catch(() => null) as { checkout?: CheckoutSession } | null;
      if (response.ok && value?.checkout?.stage === "succeeded") setCheckout(value.checkout);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [product.id]);

  if (!checkout?.order?.chargedAmount) return null;
  return <div className="rounded-xl border border-success/25 bg-success/5 p-4 text-sm text-success" role="status">
    <p className="font-semibold">Verified sandbox purchase completed</p>
    <p className="mt-1 leading-relaxed">Agnic confirms the SENTINEL demo order succeeded: {displayPrice(checkout.order.chargedAmount)} test charge. No real money moved and no real goods will ship.</p>
  </div>;
}

export function SandboxPanel({ onStep }: { onStep: (step: ActivityStep) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sandbox, setSandbox] = useState<SandboxInfo | null>(null);
  const [selected, setSelected] = useState<ProductCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  async function loadCatalog() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request;
    const timeout = setTimeout(() => request.abort(), 35_000);
    setBusy(true); setError(null); setSelected(null); setSandbox(null);
    try {
      const response = await fetch("/api/sandbox/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: request.signal });
      const data: { sandbox?: SandboxInfo; error?: { message?: string } } = await response.json();
      if (!response.ok || !data.sandbox) throw new Error(data.error?.message ?? "The official test store could not be verified. No checkout was started.");
      if (controller.current === request) setSandbox(data.sandbox);
    } catch (cause) {
      if (controller.current === request) setError(request.signal.aborted ? "Test store verification timed out. Try loading the store again." : cause instanceof Error ? cause.message : "Test store verification failed. No checkout was started.");
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  }

  return <div className="border-t border-border bg-muted/25">
    <button type="button" className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left focus-visible:outline-2 focus-visible:outline-primary sm:px-7" aria-expanded={expanded} aria-controls="sandbox-checkout-content" onClick={() => setExpanded(value => !value)}><span className="flex items-center gap-3"><FlaskConical className="size-5 shrink-0 text-primary" /><span><span className="block text-sm font-semibold">Demo sandbox checkout</span><span className="mt-1 block text-xs text-muted-foreground">Official test store · No real money or goods</span></span></span><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /></button>
    <div id="sandbox-checkout-content" hidden={!expanded} className="space-y-5 px-5 pb-6 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-widest text-primary">SANDBOX CHECKOUT</p><p className="mt-1 text-sm text-muted-foreground">The server verifies Agnic’s test status before allowing checkout.</p></div>{!selected && <Button type="button" variant="outline" disabled={busy} onClick={() => void loadCatalog()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{busy ? "Verifying official test store…" : sandbox ? "Refresh Test Store" : "Load Official Test Store"}</Button>}</div>
      {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">{error}</p>}
      {sandbox && <div role="status" className={`rounded-lg border p-4 text-sm leading-relaxed ${sandbox.blocked ? "border-warning/25 bg-warning/5 text-warning" : "border-success/20 bg-success/5 text-success"}`}><p className="font-semibold">{sandbox.blocked ? "Sandbox checkout blocked" : `${sandbox.merchant.name} · Sandbox identity verified`}</p><p className="mt-1">{sandbox.message}</p></div>}
      {sandbox && !sandbox.blocked && !selected && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sandbox.products.map(product => <button type="button" key={product.id} className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={product.availability === "unavailable"} onClick={() => setSelected(product)}><span className="text-xs font-medium text-primary">TEST PRODUCT</span><span className="mt-2 block text-sm font-semibold leading-relaxed">{product.name}</span><span className="mt-3 flex items-center justify-between gap-3 text-sm"><span>{displayPrice(product.price)}</span><span className="text-primary">Select →</span></span></button>)}</div>}
      {sandbox && !sandbox.blocked && !sandbox.products.length && <p className="text-sm text-muted-foreground">The verified test store returned no available products. Refresh the store later.</p>}
      {selected && <><VerifiedSandboxOrder product={selected} /><SandboxCheckout key={selected.id} product={selected} onStep={onStep} /></>}
    </div>
  </div>;
}
