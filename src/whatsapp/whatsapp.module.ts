import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { PhoneLinkModule } from './phone-link.module';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { StepMessenger } from '../telegram/step-messenger.service';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, PhoneLinkModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppAdapter,
    { provide: MESSAGING_PORT, useExisting: WhatsAppAdapter },
    WhatsAppDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
    TelegramDispatcher,
  ],
})
export class WhatsAppModule {}
