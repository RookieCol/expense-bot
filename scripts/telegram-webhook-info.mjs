#!/usr/bin/env node

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
const res = await fetch(url);
const data = await res.json();

if (!res.ok || !data.ok) {
  console.error('Telegram API error:', data);
  process.exit(1);
}

console.log(JSON.stringify(data.result, null, 2));
