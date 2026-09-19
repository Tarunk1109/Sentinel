/** Transcript hygiene. A transcript is untrusted user DATA; nothing here interprets it as instructions. */
export const VOICE_TRANSCRIPT_MAX = 1000;

/** Display/forwarding form: Unicode-normalized, control characters removed, whitespace collapsed. */
export function normalizeTranscript(raw: string): string {
  let cleaned = "";
  for (const character of raw.normalize("NFKC")) {
    const code = character.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : character;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, VOICE_TRANSCRIPT_MAX);
}

/** Matching form: lowercase, accents and smart quotes flattened ("Café" -> "cafe"). */
export function matchingText(transcript: string): string {
  return normalizeTranscript(transcript)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, "\"")
    .replace(/\bauto[\s-]pilot/g, "autopilot")
    .replace(/\s+/g, " ").trim();
}

export interface Token { text: string; start: number; end: number }

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /ca\$|c\$|us\$|\$|€|£|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|[a-z]+(?:'[a-z]+)?/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
