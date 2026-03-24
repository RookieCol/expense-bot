import { Injectable } from '@nestjs/common';
import { ConversationState } from './conversation-state.enum';
import { ConversationContext } from './conversation-context.interface';
import { Expense } from '../shared/interfaces/expense.interface';

@Injectable()
export class ConversationService {
  private contexts = new Map<number, ConversationContext>();

  getContext(chatId: number): ConversationContext {
    if (!this.contexts.has(chatId)) {
      this.contexts.set(chatId, {
        state: ConversationState.IDLE,
        pendingExpense: {},
        manualStepIds: [],
      });
    }
    return this.contexts.get(chatId)!;
  }

  setState(chatId: number, state: ConversationState): void {
    this.getContext(chatId).state = state;
  }

  updatePending(chatId: number, data: Partial<Expense>): void {
    const ctx = this.getContext(chatId);
    ctx.pendingExpense = { ...ctx.pendingExpense, ...data };
  }

  setImageBuffer(chatId: number, buffer: Buffer): void {
    this.getContext(chatId).lastImageBuffer = buffer;
  }

  setEditingField(chatId: number, field: string): void {
    this.getContext(chatId).editingField = field;
  }

  setUserName(chatId: number, userName: string): void {
    this.getContext(chatId).userName = userName;
  }

  setLastBotMessageId(chatId: number, messageId: number): void {
    this.getContext(chatId).lastBotMessageId = messageId;
  }

  setEditStepMessageId(chatId: number, messageId: number | undefined): void {
    this.getContext(chatId).editStepMessageId = messageId;
  }

  addManualStepId(chatId: number, messageId: number): void {
    this.getContext(chatId).manualStepIds.push(messageId);
  }

  reset(chatId: number): void {
    const { userName, lastBotMessageId } = this.getContext(chatId);
    this.contexts.set(chatId, {
      state: ConversationState.IDLE,
      pendingExpense: {},
      manualStepIds: [],
      userName,
      lastBotMessageId,
    });
  }
}
