# NeoRobotTS 🤖

Bot de WhatsApp escrito em **TypeScript** utilizando **Baileys**, com arquitetura modular e persistência local em SQLite.

O projeto é desenvolvido principalmente no **Termux (Android)**, mas pode ser executado em qualquer ambiente compatível com Node.js.

## ✨ Recursos

- Arquitetura baseada em eventos
- Sistema modular de comandos
- Persistência de autenticação utilizando SQLite
- Conversão e manipulação de mídia
- Compatível com Termux
- Escrito em TypeScript utilizando ES Modules

## 🛠️ Stack

- Node.js 24+
- TypeScript
- Baileys
- better-sqlite3
- SQLite

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

## 📁 Estrutura do projeto

```text
src/
├── auth/        # Persistência e autenticação
├── commands/    # Sistema de comandos
├── events/      # Dispatcher e logger
├── messages/    # Processamento de mensagens
├── types/       # Declarações de tipos
├── utils/       # Utilitários
└── index.ts     # Entrypoint
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
