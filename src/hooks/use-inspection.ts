"use client";

import { useCallback, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES, type InspectionAnalysis } from "@/lib/domain/inspection";

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

export function useInspection() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<InspectionAnalysis | null>(null);
  const [source, setSource] = useState<"live" | "fixture" | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // Bumped on every new analysis so the results UI can key off it and reset its own
  // subject-selection/user-intent state instead of leaking it into the next inspection.
  const [analysisId, setAnalysisId] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const clearPreview = useCallback(() => { setPreviewUrl(current => { if (current) URL.revokeObjectURL(current); return null; }); }, []);

  const selectFile = useCallback((candidate: File | null) => {
    controller.current?.abort(); controller.current = null;
    setAnalysis(null); setSource(null); setAnalysisError(null); setIsAnalyzing(false);
    if (!candidate) { clearPreview(); setFile(null); setValidationError(null); return; }
    if (!SUPPORTED_IMAGE_TYPES.includes(candidate.type as never)) {
      clearPreview(); setFile(null);
      setValidationError("Unsupported file type. Upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      clearPreview(); setFile(null);
      setValidationError("That image is larger than the 10 MB limit.");
      return;
    }
    setValidationError(null);
    setFile(candidate);
    clearPreview();
    setPreviewUrl(URL.createObjectURL(candidate));
  }, [clearPreview]);

  const removeImage = useCallback(() => selectFile(null), [selectFile]);

  const analyze = useCallback(async () => {
    if (!file || isAnalyzing) return;
    const request = new AbortController();
    controller.current = request;
    setIsAnalyzing(true); setAnalysisError(null); setAnalysis(null); setSource(null);
    try {
      const imageBase64 = await readAsDataUrl(file);
      const response = await fetch("/api/inspect/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
        signal: request.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(publicMessage(body, "The image could not be analyzed. Please try again."));
      const result = body as { analysis?: InspectionAnalysis; source?: "live" | "fixture" };
      if (!result?.analysis) throw new Error("The server returned an unreadable analysis.");
      setAnalysis(result.analysis);
      setSource(result.source ?? "live");
      setAnalysisId(current => current + 1);
    } catch (cause) {
      if (controller.current === request && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setAnalysisError(cause instanceof Error ? cause.message : "The image could not be analyzed. Please try again.");
      }
    } finally {
      if (controller.current === request) { setIsAnalyzing(false); controller.current = null; }
    }
  }, [file, isAnalyzing]);

  const reset = useCallback(() => { controller.current?.abort(); controller.current = null; clearPreview(); setFile(null); setValidationError(null); setAnalysis(null); setSource(null); setAnalysisError(null); setIsAnalyzing(false); }, [clearPreview]);

  return { file, previewUrl, validationError, selectFile, removeImage, analyze, analysis, source, analysisId, isAnalyzing, analysisError, reset };
}
