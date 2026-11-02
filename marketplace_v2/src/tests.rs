use super::*;
use near_sdk::{testing_env, test_utils::{VMContextBuilder, get_logs}, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const FUND: u128 = 1_000_000_000_000_000_000_000_000;
fn a(s: &str) -> AccountId { s.parse().unwrap() }
fn context(who: &str, deposit: u128, balance: u128, time: u64, results: Vec<PromiseResult>) {
    let usage = env::storage_usage();
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("market.testnet")).signer_account_id(a(who)).predecessor_account_id(a(who))
        .attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_yoctonear(balance))
        .storage_usage(usage).block_timestamp(time).prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn caller(who: &str, deposit: u128) { context(who, deposit, FUND * 10_000, 1, vec![]); }
fn fresh() -> Contract {
    env::set_blockchain_interface(near_sdk::MockedBlockchain::default());
    caller("merchant.testnet", 0); Contract::new()
}
fn f(owner: &str, feature: &str) -> FeatureId { FeatureId { owner: a(owner), product: "app".into(), feature: feature.into(), version: 1 } }
fn terms(price: u128, bps: u16, cap: u128) -> Terms {
    Terms { requirements_sha256: "a".repeat(64), price: U128(price), royalty_bps: bps, cap: U128(cap), deadline_ns: None }
}
fn product(c: &mut Contract, who: &str) { caller(who, FUND); c.create_product("app".into(), "App".into()); }
fn opened(c: &mut Contract, feature: &FeatureId, dev: &str, t: Terms) -> String {
    caller(feature.owner.as_str(), 0); c.open_opportunity(feature.clone(), a(dev), t).terms_hash
}
fn live(c: &mut Contract, feature: &FeatureId, dev: &str, t: Terms) -> String {
    let hash = opened(c, feature, dev, t);
    caller(dev, 0); c.accept(feature.clone(), hash.clone());
    c.submit(feature.clone(), hash.clone(), "b".repeat(64));
    caller(feature.owner.as_str(), 0); c.approve(feature.clone(), hash.clone(), "b".repeat(64)); hash
}
fn setup() -> (Contract, FeatureId, String) {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "csv");
    let hash = live(&mut c, &feature, "dev.testnet", terms(11, 2500, 3)); (c, feature, hash)
}
fn buy(c: &mut Contract, f: &FeatureId, order: &str, price: u128) -> Order {
    caller("buyer.testnet", price); c.purchase(f.clone(), order.into())
}
fn rejects(msg: &str, call: impl FnOnce()) {
    let error = catch_unwind(AssertUnwindSafe(call)).expect_err("attack unexpectedly succeeded");
    let s = error.downcast_ref::<String>().map(String::as_str)
        .or_else(|| error.downcast_ref::<&str>().copied()).unwrap_or("non-string panic");
    assert!(s.contains(msg), "expected {msg}, got {s}");
}
fn conserved(c: &Contract) {
    assert_eq!(c.total_sales, c.total_claimable + c.total_pending + c.total_withdrawn);
    assert!(c.storage_spent <= c.storage_funded);
    assert!(cost(env::storage_usage()) <= c.bootstrap_backing + c.storage_spent);
}

#[test]
fn two_merchants_identical_names_isolate_funds_and_credits() {
    let (mut c, fa, _) = setup(); product(&mut c, "other.testnet"); let fb = f("other.testnet", "csv");
    live(&mut c, &fb, "otherdev.testnet", terms(7, 10000, 7));
    buy(&mut c, &fa, "same", 11); buy(&mut c, &fb, "second", 7);
    assert_eq!(c.get_payout(a("merchant.testnet")).claimable.0, 9);
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 2);
    assert_eq!(c.get_payout(a("otherdev.testnet")).claimable.0, 7);
    assert_eq!(c.get_payout(a("other.testnet")).claimable.0, 0);
    caller("buyer.testnet", 0); c.consume_use(fa.clone(), "run".into());
    assert_eq!(c.get_credits(a("buyer.testnet"), fa).0, 0);
    assert_eq!(c.get_credits(a("buyer.testnet"), fb).0, 1); conserved(&c);
}

#[test]
fn stranger_cannot_squat_inside_merchant_product() {
    let mut c = fresh(); product(&mut c, "merchant.testnet");
    let feature = f("merchant.testnet", "reserved"); caller("stranger.testnet", 0);
    rejects("NOT_OWNER", || { c.open_opportunity(feature.clone(), a("stranger.testnet"), terms(10, 2000, 4)); });
    assert!(c.get_opportunity(feature.clone()).is_none());
    opened(&mut c, &feature, "dev.testnet", terms(10, 2000, 4));
}

