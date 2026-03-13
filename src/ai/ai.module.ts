import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { GeminiConnector } from './connectors/gemini.connector';
import { OpenAiConnector } from './connectors/openai.connector';
import { IAiConnector } from './connectors/ai-connector.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    GeminiConnector,
    OpenAiConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (
        gemini: GeminiConnector,
        openai: OpenAiConnector,
      ): IAiConnector[] => [gemini, openai],
      inject: [GeminiConnector, OpenAiConnector],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
