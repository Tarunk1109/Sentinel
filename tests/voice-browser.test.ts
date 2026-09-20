import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBrowserVoiceService, getSpeechRecognitionConstructor, normalizeRecognitionError, type RecognitionEventLike, type SpeechRecognitionLike } from "@/lib/voice/browser-speech";

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = ""; continuous = true; interimResults = false; maxAlternatives = 5;
  onstart: (() => void) | null = null;
  onresult: ((event: RecognitionEventLike) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { this.onstart?.(); });
  stop = vi.fn();
  abort = vi.fn(() => { this.onerror?.({ error: "aborted" }); this.onend?.(); });
  constructor() { FakeRecognition.instances.push(this); }
  emit(results: [string, boolean][], resultIndex = 0) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex, results: Object.assign(list, { length: list.length }) } as unknown as RecognitionEventLike);
  }
}
function scope(extra: Record<string, unknown> = { SpeechRecognition: FakeRecognition }) {
  FakeRecognition.instances = [];
  return { navigator: { language: "fr-CA" }, ...extra };
}
const callbacks = () => ({ onStart: vi.fn(), onInterimTranscript: vi.fn(), onFinalTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });

describe("Browser voice adapter", () => {
  it("#1 reports supported when the native SpeechRecognition API exists", () => {
    const service = createBrowserVoiceService(scope());
    expect(service.supported).toBe(true);
    expect(service.listening).toBe(false);
  });

  it("#2 falls back to webkitSpeechRecognition", () => {
    const service = createBrowserVoiceService(scope({ webkitSpeechRecognition: FakeRecognition }));
    expect(service.supported).toBe(true);
    expect(getSpeechRecognitionConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
  });

  it("#3 an unsupported browser returns supported=false and never fakes support", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope({}));
    expect(service.supported).toBe(false);
    expect(service.start(events)).toEqual({ ok: false, error: { code: "NOT_SUPPORTED", message: "Voice input isn't supported in this browser. Type your request instead." } });
    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_SUPPORTED" }));
    expect(createBrowserVoiceService(undefined).supported).toBe(false);
    expect(createBrowserVoiceService({ SpeechRecognition: "not a constructor" }).supported).toBe(false);
    // Server-side (plain Node): no SpeechRecognition global exists, so it's unsupported - safely.
    expect(createBrowserVoiceService().supported).toBe(false);
  });

  it("configures one-utterance recognition with a safe language", () => {
    const service = createBrowserVoiceService(scope());
    service.start(callbacks());
    const [recognition] = FakeRecognition.instances;
    expect(recognition).toMatchObject({ lang: "fr-CA", continuous: false, interimResults: true, maxAlternatives: 1 });
    service.abort();
    service.start(callbacks(), { lang: "en-US;alert(1)", interimResults: false });
    expect(FakeRecognition.instances[1]).toMatchObject({ lang: "fr-CA", interimResults: false });
    service.abort();
    const noNavigator = createBrowserVoiceService({ SpeechRecognition: FakeRecognition });
    noNavigator.start(callbacks());
    expect(FakeRecognition.instances.at(-1)?.lang).toBe("en-CA");
  });

  it("#4 delivers the final transcript, whitespace-normalized", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope());
    expect(service.start(events)).toEqual({ ok: true });
    expect(events.onStart).toHaveBeenCalledOnce();
    FakeRecognition.instances[0].emit([["  Keep Coke,   Sprite and Fanta stocked  ", true]]);
    expect(events.onFinalTranscript).toHaveBeenCalledWith("Keep Coke, Sprite and Fanta stocked");
    expect(events.onInterimTranscript).not.toHaveBeenCalled();
  });

  it("#5 delivers interim transcripts while the user is still speaking", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope());
    service.start(events);
    FakeRecognition.instances[0].emit([["keep coke", false]]);
    expect(events.onInterimTranscript).toHaveBeenCalledWith("keep coke");
    expect(events.onFinalTranscript).not.toHaveBeenCalled();
  });

  it("#6 stop() lets the browser finish; listening ends on the end event", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope());
    service.start(events);
    expect(service.listening).toBe(true);
    expect(service.start(callbacks())).toMatchObject({ ok: false, error: { code: "ALREADY_LISTENING" } });
    service.stop();
    const [recognition] = FakeRecognition.instances;
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(service.listening).toBe(true);
    recognition.emit([["pause my cafe drinks autopilot", true]]);
    recognition.onend?.();
    expect(events.onFinalTranscript).toHaveBeenCalledWith("pause my cafe drinks autopilot");
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
  });

  it("#7 abort() stops immediately without reporting its own cancellation as an error", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope());
    service.start(events);
    service.abort();
    expect(FakeRecognition.instances[0].abort).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
    expect(events.onError).not.toHaveBeenCalled();
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(service.start(callbacks())).toEqual({ ok: true });
  });

  it("#8 normalizes browser recognition errors to a fixed, safe message set", () => {
    const events = callbacks();
    const service = createBrowserVoiceService(scope());
    service.start(events);
    FakeRecognition.instances[0].onerror?.({ error: "not-allowed" });
    expect(events.onError).toHaveBeenLastCalledWith({ code: "PERMISSION_DENIED", message: "Microphone access is blocked. Allow it in your browser settings, or type instead." });
    expect(normalizeRecognitionError("no-speech").code).toBe("NO_SPEECH");
    expect(normalizeRecognitionError("network").code).toBe("NETWORK");
    expect(normalizeRecognitionError("<img src=x onerror=alert(1)>")).toEqual({ code: "UNKNOWN", message: "Voice input stopped unexpectedly. Try again or type instead." });
    expect(normalizeRecognitionError("constructor").code).toBe("UNKNOWN");
    expect(normalizeRecognitionError(undefined).code).toBe("UNKNOWN");
    const throwing = createBrowserVoiceService({ SpeechRecognition: class extends FakeRecognition { start = vi.fn(() => { throw new Error("InvalidStateError"); }); } });
    const failed = callbacks();
    expect(throwing.start(failed)).toMatchObject({ ok: false, error: { code: "START_FAILED" } });
    expect(throwing.listening).toBe(false);
  });

  it("#9 never touches or persists audio: no capture, recording, storage or network APIs, and no retained transcript", () => {
    const source = readFileSync("src/lib/voice/browser-speech.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const api of ["getUserMedia", "MediaRecorder", "AudioContext", "Blob", "FileReader", "localStorage", "sessionStorage", "indexedDB", "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "caches"]) {
      expect(source, api).not.toContain(api);
    }
    const service = createBrowserVoiceService(scope());
    service.start(callbacks());
    FakeRecognition.instances[0].emit([["keep coke stocked", true]]);
    expect(Object.keys(service).sort()).toEqual(["abort", "listening", "start", "stop", "supported"]);
    expect(JSON.stringify(service)).not.toContain("coke");
  });
});