#[test]
fn zero_deposit_product_fails_before_state_mutation() {
    let mut c = fresh(); caller("stranger.testnet", 0); let usage = env::storage_usage();
    let state = near_sdk::borsh::to_vec(&c).unwrap();
    rejects("STORAGE_UNFUNDED", || { c.create_product("spam".into(), "Spam".into()); });
    assert!(c.get_product(a("stranger.testnet"), "spam".into()).is_none());
    assert_eq!(env::storage_usage(), usage); assert_eq!(near_sdk::borsh::to_vec(&c).unwrap(), state);
}

#[test]
fn underfunded_opportunity_fails_before_state_mutation() {
    let mut c = fresh(); caller("merchant.testnet", cost(CREATE_BYTES)); c.create_product("app".into(), "App".into());
    let feature = f("merchant.testnet", "csv"); caller("merchant.testnet", 0); let usage = env::storage_usage();
    rejects("STORAGE_UNFUNDED", || { c.open_opportunity(feature.clone(), a("dev.testnet"), terms(10, 2000, 4)); });
    assert!(c.get_opportunity(feature).is_none()); assert_eq!(env::storage_usage(), usage);
}

#[test]
fn stranger_cannot_publish_pause_close_or_edit_owner_product() {
    let (mut c, feature, hash) = setup(); caller("stranger.testnet", 0);
    rejects("NOT_OWNER", || c.approve(feature.clone(), hash, "b".repeat(64)));
    rejects("NOT_OWNER", || c.set_paused(feature.clone(), true));
    rejects("NOT_OWNER", || c.close(feature.clone()));
    rejects("UNKNOWN_PRODUCT", || c.update_product("app".into(), "Stolen".into()));
    assert_eq!(c.get_product(a("merchant.testnet"), "app".into()).unwrap().name, "App");
}

#[test]
fn only_selected_developer_can_accept_or_submit() {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "csv");
    let hash = opened(&mut c, &feature, "dev.testnet", terms(10, 2000, 4)); caller("stranger.testnet", 0);
    rejects("NOT_DEVELOPER", || c.accept(feature.clone(), hash.clone()));
    caller("dev.testnet", 0); c.accept(feature.clone(), hash.clone()); caller("stranger.testnet", 0);
    rejects("NOT_DEVELOPER", || c.submit(feature, hash, "b".repeat(64)));
}

#[test]
fn hash_binds_contract_namespace_developer_and_every_term() {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "csv");
    let original = terms(11, 2000, 20); let hash = opened(&mut c, &feature, "dev.testnet", original.clone());
    for t in [terms(12, 2000, 20), terms(11, 1000, 20), terms(11, 2000, 10),
        Terms { requirements_sha256: "c".repeat(64), ..original.clone() },
        Terms { deadline_ns: Some(U64(50)), ..original.clone() }] {
        assert_ne!(terms_hash(&feature, &a("dev.testnet"), &t), hash);
    }
    assert_ne!(terms_hash(&feature, &a("otherdev.testnet"), &original), hash);
    let mut next = feature.clone(); next.version = 2;
    assert_ne!(terms_hash(&next, &a("dev.testnet"), &original), hash);
    caller("dev.testnet", 0); rejects("TERMS_MISMATCH", || c.accept(feature.clone(), "0".repeat(64)));
    c.accept(feature.clone(), hash.clone()); caller("merchant.testnet", 0);
    rejects("DUPLICATE_VERSION", || { c.open_opportunity(feature.clone(), a("evil.testnet"), terms(1, 0, 0)); });
    let old = c.get_opportunity(feature).unwrap(); assert_eq!(old.terms, original); assert_eq!(old.developer, a("dev.testnet"));
}

#[test]
fn acceptance_and_submission_cannot_repeat_or_replace_digest() {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "csv");
    let hash = opened(&mut c, &feature, "dev.testnet", terms(10, 2000, 4));
    caller("dev.testnet", 0); c.accept(feature.clone(), hash.clone());
    rejects("INVALID_TRANSITION", || c.accept(feature.clone(), hash.clone()));
    rejects("TERMS_MISMATCH", || c.submit(feature.clone(), "c".repeat(64), "b".repeat(64)));
    c.submit(feature.clone(), hash.clone(), "b".repeat(64));
    rejects("INVALID_TRANSITION", || c.submit(feature.clone(), hash.clone(), "c".repeat(64)));
    caller("merchant.testnet", 0);
    rejects("ARTIFACT_MISMATCH", || c.approve(feature.clone(), hash.clone(), "c".repeat(64)));
    c.approve(feature.clone(), hash.clone(), "b".repeat(64)); c.set_paused(feature.clone(), true);
    rejects("INVALID_TRANSITION", || c.approve(feature, hash, "b".repeat(64)));
}

