# Private source release handoff

The accepted product is isolated as a normal source repository, independent of the historical engineering workspace. No hard links, original Git history, credentials, signed transactions, private journals or runtime databases were copied. No public deployment or visibility change is part of this release.

The initial commit contains the G40 application/backend, G37 Bridge SDK/API and separate Paperlane SaaS, exact approved SafeShare engine, native marketplace, commitment escrow and token contracts, four accepted WASMs, locked JavaScript/G38 Rust dependencies, PostgreSQL bootstrap migration, Railway-only container configuration and tests. Generation-number paths are retained where required by accepted imports; entire historical generations are not included. The runtime deploy context is built separately by npm run build.

Clean-copy checks actually executed: 35/35 application/SDK/finance/integration regressions; production build and cold startup; HTTPS/private HMAC/CSV/restart scenario; headless Edge genuine CSV download; normal loopback three-role UI and independent Paperlane handoff/download. Approved financial Rust sources, binaries and seven-file SafeShare source are unchanged. Financial model tests use simulations; compiled WASM host checks do not claim nearcore gas metering. Native Rust tests and Railway-hosted/Docker execution were not repeated in this source-copy pass. Original G40 real PostgreSQL acceptance is retained as sanitized metadata, not fabricated as a newly executed copy test.

Preparation adjustments are explicitly listed in accepted/PREPARATION_CHANGES.json: portable checked-in public proof input; package-local browser tooling; clean-directory/root-dependency test support; loopback HTTP cookie handling with production HTTPS behavior preserved; removal of obsolete pre-deployment planning documents. The new launcher stores only isolated evaluation state and cannot sign transactions.

The original G27 accepted source had no Cargo.lock. Its SDK version is pinned, source and accepted binary are verified, and scripts/contracts.sh makes resolution explicit. A rebuild on another toolchain is not asserted to produce identical bytes. The supplied G38 lockfiles are preserved.

For the owner walkthrough, run npm ci, npm run build and npm start. Open http://127.0.0.1:4580; separate Paperlane uses :4581. This command was verified through isolated HTTP and browser journeys. It does not launch a wallet-enabled financial service or read/reset existing acceptance data. Stop with Ctrl+C. See OPERATIONS.md for precise test, state, PostgreSQL and Railway configuration.

No hackathon README has been authored; the owner retains README and presentation ownership.
