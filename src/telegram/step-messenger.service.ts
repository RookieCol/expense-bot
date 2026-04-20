import { Injectable, Inject } from '@nestjs/common';
import type {
  MessagingPort,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';
import { ConversationService } from '../conversation/conversation.service';

@Injectable()
export class StepMessenger {
  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
  ) {}

  async send(
    chatId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.setEditStepMessageId(chatId, undefined);
    const msg = await this.messaging.sendText(chatId, text, opts);
    await Promise.all(
      toDelete.map((id) => this.messaging.deleteMessage(chatId, id)),
    );
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
    return msg;
  }
}