#[test]
fn cancelled_cannot_be_published_or_reaccepted() {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "csv");
    let hash = opened(&mut c, &feature, "dev.testnet", terms(10, 2000, 4)); c.close(feature.clone());
    rejects("INVALID_TRANSITION", || c.approve(feature.clone(), hash.clone(), "b".repeat(64)));
    caller("dev.testnet", 0); rejects("INVALID_TRANSITION", || c.accept(feature, hash));
}

#[test]
fn fresh_version_requires_new_acceptance_and_keeps_old_release() {
    let (mut c, feature, hash) = setup(); let mut next = feature.clone(); next.version = 2;
    let newhash = opened(&mut c, &next, "newdev.testnet", terms(15, 1000, 20));
    assert_ne!(hash, newhash); caller("newdev.testnet", 0);
    rejects("TERMS_MISMATCH", || c.accept(next.clone(), hash));
    c.accept(next.clone(), newhash); assert_eq!(c.load(&next).status, Status::Accepted);
    assert_eq!(c.load(&feature).status, Status::Live);
}

#[test]
fn deadline_blocks_late_accept_submit_and_approval() {
    let mut c = fresh(); product(&mut c, "merchant.testnet");
    for (i, stage) in [("accept", 0), ("submit", 1), ("approve", 2)] {
        let feature = f("merchant.testnet", i);
        let hash = opened(&mut c, &feature, "dev.testnet", Terms { deadline_ns: Some(U64(2)), ..terms(10, 2000, 4) });
        caller("dev.testnet", 0);
        if stage >= 1 { c.accept(feature.clone(), hash.clone()); }
        if stage == 2 { c.submit(feature.clone(), hash.clone(), "b".repeat(64)); }
        context(if stage == 2 { "merchant.testnet" } else { "dev.testnet" }, 0, FUND * 10000, 3, vec![]);
        rejects("DEADLINE_EXPIRED", || match stage {
            0 => c.accept(feature, hash), 1 => c.submit(feature, hash, "b".repeat(64)),
            _ => c.approve(feature, hash, "b".repeat(64)),
        });
    }
}

#[test]
fn replay_wrong_price_nonexistent_and_unfunded_sale_do_not_credit() {
    let (mut c, feature, _) = setup();
    for amount in [0, 10, 12] {
        caller("buyer.testnet", amount); rejects("EXACT_PRICE_REQUIRED", || { c.purchase(feature.clone(), "bad".into()); });
    }
    caller("buyer.testnet", 11); rejects("UNKNOWN_FEATURE", || { c.purchase(f("merchant.testnet", "missing"), "bad".into()); });
    buy(&mut c, &feature, "once", 11);
    rejects("ORDER_REPLAY", || { c.purchase(feature.clone(), "once".into()); });
    // Simulates depletion while keeping funding totals unchanged for the check.
    c.products.get_mut(&feature.product_key()).unwrap().storage_available = U128(0); c.flush();
    rejects("STORAGE_UNFUNDED", || { c.purchase(feature.clone(), "unfunded".into()); });
    assert_eq!(c.total_sales, 11); assert!(c.get_order(a("buyer.testnet"), "unfunded".into()).is_none());
}

#[test]
fn buyer_wide_orders_are_immutable_and_distinct_buyers_can_reuse_ids() {
    let (mut c, feature, _) = setup(); let order = buy(&mut c, &feature, "one", 11);
    caller("otherbuyer.testnet", 11); c.purchase(feature.clone(), "one".into());
    assert_eq!(c.get_order(a("buyer.testnet"), "one".into()).unwrap().buyer, order.buyer);
    assert_eq!(c.get_order(a("buyer.testnet"), "one".into()).unwrap().artifact_sha256, "b".repeat(64));
    assert_eq!(c.get_credits(a("otherbuyer.testnet"), feature).0, 1);
}

