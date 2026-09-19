/**
 * BROWSER-ONLY headless voice adapter over the native Web Speech API (SpeechRecognition,
 * with the webkitSpeechRecognition fallback). Never import this from server code - a test
 * enforces it. It has no UI and makes no network calls of its own.
 *
 * Privacy: this module never touches audio. It does not use getUserMedia, MediaRecorder or
 * any storage; it only receives text transcripts from the browser. Note that the browser
 * itself may send audio to its vendor's speech service (Chrome does), which SENTINEL
 * neither controls nor receives.
 */

export type VoiceErrorCode =
  | "NOT_SUPPORTED" | "ALREADY_LISTENING" | "PERMISSION_DENIED" | "NO_SPEECH" | "AUDIO_CAPTURE"
  | "NETWORK" | "ABORTED" | "LANGUAGE_NOT_SUPPORTED" | "START_FAILED" | "UNKNOWN";
export interface VoiceError { code: VoiceErrorCode; message: string }

const MESSAGES: Record<VoiceErrorCode, string> = {
  NOT_SUPPORTED: "Voice input isn't supported in this browser. Type your request instead.",
  ALREADY_LISTENING: "SENTINEL is already listening.",
  PERMISSION_DENIED: "Microphone access is blocked. Allow it in your browser settings, or type instead.",
  NO_SPEECH: "No speech was detected. Try again.",
  AUDIO_CAPTURE: "No microphone was found.",
  NETWORK: "The browser's speech service couldn't be reached. Try again or type instead.",
  ABORTED: "Listening was cancelled.",
  LANGUAGE_NOT_SUPPORTED: "This language isn't supported for voice input.",
  START_FAILED: "Voice input couldn't start. Try again.",
  UNKNOWN: "Voice input stopped unexpectedly. Try again or type instead.",
};
const NATIVE_ERRORS: Record<string, VoiceErrorCode> = {
  "not-allowed": "PERMISSION_DENIED", "service-not-allowed": "PERMISSION_DENIED", "no-speech": "NO_SPEECH",
  "audio-capture": "AUDIO_CAPTURE", network: "NETWORK", aborted: "ABORTED", "language-not-supported": "LANGUAGE_NOT_SUPPORTED",
};

export function voiceError(code: VoiceErrorCode): VoiceError { return { code, message: MESSAGES[code] }; }
/** Browser error strings (and anything unexpected) map to a fixed, safe message set. */
export function normalizeRecognitionError(nativeCode: unknown): VoiceError {
  return voiceError(typeof nativeCode === "string" && Object.prototype.hasOwnProperty.call(NATIVE_ERRORS, nativeCode) ? NATIVE_ERRORS[nativeCode] : "UNKNOWN");
}

/** Minimal structural types, so this does not depend on lib.dom's Web Speech typings. */
interface RecognitionAlternativeLike { readonly transcript: string }
interface RecognitionResultLike { readonly isFinal: boolean; readonly length: number; readonly [index: number]: RecognitionAlternativeLike }
export interface RecognitionEventLike { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike } }
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

export function getSpeechRecognitionConstructor(scope: unknown = globalThis): SpeechRecognitionConstructorLike | null {
  if (!scope || typeof scope !== "object") return null;
  const candidates = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const constructor = candidates.SpeechRecognition ?? candidates.webkitSpeechRecognition;
  return typeof constructor === "function" ? (constructor as SpeechRecognitionConstructorLike) : null;
}

export interface VoiceCallbacks {
  onStart?(): void;
  onInterimTranscript?(text: string): void;
  onFinalTranscript?(text: string): void;
  onError?(error: VoiceError): void;
  onEnd?(): void;
}
export interface VoiceStartOptions { lang?: string; interimResults?: boolean }
export type VoiceStartResult = { ok: true } | { ok: false; error: VoiceError };

export interface BrowserVoiceService {
  /** false when the browser has no SpeechRecognition - callers should offer typing instead. */
  readonly supported: boolean;
  readonly listening: boolean;
  start(callbacks?: VoiceCallbacks, options?: VoiceStartOptions): VoiceStartResult;
  /** Stop listening and let the browser deliver any final transcript. */
  stop(): void;
  /** Stop immediately and discard any pending result. */
  abort(): void;
}

const MAX_TRANSCRIPT = 1000;
function clean(text: string): string { return text.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT); }
function defaultLang(scope: unknown): string {
  const language = (scope as { navigator?: { language?: unknown } } | null)?.navigator?.language;
  return typeof language === "string" && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language) ? language : "en-CA";
}

interface Session { recognition: SpeechRecognitionLike; abortedByCaller: boolean }

export function createBrowserVoiceService(scope: unknown = globalThis): BrowserVoiceService {
  const Recognition = getSpeechRecognitionConstructor(scope);
  let active: Session | null = null;

  return {
    get supported() { return Recognition !== null; },
    get listening() { return active !== null; },
    start(callbacks = {}, options = {}) {
      if (!Recognition) { const error = voiceError("NOT_SUPPORTED"); callbacks.onError?.(error); return { ok: false, error }; }
      if (active) return { ok: false, error: voiceError("ALREADY_LISTENING") };
      const recognition = new Recognition();
      const session: Session = { recognition, abortedByCaller: false };
      recognition.lang = options.lang && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(options.lang) ? options.lang : defaultLang(scope);
      recognition.continuous = false;
      recognition.interimResults = options.interimResults ?? true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => callbacks.onStart?.();
      recognition.onresult = event => {
        let interim = "";
        let final = "";
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) final += text; else interim += text;
        }
        const finalText = clean(final);
        const interimText = clean(interim);
        if (finalText) callbacks.onFinalTranscript?.(finalText);
        else if (interimText) callbacks.onInterimTranscript?.(interimText);
      };
      recognition.onerror = event => {
        const error = normalizeRecognitionError(event?.error);
        // The caller's own abort() is not an error worth surfacing.
        if (error.code === "ABORTED" && session.abortedByCaller) return;
        callbacks.onError?.(error);
      };
      recognition.onend = () => {
        if (active === session) active = null;
        callbacks.onEnd?.();
      };
      active = session;
      try { recognition.start(); } catch {
        active = null;
        const error = voiceError("START_FAILED");
        callbacks.onError?.(error);
        return { ok: false, error };
      }
      return { ok: true };
    },
    stop() { active?.recognition.stop(); },
    abort() {
      const current = active;
      if (!current) return;
      current.abortedByCaller = true;
      active = null;
      current.recognition.abort();
    },
  };
}
