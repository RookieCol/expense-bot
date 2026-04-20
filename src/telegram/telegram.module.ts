import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotProvider } from './bot.provider';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramService } from './telegram.service';
import { TelegramDispatcher } from './telegram.dispatcher';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { StepMessenger } from './step-messenger.service';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { PhoneLinkModule } from '../whatsapp/phone-link.module';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, PhoneLinkModule],
  controllers: [TelegramWebhookController],
  providers: [
    BotProvider,
    TelegramAdapter,
    { provide: MESSAGING_PORT, useExisting: TelegramAdapter },
    TelegramService,
    TelegramDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
  ],
})
export class TelegramModule {}
