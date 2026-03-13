import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { configSchema } from './config/config.schema';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { I18nModule } from './i18n/i18n.module';
import { ConversationModule } from './conversation/conversation.module';
import { OpenAiModule } from './openai/openai.module';
import { SheetsModule } from './sheets/sheets.module';
import { DriveModule } from './drive/drive.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    I18nModule,
    ConversationModule,
    OpenAiModule,
    SheetsModule,
    DriveModule,
    TelegramModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
