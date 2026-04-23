import { Test, TestingModule } from '@nestjs/testing';
import { AiService, AI_CONNECTORS } from './ai.service';
import { AiUnavailableError } from './errors/ai-unavailable.error';
import { IAiConnector } from './connectors/ai-connector.interface';

const buildService = async (connectors: IAiConnector[]) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [AiService, { provide: AI_CONNECTORS, useValue: connectors }],
  }).compile();
  return module.get(AiService);
};

const makeConnector = (
  name: string,
  overrides: Partial<IAiConnector> = {},
): IAiConnector => ({
  name,
  extractFromImage: jest.fn().mockRejectedValue(new Error(`${name} down`)),
  extractFromText: jest.fn().mockRejectedValue(new Error(`${name} down`)),
  classifyIntent: jest.fn().mockRejectedValue(new Error(`${name} down`)),
  transcribeAudio: jest.fn().mockRejectedValue(new Error(`${name} down`)),
  ...overrides,
});

describe('AiService', () => {
  describe('extractFromImage', () => {
    it('returns from the first connector that succeeds', async () => {
      const a = makeConnector('A', {
        extractFromImage: jest.fn().mockResolvedValue({ monto: 50 }),
      });
      const b = makeConnector('B');
      const svc = await buildService([a, b]);

      await expect(svc.extractFromImage(Buffer.from('x'))).resolves.toEqual({
        monto: 50,
      });
      expect(b.extractFromImage).not.toHaveBeenCalled();
    });

    it('tries the next connector when the first throws', async () => {
      const a = makeConnector('A');
      const b = makeConnector('B', {
        extractFromImage: jest.fn().mockResolvedValue({ monto: 100 }),
      });
      const svc = await buildService([a, b]);

      await expect(svc.extractFromImage(Buffer.from('x'))).resolves.toEqual({
        monto: 100,
      });
      expect(a.extractFromImage).toHaveBeenCalled();
      expect(b.extractFromImage).toHaveBeenCalled();
    });

    it('throws AiUnavailableError when every connector fails', async () => {
      const svc = await buildService([makeConnector('A'), makeConnector('B')]);

      await expect(svc.extractFromImage(Buffer.from('x'))).rejects.toThrow(
        AiUnavailableError,
      );
      await expect(
        svc.extractFromImage(Buffer.from('x')),
      ).rejects.toMatchObject({
        task: 'extract-image',
        lastError: expect.any(Error),
      });
    });
  });

  describe('extractFromText', () => {
    it('throws AiUnavailableError when every connector fails', async () => {
      const svc = await buildService([makeConnector('only')]);
      await expect(svc.extractFromText('gasté 50')).rejects.toThrow(
        AiUnavailableError,
      );
      await expect(svc.extractFromText('gasté 50')).rejects.toMatchObject({
        task: 'extract-text',
      });
    });
  });

  describe('transcribeAudio', () => {
    it('throws AiUnavailableError when every connector fails', async () => {
      const svc = await buildService([makeConnector('only')]);
      await expect(svc.transcribeAudio(Buffer.from('x'))).rejects.toThrow(
        AiUnavailableError,
      );
      await expect(svc.transcribeAudio(Buffer.from('x'))).rejects.toMatchObject(
        {
          task: 'transcribe-audio',
        },
      );
    });
  });

  describe('classifyIntent', () => {
    it('returns the classification from the first successful connector', async () => {
      const a = makeConnector('A', {
        classifyIntent: jest.fn().mockResolvedValue('MANUAL_EXPENSE'),
      });
      const svc = await buildService([a]);
      await expect(svc.classifyIntent('gasté 50')).resolves.toBe(
        'MANUAL_EXPENSE',
      );
    });

    it('falls back silently to UNKNOWN when every connector fails (non-critical path)', async () => {
      const svc = await buildService([makeConnector('A'), makeConnector('B')]);
      await expect(svc.classifyIntent('anything')).resolves.toBe('UNKNOWN');
    });
  });
});
