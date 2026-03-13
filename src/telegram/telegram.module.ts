import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ConversationModule } from '../conversation/conversation.module';
import { OpenAiModule } from '../openai/openai.module';
import { SheetsModule } from '../sheets/sheets.module';
import { DriveModule } from '../drive/drive.module';

@Module({
  imports: [ConversationModule, OpenAiModule, SheetsModule, DriveModule],
  providers: [TelegramService],
})
export class TelegramModule {}
