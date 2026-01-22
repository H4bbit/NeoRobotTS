# Use Node 24 (compatível com seu ambiente de dev)
FROM node:24

WORKDIR /app

# Instala ferramentas necessárias para compilar native addons (better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 build-essential pkg-config libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

# Copia apenas package*.json pra aproveitar cache
COPY package*.json ./

# Instala dependências de produção
RUN npm ci --omit=dev

# Copia o restante do projeto
COPY . .

# Build do TypeScript para gerar dist/
RUN npm run build

ENV NODE_ENV=production
# Porta que o container vai expor (Back4App define PORT via env)
EXPOSE 3000

# Start (usa o script start do package.json -> node dist/index.js)
CMD ["npm", "start"]
