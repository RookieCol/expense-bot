import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { REDIS_CLIENT } from '../shared/redis/redis.provider';
import { ConversationState } from './conversation-state.enum';
import {
  ConversationContext,
  ConversationTurn,
} from './conversation-context.interface';
import { Expense } from '../shared/interfaces/expense.interface';

// Cap the rolling transcript so the Redis blob stays small and we
// don't blow the LLM context window on very chatty users.
const MAX_HISTORY_TURNS = 20;

/**
 * Session-scoped conversation state with write-through Redis persistence.
 *
 * Pattern:
 *  - Dispatchers call `await load(chatId)` at webhook entry and
 *    `await flush(chatId)` after the handler chain completes.
 *  - Handlers keep using the sync mutation API (setState, updatePending, ...)
 *    which marks the chatId dirty. flush writes to Redis only if dirty.
 *  - `lastImageBuffer` is kept in a separate in-memory Map and never
 *    persisted — post-restart, the user resends the photo.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly cache = new Map<string, ConversationContext>();
  private readonly imageBuffers = new Map<string, Buffer>();
  private readonly dirty = new Set<string>();

  // 2h TTL — conversations older than this are almost certainly abandoned.
  private readonly ttlSeconds = 60 * 60 * 2;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Hydrate the in-memory cache for chatId from Redis. Idempotent —
   * if already cached, does nothing. Call at webhook entry.
   */
  async load(chatId: string): Promise<void> {
    if (this.cache.has(chatId)) return;
    try {
      const stored = await this.redis.get<ConversationContext>(
        this.key(chatId),
      );
      this.cache.set(chatId, stored ?? this.freshContext());
    } catch (err) {
      this.logger.warn(
        `Redis load failed for ${chatId}, starting fresh: ${(err as Error).message}`,
      );
      this.cache.set(chatId, this.freshContext());
    }
  }

  /**
   * Persist the cached context to Redis if it was mutated this request.
   * Does NOT evict the in-memory entry — multiple nested dispatch calls
   * for the same chatId within one webhook (e.g. Telegram photo path
   * invoking both dispatchMessage and receipt.handlePhotoBuffer) safely
   * share the same cached object. Call at the end of every webhook
   * handler; subsequent webhooks re-read from Redis on load().
   */
  async flush(chatId: string): Promise<void> {
    if (!this.dirty.has(chatId)) return;
    this.dirty.delete(chatId);
    const ctx = this.cache.get(chatId);
    if (!ctx) return;
    try {
      await this.redis.set(this.key(chatId), ctx, { ex: this.ttlSeconds });
    } catch (err) {
      this.logger.warn(
        `Redis flush failed for ${chatId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Force a reload from Redis on next access. Useful after flushing and
   * needing to observe fresh data (e.g. across separate webhook requests).
   */
  evict(chatId: string): void {
    this.cache.delete(chatId);
    this.imageBuffers.delete(chatId);
  }

  getContext(chatId: string): ConversationContext {
    if (!this.cache.has(chatId)) this.cache.set(chatId, this.freshContext());
    const ctx = this.cache.get(chatId)!;
    const buf = this.imageBuffers.get(chatId);
    if (buf) ctx.lastImageBuffer = buf;
    return ctx;
  }

  setState(chatId: string, state: ConversationState): void {
    this.getContext(chatId).state = state;
    this.markDirty(chatId);
  }

  updatePending(chatId: string, data: Partial<Expense>): void {
    const ctx = this.getContext(chatId);
    ctx.pendingExpense = { ...ctx.pendingExpense, ...data };
    this.markDirty(chatId);
  }

  setImageBuffer(chatId: string, buffer: Buffer): void {
    // Buffers are large and ephemeral — keep in-memory only.
    this.imageBuffers.set(chatId, buffer);
  }

  setEditingField(chatId: string, field: string): void {
    this.getContext(chatId).editingField = field;
    this.markDirty(chatId);
  }

  setUserName(chatId: string, userName: string): void {
    this.getContext(chatId).userName = userName;
    this.markDirty(chatId);
  }

  setLastBotMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).lastBotMessageId = messageId;
    this.markDirty(chatId);
  }

  setEditStepMessageId(chatId: string, messageId: string | undefined): void {
    this.getContext(chatId).editStepMessageId = messageId;
    this.markDirty(chatId);
  }

  addManualStepId(chatId: string, messageId: string): void {
    this.getContext(chatId).manualStepIds.push(messageId);
    this.markDirty(chatId);
  }

  addUserMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).userMessageIds.push(messageId);
    this.markDirty(chatId);
  }

  setPendingMenuOptions(chatId: string, optionIds: string[]): void {
    this.getContext(chatId).pendingMenuOptions = optionIds;
    this.markDirty(chatId);
  }

  getPendingMenuOptions(chatId: string): string[] | undefined {
    return this.getContext(chatId).pendingMenuOptions;
  }

  clearPendingMenuOptions(chatId: string): void {
    this.getContext(chatId).pendingMenuOptions = undefined;
    this.markDirty(chatId);
  }

  /** Append a turn to the rolling transcript used by the conversation
   * agent. Trims to the last MAX_HISTORY_TURNS entries. */
  appendHistory(chatId: string, turn: ConversationTurn): void {
    const ctx = this.getContext(chatId);
    ctx.history = [...(ctx.history ?? []), turn].slice(-MAX_HISTORY_TURNS);
    this.markDirty(chatId);
  }

  getHistory(chatId: string): ConversationTurn[] {
    return this.getContext(chatId).history ?? [];
  }

  clearHistory(chatId: string): void {
    this.getContext(chatId).history = [];
    this.markDirty(chatId);
  }

  reset(chatId: string): void {
    const { userName, lastBotMessageId } = this.getContext(chatId);
    this.cache.set(chatId, {
      ...this.freshContext(),
      userName,
      lastBotMessageId,
    });
    this.imageBuffers.delete(chatId);
    this.markDirty(chatId);
  }

  private markDirty(chatId: string): void {
    this.dirty.add(chatId);
  }

  private key(chatId: string): string {
    return `conv:${chatId}`;
  }

  private freshContext(): ConversationContext {
    return {
      state: ConversationState.IDLE,
      pendingExpense: {},
      manualStepIds: [],
      userMessageIds: [],
    };
  }
}
