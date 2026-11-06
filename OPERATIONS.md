# Engineering setup and operation

This repository contains the maintained EarnPatch product source. The public application offers wallet-free evaluation with simulated finances, genuine SafeShare CSV processing, an independent Paperlane integration, and authentic read-only NEAR Testnet evidence. Public financial signing is disabled. No hosting or financial deployment is triggered by these commands.

## Local development and owner walkthrough

Requires Node 22 or newer and npm. From this repository:

~~~sh
npm ci
npm run build
npm start
~~~

Open http://127.0.0.1:4580/start for the role-by-role technical guide, then http://127.0.0.1:4580 for EarnPatch, /studio for the server-backed merchant/developer lifecycle, /finance for simulated escrow/token accounting, and /verified for accepted transaction references. Paperlane is a separate service at http://127.0.0.1:4581. Use the handoff button in the financial workspace after approving/importing a release and accepting token terms. The main application, Studio and Finance share the current workspace. A fresh EarnPatch session always starts with the open sample SafeShare invitation. To write a new brief, select Merchant in Studio and confirm Reset this workspace; this explicitly creates a draft. Reset affects the shared evaluation scenario, not historical Testnet records. Native purchases and Paperlane token credits belong to separate agreements. Opening Paperlane directly creates its own workspace; use the Finance handoff to continue the already approved release.

The launcher binds only to loopback. It has no wallet signer and creates new local state under ignored .runtime/local; it does not read the original engineering workspace or browser history. State persists across restart. Stop with Ctrl+C. If a port is occupied, choose EARNPATCH_LOCAL_PORT and PAPERLANE_LOCAL_PORT; no existing process is terminated. Do not delete a state lock while a process owns it. Production uses PostgreSQL, not this single-process local file adapter.

## Verification

~~~sh
npm test
npm run test:https
npm run test:browser
npm run test:wasm
npm run verify
~~~

The HTTPS fixture needs OpenSSL. Windows defaults to Git for Windows' OpenSSL; override G40_OPENSSL with an installed executable path if necessary. Browser tests use the locked Playwright package and installed Microsoft Edge. These checked-in browser gates currently require Microsoft Edge (channel msedge), including on other operating systems. No browser is silently downloaded. Local application startup does not require browser automation. The tests use isolated sessions/ports and never approve wallets. On Windows, scripts/WINDOWS_VERIFY.ps1 -Browser performs the same gates.

Rust sources are marketplace_v2 (native marketplace), g38/contracts (commitment escrow and token settlement), and g38/test-token (test-only NEP-141 token, no redemption value). scripts/contracts.sh tests and compiles to ignored target directories, never replacing the accepted WASMs. Rust/wasm32 and the pinned near-sdk 5.29.1 dependencies must be available. G38 Cargo locks are preserved. The native marketplace dependency lock is included. Recompilation with another compiler/dependency resolution is not a claim of byte-identical WASM. Accepted binaries and every financial source fingerprint are verified by npm run verify. No Rust compilation is claimed for this source-copy pass.

Portable real-PostgreSQL verification is `npm run test:postgres`. It requires PostgreSQL 16+ binaries (initdb, postgres, pg_ctl, createdb), Node and OpenSSL. Set PG_BINDIR if pg_config is not on PATH; optionally set PG_SHAREDIR and PG_LIBDIR for an unpacked distribution. Run as a normal user on Linux. Unset DATABASE_URL and G40_TEST_DATABASE_URL for this child process: the runner refuses existing database URLs, initializes a unique loopback-only disposable cluster/database, runs the actual HTTPS/service/CSV/cap/restart tests, checks JSONB exact-string persistence, stops its cluster and removes only its own temporary directory. Existing application databases are never used. The local fixture uses trust authentication solely for its disposable loopback cluster. Outputs go to ignored g40/evidence/POSTGRES_VERIFICATION.json and logs. Missing prerequisites fail; they are not treated as passing.

## Railway only

Run npm run build, then npm run verify:package. The build validates every Docker COPY input before acknowledging success. The generated g40/build is the deployment context for both apps, containing its own Dockerfile and railway.json. Do not upload the workspace root. Create exactly three services in one Railway project/environment: earnpatch, paperlane and postgres. PostgreSQL alone has a persistent volume; keep its connection private with no public proxy. No extra frontend host or reverse proxy is needed.

Set these on both apps using Railway variables:

| Variable | Value |
|---|---|
| G40_SERVICE | earnpatch or paperlane, matching the service |
| PORT | 8080 |
| G40_EARNPATCH_ORIGIN | Exact generated EarnPatch HTTPS origin |
| G40_PAPERLANE_ORIGIN | Exact, distinct Paperlane HTTPS origin |
| G40_BRIDGE_INTERNAL_ORIGIN | http://earnpatch.railway.internal:8080 |
| G40_INTEGRATION_KEY | Same owner-generated random 32-byte hex secret on both; server-only |
| DATABASE_URL | Private reference to postgres.DATABASE_URL |
| G40_DATABASE_TRANSPORT | railway-private |
| NODE_OPTIONS | Recommended --max-old-space-size=128 |
| RAILWAY_ENVIRONMENT_ID | Injected by Railway |

