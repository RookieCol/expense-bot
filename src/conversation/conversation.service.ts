import { Injectable } from '@nestjs/common';
import { ConversationState } from './conversation-state.enum';
import { ConversationContext } from './conversation-context.interface';
import { Expense } from '../shared/interfaces/expense.interface';

@Injectable()
export class ConversationService {
  private contexts = new Map<string, ConversationContext>();

  getContext(chatId: string): ConversationContext {
    if (!this.contexts.has(chatId)) {
      this.contexts.set(chatId, {
        state: ConversationState.IDLE,
        pendingExpense: {},
        manualStepIds: [],
        userMessageIds: [],
      });
    }
    return this.contexts.get(chatId)!;
  }

  setState(chatId: string, state: ConversationState): void {
    this.getContext(chatId).state = state;
  }

  updatePending(chatId: string, data: Partial<Expense>): void {
    const ctx = this.getContext(chatId);
    ctx.pendingExpense = { ...ctx.pendingExpense, ...data };
  }

  setImageBuffer(chatId: string, buffer: Buffer): void {
    this.getContext(chatId).lastImageBuffer = buffer;
  }

  setEditingField(chatId: string, field: string): void {
    this.getContext(chatId).editingField = field;
  }

  setUserName(chatId: string, userName: string): void {
    this.getContext(chatId).userName = userName;
  }

  setLastBotMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).lastBotMessageId = messageId;
  }

  setEditStepMessageId(chatId: string, messageId: string | undefined): void {
    this.getContext(chatId).editStepMessageId = messageId;
  }

  addManualStepId(chatId: string, messageId: string): void {
    this.getContext(chatId).manualStepIds.push(messageId);
  }

  addUserMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).userMessageIds.push(messageId);
  }

  reset(chatId: string): void {
    const { userName, lastBotMessageId } = this.getContext(chatId);
    this.contexts.set(chatId, {
      state: ConversationState.IDLE,
      pendingExpense: {},
      manualStepIds: [],
      userMessageIds: [],
      userName,
      lastBotMessageId,
    });
  }
}
