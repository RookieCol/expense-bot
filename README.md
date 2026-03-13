# Expense Bot

Bot de Telegram para registrar gastos de un negocio, consultar historial y ver resumen mensual.
El proyecto esta construido con NestJS y usa Google Sheets como base de datos ligera.

## Que hace

- Registra gastos manuales guiando al usuario paso a paso.
- Procesa una foto de factura/recibo para extraer datos con IA.
- Acepta notas de voz y las transcribe para continuar el flujo normal del bot.
- Guarda cada gasto en Google Sheets.
- Sube imagenes a Google Drive y guarda el link publico.
- Responde consultas de ultimos gastos y resumen del mes por categoria.

## Stack y arquitectura

- **Framework:** NestJS (TypeScript)
- **Bot:** `node-telegram-bot-api` en modo polling
- **IA:** conectores en cadena (Gemini principal, OpenAI fallback)
- **Persistencia:** Google Sheets API
- **Archivos:** Google Drive API
- **Logs:** `nestjs-pino`
- **Config:** `@nestjs/config` + validacion con Joi

Modulos principales:
- `TelegramModule`: entrada de mensajes/callbacks y ruteo de intenciones.
- `AiModule`: clasificacion de intencion, OCR de recibos, transcripcion de audio.
- `GoogleModule`: autenticacion, escritura/lectura en Sheets, subida a Drive.
- `ConversationModule`: estado conversacional por chat.
- `I18nModule`: textos del bot.

## Variables de entorno

Crear un archivo `.env` en la raiz con:

```env
TELEGRAM_BOT_TOKEN=
GEMINI_API_KEY=
OPENAI_API_KEY=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=
PORT=3000
```

Notas:
- `OPENAI_API_KEY` es opcional (fallback).
- `GOOGLE_PRIVATE_KEY` debe conservar los saltos de linea (`\n`) si viene en una sola linea.
- `GOOGLE_DRIVE_FOLDER_ID` es opcional; si no se define, sube al Drive disponible para la cuenta.

## Instalacion y ejecucion

```bash
pnpm install
pnpm start:dev
```

Otros scripts utiles:

```bash
pnpm build
pnpm start:prod
pnpm lint
pnpm test
pnpm test:e2e
```

## Comandos de Telegram

- `/start`: muestra menu principal.
- `/gasto` o `/expense`: iniciar carga manual de gasto.
- `/factura` o `/receipt`: iniciar flujo de recibo por imagen.
- `/gastos` o `/expenses`: ver ultimos gastos.
- `/mes` o `/month`: resumen mensual.
- `/cancel` o `/cancelar`: cancelar flujo activo.

## Flujo funcional (resumen)

1. El usuario envia texto, foto o voz.
2. `TelegramDispatcher` enruta segun comando/estado/intencion.
3. Si hay imagen o voz, `AiService` extrae/transcribe.
4. Se confirma o completa informacion faltante con el usuario.
5. Se guarda gasto en `Google Sheets` y (si aplica) se sube imagen a `Google Drive`.

## Convenciones de desarrollo

- Se usa `pnpm`.
- Husky esta configurado para sanitizar mensajes de commit y remover trailers no deseados (`Co-authored-by`, `Made by`).
