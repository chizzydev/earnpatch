//! Offline research/testnet implementation. No deployment authorized in G27.
mod model;
pub use model::*;

use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;

// Conservative operation reservations, followed by explicit flush + reconciliation.
// The gate must validate these bounds in the mocked VM and compiled WASM runtime.
const CREATE_BYTES: u64 = 4096;
const OPEN_BYTES: u64 = 8192;
const SALE_BYTES: u64 = 8192;
const ACTION_BYTES: u64 = 4096;
const CHANGE_BYTES: u64 = 2048;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    products: LookupMap<ProductKey, Product>,
    opportunities: LookupMap<FeatureKey, Opportunity>,
    orders: LookupMap<BuyerKey, Order>,
    credits: LookupMap<CreditKey, u64>,
    actions: LookupMap<BuyerKey, FeatureId>,
    ledgers: LookupMap<AccountId, Ledger>,
    storage_funded: u128,
    storage_spent: u128,
    bootstrap_backing: u128,
    total_claimable: u128,
    total_pending: u128,
    total_sales: u128,
    total_withdrawn: u128,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_withdraw_complete(&mut self, account_id: AccountId, nonce: U64) -> bool;
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        assert!(!env::state_exists(), "ALREADY_INITIALIZED");
        // Initial account must be endowed for initial state, code stake, and headroom.
        let bootstrap = cost(env::storage_usage().checked_add(4096).expect("OVERFLOW"));
        assert!(env::account_balance().as_yoctonear() >= bootstrap, "BOOTSTRAP_UNFUNDED");
        Self {
            products: LookupMap::new(b"p"), opportunities: LookupMap::new(b"f"),
            orders: LookupMap::new(b"o"), credits: LookupMap::new(b"c"),
            actions: LookupMap::new(b"a"), ledgers: LookupMap::new(b"l"),
            storage_funded: 0, storage_spent: 0, bootstrap_backing: bootstrap,
            total_claimable: 0, total_pending: 0, total_sales: 0, total_withdrawn: 0,
        }
    }

    #[payable]
    pub fn create_product(&mut self, product_id: String, name: String) -> Product {
        id(&product_id); label(&name);
        let owner = env::predecessor_account_id();
        let key = (owner.clone(), product_id);
        assert!(!self.products.contains_key(&key), "DUPLICATE_PRODUCT");
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit >= cost(CREATE_BYTES), "STORAGE_UNFUNDED");
        let funded = add(self.storage_funded, deposit);
        self.check_backing(self.total_claimable, self.total_pending, funded);
        let before = env::storage_usage();
        self.products.insert(key.clone(), Product {
            owner: owner.clone(), name, storage_available: U128(deposit), storage_funded: U128(deposit), use_storage_escrow: U128(0),
        });
        if !self.ledgers.contains_key(&owner) { self.ledgers.insert(owner, Ledger::default()); }
        self.storage_funded = funded;
        self.reconcile(&key, before, CREATE_BYTES);
        event("product_created", &key);
        self.products.get(&key).unwrap().clone()
    }

    #[payable]
    pub fn fund_storage(&mut self, product_id: String) {
        id(&product_id);
        let key = (env::predecessor_account_id(), product_id);
        let mut p = self.products.get(&key).expect("UNKNOWN_PRODUCT").clone();
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "INVALID_AMOUNT");
        let funded = add(self.storage_funded, amount);
        p.storage_funded.0 = add(p.storage_funded.0, amount);
        p.storage_available.0 = add(p.storage_available.0, amount);
        self.check_backing(self.total_claimable, self.total_pending, funded);
        self.products.insert(key.clone(), p);
        self.storage_funded = funded;
        self.flush();
        event("storage_funded", &key);
    }

    pub fn update_product(&mut self, product_id: String, name: String) {
        id(&product_id); label(&name);
        let key = (env::predecessor_account_id(), product_id);
        let before = self.reserve(&key, CHANGE_BYTES);
        self.products.get_mut(&key).unwrap().name = name;
        self.reconcile(&key, before, CHANGE_BYTES);
        event("product_updated", &key);
    }

    /// Creates a permanently immutable version. A successor is a separate identity.
    pub fn open_opportunity(&mut self, feature: FeatureId, developer: AccountId, terms: Terms) -> Opportunity {
        validate_feature(&feature); owner(&feature); validate_terms(&terms);
        let key = feature.key();
        assert!(!self.opportunities.contains_key(&key), "DUPLICATE_VERSION");
        let hash = terms_hash(&feature, &developer, &terms);
        let before = self.reserve(&feature.product_key(), OPEN_BYTES);
        let f = Opportunity { id: feature.clone(), developer: developer.clone(), terms,
            terms_hash: hash, accepted_hash: None, submitted_sha256: None,
            approved_sha256: None, status: Status::Open, paid: U128(0), sold: U64(0) };
        if !self.ledgers.contains_key(&developer) { self.ledgers.insert(developer, Ledger::default()); }
        self.opportunities.insert(key, f.clone());
        self.reconcile(&feature.product_key(), before, OPEN_BYTES);
        event("opportunity_opened", &f);
        f
    }

    pub fn accept(&mut self, feature: FeatureId, expected_terms_hash: String) {
        let mut f = self.load(&feature);
        assert_eq!(env::predecessor_account_id(), f.developer, "NOT_DEVELOPER");
        assert_eq!(f.status, Status::Open, "INVALID_TRANSITION");
        deadline(&f);
        assert_eq!(expected_terms_hash, f.terms_hash, "TERMS_MISMATCH");
        let before = self.reserve(&feature.product_key(), CHANGE_BYTES);
        f.accepted_hash = Some(f.terms_hash.clone()); f.status = Status::Accepted;
        self.save(f, before, CHANGE_BYTES, "developer_accepted");
    }

    pub fn submit(&mut self, feature: FeatureId, expected_terms_hash: String, artifact_sha256: String) {
        digest(&artifact_sha256);
        let mut f = self.load(&feature);
        assert_eq!(env::predecessor_account_id(), f.developer, "NOT_DEVELOPER");
        assert_eq!(f.status, Status::Accepted, "INVALID_TRANSITION"); deadline(&f);
        assert_eq!(Some(&expected_terms_hash), f.accepted_hash.as_ref(), "TERMS_MISMATCH");
        let before = self.reserve(&feature.product_key(), CHANGE_BYTES);
        f.submitted_sha256 = Some(artifact_sha256); f.status = Status::Submitted;
        self.save(f, before, CHANGE_BYTES, "artifact_submitted");
    }

    pub fn approve(&mut self, feature: FeatureId, expected_terms_hash: String, artifact_sha256: String) {
        owner(&feature);
        let mut f = self.load(&feature);
        assert_eq!(f.status, Status::Submitted, "INVALID_TRANSITION"); deadline(&f);
        assert_eq!(Some(&expected_terms_hash), f.accepted_hash.as_ref(), "TERMS_MISMATCH");
        assert_eq!(Some(&artifact_sha256), f.submitted_sha256.as_ref(), "ARTIFACT_MISMATCH");
        let before = self.reserve(&feature.product_key(), CHANGE_BYTES);
        f.approved_sha256 = Some(artifact_sha256); f.status = Status::Live;
        self.save(f, before, CHANGE_BYTES, "feature_published");
    }

    pub fn set_paused(&mut self, feature: FeatureId, paused: bool) {
        owner(&feature);
        let mut f = self.load(&feature);
        assert_eq!(f.status, if paused { Status::Live } else { Status::Paused }, "INVALID_TRANSITION");
        let before = self.reserve(&feature.product_key(), 0);
        f.status = if paused { Status::Paused } else { Status::Live };
        self.save(f, before, 0, "feature_status_changed");
    }

    /// Reject/cancel commissioning or permanently retire a released version.
    pub fn close(&mut self, feature: FeatureId) {
        owner(&feature);
        let mut f = self.load(&feature);
        let next = match f.status {
            Status::Open | Status::Accepted | Status::Submitted => Status::Cancelled,
            Status::Live | Status::Paused => Status::Retired,
            _ => panic!("INVALID_TRANSITION"),
        };
        let before = self.reserve(&feature.product_key(), 0);
        f.status = next;
        self.save(f, before, 0, "feature_closed");
    }

    #[payable]
    pub fn purchase(&mut self, feature: FeatureId, order_id: String) -> Order {
        id(&order_id);
        let mut f = self.load(&feature);
        assert_eq!(f.status, Status::Live, "FEATURE_NOT_LIVE");
        assert_eq!(env::attached_deposit().as_yoctonear(), f.terms.price.0, "EXACT_PRICE_REQUIRED");
        let buyer = env::predecessor_account_id();
        let order_key = (buyer.clone(), order_id.clone());
        assert!(!self.orders.contains_key(&order_key), "ORDER_REPLAY");
        // Quotient/remainder avoids price*bps overflow even at u128::MAX.
        let royalty = split(f.terms.price.0, f.terms.royalty_bps).min(f.terms.cap.0 - f.paid.0);
        let merchant = f.terms.price.0 - royalty;
        let developer_balance = self.ledgers.get(&f.developer).expect("MISSING_LEDGER").claimable.0;
        let owner_balance = self.ledgers.get(&feature.owner).expect("MISSING_LEDGER").claimable.0;
        if f.developer == feature.owner { add(owner_balance, f.terms.price.0); }
        else { add(developer_balance, royalty); add(owner_balance, merchant); }
        let claimable = add(self.total_claimable, f.terms.price.0);
        let sales = add(self.total_sales, f.terms.price.0);
        let sold = f.sold.0.checked_add(1).expect("OVERFLOW");
        let credit_key = (buyer.clone(), feature.key());
        let credits = self.credits.get(&credit_key).copied().unwrap_or(0).checked_add(1).expect("OVERFLOW");
        self.check_backing(claimable, self.total_pending, self.storage_funded);
        let before = self.reserve(&feature.product_key(), SALE_BYTES + ACTION_BYTES);
        let p = self.products.get_mut(&feature.product_key()).unwrap();
        p.storage_available.0 -= cost(ACTION_BYTES);
        p.use_storage_escrow.0 = add(p.use_storage_escrow.0, cost(ACTION_BYTES));
        f.paid.0 = add(f.paid.0, royalty); f.sold = U64(sold);
        let order = Order { id: order_id, feature: feature.clone(), terms_hash: f.terms_hash.clone(),
            artifact_sha256: f.approved_sha256.clone().expect("MISSING_APPROVAL"), buyer,
            price: f.terms.price, developer_share: U128(royalty), owner_share: U128(merchant) };
        self.credit(&f.developer, royalty); self.credit(&feature.owner, merchant);
        self.total_claimable = claimable; self.total_sales = sales;
        self.credits.insert(credit_key, credits);
        self.orders.insert(order_key, order.clone());
        self.opportunities.insert(feature.key(), f);
        self.reconcile(&feature.product_key(), before, SALE_BYTES);
        event("purchase_settled", &order);
        order
    }

    pub fn consume_use(&mut self, feature: FeatureId, action_id: String) -> U64 {
        id(&action_id); self.load(&feature);
        let buyer = env::predecessor_account_id();
        // Buyer-wide action IDs deliberately cannot be replayed across features.
        let action_key = (buyer.clone(), action_id);
        assert!(!self.actions.contains_key(&action_key), "ACTION_REPLAY");
        let key = (buyer, feature.key());
        let count = self.credits.get(&key).copied().unwrap_or(0);
        assert!(count > 0, "NO_PAID_USE");
        let pkey = feature.product_key();
        assert!(self.products.get(&pkey).unwrap().use_storage_escrow.0 >= cost(ACTION_BYTES), "USE_ESCROW_BROKEN");
        self.flush();
        let before = env::storage_usage();
        let p = self.products.get_mut(&pkey).unwrap();
        p.use_storage_escrow.0 -= cost(ACTION_BYTES);
        p.storage_available.0 = add(p.storage_available.0, cost(ACTION_BYTES));
        self.credits.insert(key, count - 1);
        self.actions.insert(action_key.clone(), feature.clone());
        self.reconcile(&feature.product_key(), before, ACTION_BYTES);
        event("use_consumed", &(action_key, feature, U64(count - 1)));
        U64(count - 1)
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert!(amount.0 > 0, "INVALID_AMOUNT");
        let caller = env::predecessor_account_id();
        let mut ledger = self.ledgers.get(&caller).expect("NO_CLAIMABLE").clone();
        assert_eq!(ledger.pending.0, 0, "PAYOUT_PENDING");
        assert!(ledger.claimable.0 >= amount.0, "INSUFFICIENT_CLAIMABLE");
        let nonce = ledger.nonce.0.checked_add(1).expect("OVERFLOW");
        let pending = add(self.total_pending, amount.0);
        self.check_backing(self.total_claimable, self.total_pending, self.storage_funded);
        // Ledger fields are fixed size. This transition allocates no new entry.
        ledger.claimable.0 -= amount.0; ledger.pending = amount; ledger.nonce = U64(nonce);
        self.ledgers.insert(caller.clone(), ledger);
        self.total_claimable -= amount.0; self.total_pending = pending;
        self.flush();
        event("withdraw_pending", &(caller.clone(), U64(nonce), amount));
        Promise::new(caller.clone()).transfer(NearToken::from_yoctonear(amount.0))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15))
                .on_withdraw_complete(caller, U64(nonce)))
    }

    #[private]
    pub fn on_withdraw_complete(&mut self, account_id: AccountId, nonce: U64) -> bool {
        // Explicit check also protects direct native calls that bypass macro wrapper.
        assert_eq!(env::predecessor_account_id(), env::current_account_id(), "PRIVATE_CALLBACK");
        let mut ledger = self.ledgers.get(&account_id).expect("UNKNOWN_PAYOUT").clone();
        assert!(ledger.pending.0 > 0 && ledger.nonce == nonce, "UNKNOWN_OR_SETTLED_PAYOUT");
        assert_eq!(env::promise_results_count(), 1, "INVALID_CALLBACK");
        let success = env::promise_result_checked(0, 0).is_ok();
        let amount = ledger.pending.0;
        if success { self.total_withdrawn = add(self.total_withdrawn, amount); }
        else {
            ledger.claimable.0 = add(ledger.claimable.0, amount);
            self.total_claimable = add(self.total_claimable, amount);
        }
        ledger.pending = U128(0); self.total_pending -= amount;
        self.ledgers.insert(account_id.clone(), ledger); self.flush();
        event(if success { "withdraw_settled" } else { "withdraw_restored" }, &(account_id, nonce, U128(amount)));
        success
    }

    pub fn get_product(&self, owner: AccountId, product_id: String) -> Option<Product> {
        id(&product_id); self.products.get(&(owner, product_id)).cloned()
    }
    pub fn get_opportunity(&self, feature: FeatureId) -> Option<Opportunity> {
        validate_feature(&feature); self.opportunities.get(&feature.key()).cloned()
    }
    pub fn get_submission(&self, feature: FeatureId) -> Option<String> { self.load(&feature).submitted_sha256 }
    pub fn get_release(&self, feature: FeatureId) -> Option<Opportunity> {
        let f = self.load(&feature); if f.approved_sha256.is_some() { Some(f) } else { None }
    }
    pub fn get_order(&self, buyer: AccountId, order_id: String) -> Option<Order> {
        id(&order_id); self.orders.get(&(buyer, order_id)).cloned()
    }
    pub fn get_credits(&self, buyer: AccountId, feature: FeatureId) -> U64 {
        validate_feature(&feature); U64(self.credits.get(&(buyer, feature.key())).copied().unwrap_or(0))
    }
    pub fn get_action(&self, buyer: AccountId, action_id: String) -> Option<FeatureId> {
        id(&action_id); self.actions.get(&(buyer, action_id)).cloned()
    }
    pub fn get_payout(&self, account_id: AccountId) -> Ledger { self.ledgers.get(&account_id).cloned().unwrap_or_default() }
    pub fn accounting(&self) -> Accounting {
        let balance = env::account_balance().as_yoctonear();
        Accounting { claimable: U128(self.total_claimable), pending: U128(self.total_pending),
            sales: U128(self.total_sales), withdrawn: U128(self.total_withdrawn),
            storage_funded: U128(self.storage_funded), storage_spent: U128(self.storage_spent),
            storage_available: U128(self.storage_funded - self.storage_spent),
            bootstrap_backing: U128(self.bootstrap_backing), storage_usage: U64(env::storage_usage()),
            account_balance: U128(balance),
            fully_backed_including_inflight: self.required(self.total_claimable, self.total_pending, self.storage_funded)
                .map(|r| balance >= r).unwrap_or(false), }
    }
}

