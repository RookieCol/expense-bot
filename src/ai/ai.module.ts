import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { VercelAiConnector } from './connectors/vercel-ai.connector';
import { IAiConnector } from './connectors/ai-connector.interface';
import { LangfuseService } from './langfuse/langfuse.service';
import { ExpensesQueryAgent } from './agents/expenses-query.agent';
import { ConversationAgent } from './agents/conversation.agent';
import { GoogleModule } from '../google/google.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [ConfigModule, GoogleModule, ConversationModule],
  providers: [
    LangfuseService,
    VercelAiConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (c: VercelAiConnector): IAiConnector[] => [c],
      inject: [VercelAiConnector],
    },
    AiService,
    ExpensesQueryAgent,
    ConversationAgent,
  ],
  exports: [AiService, ExpensesQueryAgent, ConversationAgent],
})
export class AiModule {}
