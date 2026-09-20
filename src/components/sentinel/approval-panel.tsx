"use client";

import { isOfficialShopifySandbox, isSandboxMerchant } from "@/lib/domain/sandbox";
import { useState } from "react";
import { Check, ExternalLink, FlaskConical, LoaderCircle, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCheckout } from "@/hooks/use-checkout";
import type { CheckoutSession } from "@/lib/domain/checkout";
import type { ActivityStep, ProductCandidate, RequestMission } from "@/lib/domain/commerce";
import { compatibilityLabels, displayPrice, publicUrl } from "./commerce-display";
import { SandboxPanel } from "./sandbox-panel";

type CheckoutController = ReturnType<typeof useCheckout>;

export function PurchaseProof({ checkout }: { checkout: CheckoutSession }) {
  const order = checkout.order;
  if (checkout.mode !== "SANDBOX_COMMERCE_MODE" || checkout.stage !== "succeeded" || order?.status !== "succeeded" || (!order.test && !isOfficialShopifySandbox(checkout.merchant))) return null;
  const evidenceUrl = publicUrl(order.orderUrl);
  return <section aria-labelledby="purchase-proof-title" className="rounded-xl border border-success/25 bg-success/5 p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-success">PURCHASE PROOF</p><h3 id="purchase-proof-title" className="mt-3 flex items-center gap-2 text-xl font-semibold"><Check className="size-6 text-success" />Test order completed</h3></div><span className="rounded-full border border-success/25 px-3 py-1 text-xs font-semibold text-success">SANDBOX</span></div>
    <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Product</dt><dd className="mt-1 font-medium">{checkout.product.name}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Merchant</dt><dd className="mt-1">{checkout.merchant?.name ?? checkout.product.merchantName}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Actual test charge</dt><dd className="mt-1 font-semibold">{order.chargedAmount ? displayPrice(order.chargedAmount) : "Not returned by Agnic"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Approved maximum</dt><dd className="mt-1">{displayPrice(order.approvedAmount)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Order ID</dt><dd className="mt-1 break-all font-mono text-xs">{order.id}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Provider timestamp</dt><dd className="mt-1">{order.timestamp ?? "Not returned by Agnic"}</dd></div>
    </dl>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-success/20 pt-4"><p className="text-xs font-semibold text-success">AGNIC · VERIFIED TEST CHECKOUT · NO REAL MONEY MOVED</p>{evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-4">View checkout evidence<ExternalLink className="size-3.5" /></a>}</div>
  </section>;
}

export function CheckoutReview({ product, quantity, state, onClear }: { product: ProductCandidate; quantity: number; state: CheckoutController; onClear?: () => void }) {
  const { checkout, busy, error } = state;
  const [fulfillment, setFulfillment] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const preview = checkout?.preview;
  const sandbox = checkout?.mode === "SANDBOX_COMMERCE_MODE";
  const selectedFulfillment = fulfillment || preview?.selectedFulfillmentId || "";
  const selectionChanged = Boolean(fulfillment && fulfillment !== preview?.selectedFulfillmentId);
  const hasTotal = preview?.status === "quoted" && !preview.requiresFulfillment && !selectionChanged;
  const inFlight = checkout && ["dispatching", "processing", "exploring"].includes(checkout.stage);
  const orderStarted = Boolean(checkout?.approvedAt || checkout?.order || checkout?.stage === "unknown");
  const needsMerchant = checkout ? !checkout.merchant : product.onboardRequired;
  const readyForConsent = Boolean(sandbox && checkout?.canConfirm && isSandboxMerchant(checkout.merchant) && hasTotal && !preview?.budgetViolation && !busy && !orderStarted);
  const setupUrl = publicUrl(checkout?.setup.cardSetupUrl ?? null);
  const guideUrl = publicUrl(checkout?.setup.guideUrl ?? null);
  const profileUrl = publicUrl(checkout?.setup.profileSetupUrl ?? null);
  const evidenceUrl = publicUrl(checkout?.order?.orderUrl ?? null);
  const settled = Boolean(checkout?.order?.chargedAmount && checkout.stage === "succeeded");

  return <div className="space-y-5">
    <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr]">
      <div>
        <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold tracking-widest text-muted-foreground">SELECTED PRODUCT</p><h3 className="mt-2 text-lg font-semibold leading-snug">{product.name}</h3><p className="mt-2 text-sm text-muted-foreground">{product.merchantName} · Quantity {quantity}</p></div>{onClear && <Button type="button" variant="ghost" size="icon" disabled={Boolean(busy) || Boolean(orderStarted)} aria-label="Clear product selection" onClick={onClear}><X className="size-4" /></Button>}</div>
        <p className="mt-4 text-sm font-medium text-warning">{compatibilityLabels[product.compatibility.status]}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{product.recommendation}</p>
        {needsMerchant && <div className="mt-5 rounded-lg border border-border bg-muted/50 p-4"><h4 className="text-sm font-semibold">Prepare this merchant</h4><p className="mt-1 text-sm leading-relaxed text-muted-foreground">SENTINEL needs to securely inspect this merchant’s checkout before pricing the order. This does not make a purchase.</p><Button type="button" className="mt-4" variant="outline" disabled={Boolean(busy) || Boolean(orderStarted)} onClick={() => void state.prepare()}>{busy === "prepare" && <LoaderCircle className="size-4 animate-spin" />}{busy === "prepare" ? "Preparing merchant…" : "Prepare Merchant"}</Button></div>}
        {checkout?.merchant && <p className="mt-5 flex items-center gap-2 text-sm text-success"><ShieldCheck className="size-4 shrink-0" />Merchant ready{sandbox ? " · Verified test store" : " for a safe quote"}</p>}
        {(busy === "prepare" || checkout?.stage === "exploring") && <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground">Preparing merchant — this can take up to ~2 minutes. Checking the actual Agnic exploration status.</p>}
        {checkout && <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground">{checkout.message}</p>}
        {checkout && profileUrl && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">If Agnic requests a delivery profile, complete it in <a className="font-medium text-primary underline underline-offset-4" href={profileUrl} target="_blank" rel="noopener noreferrer">your hosted Agnic account ↗</a>. SENTINEL does not collect addresses or card details.</p>}
        {checkout?.setup && !checkout.setup.testCardConfigured && sandbox && <div className="mt-4 rounded-lg border border-warning/25 bg-warning/5 p-4"><p className="text-sm font-semibold text-warning">Manual test setup required</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Use Agnic’s hosted setup for a test payment method and, if requested, a test delivery profile. Never enter real card data in this demo.</p><div className="mt-3 flex flex-wrap gap-4 text-sm">{setupUrl && <a className="font-medium text-primary underline underline-offset-4" href={setupUrl} target="_blank" rel="noopener noreferrer">Open hosted setup ↗</a>}{guideUrl && <a className="font-medium text-primary underline underline-offset-4" href={guideUrl} target="_blank" rel="noopener noreferrer">Test setup guide ↗</a>}</div></div>}
      </div>
      <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
        <p className="text-[11px] font-semibold tracking-widest text-muted-foreground">{settled ? "WHAT WAS CHARGED" : "PRICE REVIEW"}</p>
        {/* Once an order settles its quote is spent, so the provider's own figures replace
            the empty quote rows rather than reading as missing information. */}
        {settled ? <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Store list price / item</dt><dd>{displayPrice(product.price)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Approved maximum</dt><dd>{displayPrice(checkout?.order?.approvedAmount)}</dd></div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4"><dt className="font-medium">Actual charge</dt><dd className="text-lg font-semibold text-success">{displayPrice(checkout?.order?.chargedAmount)}</dd></div>
        </dl> : <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Store list price / item</dt><dd>{displayPrice(product.price)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Checkout item subtotal</dt><dd>{displayPrice(preview?.subtotal)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Shipping / fulfillment</dt><dd>{preview?.shipping && !selectionChanged ? displayPrice(preview.shipping) : "Not confirmed"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tax</dt><dd>{preview?.tax ? displayPrice(preview.tax) : hasTotal && preview?.amountIsFinal ? "Included in total" : "Not confirmed"}</dd></div><div className="flex items-center justify-between gap-4 border-t border-border pt-4"><dt className="font-medium">{hasTotal && preview?.amountIsFinal ? "Final total" : "Maximum checkout amount"}</dt><dd className="text-lg font-semibold">{hasTotal ? `${preview?.amountIsFinal ? "" : "≤ "}${displayPrice(preview?.amount)}` : "Pending quote"}</dd></div></dl>}
        {hasTotal && !preview?.amountIsFinal && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Tax may be finalized during checkout. SENTINEL will not allow the charge to exceed this amount.</p>}
        {preview?.priceChanged && <p className="mt-3 text-sm text-warning">The checkout item price changed from the browse price. Review the updated amount.</p>}
        {Boolean(preview?.fulfillmentOptions?.length) && <fieldset disabled={Boolean(busy) || orderStarted} className="mt-5 space-y-2"><legend className="mb-2 text-sm font-semibold">Choose fulfillment</legend>{preview?.fulfillmentOptions?.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${selectedFulfillment === option.id ? "border-primary bg-primary/5" : "border-border"}`}><input type="radio" name={`fulfillment-${checkout?.id}`} value={option.id} checked={selectedFulfillment === option.id} onChange={() => { setFulfillment(option.id); setConsentOpen(false); }} className="mt-1 accent-primary" /><span className="min-w-0 flex-1"><span className="flex flex-wrap justify-between gap-2 font-medium"><span>{option.title}</span><span>{displayPrice(option.price)}</span></span>{option.description && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>}{option.eta && <span className="mt-1 block text-xs text-muted-foreground">{option.eta}</span>}{option.requiresAddress && <span className="mt-1 block text-xs text-muted-foreground">Delivery profile required</span>}</span></label>)}</fieldset>}
        {selectionChanged && <p role="status" className="mt-3 text-sm text-warning">Fulfillment changed. Check the price again to refresh your quote.</p>}
        {preview?.budgetViolation && <div role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4"><p className="text-xs font-bold tracking-wide text-destructive">PURCHASE BLOCKED</p><p className="mt-2 text-sm font-semibold">Budget exceeded</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt>Your maximum</dt><dd>{displayPrice(preview.budgetViolation.limit)}</dd></div><div className="flex justify-between gap-3"><dt>Checkout</dt><dd>{displayPrice(preview.budgetViolation.checkout)}</dd></div></dl><p className="mt-3 text-xs leading-relaxed text-muted-foreground">SENTINEL will not continue without an updated request and fresh consent.</p></div>}
        {preview?.requirements.map(requirement => <p key={requirement} className="mt-3 text-sm leading-relaxed text-warning">{requirement}</p>)}
        {preview && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{sandbox ? "Current checkout: price quote ready. No order has been submitted and no email will be sent until you review and confirm this test purchase." : preview.message}</p>}
        {!orderStarted && <Button type="button" className="mt-5 w-full" variant={sandbox ? "outline" : "default"} disabled={Boolean(busy) || needsMerchant || Boolean(preview?.requiresFulfillment && !selectedFulfillment)} onClick={() => void state.quote(selectedFulfillment || undefined)}>{busy === "quote" && <LoaderCircle className="size-4 animate-spin" />}{busy === "quote" ? "Checking live checkout price…" : selectionChanged ? "Update Checkout Price" : "Check Checkout Price"}</Button>}
        {sandbox && !orderStarted && <Button type="button" className="mt-3 w-full" disabled={!readyForConsent} onClick={() => setConsentOpen(true)}>Review & Confirm Test Purchase</Button>}
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">{error}</p>}
    {checkout && (error || ["failed", "unknown", "timed-out", "processing", "dispatching", "exploring"].includes(checkout.stage)) && <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void state.checkStatus()}>{busy && <LoaderCircle className="size-4 animate-spin" />}{inFlight ? "Tracking Agnic status…" : "Check Existing Status"}</Button>{orderStarted && <span className="text-xs text-muted-foreground">Status checks never submit another order.</span>}</div>}
    {checkout?.order && checkout.stage !== "succeeded" && <div className="rounded-lg border border-border bg-muted/40 p-4"><p className="text-xs font-semibold tracking-widest text-primary">TEST ORDER</p><ol className="mt-3 space-y-2 text-sm"><li>{checkout.approvedAt ? "✓" : "○"} User approved</li><li>✓ Order tracked · <span className="break-all font-mono text-xs">{checkout.order.id}</span></li><li className="flex items-center gap-2">{checkout.stage === "processing" ? <LoaderCircle className="size-3.5 animate-spin" /> : <span>○</span>}Agnic status: {checkout.order.status}</li></ol>{evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4">View checkout evidence<ExternalLink className="size-3" /></a>}</div>}
    {checkout && <PurchaseProof checkout={checkout} />}
    <Dialog open={consentOpen} onOpenChange={setConsentOpen}><DialogContent><span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><FlaskConical className="size-6" /></span><div><p className="mb-2 text-xs font-semibold tracking-widest text-primary">TEST PURCHASE</p><DialogTitle>Approve this test checkout</DialogTitle></div><DialogDescription>No real money will move. No real goods will ship. This submits one order to an Agnic-verified test merchant.</DialogDescription><dl className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm"><div><dt className="text-xs text-muted-foreground">Product</dt><dd className="mt-1 font-medium">{product.name} × {quantity}</dd></div><div><dt className="text-xs text-muted-foreground">Merchant</dt><dd className="mt-1">{checkout?.merchant?.name}</dd></div><div className="flex justify-between gap-3 border-t border-border pt-3"><dt>{preview?.amountIsFinal ? "Exact test amount" : "Maximum test amount"}</dt><dd className="font-semibold">{preview?.amountIsFinal ? "" : "≤ "}{displayPrice(preview?.amount)}</dd></div></dl><div className="flex flex-col-reverse gap-3 sm:flex-row"><Button type="button" variant="outline" className="flex-1" onClick={() => setConsentOpen(false)}>Cancel</Button><Button type="button" className="flex-1" disabled={!readyForConsent} onClick={() => { setConsentOpen(false); void state.confirm(); }}>Confirm Test Purchase</Button></div></DialogContent></Dialog>
  </div>;
}

function RealCheckout({ product, mission, onClear, onStep }: { product: ProductCandidate; mission: RequestMission; onClear: () => void; onStep: (step: ActivityStep) => void }) {
  const state = useCheckout({ mode: "real", missionId: mission.id, productId: product.id }, onStep);
  return <CheckoutReview product={product} quantity={mission.intent.quantity} state={state} onClear={onClear} />;
}

export function ApprovalPanel({ product, mission, onClear, onStep }: { product: ProductCandidate | null; mission: RequestMission | null; onClear: () => void; onStep: (step: ActivityStep) => void }) {
  return <section id="approval" aria-labelledby="approval-title" className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-7"><h2 id="approval-title" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-5 text-primary" />Checkout review</h2><span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground"><LockKeyhole className="size-3" />Real purchasing disabled</span></div>
    <div className="p-5 sm:p-7">{product && mission ? <RealCheckout key={`${mission.id}:${product.id}`} product={product} mission={mission} onClear={onClear} onStep={onStep} /> : <div className="flex items-center gap-4 py-3"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary"><ShieldCheck className="size-6" strokeWidth={1.5} /></span><div><h3 className="text-base font-medium">Your approval stays in control.</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Select a product to prepare its merchant and review a live checkout quote.</p></div></div>}</div>
    <SandboxPanel onStep={onStep} />
  </section>;
}