impl Contract {
    fn load(&self, feature: &FeatureId) -> Opportunity {
        validate_feature(feature); self.opportunities.get(&feature.key()).expect("UNKNOWN_FEATURE").clone()
    }
    fn save(&mut self, f: Opportunity, before: u64, bound: u64, name: &str) {
        let key = f.id.product_key(); self.opportunities.insert(f.id.key(), f.clone());
        self.reconcile(&key, before, bound); event(name, &f);
    }
    fn credit(&mut self, who: &AccountId, amount: u128) {
        let ledger = self.ledgers.get_mut(who).expect("MISSING_LEDGER");
        ledger.claimable.0 = add(ledger.claimable.0, amount);
    }
    fn required(&self, claimable: u128, pending: u128, funded: u128) -> Option<u128> {
        self.bootstrap_backing.checked_add(funded)?.checked_add(claimable)?.checked_add(pending)
    }
    fn check_backing(&self, claimable: u128, pending: u128, funded: u128) {
        assert!(env::account_balance().as_yoctonear() >= self.required(claimable, pending, funded).expect("OVERFLOW"), "INSOLVENT");
    }
    fn reserve(&mut self, key: &ProductKey, bytes: u64) -> u64 {
        // No writes before this check: insufficient funding does not partially mutate
        // even in native Rust tests (runtime additionally rolls back failed receipts).
        assert!(self.products.get(key).expect("UNKNOWN_PRODUCT").storage_available.0 >= cost(bytes), "STORAGE_UNFUNDED");
        self.flush(); env::storage_usage()
    }
    fn reconcile(&mut self, key: &ProductKey, before: u64, bound: u64) {
        self.flush();
        let after = env::storage_usage();
        if after >= before {
            let bytes = after - before;
            assert!(bytes <= bound, "STORAGE_BOUND_EXCEEDED");
            let charge = cost(bytes);
            let p = self.products.get_mut(key).unwrap();
            p.storage_available.0 = p.storage_available.0.checked_sub(charge).expect("STORAGE_UNFUNDED");
            self.storage_spent = add(self.storage_spent, charge);
        } else {
            let refund = cost(before - after);
            let p = self.products.get_mut(key).unwrap();
            p.storage_available.0 = add(p.storage_available.0, refund);
            self.storage_spent = self.storage_spent.checked_sub(refund).expect("STORAGE_ACCOUNTING");
        }
        // Product balance updates are fixed width and cannot change byte usage.
        self.flush();
        assert_eq!(env::storage_usage(), after, "STORAGE_RECONCILE_CHANGED_SIZE");
        assert!(cost(after) <= add(self.bootstrap_backing, self.storage_spent), "STAKE_UNFUNDED");
    }
    fn flush(&mut self) {
        self.products.flush(); self.opportunities.flush(); self.orders.flush();
        self.credits.flush(); self.actions.flush(); self.ledgers.flush();
    }
}

