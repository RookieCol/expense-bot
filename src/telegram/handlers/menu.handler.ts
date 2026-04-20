import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
    private readonly step: StepMessenger,
  ) {}

  async showMenu(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.reset(chatId);
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('menu.welcome'),
      [
        { title: '', options: [
          { id: 'cmd_gasto',  label: this.i18n.get('menu.btn_log_expense') },
          { id: 'cmd_gastos', label: this.i18n.get('menu.btn_recent') },
          { id: 'cmd_mes',    label: this.i18n.get('menu.btn_summary') },
        ]},
      ],
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async startExpenseFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.ask_amount'),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  async startReceiptFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.step.send(chatId, this.i18n.get('receipt.ask'), { parseMode: 'MarkdownV2' });
  }

  async showExpenseMethodMenu(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.setEditStepMessageId(chatId, undefined);
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('menu.expense_method_prompt'),
      [
        { title: '', options: [
          { id: 'method_receipt', label: this.i18n.get('menu.btn_receipt') },
          { id: 'method_dictate', label: this.i18n.get('menu.btn_dictate') },
          { id: 'method_manual',  label: this.i18n.get('menu.btn_manual')  },
          { id: 'back_menu',      label: this.i18n.get('general.back_to_menu') },
        ]},
      ],
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async startDictateFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_VOICE_EXPENSE);
    await this.step.send(chatId, this.i18n.get('expense.dictate_ask'), { parseMode: 'MarkdownV2' });
  }

  async handleCancel(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.reset(chatId);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('general.cancelled'),
      { parseMode: 'MarkdownV2' },
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async handleUnknown(chatId: string): Promise<void> {
    await this.messaging.sendText(chatId, this.i18n.get('nlp.unknown'), { parseMode: 'MarkdownV2' });
  }

  async showVincularPrompt(chatId: string): Promise<void> {
    await this.messaging.sendText(
      chatId,
      '📱 Comparte tu número de teléfono para vincular tu cuenta de WhatsApp\\.\n\nUsa el botón "Compartir contacto" debajo\\.',
      { parseMode: 'MarkdownV2' },
    );
  }
}
