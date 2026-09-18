"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import Image from "next/image";
import { ArrowRight, ImageUp, LoaderCircle, RefreshCw, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const defaultExampleHints = ["Broken chair wheel", "Laptop charger", "Printer toner", "Appliance filter"];
const ACCEPT = "image/jpeg,image/png,image/webp";

export function InspectUpload({
  file, previewUrl, validationError, onSelectFile, onRemove, onAnalyze, isAnalyzing, disabled, disabledReason,
  id = "inspect", icon = <ScanLine size={16} />, heading = "Show SENTINEL what needs attention",
  description = "Upload a photo of something broken, missing, damaged, or needing replacement.",
  exampleLabel = "Try photographing", exampleHints = defaultExampleHints,
  analyzeLabel = "Analyze Image", analyzingLabel = "Analyzing image…", previewAlt = "Uploaded item to inspect",
}: {
  file: File | null; previewUrl: string | null; validationError: string | null;
  onSelectFile: (file: File | null) => void; onRemove: () => void; onAnalyze: () => void;
  isAnalyzing: boolean; disabled: boolean; disabledReason: string | null;
  id?: string; icon?: ReactNode; heading?: string; description?: string;
  exampleLabel?: string; exampleHints?: string[]; analyzeLabel?: string; analyzingLabel?: string; previewAlt?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const errorId = `${id}-file-error`;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragActive(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onSelectFile(dropped);
  }

  return <section id={`${id}-upload`} className="composer inspect-composer" aria-labelledby={`${id}-heading`}>
    <div className="inspect-heading"><h2 id={`${id}-heading`}>{icon}{heading}</h2><p>{description}</p></div>
    {!file ? <>
      <div
        className={`inspect-dropzone ${dragActive ? "drag-active" : ""}`}
        onDragOver={event => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Upload an image, JPG, PNG or WEBP, up to 10 megabytes"
        onClick={() => inputRef.current?.click()}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
      >
        <ImageUp size={30} strokeWidth={1.3} aria-hidden="true" />
        <p className="inspect-dropzone-title">Drop an image here, or <span>browse files</span></p>
        <p className="inspect-dropzone-caption">Supported: JPG · PNG · WEBP · Up to 10 MB</p>
        <input
          ref={inputRef}
          id={`${id}-file-input`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-describedby={validationError ? errorId : undefined}
          onChange={event => { onSelectFile(event.target.files?.[0] ?? null); event.target.value = ""; }}
        />
      </div>
      {validationError && <p className="error-message" role="alert" id={errorId}>{validationError}</p>}
      <div className="example-row"><span>{exampleLabel}</span><div>{exampleHints.map(hint => <span key={hint} className="inspect-example-chip">{hint}</span>)}</div></div>
    </> : <div className="inspect-preview">
      <div className="inspect-preview-image">{previewUrl && <Image src={previewUrl} alt={previewAlt} width={520} height={340} unoptimized className="inspect-preview-img" />}</div>
      <div className="inspect-preview-actions">
        <div className="inspect-file-meta"><span>{file.name}</span><span>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}</span></div>
        <div className="inspect-preview-buttons">
          <Button type="button" variant="outline" size="sm" disabled={isAnalyzing} onClick={() => inputRef.current?.click()}><RefreshCw size={13} />Replace image</Button>
          <Button type="button" variant="ghost" size="sm" disabled={isAnalyzing} onClick={onRemove}><X size={13} />Remove</Button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Replace uploaded image" onChange={event => { onSelectFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </div>
        <Button type="button" className="inspect-analyze-button" disabled={isAnalyzing || disabled} onClick={onAnalyze}>{isAnalyzing ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />{analyzingLabel}</> : <>{analyzeLabel}<ArrowRight /></>}</Button>
        {disabled && disabledReason && <p className="configuration-note">{disabledReason}</p>}
      </div>
    </div>}
  </section>;
}