fn add(a: u128, b: u128) -> u128 { a.checked_add(b).expect("OVERFLOW") }
fn cost(bytes: u64) -> u128 { u128::from(bytes).checked_mul(env::storage_byte_cost().as_yoctonear()).expect("OVERFLOW") }
fn id(s: &str) { assert!(!s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'), "INVALID_ID"); }
fn label(s: &str) { assert!(!s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control), "INVALID_NAME"); }
fn digest(s: &str) { assert!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "INVALID_SHA256"); }
fn validate_feature(f: &FeatureId) { id(&f.product); id(&f.feature); assert!(f.version > 0, "INVALID_VERSION"); }
fn owner(f: &FeatureId) { assert_eq!(env::predecessor_account_id(), f.owner, "NOT_OWNER"); }
fn validate_terms(t: &Terms) {
    digest(&t.requirements_sha256); assert!(t.price.0 > 0 && t.royalty_bps <= 10_000, "INVALID_TERMS");
    if let Some(d) = t.deadline_ns { assert!(d.0 > env::block_timestamp(), "DEADLINE_EXPIRED"); }
}
fn deadline(f: &Opportunity) { if let Some(d) = f.terms.deadline_ns { assert!(env::block_timestamp() <= d.0, "DEADLINE_EXPIRED"); } }
fn split(price: u128, bps: u16) -> u128 { (price / 10_000) * u128::from(bps) + ((price % 10_000) * u128::from(bps)) / 10_000 }
fn terms_hash(f: &FeatureId, dev: &AccountId, t: &Terms) -> String {
    let bytes = near_sdk::borsh::to_vec(&("earnpatch.marketplace.v2.terms", env::current_account_id(), f, dev, t)).unwrap();
    env::sha256(&bytes).iter().map(|b| format!("{b:02x}")).collect()
}
fn event<T: near_sdk::serde::Serialize>(name: &str, data: &T) {
    let payload = near_sdk::serde_json::json!({"standard":"earnpatch", "version":"2.0.0", "event":name, "data":[data]});
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

#[cfg(test)]
mod tests;
