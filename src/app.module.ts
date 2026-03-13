import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { I18nModule } from './i18n/i18n.module';
import { ConversationModule } from './conversation/conversation.module';
import { OpenAiModule } from './openai/openai.module';
import { SheetsModule } from './sheets/sheets.module';
import { DriveModule } from './drive/drive.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    I18nModule,
    ConversationModule,
    OpenAiModule,
    SheetsModule,
    DriveModule,
    TelegramModule,
  ],
})
export class AppModule {}
