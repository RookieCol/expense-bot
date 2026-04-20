jest.mock('langfuse', () => ({ Langfuse: class {} }));

const mockGenerateText = jest.fn();
jest.mock('ai', () => ({
  generateText: mockGenerateText,
  stepCountIs: jest.fn((n: number) => ({ kind: 'stepCount', n })),
  tool: jest.fn((def: unknown) => def),
}));

const mockCreateOpenAI = jest.fn().mockReturnValue((modelId: string) => ({
  modelId,
  provider: 'openai',
}));
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExpensesQueryAgent } from './expenses-query.agent';
import { SheetsService } from '../../google/sheets.service';
import { LangfuseService } from '../langfuse/langfuse.service';

describe('ExpensesQueryAgent', () => {
  let agent: ExpensesQueryAgent;
  let sheets: {
    getLastExpenses: jest.Mock;
    getExpenses: jest.Mock;
    getMonthlySummary: jest.Mock;
  };

  beforeEach(async () => {
    sheets = {
      getLastExpenses: jest.fn().mockResolvedValue([]),
      getExpenses: jest.fn().mockResolvedValue([]),
      getMonthlySummary: jest.fn().mockResolvedValue({
        mes: '2026-04',
        total: 0,
        porCategoria: {},
        cantidadGastos: 0,
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesQueryAgent,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-api-key') },
        },
        { provide: SheetsService, useValue: sheets },
        {
          provide: LangfuseService,
          useValue: { trace: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    agent = module.get(ExpensesQueryAgent);
    agent.onModuleInit();
    jest.clearAllMocks();
  });

  it('returns the composed answer from generateText', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Gastaste $80.000 en limpieza.',
      steps: [{}, {}],
    });
    const result = await agent.ask('¿cuánto gasté en limpieza?');
    expect(result).toBe('Gastaste $80.000 en limpieza.');
  });

  it('passes the system prompt and user question to the model', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok', steps: [] });
    await agent.ask('hola');
    const args = mockGenerateText.mock.calls[0][0] as {
      system: string;
      prompt: string;
      tools: Record<string, unknown>;
    };
    expect(args.system).toContain('asistente analítico');
    expect(args.prompt).toBe('hola');
    expect(Object.keys(args.tools)).toEqual(
      expect.arrayContaining([
        'getRecentExpenses',
        'getExpensesInRange',
        'getTotalSpent',
        'getMonthlySummary',
      ]),
    );
  });

  it('exposes tools whose execute calls the underlying SheetsService', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '', steps: [] });
    await agent.ask('trigger');
    const tools = mockGenerateText.mock.calls[0][0].tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >;

    sheets.getExpenses.mockResolvedValueOnce([
      {
        fecha: '2026-04-20',
        proveedor: 'Mercado',
        categoria: 'Cleaning',
        descripcion: 'x',
        monto: 80000,
      },
    ]);
    const ranged = await tools.getExpensesInRange.execute({
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      category: 'Cleaning',
    });
    expect(sheets.getExpenses).toHaveBeenCalledWith({
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      category: 'Cleaning',
    });
    expect(Array.isArray(ranged)).toBe(true);

    sheets.getExpenses.mockResolvedValueOnce([
      { fecha: '2026-04-20', monto: 50000 } as never,
      { fecha: '2026-04-21', monto: 30000 } as never,
    ]);
    const total = await tools.getTotalSpent.execute({
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
    });
    expect(total).toEqual({ total: 80000, count: 2 });

    await tools.getMonthlySummary.execute({ yearMonth: '2026-04' });
    expect(sheets.getMonthlySummary).toHaveBeenCalledWith('2026-04');

    await tools.getRecentExpenses.execute({ limit: 3 });
    expect(sheets.getLastExpenses).toHaveBeenCalledWith(3);
  });

  it('propagates model errors to the caller', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('openrouter 500'));
    await expect(agent.ask('hola')).rejects.toThrow('openrouter 500');
  });

  it('throws on module init when OPENROUTER_API_KEY is missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesQueryAgent,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: SheetsService, useValue: sheets },
        {
          provide: LangfuseService,
          useValue: { trace: jest.fn() },
        },
      ],
    }).compile();
    const a = module.get<ExpensesQueryAgent>(ExpensesQueryAgent);
    expect(() => a.onModuleInit()).toThrow('OPENROUTER_API_KEY is required');
  });
});
