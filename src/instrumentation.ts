import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;

if (publicKey && secretKey) {
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey,
        secretKey,
        baseUrl:
          process.env.LANGFUSE_BASE_URL ??
          process.env.LANGFUSE_BASEURL ??
          'https://cloud.langfuse.com',
        environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'production',
        exportMode: 'immediate',
      }),
    ],
  });
  tracerProvider.register();

  console.log(
    `[Langfuse OTel] enabled (${process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com'})`,
  );
} else {
  console.log('[Langfuse OTel] disabled (credentials not set)');
}
