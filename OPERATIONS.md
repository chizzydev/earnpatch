# Engineering setup and operation

This is the accepted EarnPatch G40 source snapshot. The public application offers wallet-free evaluation with simulated finances, genuine SafeShare CSV processing, an independent Paperlane integration, and authentic read-only NEAR Testnet evidence. Public financial signing is disabled. No hosting or financial deployment is triggered by these commands.

## Local development and owner walkthrough

Requires Node 22 or newer and npm. From this repository:

~~~sh
npm ci
npm run build
npm start
~~~

Open http://127.0.0.1:4580 for EarnPatch, /studio for the server-backed merchant/developer lifecycle, /finance for simulated escrow/token accounting, and /verified for accepted transaction references. Paperlane is a separate service at http://127.0.0.1:4581. Use the handoff button in the financial workspace after approving/importing a release and accepting token terms. The normal EarnPatch frontend also has its own three-role evaluation journey.

The launcher binds only to loopback. It has no wallet signer and creates new local state under ignored .runtime/local; it does not read the original engineering workspace or browser history. State persists across restart. Stop with Ctrl+C. If a port is occupied, choose EARNPATCH_LOCAL_PORT and PAPERLANE_LOCAL_PORT; no existing process is terminated. Do not delete a state lock while a process owns it. Production uses PostgreSQL, not this single-process local file adapter.

## Verification

~~~sh
npm test
npm run test:https
npm run test:browser
npm run test:wasm
npm run verify
~~~

The HTTPS fixture needs OpenSSL. Windows defaults to Git for Windows' OpenSSL; override G40_OPENSSL with an installed executable path if necessary. Browser tests use the locked Playwright package and installed Microsoft Edge. Other systems need a separately installed supported browser; no browser is silently downloaded. The tests use isolated sessions/ports and never approve wallets. On Windows, scripts/WINDOWS_VERIFY.ps1 -Browser performs the same gates.

Rust sources are marketplace_v2 (native marketplace), g38/contracts (commitment escrow and token settlement), and g38/test-token (test-only NEP-141 token, no redemption value). scripts/contracts.sh tests and compiles to ignored target directories, never replacing the accepted WASMs. Rust/wasm32 and the pinned near-sdk 5.29.1 dependencies must be available. G38 Cargo locks are preserved. The original G27 source did not include an accepted Cargo.lock; its initial dependency resolution is explicit. Recompilation with another compiler/dependency resolution is not a claim of byte-identical WASM. Accepted binaries and every financial source fingerprint are verified by npm run verify. No Rust compilation is claimed for this source-copy pass.

The G40 PostgreSQL fixture is g40/tests/local-postgres.py: it requires the existing documented PostgreSQL 16.15 Ubuntu cache (or adapt a separately reviewed installed toolchain), Node >=22 and OpenSSL. It creates and removes its own loopback-only cluster and never takes an application DB URL. accepted/LOCAL_VERIFICATION.json records the actual completed original G40 run; it is not a newly fabricated release-copy database run. Windows HTTPS/CSV and portable-start checks are independently rerun in this copy.

## Railway only

Run npm run build. The generated g40/build is the deployment context for both apps, containing its own Dockerfile and railway.json. Do not upload the workspace root. Create exactly three services in one Railway project/environment: earnpatch, paperlane and postgres. PostgreSQL alone has a persistent volume; keep its connection private with no public proxy. No extra frontend host or reverse proxy is needed.

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

G40_DATABASE_TRANSPORT=verify-tls and a trusted G40_DATABASE_CA are optional alternatives; certificate verification is not disabled. g40/.env.example contains placeholders only. Never commit a real dotenv file. Never enable historical owner-wallet flags in this public service. Paperlane's integration uses a fixed private destination with HMAC/time/nonce checks; public mutation APIs require same-origin sessions.

Each app uses one dual-stack listener on 8080, one replica initially, /health readiness, 120-second deployment health timeout, ALWAYS restart policy, 10-second overlap and 30-second drain. Railway's healthcheck Host is accepted only on health routes. Runtime DB failure marks the process unready and stops it. Start with conservative limits (512 MB per app, 1 GB PostgreSQL, small DB volume); billing depends on actual usage. Keep sleeping/serverless disabled for predictable private calls. Backups and restore verification require owner configuration after deployment.

Database.initialize in g40/database.mjs is the version-1 bootstrap migration: it serializes schema creation with a transaction advisory lock and creates earnpatch_g40_state. Separate bridge/paperlane rows use row locks, version counters and commit-before-response. Commit ambiguity fails closed; retained request/job identities support recovery. Raw CSV is not persisted. Server evaluation sessions expire after 24 hours; role state is bounded to 8 MB. This is a bounded small-service implementation, not unlimited multi-tenant throughput.

Actual Railway image execution, private routing, domains, backups and resource measurements remain deployment acceptance tasks. No Railway resource or public deployment is authorized by the private source push.

## Integrity and security

accepted/SOURCE_BASELINE.json records the selected accepted files and original build fingerprints. accepted/PREPARATION_CHANGES.json lists the narrow release-only changes. Contract sources, four accepted WASMs and the seven-file approved SafeShare release remain byte-identical. npm run verify checks those fingerprints and scans source (or the Git index with --staged) for prohibited files and credential patterns. Unit-test DB credentials are explicit fictional placeholders, not production credentials.

The application includes original public transaction references and approved sanitized CSV evidence only. No private operation journals, signed payloads, local DB contents, user CSV inputs, credentials or historical Git directory are included. The original engineering evidence remains separately preserved. No hackathon README or promotional content has been authored here.
