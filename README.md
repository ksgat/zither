# Zither

A desktop AI CAD assistant for Onshape, powered by Pi.

Zither runs in its own Electron window. Onshape stays in the user's browser. The assistant reads and edits the selected CAD document through Onshape's HTTP API.

## Project status

The first pipeline is implemented: Electron → local Pi agent → authenticated Zither server → Onshape. It can read a Part Studio and edit an existing expression parameter. OAuth and live CAD access still require your service configuration and end-to-end verification.

The UI is provisional. Its styling lives in [src/style.css](src/style.css), ready to replace with a Figma reference and your chosen fonts. Keep implementation small: native controls, direct functions, and no framework around a problem that does not need one.

The priority is editing human-made designs well. Fillet creation, topology selection, and assembly fastening are future tools; the current agent explicitly reports that it cannot perform them yet.

## Stack

- Electron, React, and TypeScript for the desktop app.
- Pi agent core and model providers for local agent execution.
- A Node server with Better Auth for Google, GitHub, and username/password sign-in.
- Neon Postgres for accounts, sessions, and encrypted Onshape credentials.
- Onshape OAuth and REST APIs for CAD access.
- User-provided model API keys or ChatGPT sign-in for inference.

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

1. Copy `.env.example` to `.env`. Set `DATABASE_URL` to your Neon connection string.
2. Set a random `BETTER_AUTH_SECRET` and a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY`. The example file includes a generation command.
3. Use `http://localhost:3001` for both `BETTER_AUTH_URL` and `ZITHER_SERVER_URL` during local development. Production requires an HTTPS origin. The desktop reads `ZITHER_SERVER_URL` from `.env` in development; set it in the environment for `npm start`.
4. Register Google and/or GitHub OAuth applications and set their client IDs and secrets. Register callbacks at `/api/auth/callback/google` and `/api/auth/callback/github` on the server origin. Username/password works without social provider credentials.
5. Register an Onshape OAuth application with document read and write permissions. Set its client ID and secret and register `/onshape/callback` on the same server origin. The client secret stays on the server.

Then run:

```sh
npm run db:migrate
npm run dev:server
```

The server has no proxy-trust configuration by default. Configure trusted proxy hops and shared rate limiting for the actual hosting topology before exposing it publicly. Email verification/recovery and production deployment configuration are also still release work; this is a development pipeline.

## Use it

Sign in to Zither in the system browser, connect Onshape, and select **Refresh connections** after returning from Onshape consent. Add a model API key or choose **Continue with ChatGPT**, then select a model. An OpenAI API key and ChatGPT use the same provider slot; connecting one replaces the other.

Paste the URL of an editable Part Studio in its default configuration. Try “Explain this feature tree,” then an explicit dimension edit such as “Change Extrude 1 depth to 25 mm.” The agent re-reads the feature data for each user request and preserves the rest of the edited feature. A changed microversion rejects the write. Failed or uncertain writes stop further edits for that request.

Changing documents, model connections, or Zither accounts starts a fresh conversation. Chat history is currently in memory. Stopping cancels local work; a write already accepted by Onshape cannot be undone by cancellation. Disconnecting Onshape removes Zither's stored tokens; revoke the application's grant in Onshape to revoke it at the provider too.

ChatGPT uses the documented local-app plan-usage flow, verifies the ID token, and requests the account's current model catalog. Eligibility and production distribution must be validated for Zither before release. [OpenAI documentation](https://developers.openai.com/siwc/token-sharing-open-source)

## Validate

```sh
npm run build
npm test
npm run test:desktop
```

Tests use an in-process Postgres database, a deterministic Pi model, and mocked Onshape responses. The desktop smoke test launches a hidden real Electron window with an isolated profile under `.local`, checks the renderer/IPC boundary and OS-encrypted credentials, and writes `.local/desktop.png`. No provider secrets are needed and no live CAD is edited.

See [PLAN.md](PLAN.md) for the remaining milestones. Work is delivered in small stacked PRs, merged by you.
