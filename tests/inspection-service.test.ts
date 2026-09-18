import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { InspectionService } from '@/lib/server/services/inspection';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';
import type { ImageInspector } from '@/lib/server/services/live-contracts';

function png(): Buffer { const buf = Buffer.alloc(24, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf); return buf; }
const imageBase64 = png().toString('base64');

afterEach(() => vi.unstubAllEnvs());

describe('InspectionService', () => {
  it('validates the image and makes exactly one live analysis call by default', async () => {
    const inspector: ImageInspector = { analyzeInspectionImage: vi.fn().mockResolvedValue(inspectionFixtures['broken-office-chair-caster']) };
    const service = new InspectionService(inspector);
    const result = await service.analyze(imageBase64, new AbortController().signal);
    expect(result.source).toBe('live');
    expect(inspector.analyzeInspectionImage).toHaveBeenCalledOnce();
    const [image] = vi.mocked(inspector.analyzeInspectionImage).mock.calls[0];
    expect(image.type).toBe('image/png');
  });
  it('rejects an invalid image before ever calling the model', async () => {
    const inspector: ImageInspector = { analyzeInspectionImage: vi.fn() };
    const service = new InspectionService(inspector);
    await expect(service.analyze(Buffer.from('not an image').toString('base64'), new AbortController().signal)).rejects.toThrow();
    expect(inspector.analyzeInspectionImage).not.toHaveBeenCalled();
  });
  it('never silently uses a fixture: the live path runs unless SENTINEL_INSPECT_FIXTURE is explicitly set', async () => {
    const inspector: ImageInspector = { analyzeInspectionImage: vi.fn().mockResolvedValue(inspectionFixtures['broken-office-chair-caster']) };
    const service = new InspectionService(inspector);
    const result = await service.analyze(imageBase64, new AbortController().signal);
    expect(result.source).toBe('live');
  });
  it('returns a clearly labelled DEVELOPMENT FIXTURE only when explicitly configured, and skips the paid call', async () => {
    vi.stubEnv('SENTINEL_INSPECT_FIXTURE', 'broken-office-chair-caster');
    const inspector: ImageInspector = { analyzeInspectionImage: vi.fn() };
    const service = new InspectionService(inspector);
    const result = await service.analyze(imageBase64, new AbortController().signal);
    expect(result.source).toBe('fixture');
    expect(result.analysis).toEqual(inspectionFixtures['broken-office-chair-caster']);
    expect(inspector.analyzeInspectionImage).not.toHaveBeenCalled();
  });
  it('rejects an unknown configured fixture name instead of silently falling back to live', async () => {
    vi.stubEnv('SENTINEL_INSPECT_FIXTURE', 'not-a-real-fixture');
    const inspector: ImageInspector = { analyzeInspectionImage: vi.fn() };
    const service = new InspectionService(inspector);
    await expect(service.analyze(imageBase64, new AbortController().signal)).rejects.toThrow();
    expect(inspector.analyzeInspectionImage).not.toHaveBeenCalled();
  });
});