G40_DATABASE_TRANSPORT=verify-tls and a trusted G40_DATABASE_CA are optional alternatives; certificate verification is not disabled. g40/.env.example contains placeholders only. Never commit a real dotenv file. This public service does not expose owner-wallet financial request endpoints. Paperlane's integration uses a fixed private destination with HMAC/time/nonce checks; public mutation APIs require same-origin sessions.

Each app uses one dual-stack listener on 8080, one replica initially, /health readiness, 120-second deployment health timeout, ALWAYS restart policy, 10-second overlap and 30-second drain. Railway's healthcheck Host is accepted only on health routes. Runtime DB failure marks the process unready and stops it. Start with conservative limits (512 MB per app, 1 GB PostgreSQL, small DB volume); billing depends on actual usage. Keep sleeping/serverless disabled for predictable private calls. Backups and restore verification require owner configuration after deployment.

Database.initialize in g40/database.mjs is the version-1 bootstrap migration: it serializes schema creation with a transaction advisory lock and creates earnpatch_g40_state. Separate bridge/paperlane rows use row locks, version counters and commit-before-response. Commit ambiguity fails closed; retained request/job identities support recovery. Raw CSV is not persisted. Server evaluation sessions expire after 24 hours; role state is bounded to 8 MB. This is a bounded small-service implementation, not unlimited multi-tenant throughput.

Live Railway status (reported and accepted on 2026-11-06): EarnPatch is publicly served at https://earnpatch-production.up.railway.app/ and the independent Paperlane app at https://paperlane-production-763e.up.railway.app/. The three-service deployment includes private PostgreSQL, and the public acceptance report covered role flows, real CSV downloads, Paperlane integration, royalty caps, session isolation, mobile layouts and application restart recovery. Original Testnet evidence remains read-only. Database **backup/restore remains untested**; no uptime, ongoing cost or future memory-use guarantee is implied. Public financial signing remains disabled.

## Integrity and security

accepted/SOURCE_SHA256.json records the curated source fingerprint. Contract sources, four accepted WASMs and the seven-file approved SafeShare release remain byte-identical. npm run verify checks those fingerprints and scans source (or the Git index with --staged) for prohibited files and credential patterns. Unit-test DB credentials are explicit fictional placeholders, not production credentials.

The application includes original public transaction references and approved sanitized CSV evidence only. No private operation journals, signed payloads, local DB contents, user CSV inputs, credentials or historical Git directory are included. The original engineering evidence remains separately preserved. Submission-facing README content is maintained in the repository root; this operations guide documents the local and hosted engineering behavior.


The Live NEAR proof navigation opens `/verified`. It requires no owner wallet or private runtime evidence. POST requests to `/api/testnet/` are rejected; only the explicit code-verified GET state read is exposed. Owner pilot consoles, incident journals, authorization files, VM transfer scripts and historical engineering reports are kept outside the public release. Generation-number source paths are retained where required by current imports.

## Local container acceptance

`npm run test:container` requires access to an existing Docker daemon. It builds the generated g40/build context, creates one temporary private network and three disposable containers (EarnPatch, independent Paperlane and PostgreSQL), exercises actual service/CSV/cap/payout flow, restarts both apps and checks idempotent recovery. It publishes no ports and deploys nothing to Railway. It removes only its labelled test containers, associated disposable volumes, network and generated local image; it never prunes existing resources. Docker may download the official node:24-bookworm-slim and postgres:16-alpine images when uncached. Allow roughly 1 GB free RAM and 1 GB additional disk headroom, depending on cached layers. This is local image/private-network verification, not acceptance of Railway routing or a hosted HTTPS domain. Separate test:browser covers the HTTPS edge fixture. On Linux use the owner-approved Docker access mechanism; do not change socket permissions.

## Completed registration evidence

The read-only /verified page keeps the original 42 G39-A transaction identities unchanged and adds a separate G45 record from g40/public/registration-proof.json. Its original hash is 4jd1JJ7fshiLPht1DkErJ3NKBQGVx8R8oNBczUDww9oW. GET /api/registration-evidence exposes only sanitized public facts. GET /api/registration-status and npm run verify:proof independently check FINAL execution, exact signer/receiver/arguments/deposit/gas, original receipt identities, accepted code and product at a finalized block. An unavailable RPC returns 503; historical proof remains labelled historical. No new transaction, grant or wallet request is possible through these endpoints. Product registration does not independently establish IP ownership, copyright, legal title or creator identity.

## Verification scope

The Windows gate reports only checks actually run. PostgreSQL and container checks are optional explicit switches and print NOT_REQUESTED when omitted. A local candidate result is not a post-push public GitHub result. No command here pushes, deploys or signs. Final project licensing and the final hackathon README remain owner decisions; no license is silently assigned by these engineering changes.
