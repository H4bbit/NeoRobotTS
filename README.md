# NeoRobotTS 🤖

![Node](https://img.shields.io/badge/Node-24.x-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![Baileys](https://img.shields.io/badge/Baileys-7.x-black) ![License](https://img.shields.io/badge/license-ISC-yellow) ![Platform](https://img.shields.io/badge/platform-Termux%20%7C%20Linux-lightgrey)

Bot de WhatsApp escrito em **TypeScript** utilizando **Baileys**, com arquitetura modular e persistência local em SQLite.

O projeto é desenvolvido principalmente no **Termux (Android)**, mas pode ser executado em qualquer ambiente compatível com Node.js.

## ✨ Recursos

- Arquitetura baseada em eventos
- Sistema modular de comandos
- Persistência de autenticação utilizando SQLite
- Conversão e manipulação de mídia (`!s`, `!toimg`, `!tovideo`)
- Comandos de administração de grupos (`!ban`, `!promover`, `!rebaixar`, `!abrir`, `!fechar`)
- Logger centralizado com `pino` e métricas de conversão
- Compatível com Termux (Android ARM64)
- Escrito em TypeScript utilizando ES Modules

## 🛠️ Stack

- Node.js 24+
- TypeScript
- Baileys 7.x RC
- better-sqlite3 + SQLite
- ffmpeg + webpmux (conversão de mídia)
- pino (logs estruturados)

## ⚙️ Configuração

Variáveis de ambiente:

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `WHATSAPP_PHONE_NUMBER` | Número para pareamento via código | `5511999999999` |
| `LOG_LEVEL` | Nível do logger `pino` | `info` (padrão) |
| `FORCE_RESET` | Se `true`, limpa `data/auth` ao iniciar | `false` |

Exemplo:

```sh
export WHATSAPP_PHONE_NUMBER="5511999999999"
npm start
```

## 💬 Comandos

### Geral
| Comando | Descrição |
|---------|-----------|
| `!ping` | Responde Pong |
| `!boton` / `!botoff` | Ativa/desativa o bot no grupo (persiste em SQLite) |

### Mídia
| Comando | Descrição | Uso |
|---------|-----------|-----|
| `!s` / `!sticker` | Imagem/vídeo → sticker | Responda ou marque mídia |
| `!toimg` | Sticker → imagem PNG | Responda um sticker |
| `!tovideo` | Sticker animado → vídeo MP4 | Responda um sticker animado |

> Vídeos para sticker devem ter no máximo 10s.

### Administração (apenas grupos, requer bot admin)
| Comando | Aliases | Descrição | Uso |
|---------|---------|-----------|-----|
| `!ban` | `!banir`, `!kick` | Remove do grupo | `!ban @usuario` ou responda |
| `!promote` | `!promover`, `!up` | Promove a admin | `!promote @usuario` |
| `!demote` | `!rebaixar`, `!down` | Rebaixa admin | `!demote @usuario` |
| `!abrir` | `!open` | Abre o grupo (todos falam) | `!abrir` |
| `!fechar` | `!close` | Fecha o grupo (só admin fala) | `!fechar` |

> Todos os comandos de admin verificam `LID`/`s.whatsapp.net` e exigem que o bot também seja admin.

## 📦 Instalação

Instale as dependências:

```sh
npm install
```

Compile o projeto:

```sh
npm run build
```

## ▶️ Executando

```sh
npm start
```

Pareamento: na primeira execução, se `WHATSAPP_PHONE_NUMBER` estiver definido, o código de 8 dígitos será exibido no terminal (Vá em Aparelhos Conectados > Conectar com número).

## 📁 Estrutura do projeto

```text
src/
├── auth/        # Persistência SQLite (Baileys creds)
├── commands/    # Controller + DB de grupos ativos
├── events/      # Dispatcher e logger
├── messages/    # Parser, tipos e reações
├── utils/       # jid, logger, admin, sticker, metadataWebp
└── index.ts     # Entrypoint + pareamento
```

## 📊 Logs

Logger centralizado em `src/utils/logger.ts` com `pino`:

- `module: command` → `command_event` (comando, jid, sender, runtime)
- `module: db` → `db_event` (READ_GROUP, SET_GROUP_ACTIVE)
- `module: webp` → `webp_conversion_event` (start, inspection, frames_extracted, concat_written, encode_start/done, success/failure com tamanhos e duração)
- `module: sticker` → `sticker_event` (image/video_start/success)
- `module: command` + `admin_event` → `ban/promote/demote/open/close`

Filtre com `grep`:

```sh
cat bot.log | grep 'module.*webp'
cat bot.log | grep 'admin_event'
```

## 📜 Scripts

| Script | Descrição |
|--------|-----------|
| `npm run build` | Compila o projeto |
| `npm start` | Executa o bot |
| `npm run dev` | Executa em modo watch |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos |
| `npm run clean` | Remove o diretório `dist` |
| `npm test` | Placeholder para futuros testes |

## 🔧 Desenvolvimento

### Ambiente utilizado

O projeto é desenvolvido e testado utilizando:

- Termux
- Node.js 24.x
- TypeScript 5.x
- Baileys 7.x RC

### Dependências nativas

Este projeto utiliza **better-sqlite3**, que possui código nativo compilado durante a instalação.

### Termux

> [!IMPORTANT]
> Antes de executar `npm install` no Termux, defina a seguinte variável de ambiente:

```sh
export GYP_DEFINES="android_ndk_path=''"
```

Essa configuração evita que o `node-gyp` tente localizar um Android NDK e faz com que a compilação utilize o toolchain fornecido pelo próprio Termux.

Instalação completa:

```sh
export GYP_DEFINES="android_ndk_path=''"
npm install
npm run build
```

> [!TIP]
> Caso a instalação falhe, remova as dependências e tente novamente.

```sh
rm -rf node_modules package-lock.json

export GYP_DEFINES="android_ndk_path=''"

npm install
```

> [!CAUTION]
> Atualizações do Node.js podem exigir a recompilação das dependências nativas.

## 📄 Licença

ISC
