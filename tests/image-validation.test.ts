import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { decodeAndValidateImage } from '@/lib/server/image-validation';
import { MAX_IMAGE_BYTES } from '@/lib/domain/inspection';

function jpeg(size = 32): Buffer { const buf = Buffer.alloc(size, 0); buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; return buf; }
function png(size = 32): Buffer { const buf = Buffer.alloc(size, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf); return buf; }
function webp(size = 32): Buffer { const buf = Buffer.alloc(size, 0); Buffer.from('RIFF').copy(buf, 0); Buffer.from('WEBP').copy(buf, 8); return buf; }
function b64(buf: Buffer): string { return buf.toString('base64'); }

describe('server-side image validation', () => {
  it('accepts real JPEG, PNG and WEBP magic bytes regardless of a claimed extension', () => {
    expect(decodeAndValidateImage(b64(jpeg())).type).toBe('image/jpeg');
    expect(decodeAndValidateImage(b64(png())).type).toBe('image/png');
    expect(decodeAndValidateImage(b64(webp())).type).toBe('image/webp');
  });
  it('accepts a data: URL prefix the same way as raw base64', () => {
    expect(decodeAndValidateImage(`data:image/png;base64,${b64(png())}`).type).toBe('image/png');
  });
  it('never trusts a claimed MIME type or extension: content bytes decide', () => {
    // A GIF signature (not in the supported allowlist) must be rejected even if small.
    const gif = Buffer.from('GIF89a-not-a-real-image-------');
    expect(() => decodeAndValidateImage(b64(gif))).toThrow(/JPG, PNG, and WEBP/);
    // Plain text masquerading as an image must also be rejected.
    expect(() => decodeAndValidateImage(Buffer.from('hello world').toString('base64'))).toThrow();
  });
  it('rejects malformed base64 input', () => {
    expect(() => decodeAndValidateImage('not-valid-base64-!!!')).toThrow(/valid image/);
  });
  it('rejects images larger than the 10 MB limit before and after decoding', () => {
    const oversized = Buffer.concat([jpeg(3), Buffer.alloc(MAX_IMAGE_BYTES, 1)]);
    expect(() => decodeAndValidateImage(b64(oversized))).toThrow(/10 MB/);
  });
  it('never logs or otherwise reveals the raw image payload in its error output', () => {
    const gif = Buffer.from('GIF89a-secret-marker-bytes-xyz');
    try { decodeAndValidateImage(b64(gif)); } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-marker');
    }
  });
});
