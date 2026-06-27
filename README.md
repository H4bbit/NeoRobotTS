NeoRobotTS 🤖

Bot de WhatsApp escrito em TypeScript utilizando Baileys, com suporte a execução em ambiente Termux (Android).

---

📌 Visão geral

Este projeto implementa um bot de WhatsApp baseado em eventos usando a biblioteca Baileys, com persistência de sessão via better-sqlite3 e arquitetura modular em TypeScript.

Ele foi desenvolvido e testado diretamente no Termux (Android ARM64), sem necessidade de PC.

---

⚙️ Stack

Node.js (>= 24.x recomendado no Termux)

TypeScript

Baileys (WhatsApp Web API)

better-sqlite3 (persistência local)

SQLite embutido

Termux toolchain (clang, make, python via node-gyp)

---

🚨 Execução no Termux (IMPORTANTE)

No Termux, algumas dependências nativas não conseguem detectar corretamente o Android NDK.

Isso afeta principalmente o node-gyp, usado por pacotes como:

better-sqlite3

sharp (em alguns casos)

dependências de protobuf / crypto nativo

---

❌ Problema conhecido

Durante npm install, pode ocorrer erro como:

gyp: Undefined variable android_ndk_path in binding.gyp

ou falhas de build relacionadas ao Android toolchain.

---

✅ Solução aplicada neste projeto

Para garantir que o build funcione no Termux, é necessário definir:

export GYP_DEFINES="android_ndk_path=''"

O que isso faz

Remove a necessidade de um Android NDK real

Evita que o node-gyp tente resolver toolchains de APK build

Força uso do toolchain do Termux (clang/make/python)

Permite compilação nativa direta no ambiente Android

---

🧪 Setup completo (Termux)

export GYP_DEFINES="android_ndk_path=''" npm install npm run build

---

▶️ Rodando o bot

npm start

---

📦 Scripts disponíveis

{ "build": "tsc", "start": "node dist/index.js", "dev": "node --watch dist/index.js", "typecheck": "tsc --noEmit", "clean": "rm -rf dist" }

---

🧠 Arquitetura

src/index.ts → entrypoint do bot

src/auth/ → persistência SQLite

src/messages/ → parsing de mensagens

src/events/ → sistema de eventos

dist/ → build final

---

⚠️ Observações importantes

Persistência

O bot usa SQLite via better-sqlite3 para armazenar credenciais do WhatsApp e manter login persistente.

---

Ambiente Android

Rodando em Termux (runtime não oficial Node.js), então:

builds nativos podem falhar sem ajustes

comportamento do node-gyp varia entre versões

upgrades de Node podem quebrar dependências

---

Dependências nativas

better-sqlite3 (C++)

protobuf

sharp (dependendo do uso)

---

🧪 Debug rápido

rm -rf node_modules package-lock.json export GYP_DEFINES="android_ndk_path=''" npm install

---

📌 Compatibilidade testada

Termux Android 11+

Node 24.x

Baileys 7.x RC

ARM64

---

🚧 Limitações

Sem suporte a NDK real (não necessário)

Dependente do toolchain do Termux

Quebras possíveis em upgrades de Node