#[test]
fn action_replay_including_different_feature_and_forged_buyer_rejected() {
    let (mut c, feature, _) = setup(); let other = f("merchant.testnet", "pdf");
    live(&mut c, &other, "dev.testnet", terms(11, 2500, 3));
    buy(&mut c, &feature, "one", 11); buy(&mut c, &other, "two", 11);
    caller("stranger.testnet", 0); rejects("NO_PAID_USE", || { c.consume_use(feature.clone(), "run".into()); });
    caller("buyer.testnet", 0); c.consume_use(feature.clone(), "run".into());
    rejects("ACTION_REPLAY", || { c.consume_use(feature.clone(), "run".into()); });
    rejects("ACTION_REPLAY", || { c.consume_use(other.clone(), "run".into()); });
    rejects("NO_PAID_USE", || { c.consume_use(feature.clone(), "new".into()); });
    c.consume_use(other, "new".into());
}

#[test]
fn paused_retired_keep_entitlement_and_earmarked_action_storage() {
    let (mut c, feature, _) = setup(); buy(&mut c, &feature, "one", 11); buy(&mut c, &feature, "two", 11);
    // Fill the remaining budget with a real merchant metadata write? Set only the
    // spendable field to zero to independently check consumption uses its escrow.
    c.products.get_mut(&feature.product_key()).unwrap().storage_available = U128(0); c.flush();
    caller("merchant.testnet", 0); c.set_paused(feature.clone(), true);
    caller("buyer.testnet", 11); rejects("FEATURE_NOT_LIVE", || { c.purchase(feature.clone(), "three".into()); });
    caller("buyer.testnet", 0); c.consume_use(feature.clone(), "paused-use".into());
    caller("merchant.testnet", 0); c.close(feature.clone());
    caller("buyer.testnet", 0); c.consume_use(feature.clone(), "retired-use".into());
    assert_eq!(c.get_credits(a("buyer.testnet"), feature.clone()).0, 0);
    assert_eq!(c.products.get(&feature.product_key()).unwrap().use_storage_escrow.0, 0);
    caller("merchant.testnet", 0); rejects("INVALID_TRANSITION", || c.set_paused(feature, false));
    assert_eq!(c.total_sales, 22);
}

#[test]
fn cap_boundary_fraction_rounding_and_multiple_features_conserve() {
    let (mut c, feature, _) = setup();
    for (i, expected) in [2, 1, 0].into_iter().enumerate() {
        let order = buy(&mut c, &feature, &format!("cap-{i}"), 11);
        assert_eq!(order.developer_share.0, expected); assert_eq!(order.owner_share.0 + expected, 11);
    }
    let other = f("merchant.testnet", "other"); live(&mut c, &other, "dev.testnet", terms(10, 2000, 4));
    buy(&mut c, &other, "other", 10);
    assert_eq!(c.load(&feature).paid.0, 3); assert_eq!(c.load(&other).paid.0, 2);
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 5); conserved(&c);
}

#[test]
fn baseline_twenty_percent_then_owner_only_after_cap() {
    let mut c = fresh(); product(&mut c, "merchant.testnet"); let feature = f("merchant.testnet", "baseline");
    live(&mut c, &feature, "dev.testnet", terms(10, 2000, 24));
    for i in 0..13 {
        let order = buy(&mut c, &feature, &format!("baseline-{i}"), 10);
        assert_eq!(order.developer_share.0, if i < 12 { 2 } else { 0 });
    }
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 24);
    assert_eq!(c.get_payout(a("merchant.testnet")).claimable.0, 106);
    let p = c.products.get(&feature.product_key()).unwrap();
    assert_eq!(p.storage_funded.0, p.storage_available.0 + p.use_storage_escrow.0 + c.storage_spent);
    conserved(&c);
}

