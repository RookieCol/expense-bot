jest.mock('langfuse', () => ({ Langfuse: class {} }));

const mockGenerateObject = jest.fn();
jest.mock('ai', () => ({
  generateObject: mockGenerateObject,
  generateText: jest.fn(),
}));

const makeProvider = () => {
  // Factory doubles as a callable and as a namespace with .chat(),
  // mirroring the shape of the real @ai-sdk/openai provider.
  const factory = (modelId: string) => ({ modelId, provider: 'openai' });
  (factory as unknown as { chat: (id: string) => unknown }).chat = (
    modelId: string,
  ) => ({ modelId, provider: 'openai', api: 'chat' });
  return factory;
};
const mockCreateOpenAI = jest.fn().mockReturnValue(makeProvider());
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VercelAiConnector } from './vercel-ai.connector';
import { LangfuseService } from '../langfuse/langfuse.service';

describe('VercelAiConnector', () => {
  let connector: VercelAiConnector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VercelAiConnector,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-api-key') },
        },
        {
          provide: LangfuseService,
          useValue: { trace: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    connector = module.get(VercelAiConnector);
    connector.onModuleInit();
    jest.clearAllMocks();
    mockCreateOpenAI.mockReturnValue(makeProvider());
  });

  describe('extractFromImage', () => {
    const validExtraction = {
      fecha: '2026-04-20',
      proveedor: 'Supermercado',
      categoria: 'Cleaning',
      descripcion: 'Supplies',
      monto: 50.0,
    };

    it('calls generateObject with the Zod schema and returns the object', async () => {
      mockGenerateObject.mockResolvedValueOnce({ object: validExtraction });
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result).toEqual(validExtraction);
      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      const args = mockGenerateObject.mock.calls[0][0] as {
        schema: unknown;
        messages: unknown;
      };
      expect(args.schema).toBeDefined();
      expect(args.messages).toBeDefined();
    });

    it('falls back to the second model when the first fails', async () => {
      mockGenerateObject
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce({ object: validExtraction });
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result).toEqual(validExtraction);
      expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    });

    it('throws when all models fail', async () => {
      mockGenerateObject
        .mockRejectedValueOnce(new Error('first'))
        .mockRejectedValueOnce(new Error('second'));
      await expect(
        connector.extractFromImage(Buffer.from('fake')),
      ).rejects.toThrow('second');
    });
  });

  describe('extractFromText', () => {
    it('calls generateObject with the text prompt', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          fecha: '2026-04-20',
          proveedor: 'Ferrería',
          categoria: 'Maintenance',
          descripcion: 'Tornillos',
          monto: 35.5,
        },
      });
      const result = await connector.extractFromText(
        'Compré tornillos por 35.50',
      );
      expect(result.proveedor).toBe('Ferrería');
      const args = mockGenerateObject.mock.calls[0][0] as { prompt: string };
      expect(args.prompt).toContain('Compré tornillos');
    });
  });

  describe('classifyIntent', () => {
    it('returns the intent field from the structured output', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: { intent: 'MANUAL_EXPENSE' },
      });
      const result = await connector.classifyIntent(
        'quiero registrar un gasto',
      );
      expect(result).toBe('MANUAL_EXPENSE');
    });

    it('falls back to the second model when the first fails', async () => {
      mockGenerateObject
        .mockRejectedValueOnce(new Error('overloaded'))
        .mockResolvedValueOnce({ object: { intent: 'GREETING' } });
      const result = await connector.classifyIntent('hola');
      expect(result).toBe('GREETING');
      expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    });
  });

  describe('onModuleInit', () => {
    it('throws when OPENROUTER_API_KEY is missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VercelAiConnector,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
          {
            provide: LangfuseService,
            useValue: { trace: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();
      const c = module.get<VercelAiConnector>(VercelAiConnector);
      expect(() => c.onModuleInit()).toThrow('OPENROUTER_API_KEY is required');
    });
  });
});
