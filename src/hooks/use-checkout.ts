"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutSession } from "@/lib/domain/checkout";
import type { ActivityStep } from "@/lib/domain/commerce";

type Selection = { mode: "real"; missionId: string; productId: string } | { mode: "sandbox"; productId: string };
type Action = "prepare" | "quote" | "confirm" | "status" | "autoQuote";

function messageFrom(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return null;
}

/** One explicit action at a time. Polling never submits an order or starts exploration. */
export function useCheckout(selection: Selection, onStep?: (step: ActivityStep) => void) {
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<CheckoutSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const stepCallback = useRef(onStep);
  const confirmationPending = useRef(false);
  useEffect(() => { stepCallback.current = onStep; }, [onStep]);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  function accept(value: CheckoutSession) {
    current.current = value; setCheckout(value);
    if (value.stage === "exploring") stepCallback.current?.({ id: "prepare", label: "Prepare merchant", status: "active", detail: value.message });
    else if (value.merchant && ["ready", "fulfillment", "quoted"].includes(value.stage)) stepCallback.current?.({ id: "prepare", label: "Merchant ready", status: "complete", detail: `${value.merchant.name} is available for a safe price check.` });
    if (value.preview) stepCallback.current?.({ id: "preview", label: "Check checkout price", status: value.preview.status === "quoted" && !value.preview.budgetViolation ? "complete" : "blocked", detail: value.preview.message });
    if (value.approvedAt) stepCallback.current?.({ id: "consent", label: "Test purchase approved", status: "complete", detail: "Explicit consent received for this sandbox quote." });
    if (["dispatching", "processing"].includes(value.stage)) stepCallback.current?.({ id: "purchase", label: "Test checkout processing", status: "active", detail: value.message });
    if (["failed", "unknown", "timed-out", "blocked"].includes(value.stage) && (value.approvedAt || value.order)) {
      stepCallback.current?.({ id: "purchase", label: "Test checkout needs attention", status: value.stage === "failed" ? "error" : "blocked", detail: value.message });
      stepCallback.current?.({ id: "proof", label: "Purchase proof unavailable", status: "blocked", detail: "Agnic has not confirmed a successful test order." });
    }
    if (value.stage === "succeeded" && value.order?.test && value.order.status === "succeeded") {
      stepCallback.current?.({ id: "purchase", label: "Test checkout completed", status: "complete", detail: value.message });
      stepCallback.current?.({ id: "proof", label: "Purchase proof available", status: "complete", detail: `Agnic order ${value.order.id}. No real purchase.` });
    }
  }

  async function perform(action: Action, fulfillmentId?: string) {
    // Ref changes synchronously, including before a double click can re-render.
    if (controller.current || (action === "confirm" && confirmationPending.current)) return;
    if (action === "confirm" && (!current.current?.canConfirm || !current.current.quoteId || selection.mode !== "sandbox")) return;
    const request = new AbortController(); controller.current = request;
    const deadline = Date.now() + (action === "prepare" || action === "autoQuote" ? 180_000 : action === "confirm" || action === "status" ? 240_000 : 40_000);
    const timeout = setTimeout(() => request.abort(), deadline - Date.now());
    setBusy(action); setError(null);
    if (action === "confirm") {
      confirmationPending.current = true;
      const snapshot = current.current;
      if (snapshot) accept({ ...snapshot, stage: "dispatching", canConfirm: false, message: "Submitting your approved test checkout once. Awaiting Agnic confirmation." });
    }
    if (action === "prepare") stepCallback.current?.({ id: "prepare", label: "Prepare merchant", status: "active", detail: "Inspecting this merchant’s checkout. This does not make a purchase." });
    if (action === "quote") stepCallback.current?.({ id: "preview", label: "Check checkout price", status: "active", detail: "Requesting the current Agnic checkout amount." });
    async function call(path: string, body?: object): Promise<CheckoutSession> {
      const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: request.signal });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data) ?? "Agnic could not complete this action. Check the checkout status before continuing.");
      if (!data || typeof data !== "object" || !("checkout" in data) || !data.checkout || typeof data.checkout !== "object" || !("id" in data.checkout) || typeof data.checkout.id !== "string") throw new Error("The checkout response was incomplete. Check its status before continuing.");
      return data.checkout as CheckoutSession;
    }
    try {
      let value = current.current;
      if (action === "autoQuote" && selection.mode === "sandbox") {
        value = await call("/api/sandbox/auto-quote", { productId: selection.productId });
      }
      if (!value) {
        value = selection.mode === "real"
          ? await call("/api/checkout/session", { missionId: selection.missionId, productId: selection.productId })
          : await call("/api/sandbox/session", { productId: selection.productId });
        if (controller.current !== request) return;
        accept(value);
      }
      if (action === "prepare") value = await call("/api/checkout/prepare", { checkoutId: value.id });
      if (action === "quote") value = await call("/api/checkout/quote", { checkoutId: value.id, ...(fulfillmentId ? { fulfillmentId } : {}) });
      if (action === "confirm") value = selection.mode === "sandbox"
        ? await call("/api/sandbox/auto-confirm", { productId: selection.productId, confirmed: true, confirmationText: "Confirm Test Purchase" })
        : await call("/api/sandbox/confirm", { checkoutId: value.id, quoteId: value.quoteId, confirmed: true, confirmationText: "Confirm Test Purchase" });
      if (action === "status") value = selection.mode === "sandbox" && value.order
        ? await call("/api/sandbox/order-status", { productId: selection.productId, orderId: value.order.id })
        : await call(`/api/checkout/status?checkoutId=${encodeURIComponent(value.id)}`);
      if (controller.current !== request) return;
      accept(value);
      // Only these server-reported in-flight states permit polling.
      while (["exploring", "processing", "dispatching"].includes(value.stage) && controller.current === request) {
        await new Promise<void>((resolve, reject) => {
          const done = () => { request.signal.removeEventListener("abort", aborted); resolve(); };
          const delay = setTimeout(done, 5_000);
          const aborted = () => { clearTimeout(delay); reject(new DOMException("Aborted", "AbortError")); };
          request.signal.addEventListener("abort", aborted, { once: true });
          if (request.signal.aborted) aborted();
        });
        value = selection.mode === "sandbox" && value.order
          ? await call("/api/sandbox/order-status", { productId: selection.productId, orderId: value.order.id })
          : await call(`/api/checkout/status?checkoutId=${encodeURIComponent(value.id)}`);
        if (controller.current !== request) return;
        accept(value);
      }
      // The server is authoritative about whether a rejected consent ever dispatched.
      if ((action === "status" || action === "quote") && value.canConfirm && value.stage === "quoted" && !value.order && !value.approvedAt) confirmationPending.current = false;
    } catch (cause) {
      if (controller.current !== request) return;
      const message = request.signal.aborted
        ? action === "confirm" || action === "status" ? "Status tracking timed out. An order may still be processing. Check status; do not submit another test order." : "This action timed out. Check status before trying merchant preparation again."
        : cause instanceof Error ? cause.message : "The checkout connection was interrupted. Check status before continuing.";
      setError(message);
      if (action === "confirm" && current.current) accept({ ...current.current, stage: "unknown", canConfirm: false, message });
      if (action === "prepare" || action === "quote") stepCallback.current?.({ id: action === "prepare" ? "prepare" : "preview", label: action === "prepare" ? "Prepare merchant" : "Check checkout price", status: "error", detail: message });
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) { controller.current = null; setBusy(null); }
    }
  }

  return { checkout, busy, error, autoQuote: () => perform("autoQuote"), prepare: () => perform("prepare"), quote: (fulfillmentId?: string) => perform("quote", fulfillmentId), confirm: () => perform("confirm"), checkStatus: () => perform("status") };
}
