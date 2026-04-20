import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';
import { ExpensesQueryAgent } from '../../ai/agents/expenses-query.agent';

@Injectable()
export class InsightsHandler {
  private readonly logger = new Logger(InsightsHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
    private readonly agent: ExpensesQueryAgent,
  ) {}

  /** Entry: user tapped the "💬 Pregúntale al bot" menu option. */
  async start(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_QUESTION);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('insights.ask'),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  /** Called by the dispatcher when the user is in WAITING_QUESTION. */
  async handleQuestion(chatId: string, question: string): Promise<void> {
    const thinking = await this.messaging.sendText(
      chatId,
      this.i18n.get('insights.thinking'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      const answer = await this.agent.ask(question);
      await this.messaging.deleteMessage(chatId, thinking.messageId);
      this.conversation.reset(chatId);
      const reply = await this.messaging.sendText(chatId, answer);
      this.conversation.setLastBotMessageId(chatId, reply.messageId);
    } catch (err) {
      this.logger.error(
        `insights.ask failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.messaging.deleteMessage(chatId, thinking.messageId);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, this.i18n.get('insights.error'), {
        parseMode: 'MarkdownV2',
      });
    }
  }
}
