import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { VercelAiConnector } from './connectors/vercel-ai.connector';
import { IAiConnector } from './connectors/ai-connector.interface';
import { LangfuseService } from './langfuse/langfuse.service';

@Module({
  imports: [ConfigModule],
  providers: [
    LangfuseService,
    VercelAiConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (c: VercelAiConnector): IAiConnector[] => [c],
      inject: [VercelAiConnector],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