#[test]
fn independent_merchant_withdrawals_restore_only_the_correct_ledger() {
    let (mut c, feature, _) = setup(); product(&mut c, "other.testnet"); let other = f("other.testnet", "csv");
    live(&mut c, &other, "otherdev.testnet", terms(10, 2000, 20));
    buy(&mut c, &feature, "first", 11); buy(&mut c, &other, "second", 10);
    caller("merchant.testnet", 0); c.withdraw(U128(9));
    caller("other.testnet", 0); c.withdraw(U128(8));
    assert_eq!(c.total_pending, 17);
    context("market.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Failed]);
    c.on_withdraw_complete(a("other.testnet"), U64(1));
    assert_eq!(c.get_payout(a("other.testnet")).claimable.0, 8);
    assert_eq!(c.get_payout(a("merchant.testnet")).pending.0, 9);
    context("market.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Successful(vec![])]);
    c.on_withdraw_complete(a("merchant.testnet"), U64(1));
    assert_eq!(c.get_payout(a("merchant.testnet")).claimable.0, 0);
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 2);
    assert_eq!(c.get_payout(a("otherdev.testnet")).claimable.0, 2); conserved(&c);
}

#[test]
fn zero_and_full_royalties_zero_cap_and_same_owner_developer() {
    let mut c = fresh(); product(&mut c, "merchant.testnet");
    for (slug, bps, cap, expected) in [("zero", 0, 100, 0), ("full", 10000, 100, 10), ("capped", 10000, 0, 0)] {
        let feature = f("merchant.testnet", slug); live(&mut c, &feature, "merchant.testnet", terms(10, bps, cap));
        assert_eq!(buy(&mut c, &feature, slug, 10).developer_share.0, expected);
    }
    assert_eq!(c.get_payout(a("merchant.testnet")).claimable.0, 30); conserved(&c);
}

#[test]
fn split_handles_u128_max_without_intermediate_overflow() {
    assert_eq!(split(u128::MAX, 10000), u128::MAX);
    assert_eq!(split(u128::MAX, 0), 0);
    assert_eq!(split(11, 2500), 2);
    for bps in [0, 1, 2000, 9999, 10000] { assert!(split(u128::MAX, bps) <= u128::MAX); }
    rejects("OVERFLOW", || { add(u128::MAX, 1); });
}

#[test]
fn aggregate_overflow_rejects_purchase_before_mutation() {
    let (mut c, feature, _) = setup(); c.total_sales = u128::MAX; caller("buyer.testnet", 11);
    rejects("OVERFLOW", || { c.purchase(feature.clone(), "overflow".into()); });
    assert!(c.get_order(a("buyer.testnet"), "overflow".into()).is_none()); assert_eq!(c.load(&feature).sold.0, 0);
}

#[test]
fn identifiers_hashes_terms_are_bounded_and_canonical() {
    let mut c = fresh(); caller("merchant.testnet", FUND);
    for bad in ["".into(), "x".repeat(65), "bad/id".into(), "caf\u{e9}".into()] {
        rejects("INVALID_ID", || { c.create_product(bad, "App".into()); });
    }
    rejects("INVALID_NAME", || { c.create_product("app".into(), "x".repeat(129)); });
    for bad in ["A".repeat(64), "z".repeat(64), "a".repeat(63)] { rejects("INVALID_SHA256", || digest(&bad)); }
    rejects("INVALID_TERMS", || validate_terms(&terms(0, 2000, 1)));
    rejects("INVALID_TERMS", || validate_terms(&terms(10, 10001, 1)));
    let mut feature = f("merchant.testnet", "csv"); feature.version = 0;
    rejects("INVALID_VERSION", || validate_feature(&feature));
}

#[test]
fn pending_payout_failure_restores_exactly_once_and_nonce_blocks_replay() {
    let (mut c, feature, _) = setup(); buy(&mut c, &feature, "one", 11);
    caller("dev.testnet", 0); c.withdraw(U128(2)); assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 0);
    assert_eq!(c.total_pending, 2); rejects("PAYOUT_PENDING", || { c.withdraw(U128(1)); }); conserved(&c);
    context("market.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Failed]);
    assert!(!c.on_withdraw_complete(a("dev.testnet"), U64(1)));
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 2);
    rejects("UNKNOWN_OR_SETTLED_PAYOUT", || { c.on_withdraw_complete(a("dev.testnet"), U64(1)); });
    caller("dev.testnet", 0); c.withdraw(U128(2));
    context("market.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Failed]);
    rejects("UNKNOWN_OR_SETTLED_PAYOUT", || { c.on_withdraw_complete(a("dev.testnet"), U64(1)); });
    assert!(!c.on_withdraw_complete(a("dev.testnet"), U64(2))); conserved(&c);
}

#[test]
fn successful_payout_retains_storage_backing_and_merchant_cannot_take_developer_funds() {
    let (mut c, feature, _) = setup(); buy(&mut c, &feature, "one", 11);
    caller("merchant.testnet", 0); rejects("INSUFFICIENT_CLAIMABLE", || { c.withdraw(U128(11)); });
    let before = env::storage_usage(); let reserve = c.storage_funded + c.bootstrap_backing;
    // Exact liquid balance before sending merchant's share; no storage money available.
    context("merchant.testnet", 0, reserve + 11, 1, vec![]); c.withdraw(U128(9));
    context("market.testnet", 0, reserve + 2, 1, vec![PromiseResult::Successful(vec![])]);
    assert!(c.on_withdraw_complete(a("merchant.testnet"), U64(1)));
    assert_eq!(env::storage_usage(), before); assert_eq!(c.total_withdrawn, 9);
    assert!(c.accounting().fully_backed_including_inflight); assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 2); conserved(&c);
}

