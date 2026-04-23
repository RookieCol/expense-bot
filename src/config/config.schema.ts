import * as Joi from 'joi';

export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_TRANSPORT: Joi.string()
    .valid('polling', 'webhook')
    .default('polling'),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().optional(),
  TWILIO_ACCOUNT_SID: Joi.string().optional(),
  TWILIO_AUTH_TOKEN: Joi.string().optional(),
  TWILIO_WHATSAPP_NUMBER: Joi.string().optional(),
  WHATSAPP_WEBHOOK_URL: Joi.string().uri().optional(),
  UPSTASH_REDIS_REST_URL: Joi.string().uri().required(),
  UPSTASH_REDIS_REST_TOKEN: Joi.string().required(),
  LANGFUSE_SECRET_KEY: Joi.string().optional(),
  LANGFUSE_PUBLIC_KEY: Joi.string().optional(),
  LANGFUSE_BASEURL: Joi.string().uri().optional(),
  OPENROUTER_API_KEY: Joi.string().required(),
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().optional(),
  GOOGLE_CLIENT_EMAIL: Joi.string().email().optional(),
  GOOGLE_PRIVATE_KEY: Joi.string().optional(),
  GOOGLE_SHEET_ID: Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT: Joi.number().default(3000),
});
