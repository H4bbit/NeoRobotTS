# ---------- STAGE 1: build ----------
FROM node:24 AS builder

WORKDIR /app

# Dependências completas (inclui dev)
COPY package*.json ./
RUN npm ci

# Código
COPY . .

# Build TypeScript -> dist/
RUN npm run build


# ---------- STAGE 2: runtime ----------
FROM node:24

WORKDIR /app

# Apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia apenas o resultado do build
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
