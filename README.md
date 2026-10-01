# Zither

A desktop AI CAD assistant for Onshape, powered by Pi.

Zither runs in its own Electron window. Onshape stays in the user's browser. The assistant reads and edits the selected CAD document through Onshape's HTTP API.

## Project status

The first pipeline is implemented: Electron → local Pi agent → authenticated Zither server → Haskell edit compiler → Onshape. Browse documents, choose a Part Studio, then read and edit existing expression parameters across Part Studios in that document. OAuth and live CAD access still require your service configuration and end-to-end verification.

Live Neon setup has been verified through account registration, password sign-in, the desktop session handoff, replay rejection, and sign-out. The temporary test account was removed. Connection strings and app secrets remain local in the ignored `.env`.

The UI is provisional. Its styling lives in [src/style.css](src/style.css), ready to replace with a Figma reference and your chosen fonts. Keep implementation small: native controls, direct functions, and no framework around a problem that does not need one.

The priority is editing human-made designs well. Fillet creation, topology selection, and assembly fastening are future tools; the current agent explicitly reports that it cannot perform them yet.

## Stack

- Electron, React, and TypeScript for the desktop app.
- Pi agent core and model providers for local agent execution.
- A Node server with Better Auth for Google, GitHub, and username/password sign-in.
- Neon Postgres for accounts, sessions, and encrypted Onshape credentials.
- Onshape OAuth and REST APIs for CAD access.
- Haskell for lossless feature-tree import and sparse edit compilation, with the complete public API catalog pinned locally.
- User-provided model API keys or Codex subscription sign-in for inference.

## Development prerequisites

Use Node.js 22.19 or newer. Node 24 is used for validation and CI.

The dependency lockfile is committed. `.env.example` lists planned configuration names without real credentials. `.env`, build output, and dependencies are ignored by Git.

## Run the desktop

```sh
npm ci
npm run dev
```

This launches the desktop UI without requiring server credentials. To sign in and access CAD, start the configured server in a second terminal. Renderer edits reload automatically; restart `npm run dev` after changing Electron code.

For a production build:

```sh
npm run build
npm start
```

## Configure the server

1. Run `npm run setup`. This creates an ignored `.env` and generates `BETTER_AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY`. Running it again preserves the existing file and secrets.
2. Create a Neon project/database for Zither, open **Connect**, and paste the Postgres connection string into `DATABASE_URL`, keeping its SSL parameters. Use the direct connection string for `DATABASE_MIGRATION_URL` if `DATABASE_URL` is pooled. Keep both app secrets stable; changing the encryption key makes existing Onshape credentials unreadable. [Neon connection documentation](https://neon.com/docs/connect/connection-pooling)
3. Use `http://localhost:3001` for both `BETTER_AUTH_URL` and `ZITHER_SERVER_URL` during local development. Production requires an HTTPS origin. The desktop reads `ZITHER_SERVER_URL` from `.env` in development; set it in the environment for `npm start`.
4. Register Google and/or GitHub OAuth applications and set both their client ID and secret. Local callback URLs are `http://localhost:3001/api/auth/callback/google` and `http://localhost:3001/api/auth/callback/github`. Leave each pair blank until configured; username/password works without social credentials.
5. Register an Onshape OAuth application with document read and write permissions. Set its client ID and secret and register `/onshape/callback` on the same server origin. The client secret stays on the server.
6. Build the [Haskell kernel](kernel/README.md) and set server `ZITHER_KERNEL_PATH` to its absolute executable path. The imported schema and gateway use Onshape API v17. CAD reads and edits need the kernel; there is no JavaScript edit fallback.

Then run:

```sh
npm run db:check
npm run db:migrate
npm run db:check
npm run dev:server
```

`db:check` is read-only and reports pending schema with exit code 1. A fresh database needs the migration before that check passes. `db:migrate` uses Better Auth's migration API for account, session, provider, verification, username, and rate-limit storage, then creates Zither's desktop and Onshape tables. It can be rerun without clearing accounts. Neither command prints connection strings or secret values.

Once the server is running, `http://localhost:3001/health` checks the HTTP process and `http://localhost:3001/login` opens account registration. Use **Sign in to Zither** in Electron to complete the desktop handoff. Database setup and username/password sign-in can be tested before adding OAuth provider credentials or the Haskell executable.

The server has no proxy-trust configuration by default. Configure trusted proxy hops and shared rate limiting for the actual hosting topology before exposing it publicly. Email verification/recovery and production deployment configuration are also still release work; this is a development pipeline.

## Use it

Sign in to Zither in the system browser, connect Onshape, and select **Refresh connections** after returning from Onshape consent. Add a model API key or choose **Sign in to Codex**, then select a model. OpenAI API keys and Codex subscriptions have separate connections.

**Sign in to Codex** uses Pi’s `openai-codex` browser login, transport, and model catalog. Complete sign-in in your browser, then choose an `openai-codex` model. If the browser cannot return (for example, port 1455 is occupied), expand **Browser didn’t return?** and paste the full localhost callback link. **Stop** cancels sign-in. Tokens stay in the local OS-encrypted store. Live inference still needs verification with a real subscription.

Upgrading removes credentials from the retired direct ChatGPT sign-in and clears its model selection. Existing API keys and Codex connections are preserved.

After connecting Onshape, the desktop opens a document picker with search, My documents / Shared with me / Recent filters, and paging. Choose a document to see its tabs, then a Part Studio to open the conversation. Assemblies, drawings, and other tab types are listed but cannot be selected for editing yet. Documents open in their default workspace; the optional Part Studio link entry preserves a different workspace from its URL. Only default configurations are supported. Use **Choose file** to return to the picker and start with another document.

Try “Explain this feature tree,” then an explicit dimension edit such as “Change Extrude 1 depth to 25 mm.” The agent uses `list_elements`, `read_features(elementId)`, and `set_parameter(elementId, …)` to work across Part Studios within the chosen document. Each request discovers tabs and reads fresh feature data; a write invalidates observations of other tabs. Features remain bound to their owning tab and the Haskell compiler preserves the rest of each payload. A changed microversion rejects the write. Failed or uncertain writes stop all further edits for that request. Multiple writes are sequential, not an atomic transaction; cross-tab dependencies and assembly rebuild verification are not implemented.

Changing documents, model connections, or Zither accounts starts a fresh conversation. Chat history is currently in memory. Stopping cancels local work; a write already accepted by Onshape cannot be undone by cancellation. Disconnecting Onshape removes Zither's stored tokens; revoke the application's grant in Onshape to revoke it at the provider too.

## Validate

```sh
npm run build
npm test
npm run test:desktop
```

Tests use an in-process Postgres database, a deterministic Pi model, and mocked Onshape responses. Set `ZITHER_KERNEL_PATH` when running `npm test` to exercise the actual Haskell compiler and CAD gateway; without it those cases are explicitly skipped. Linux CI builds Haskell and runs them. The desktop smoke test launches a hidden real Electron window with an isolated profile under `.local`, checks the renderer/IPC boundary and OS-encrypted credentials, and writes `.local/desktop.png`. No provider secrets are needed and no live CAD is edited.

See [PLAN.md](PLAN.md) for the remaining milestones. Work is delivered in small stacked PRs, merged by you.
