# syntax=docker/dockerfile:1

# ── Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ARG SHOPIFY_API_KEY
ARG SHOPIFY_APP_URL
ARG REDIRECT_URL

# Keep development so npm ci installs vite/typescript (devDependencies)
ENV NODE_ENV=development
ENV SHOPIFY_API_KEY=${SHOPIFY_API_KEY}
ENV SHOPIFY_APP_URL=${SHOPIFY_APP_URL}
ENV REDIRECT_URL=${REDIRECT_URL}

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ── Production runtime ─────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ARG SHOPIFY_API_KEY
ARG SHOPIFY_APP_URL
ARG REDIRECT_URL

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SHOPIFY_API_KEY=${SHOPIFY_API_KEY}
ENV SHOPIFY_APP_URL=${SHOPIFY_APP_URL}
ENV REDIRECT_URL=${REDIRECT_URL}

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npm cache clean --force \
  && npx prisma generate

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
# Runtime theme inject reads these from disk (not bundled into Remix server)
COPY --from=build /app/app/theme-inject ./app/theme-inject
COPY --from=build /app/extensions/filter-search/snippets ./extensions/filter-search/snippets
COPY --from=build /app/extensions/filter-search/assets ./extensions/filter-search/assets

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
