"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import { ArrowRight, Camera, ImageUp, LoaderCircle, RefreshCw, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageSource } from "@/hooks/use-inspection";

const defaultExampleHints = ["Broken chair wheel", "Laptop charger", "Printer toner", "Appliance filter"];
const ACCEPT = "image/jpeg,image/png,image/webp";
const sourceLabel: Record<ImageSource, string> = { camera: "Captured photo", upload: "Uploaded image" };

export function InspectUpload({
  file, previewUrl, validationError, onSelectFile, onRemove, onAnalyze, isAnalyzing, disabled, disabledReason,
  id = "inspect", icon = <ScanLine size={16} />, heading = "Show SENTINEL what needs attention",
  description = "Take a photo or upload an image of something broken, damaged, missing, or needing replacement.",
  exampleLabel = "Try photographing", exampleHints = defaultExampleHints,
  analyzeLabel = "Analyze Image", analyzingLabel = "Analyzing image…", previewAlt = "Uploaded item to inspect",
  allowCamera = false, imageSource = null,
}: {
  file: File | null; previewUrl: string | null; validationError: string | null;
  onSelectFile: (file: File | null, source?: ImageSource) => void; onRemove: () => void; onAnalyze: () => void;
  isAnalyzing: boolean; disabled: boolean; disabledReason: string | null;
  id?: string; icon?: ReactNode; heading?: string; description?: string;
  exampleLabel?: string; exampleHints?: string[]; analyzeLabel?: string; analyzingLabel?: string; previewAlt?: string;
  /** Opt-in only: Build Mode reuses this component without setting this, so its upload
   * flow (single dropzone, "Replace image") stays byte-for-byte unchanged. */
  allowCamera?: boolean; imageSource?: ImageSource | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const errorId = `${id}-file-error`;

  // A cancelled file/camera picker fires onChange with an empty FileList - that must
  // leave whatever is already selected untouched, never silently clear it.
  function handleChange(event: ChangeEvent<HTMLInputElement>, source: ImageSource) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (chosen) onSelectFile(chosen, source);
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragActive(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onSelectFile(dropped, "upload");
  }

  return <section id={`${id}-upload`} className="composer inspect-composer" aria-labelledby={`${id}-heading`}>
    <div className="inspect-heading"><h2 id={`${id}-heading`}>{icon}{heading}</h2><p>{description}</p></div>
    {!file ? <>
      <div
        className={`inspect-dropzone ${allowCamera ? "capture-mode" : ""} ${dragActive ? "drag-active" : ""}`}
        onDragOver={event => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        {...(allowCamera ? {} : {
          role: "button", tabIndex: 0,
          "aria-label": "Upload an image, JPG, PNG or WEBP, up to 10 megabytes",
          onClick: () => inputRef.current?.click(),
          onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } },
        })}
      >
        {allowCamera ? <>
          <div className="inspect-capture-actions">
            <Button type="button" onClick={() => cameraInputRef.current?.click()}><Camera size={16} />Take Photo</Button>
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}><ImageUp size={16} />Upload Image</Button>
          </div>
          <p className="inspect-dropzone-caption">Supported: JPG · PNG · WEBP · Up to 10 MB</p>
          <input
            ref={cameraInputRef}
            id={`${id}-camera-input`}
            type="file"
            accept={ACCEPT}
            capture="environment"
            className="sr-only"
            aria-label="Take a photo with your camera"
            aria-describedby={validationError ? errorId : undefined}
            onChange={event => handleChange(event, "camera")}
          />
        </> : <>
          <ImageUp size={30} strokeWidth={1.3} aria-hidden="true" />
          <p className="inspect-dropzone-title">Drop an image here, or <span>browse files</span></p>
          <p className="inspect-dropzone-caption">Supported: JPG · PNG · WEBP · Up to 10 MB</p>
        </>}
        <input
          ref={inputRef}
          id={`${id}-file-input`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={allowCamera ? "Upload an image, JPG, PNG or WEBP, up to 10 megabytes" : undefined}
          aria-describedby={validationError ? errorId : undefined}
          onChange={event => handleChange(event, "upload")}
        />
      </div>
      {validationError && <p className="error-message" role="alert" id={errorId}>{validationError}</p>}
      <div className="example-row"><span>{exampleLabel}</span><div>{exampleHints.map(hint => <span key={hint} className="inspect-example-chip">{hint}</span>)}</div></div>
    </> : <div className="inspect-preview">
      <div className="inspect-preview-image">{previewUrl && <Image src={previewUrl} alt={previewAlt} width={520} height={340} unoptimized className="inspect-preview-img" />}</div>
      <div className="inspect-preview-actions">
        <div className="inspect-file-meta">
          <span>{file.name}{imageSource && <span className="inspect-source-label"> · {sourceLabel[imageSource]}</span>}</span>
          <span>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}</span>
        </div>
        <div className="inspect-preview-buttons">
          {allowCamera ? <>
            <Button type="button" variant="outline" size="sm" disabled={isAnalyzing} onClick={() => cameraInputRef.current?.click()}><Camera size={13} />Take Photo</Button>
            <Button type="button" variant="outline" size="sm" disabled={isAnalyzing} onClick={() => inputRef.current?.click()}><ImageUp size={13} />Upload Image</Button>
            <input ref={cameraInputRef} type="file" accept={ACCEPT} capture="environment" className="sr-only" aria-label="Take a new photo with your camera" onChange={event => handleChange(event, "camera")} />
          </> : (
            <Button type="button" variant="outline" size="sm" disabled={isAnalyzing} onClick={() => inputRef.current?.click()}><RefreshCw size={13} />Replace image</Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={isAnalyzing} onClick={onRemove}><X size={13} />Remove</Button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label={allowCamera ? "Upload a different image" : "Replace uploaded image"} onChange={event => handleChange(event, "upload")} />
        </div>
        <Button type="button" className="inspect-analyze-button" disabled={isAnalyzing || disabled} onClick={onAnalyze}>{isAnalyzing ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />{analyzingLabel}</> : <>{analyzeLabel}<ArrowRight /></>}</Button>
        {disabled && disabledReason && <p className="configuration-note">{disabledReason}</p>}
      </div>
    </div>}
  </section>;
}