#[test]
fn forged_callback_and_insolvent_withdraw_are_rejected_before_mutation() {
    let (mut c, feature, _) = setup(); buy(&mut c, &feature, "one", 11);
    caller("dev.testnet", 0); c.withdraw(U128(2));
    context("stranger.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Successful(vec![])]);
    rejects("PRIVATE_CALLBACK", || { c.on_withdraw_complete(a("dev.testnet"), U64(1)); });
    assert_eq!(c.total_pending, 2);
    context("merchant.testnet", 0, c.bootstrap_backing + c.storage_funded, 1, vec![]);
    rejects("INSOLVENT", || { c.withdraw(U128(1)); }); assert_eq!(c.get_payout(a("merchant.testnet")).claimable.0, 9);
}

#[test]
fn excessive_callback_response_cannot_unbounded_allocate() {
    let (mut c, feature, _) = setup(); buy(&mut c, &feature, "one", 11); caller("dev.testnet", 0); c.withdraw(U128(2));
    context("market.testnet", 0, FUND * 10000, 1, vec![PromiseResult::Successful(vec![0; 1024])]);
    assert!(!c.on_withdraw_complete(a("dev.testnet"), U64(1)));
    assert_eq!(c.get_payout(a("dev.testnet")).claimable.0, 2); conserved(&c);
}

#[test]
fn topup_measures_flush_and_roundtrip_keeps_maps_out_of_root_state() {
    let (mut c, feature, _) = setup(); let pkey = feature.product_key();
    let available = c.products.get(&pkey).unwrap().storage_available.0;
    caller("merchant.testnet", FUND); let usage = env::storage_usage(); c.fund_storage("app".into());
    assert_eq!(env::storage_usage(), usage); assert_eq!(c.products.get(&pkey).unwrap().storage_available.0, available + FUND);
    let bytes = near_sdk::borsh::to_vec(&c).unwrap(); drop(c);
    let c: Contract = near_sdk::borsh::from_slice(&bytes).unwrap();
    assert_eq!(c.load(&feature).approved_sha256.unwrap(), "b".repeat(64));
    assert!(bytes.len() < 512); conserved(&c);
}

#[test]
fn events_follow_nep297_envelope_and_views_do_not_change_storage() {
    let (c, feature, _) = setup(); let before = env::storage_usage();
    let state = near_sdk::borsh::to_vec(&c).unwrap();
    c.get_product(a("merchant.testnet"), "app".into()); c.get_submission(feature.clone()); c.get_release(feature);
    c.get_payout(a("dev.testnet")); c.accounting();
    assert_eq!(env::storage_usage(), before); assert_eq!(near_sdk::borsh::to_vec(&c).unwrap(), state);
    for log in get_logs() {
        let json: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(json["standard"], "earnpatch"); assert!(json["data"].is_array());
    }
}

#[test]
fn stress_500_merchants_features_orders_and_actions_constant_root() {
    let mut c = fresh(); let root_before = near_sdk::borsh::to_vec(&c).unwrap().len(); let usage_before = env::storage_usage();
    for i in 0..500 {
        let who = format!("merchant-{i}.testnet"); product(&mut c, &who); let feature = f(&who, "csv");
        live(&mut c, &feature, "dev.testnet", terms(10, 2000, 4));
        buy(&mut c, &feature, &format!("order-{i}"), 10);
        caller("buyer.testnet", 0); c.consume_use(feature.clone(), format!("action-{i}"));
        assert_eq!(c.get_credits(a("buyer.testnet"), feature).0, 0);
    }
    let root_after = near_sdk::borsh::to_vec(&c).unwrap().len(); let delta = env::storage_usage() - usage_before;
    println!("G27_NATIVE_STRESS_MERCHANTS=500 FEATURES=500 ORDERS=500 ACTIONS=500 ROOT_BEFORE={root_before} ROOT_AFTER={root_after} TRIE_DELTA_BYTES={delta} STORAGE_SPENT_YOCTO={}", c.storage_spent);
    assert_eq!(root_before, root_after); assert_eq!(c.total_sales, 5000); assert_eq!(c.total_claimable, 5000);
    assert_eq!(c.storage_spent, cost(delta)); conserved(&c);
}
