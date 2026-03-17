// src/ai/connectors/openrouter.connector.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenRouterConnector } from './openrouter.connector';

const mockGetText = jest.fn();
const mockCallModel = jest.fn(() => ({ getText: mockGetText }));

jest.mock('@openrouter/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    callModel: mockCallModel,
  })),
}));

describe('OpenRouterConnector', () => {
  let connector: OpenRouterConnector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenRouterConnector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
      ],
    }).compile();

    connector = module.get<OpenRouterConnector>(OpenRouterConnector);
    connector.onModuleInit();
    jest.clearAllMocks();
    mockCallModel.mockReturnValue({ getText: mockGetText });
  });

  describe('tryModels (via classifyIntent)', () => {
    it('returns result from first model when it succeeds', async () => {
      mockGetText.mockResolvedValueOnce('GREETING');
      const result = await connector.classifyIntent('hola');
      expect(result).toBe('GREETING');
      expect(mockCallModel).toHaveBeenCalledTimes(1);
    });

    it('tries second model when first fails', async () => {
      mockGetText
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce('GREETING');
      const result = await connector.classifyIntent('hola');
      expect(result).toBe('GREETING');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws last error when all models fail', async () => {
      mockGetText
        .mockRejectedValueOnce(new Error('first fail'))
        .mockRejectedValueOnce(new Error('second fail'));
      await expect(connector.classifyIntent('hola')).rejects.toThrow('second fail');
    });

    it('throws immediately when models array is empty', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (connector as any).tryModels([], async () => 'x'),
      ).rejects.toThrow('No models configured for this task');
    });
  });

  describe('classifyIntent', () => {
    it('returns trimmed string from model', async () => {
      mockGetText.mockResolvedValueOnce('  MANUAL_EXPENSE  ');
      const result = await connector.classifyIntent('gasté 100 en limpieza');
      expect(result).toBe('MANUAL_EXPENSE');
    });
  });

  describe('extractFromImage', () => {
    const validJson = JSON.stringify({
      fecha: '2026-03-17',
      proveedor: 'Supermercado',
      categoria: 'Cleaning',
      descripcion: 'Supplies',
      monto: 50.0,
    });

    it('parses valid JSON response', async () => {
      mockGetText.mockResolvedValueOnce(validJson);
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
      expect(result.monto).toBe(50.0);
    });

    it('strips markdown code fences before parsing', async () => {
      mockGetText.mockResolvedValueOnce('```json\n' + validJson + '\n```');
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
    });

    it('tries fallback model when JSON parse fails', async () => {
      mockGetText
        .mockResolvedValueOnce('not valid json')
        .mockResolvedValueOnce(validJson);
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });
  });

  describe('transcribeAudio', () => {
    it('returns transcription text', async () => {
      mockGetText.mockResolvedValueOnce('compramos escobas nuevas');
      const result = await connector.transcribeAudio(Buffer.from('fake-ogg'));
      expect(result).toBe('compramos escobas nuevas');
    });

    it('throws and tries fallback when response is empty string', async () => {
      mockGetText
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('compramos escobas nuevas');
      const result = await connector.transcribeAudio(Buffer.from('fake-ogg'));
      expect(result).toBe('compramos escobas nuevas');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws last error when all models return empty', async () => {
      mockGetText
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');
      await expect(
        connector.transcribeAudio(Buffer.from('fake-ogg')),
      ).rejects.toThrow();
    });
  });

  describe('onModuleInit', () => {
    it('throws when OPENROUTER_API_KEY is missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OpenRouterConnector,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();
      const c = module.get<OpenRouterConnector>(OpenRouterConnector);
      expect(() => c.onModuleInit()).toThrow('OPENROUTER_API_KEY is required');
    });
  });
});
