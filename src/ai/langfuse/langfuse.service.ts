import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse, LangfuseTraceClient } from 'langfuse';

/**
 * Thin wrapper around the Langfuse JS SDK for AI call tracing.
 *
 * If LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY are not configured,
 * every method is a no-op — traces silently disappear. This lets us
 * instrument AI calls unconditionally without forcing every developer
 * to set up Langfuse.
 */
@Injectable()
export class LangfuseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LangfuseService.name);
  private client?: Langfuse;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.config.get<string>('LANGFUSE_SECRET_KEY');
    const publicKey = this.config.get<string>('LANGFUSE_PUBLIC_KEY');
    const baseUrl =
      this.config.get<string>('LANGFUSE_BASEURL') ??
      'https://cloud.langfuse.com';
    if (!secretKey || !publicKey) {
      this.logger.log('Langfuse disabled (credentials not set)');
      return;
    }
    // flushAt:1 + flushInterval:0 sends every event immediately.
    // On Render (ephemeral process), batching risks losing traces before flush.
    this.client = new Langfuse({
      secretKey,
      publicKey,
      baseUrl,
      flushAt: 1,
      flushInterval: 0,
    });
    this.logger.log(`Langfuse enabled (${baseUrl})`);
  }

  /**
   * Start a new trace. Returns undefined when Langfuse is disabled, so
   * callers should write `trace?.generation(...)`.
   *
   * Pass `userId` (e.g. chatId) and `sessionId` so Langfuse can group
   * traces by user and conversation session in the dashboard.
   */
  trace(
    name: string,
    options?: {
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
      input?: unknown;
    },
  ): LangfuseTraceClient | undefined {
    return this.client?.trace({ name, ...options });
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.shutdownAsync();
    } catch (err) {
      this.logger.warn(`Langfuse shutdown failed: ${(err as Error).message}`);
    }
  }
}
