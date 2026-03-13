import * as Joi from 'joi';

export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_TRANSPORT: Joi.string().valid('polling', 'webhook').default('polling'),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().optional(),
  GEMINI_API_KEY: Joi.string().required(),
  OPENAI_API_KEY: Joi.string().optional(), // fallback only; connector skips init if absent
  GOOGLE_CLIENT_EMAIL: Joi.string().email().required(),
  GOOGLE_PRIVATE_KEY: Joi.string().required(),
  GOOGLE_SHEET_ID: Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT: Joi.number().default(3000),
});
