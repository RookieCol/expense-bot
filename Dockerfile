# ── Stage 1: build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-alpine

# ffmpeg for OGG→MP3 conversion (voice notes)
RUN apk add --no-cache ffmpeg

RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main"]
