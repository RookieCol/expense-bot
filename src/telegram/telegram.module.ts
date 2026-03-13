import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotProvider } from './bot.provider';
import { TelegramService } from './telegram.service';
import { TelegramDispatcher } from './telegram.dispatcher';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule],
  providers: [
    BotProvider,
    TelegramService,
    TelegramDispatcher,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
  ],
})
export class TelegramModule {}
