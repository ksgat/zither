# Zither

A desktop AI CAD assistant for Onshape, powered by Pi.

Zither runs in its own Electron window. Onshape stays in the user's browser. The assistant reads and edits the selected CAD document through Onshape's HTTP API.

## Project status

Planning stage. The initial scaffold is a checkpoint, not a runnable application. Implementation is paused for review of [PLAN.md](PLAN.md).

The scaffold currently contains package configuration, shared request types, draft Zither authentication configuration, database table definitions, token encryption helpers, and a draft Onshape feature adapter.

The Electron main process, renderer, server routes, build scripts, Pi integration, and tests have not been implemented. The package scripts describe the intended setup; most cannot run yet. No database has been migrated, OAuth applications connected, or live CAD edits performed.

## Proposed stack

- Electron, React, and TypeScript for the desktop app.
- Pi agent core and model providers for local agent execution.
- A Node server with Better Auth for Google, GitHub, and username/password sign-in.
- Neon Postgres for accounts, sessions, and encrypted Onshape credentials.
- Onshape OAuth and REST APIs for CAD access.
- User-provided model API keys or ChatGPT sign-in for inference.

## Development prerequisites

Use Node.js 22.19 or newer to meet the installed Pi packages' engine requirement. The current machine's Node.js 22.16 is older than that requirement.

The dependency lockfile is committed. `.env.example` lists planned configuration names without real credentials. `.env`, build output, and dependencies are ignored by Git.

Read [PLAN.md](PLAN.md) for the proposed flows, milestones, acceptance checks, and remaining decisions before implementing.
