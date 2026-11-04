#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --locked --manifest-path g38/contracts/Cargo.toml --workspace
cargo test --locked --manifest-path g38/test-token/Cargo.toml
# G41 adds a lockfile resolved offline on Ubuntu; accepted source/WASM is unchanged.
cargo test --locked --manifest-path marketplace_v2/Cargo.toml
# Build into ignored target directories; never replace accepted WASMs.
RUSTFLAGS='--cfg near' cargo build --locked --manifest-path g38/contracts/Cargo.toml --workspace --release --target wasm32-unknown-unknown
RUSTFLAGS='--cfg near' cargo build --locked --manifest-path g38/test-token/Cargo.toml --release --target wasm32-unknown-unknown
RUSTFLAGS='--cfg near' cargo build --locked --manifest-path marketplace_v2/Cargo.toml --release --target wasm32-unknown-unknown
