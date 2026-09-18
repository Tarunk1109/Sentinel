"use client";

import { useCallback, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES } from "@/lib/domain/inspection";
import type { BuildComponentResult } from "@/lib/domain/build";
import type { BuildSessionView } from "@/lib/server/services/build";

function publicMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected file."));
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export interface BuildFormConstraints { budget: string; goal: string; alreadyOwn: string; requirements: string }

export function useBuild() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [form, setForm] = useState<BuildFormConstraints>({ budget: "", goal: "", alreadyOwn: "", requirements: "" });
  const [session, setSession] = useState<BuildSessionView | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchingIds, setSearchingIds] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);

  const clearPreview = useCallback(() => { setPreviewUrl(current => { if (current) URL.revokeObjectURL(current); return null; }); }, []);

  const selectFile = useCallback((candidate: File | null) => {
    controller.current?.abort(); controller.current = null;
    setSession(null); setSelectedIds(new Set()); setAnalysisError(null); setSearchError(null); setIsAnalyzing(false); setIsSearching(false);
    if (!candidate) { clearPreview(); setFile(null); setValidationError(null); return; }
    if (!SUPPORTED_IMAGE_TYPES.includes(candidate.type as never)) { clearPreview(); setFile(null); setValidationError("Unsupported file type. Upload a JPG, PNG, or WEBP image."); return; }
    if (candidate.size > MAX_IMAGE_BYTES) { clearPreview(); setFile(null); setValidationError("That image is larger than the 10 MB limit."); return; }
    setValidationError(null); setFile(candidate); clearPreview(); setPreviewUrl(URL.createObjectURL(candidate));
  }, [clearPreview]);

  const removeImage = useCallback(() => selectFile(null), [selectFile]);
  const updateForm = useCallback((patch: Partial<BuildFormConstraints>) => setForm(current => ({ ...current, ...patch })), []);

  const analyze = useCallback(async () => {
    if (!file || isAnalyzing) return;
    const request = new AbortController();
    controller.current = request;
    setIsAnalyzing(true); setAnalysisError(null); setSession(null); setSelectedIds(new Set());
    try {
      const imageBase64 = await readAsDataUrl(file);
      const budgetMaxAmount = form.budget.trim() ? Number(form.budget) : null;
      const response = await fetch("/api/build/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({
          imageBase64, mimeType: file.type,
          constraints: {
            budgetMaxAmount: budgetMaxAmount !== null && Number.isFinite(budgetMaxAmount) && budgetMaxAmount > 0 ? budgetMaxAmount : null,
            goal: form.goal.trim() || undefined, alreadyOwn: form.alreadyOwn.trim() || undefined, requirements: form.requirements.trim() || undefined,
          },
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(publicMessage(body, "The image could not be analyzed. Please try again."));
      const result = body as { session?: BuildSessionView };
      if (!result?.session) throw new Error("The server returned an unreadable build plan.");
      setSession(result.session);
      setSelectedIds(new Set(result.session.plan.items.filter(item => item.included).map(item => item.componentId)));
    } catch (cause) {
      if (controller.current === request && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setAnalysisError(cause instanceof Error ? cause.message : "The image could not be analyzed. Please try again.");
      }
    } finally { if (controller.current === request) { setIsAnalyzing(false); controller.current = null; } }
  }, [file, form, isAnalyzing]);

  const toggleComponent = useCallback((componentId: string) => {
    setSelectedIds(current => { const next = new Set(current); if (next.has(componentId)) next.delete(componentId); else next.add(componentId); return next; });
  }, []);

  const search = useCallback(async (clarification?: string) => {
    if (!session || isSearching) return;
    const request = new AbortController();
    controller.current = request;
    setIsSearching(true); setSearchError(null);
    const pending = session.plan.items.filter(item => selectedIds.has(item.componentId) && !item.owned && !session.results.some(r => r.componentId === item.componentId)).slice(0, 3).map(item => item.componentId);
    setSearchingIds(new Set(pending));
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await fetch("/api/build/search", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, signal: request.signal,
        body: JSON.stringify({ planId: session.id, selectedIds: [...selectedIds], clarification: clarification?.trim() || undefined }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(publicMessage(body, "The build search could not be started. Please try again."));
      }
      if (!response.body) throw new Error("The server returned an unexpected response.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; let completed = false;
      const consume = (line: string) => {
        if (!line.trim() || controller.current !== request) return;
        const event = JSON.parse(line) as { type: string; session?: BuildSessionView; result?: BuildComponentResult; error?: { message?: string } };
        if (event.type === "complete" && event.session) { setSession(event.session); completed = true; }
        else if (event.type === "component" && event.result) {
          setSession(current => current ? { ...current, results: [...current.results.filter(r => r.componentId !== event.result!.componentId), event.result!] } : current);
          setSearchingIds(current => { const next = new Set(current); next.delete(event.result!.componentId); return next; });
        } else if (event.type === "error") { throw new Error(event.error?.message || "This build search could not be completed."); }
      };
      while (!completed && controller.current === request) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline: number;
        while (!completed && (newline = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        if (chunk.done) { if (!completed && buffer.trim()) consume(buffer); break; }
      }
    } catch (cause) {
      if (controller.current === request && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setSearchError(cause instanceof Error ? cause.message : "This build search could not be completed. Please try again.");
      }
    } finally {
      void reader?.cancel().catch(() => undefined);
      setSearchingIds(new Set());
      if (controller.current === request) { setIsSearching(false); controller.current = null; }
    }
  }, [session, selectedIds, isSearching]);

  const reset = useCallback(() => {
    controller.current?.abort(); controller.current = null; clearPreview();
    setFile(null); setValidationError(null); setForm({ budget: "", goal: "", alreadyOwn: "", requirements: "" });
    setSession(null); setSelectedIds(new Set()); setAnalysisError(null); setSearchError(null); setIsAnalyzing(false); setIsSearching(false); setSearchingIds(new Set());
  }, [clearPreview]);

  return { file, previewUrl, validationError, selectFile, removeImage, form, updateForm, analyze, isAnalyzing, analysisError, session, selectedIds, toggleComponent, search, isSearching, searchError, searchingIds, reset };
}
