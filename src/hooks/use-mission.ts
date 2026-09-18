"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityStep, MissionEvent, ProductIntent, RequestMission, RuntimeStatus } from "@/lib/domain/commerce";

function publicMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export function useMission() {
  const [mission, setMission] = useState<RequestMission | null>(null);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [intent, setIntent] = useState<ProductIntent | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const controller = useRef<AbortController | null>(null);
  const statusRequest = useRef<Promise<RuntimeStatus | null> | null>(null);

  useEffect(() => {
    let mounted = true;
    // Reuse the same read-only request during React's development effect replay.
    statusRequest.current ??= fetch("/api/status", { cache: "no-store" })
      .then(async response => response.ok ? await response.json() as RuntimeStatus : null)
      .catch(() => null);
    void statusRequest.current.then(value => { if (mounted) setStatus(value); });
    return () => { mounted = false; controller.current?.abort(); controller.current = null; };
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setMission(null); setSteps([]); setIntent(null); setIsRunning(false); setError(null);
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setIsRunning(false);
    setSteps(current => current.map(step => step.status === "active"
      ? { ...step, status: "blocked", detail: "Request canceled. No order was placed." }
      : step));
  }, []);

  const submit = useCallback(async (url: string, body: unknown) => {
    // This synchronous guard also catches double clicks before React re-renders.
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setIsRunning(true); setError(null); setMission(null); setIntent(null); setSteps([]);
    const timeout = setTimeout(() => request.abort(new Error("This request timed out. You can try again when ready.")), 95_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!response.ok) {
        const responseBody: unknown = await response.json().catch(() => null);
        throw new Error(publicMessage(responseBody, "The mission could not be started. Please try again."));
      }
      if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
        throw new Error("The server returned an unexpected response. Please try again.");
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      const consume = (line: string) => {
        if (!line.trim() || controller.current !== request) return;
        let event: MissionEvent;
        try { event = JSON.parse(line) as MissionEvent; }
        catch { throw new Error("The progress stream was interrupted. Please try again."); }
        if (!event || typeof event !== "object") throw new Error("The server returned an invalid progress update.");
        switch (event.type) {
          case "step":
            if (!event.step?.id || !event.step.label) throw new Error("The server returned an invalid activity step.");
            setSteps(current => current.some(step => step.id === event.step.id)
              ? current.map(step => step.id === event.step.id ? event.step : step)
              : [...current, event.step]);
            break;
          case "intent":
            if (!event.intent?.searchQuery) throw new Error("The server returned an invalid request summary.");
            setIntent(event.intent);
            break;
          case "complete":
            if (event.mission?.source !== "agnic" || !Array.isArray(event.mission.products) || !Array.isArray(event.mission.steps)) {
              throw new Error("The server returned an invalid product shortlist.");
            }
            setMission(event.mission); setIntent(event.mission.intent); setSteps(event.mission.steps);
            completed = true;
            break;
          case "error":
            throw new Error(event.error?.message || "This mission could not be completed.");
          default:
            throw new Error("The server returned an unknown progress update.");
        }
      };
      while (!completed && controller.current === request) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (buffer.length > 1_000_000) throw new Error("The server response was too large to display safely.");
        let newline: number;
        while (!completed && (newline = buffer.indexOf("\n")) !== -1) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (chunk.done) { if (!completed && buffer.trim()) consume(buffer); break; }
      }
      if (controller.current === request && !completed) throw new Error("The connection closed before the mission finished. Please try again.");
    } catch (cause) {
      if (controller.current === request) {
        const reason: unknown = request.signal.aborted ? request.signal.reason : cause;
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          const message = reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
          setError(message);
          setSteps(current => current.map(step => step.status === "active" ? { ...step, status: "error", detail: message } : step));
        }
      }
    } finally {
      clearTimeout(timeout);
      void reader?.cancel().catch(() => undefined);
      if (controller.current === request) { setIsRunning(false); controller.current = null; }
    }
  }, []);

  const run = useCallback((prompt: string) => submit("/api/missions", { prompt }), [submit]);
  const runFromIntent = useCallback((productIntent: ProductIntent) => submit("/api/inspect/search", { intent: productIntent }), [submit]);

  return { mission, steps, intent, isRunning, error, run, runFromIntent, reset, cancel, status };
}
