import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { SheetsService } from '../../google/sheets.service';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { LangfuseService } from '../langfuse/langfuse.service';
import { conversationAgentSystemPrompt } from '../prompts/conversation-agent.prompt';
import { CATEGORIES } from '../../shared/categories';
import { Expense } from '../../shared/interfaces/expense.interface';

const categoryValues = CATEGORIES.map((c) => c.value) as [string, ...string[]];

export interface AgentReply {
  /** Assistant-facing text to show the user. */
  text: string;
  /**
   * When the model called saveExpense and we staged a pending expense,
   * the dispatcher should render the confirmation card. The card is
   * UI, not agent output — keeping it outside the agent lets the
   * existing callback buttons (`confirm_yes`, `edit_menu`) keep
   * working untouched.
   */
  pendingConfirmation?: boolean;
}

/**
 * Conversational agent that every text message flows through. Keeps a
 * short rolling transcript per chatId, has access to data tools, and
 * can stage a pending expense for the user to confirm via buttons.
 *
 * This replaces the older `classifyIntent → state machine` flow for
 * *text* input. Button callbacks still go through routeCallbackData
 * unchanged so confirmation/edit buttons work.
 */
@Injectable()
export class ConversationAgent implements OnModuleInit {
  private readonly logger = new Logger(ConversationAgent.name);
  private openrouter!: OpenAIProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: SheetsService,
    private readonly conversation: ConversationService,
    private readonly langfuse: LangfuseService,
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

  async handle(chatId: string, userText: string): Promise<AgentReply> {
    const trace = this.langfuse.trace('conversation.handle', {
      userId: chatId,
      sessionId: chatId,
      input: userText,
      metadata: { chatId },
    });

    // Append user turn before the call so the model sees it.
    this.conversation.appendHistory(chatId, {
      role: 'user',
      content: userText,
    });
    const history = this.conversation.getHistory(chatId);

    let pendingConfirmation = false;
    const gen = trace?.generation({
      name: 'conversation-agent',
      model: 'openai/gpt-4o-mini',
      input: userText,
    });

    const pendingNote = this.buildPendingNote(chatId);
    const system =
      conversationAgentSystemPrompt() +
      (pendingNote ? `\n\n${pendingNote}` : '');

    try {
      const { text, steps } = await generateText({
        model: this.openrouter.chat('openai/gpt-4o-mini'),
        system,
        messages: this.toModelMessages(history),
        tools: this.tools(chatId, () => {
          pendingConfirmation = true;
        }),
        stopWhen: stepCountIs(6),
      });

      const reply = text.trim() || '¿Me repites?';
      this.conversation.appendHistory(chatId, {
        role: 'assistant',
        content: reply,
      });
      this.logger.debug(
        `agent answered in ${steps.length} step(s) for ${chatId}`,
      );
      gen?.end({ output: reply, metadata: { steps: steps.length } });
      return { text: reply, pendingConfirmation };
    } catch (err) {
      gen?.end({
        level: 'ERROR',
        statusMessage: (err as Error).message,
      });
      throw err;
    }
  }

  /** Map our compact transcript to the AI SDK's ModelMessage shape. */
  private toModelMessages(
    history: {
      role: 'user' | 'assistant';
      content: string;
    }[],
  ): ModelMessage[] {
    return history.map((t) => ({ role: t.role, content: t.content }));
  }

