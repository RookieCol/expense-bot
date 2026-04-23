import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool } from 'ai';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { z } from 'zod';
import { SheetsService } from '../../google/sheets.service';
import { insightsSystemPrompt } from '../prompts/insights-agent.prompt';

/**
 * Multi-step agent that answers natural-language questions about the
 * user's expenses by calling Sheets-backed tools.
 *
 * Why tool-calling instead of a LangGraph state graph: the flow here
 * is short and agentic — the model decides how many tools to call
 * and in what order before composing an answer. The AI SDK's
 * generateText + stopWhen loop gives us exactly that without pulling
 * in @langchain/langgraph. If later flows need branching or parallel
 * execution with shared state, LangGraph becomes worth it.
 */
@Injectable()
export class ExpensesQueryAgent implements OnModuleInit {
  private readonly logger = new Logger(ExpensesQueryAgent.name);
  private openrouter!: OpenAIProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: SheetsService,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
    this.openrouter = createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': 'https://github.com/blocanico/expense-bot',
        'X-Title': 'expense-bot',
      },
    });
  }

  /**
   * Ask a natural-language question about expenses. Returns the
   * composed answer text. Throws if the agent cannot reach the model
   * after retries — callers should catch and show a friendly error.
   */
  async ask(question: string, chatId?: string): Promise<string> {
    const attrs = chatId ? { userId: chatId, sessionId: chatId } : {};
    return propagateAttributes(attrs, () =>
      startActiveObservation('insights.ask', async () => {
        const { text, steps } = await generateText({
          // .chat() forces Chat Completions API — OpenRouter does not
          // support the OpenAI Responses API that `openrouter(id)` uses
          // by default in @ai-sdk/openai v3.
          model: this.openrouter.chat('openai/gpt-4o-mini'),
          system: insightsSystemPrompt(),
          prompt: question,
          tools: this.tools(),
          stopWhen: stepCountIs(6),
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'insights.ask',
            metadata: { question },
          },
        });
        this.logger.debug(
          `insights.ask answered in ${steps.length} step(s): "${question}"`,
        );
        return text;
      }),
    );
  }

  /**
   * Tools are defined inline so they close over `this.sheets`. Each
   * tool's Zod input schema doubles as the model-facing function
   * signature — the model sees tool name + description + parameter
   * names/types and picks based on the user's question.
   */
  private tools() {
    return {
      getRecentExpenses: tool({
        description:
          'Devuelve los últimos N gastos registrados, más recientes primero. Útil para preguntas como "cuál fue mi último gasto" o "muéstrame los últimos 3".',
        inputSchema: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .describe('Cuántos gastos devolver (1-20).'),
        }),
        execute: async ({ limit }) => {
          const list = await this.sheets.getLastExpenses(limit);
          return list.map((e) => ({
            fecha: e.fecha,
            proveedor: e.proveedor,
            categoria: e.categoria,
            descripcion: e.descripcion,
            monto: e.monto,
          }));
        },
      }),
      getExpensesInRange: tool({
        description:
          'Devuelve todos los gastos entre dos fechas (inclusive), opcionalmente filtrados por categoría. Usa esto para preguntas que mencionan un mes, semana o rango específico.',
        inputSchema: z.object({
          fromDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('Fecha inicial en formato YYYY-MM-DD (inclusive).'),
          toDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('Fecha final en formato YYYY-MM-DD (inclusive).'),
          category: z
            .string()
            .optional()
            .describe(
              'Categoría exacta del enum. Omitir para todas las categorías.',
            ),
        }),
        execute: async ({ fromDate, toDate, category }) => {
          const list = await this.sheets.getExpenses({
            fromDate,
            toDate,
            category,
          });
          return list.map((e) => ({
            fecha: e.fecha,
            proveedor: e.proveedor,
            categoria: e.categoria,
            monto: e.monto,
          }));
        },
      }),
      getTotalSpent: tool({
        description:
          'Suma total gastada en un rango de fechas, opcionalmente filtrado por categoría. Devuelve también la cantidad de transacciones. Más barato que getExpensesInRange cuando solo te interesa el agregado.',
        inputSchema: z.object({
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          category: z.string().optional(),
        }),
        execute: async ({ fromDate, toDate, category }) => {
          const list = await this.sheets.getExpenses({
            fromDate,
            toDate,
            category,
          });
          const total = list.reduce((sum, e) => sum + e.monto, 0);
          return { total, count: list.length };
        },
      }),
      getMonthlySummary: tool({
        description:
          'Resumen de un mes específico: total, conteo y desglose por categoría. Usa esto cuando el usuario pida explícitamente un resumen.',
        inputSchema: z.object({
          yearMonth: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .describe('Mes en formato YYYY-MM.'),
        }),
        execute: async ({ yearMonth }) => {
          return this.sheets.getMonthlySummary(yearMonth);
        },
      }),
    };
  }
}
