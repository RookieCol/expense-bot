import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { OpenRouterConnector } from './connectors/openrouter.connector';
import { IAiConnector } from './connectors/ai-connector.interface';
import { LangfuseService } from './langfuse/langfuse.service';

@Module({
  imports: [ConfigModule],
  providers: [
    LangfuseService,
    OpenRouterConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (or: OpenRouterConnector): IAiConnector[] => [or],
      inject: [OpenRouterConnector],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