  private buildPendingNote(chatId: string): string | null {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.state !== ConversationState.WAITING_CONFIRMATION) return null;
    const p = ctx.pendingExpense;
    if (!p || Object.keys(p).length === 0) return null;
    return `[GASTO PENDIENTE DE CONFIRMACIÓN]
El usuario está viendo una tarjeta de confirmación con este gasto:
- Fecha: ${p.fecha ?? 'no definida'}
- Proveedor: ${p.proveedor ?? 'no definido'}
- Categoría: ${p.categoria ?? 'no definida'}
- Descripción: ${p.descripcion ?? 'no definida'}
- Monto: ${p.monto != null ? `$${p.monto.toLocaleString('es-CO')}` : 'no definido'}

Si el usuario pide cambiar algún campo, usa editPendingExpense. NO uses saveExpense.`;
  }

  private tools(chatId: string, flagPending: () => void) {
    return {
      saveExpense: tool({
        description:
          'Registra un gasto nuevo. Queda en estado "pendiente de confirmación" — el usuario verá una pantalla de confirmación con botones. Úsalo en cuanto tengas al menos el monto; si falta algún campo, el usuario puede corregir desde la pantalla de edición.',
        inputSchema: z.object({
          monto: z.number().positive().describe('Monto en pesos colombianos.'),
          proveedor: z.string().default('').describe('Dónde se hizo el gasto.'),
          categoria: z.enum(categoryValues).describe('Categoría del gasto.'),
          descripcion: z
            .string()
            .default('')
            .describe('Descripción corta de lo comprado.'),
          fecha: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('Fecha YYYY-MM-DD. Default: hoy.'),
        }),
        execute: (fields) => {
          const pending: Partial<Expense> = {
            monto: fields.monto,
            proveedor: fields.proveedor,
            categoria: fields.categoria,
            descripcion: fields.descripcion,
            fecha: fields.fecha ?? new Date().toISOString().split('T')[0],
          };
          this.conversation.reset(chatId);
          this.conversation.updatePending(chatId, pending);
          this.conversation.setState(
            chatId,
            ConversationState.WAITING_CONFIRMATION,
          );
          flagPending();
          return {
            status: 'staged',
            message:
              'Gasto preparado. El usuario verá la pantalla de confirmación.',
          };
        },
      }),
      editPendingExpense: tool({
        description:
          'Actualiza uno o más campos del gasto que el usuario ya tiene pendiente de confirmación. Úsala cuando el usuario pida cambiar la categoría, el monto, el proveedor, la descripción o la fecha mientras ve la tarjeta de confirmación. El sistema mostrará la tarjeta actualizada automáticamente.',
        inputSchema: z.object({
          monto: z
            .number()
            .positive()
            .optional()
            .describe('Nuevo monto en pesos.'),
          proveedor: z
            .string()
            .optional()
            .describe('Nuevo nombre del proveedor.'),
          categoria: z
            .enum(categoryValues)
            .optional()
            .describe('Nueva categoría.'),
          descripcion: z.string().optional().describe('Nueva descripción.'),
          fecha: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('Nueva fecha YYYY-MM-DD.'),
        }),
        execute: (fields) => {
          const updates = Object.fromEntries(
            Object.entries(fields).filter(([, v]) => v !== undefined),
          ) as Partial<Expense>;
          this.conversation.updatePending(chatId, updates);
          flagPending();
          return {
            status: 'updated',
            message:
              'Campo(s) actualizado(s). El usuario verá la tarjeta de confirmación actualizada.',
          };
        },
      }),
      getRecentExpenses: tool({
        description: 'Últimos N gastos registrados, más recientes primero.',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).default(5),
        }),
        execute: async ({ limit }) => {
          const list = await this.sheets.getLastExpenses(limit);
          return list.map((e) => ({
            fecha: e.fecha,
            proveedor: e.proveedor,
            categoria: e.categoria,
            monto: e.monto,
            descripcion: e.descripcion,
          }));
        },
      }),
      getTotalSpent: tool({
        description:
          'Total gastado en un rango de fechas, opcionalmente por categoría. Devuelve total y cantidad de transacciones.',
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
          const total = list.reduce((s, e) => s + e.monto, 0);
          return { total, count: list.length };
        },
      }),
      getExpensesInRange: tool({
        description:
          'Lista gastos en un rango de fechas, opcionalmente por categoría.',
        inputSchema: z.object({
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          category: z.string().optional(),
        }),
        execute: async ({ fromDate, toDate, category }) => {
          return (
            await this.sheets.getExpenses({ fromDate, toDate, category })
          ).map((e) => ({
            fecha: e.fecha,
            proveedor: e.proveedor,
            categoria: e.categoria,
            monto: e.monto,
          }));
        },
      }),
      getMonthlySummary: tool({
        description:
          'Resumen de un mes: total, conteo, desglose por categoría.',
        inputSchema: z.object({
          yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
        }),
        execute: async ({ yearMonth }) =>
          this.sheets.getMonthlySummary(yearMonth),
      }),
    };
  }
}
