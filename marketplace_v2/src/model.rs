use near_sdk::{near, AccountId};
use near_sdk::json_types::{U128, U64};

// Borsh tuples are length-delimited; never concatenate user slugs to form keys.
pub type ProductKey = (AccountId, String);
pub type FeatureKey = (AccountId, String, String, u32);
pub type BuyerKey = (AccountId, String);
pub type CreditKey = (AccountId, FeatureKey);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureId {
    pub owner: AccountId,
    pub product: String,
    pub feature: String,
    pub version: u32,
}
impl FeatureId {
    pub(crate) fn key(&self) -> FeatureKey {
        (self.owner.clone(), self.product.clone(), self.feature.clone(), self.version)
    }
    pub(crate) fn product_key(&self) -> ProductKey { (self.owner.clone(), self.product.clone()) }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Terms {
    pub requirements_sha256: String,
    pub price: U128,
    pub royalty_bps: u16,
    pub cap: U128,
    // Nanoseconds since Unix epoch; commissioning only, not a sales guarantee.
    pub deadline_ns: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status { Open, Accepted, Submitted, Live, Paused, Cancelled, Retired }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Product {
    pub owner: AccountId,
    pub name: String,
    pub storage_available: U128,
    pub storage_funded: U128,
    pub use_storage_escrow: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Opportunity {
    pub id: FeatureId,
    pub developer: AccountId,
    pub terms: Terms,
    pub terms_hash: String,
    pub accepted_hash: Option<String>,
    pub submitted_sha256: Option<String>,
    pub approved_sha256: Option<String>,
    pub status: Status,
    pub paid: U128,
    pub sold: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: String,
    pub feature: FeatureId,
    pub terms_hash: String,
    pub artifact_sha256: String,
    pub buyer: AccountId,
    pub price: U128,
    pub developer_share: U128,
    pub owner_share: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Ledger {
    pub claimable: U128,
    pub pending: U128,
    pub nonce: U64,
}

#[near(serializers = [json])]
pub struct Accounting {
    pub claimable: U128,
    pub pending: U128,
    pub sales: U128,
    pub withdrawn: U128,
    pub storage_funded: U128,
    pub storage_spent: U128,
    pub storage_available: U128,
    pub bootstrap_backing: U128,
    pub storage_usage: U64,
    pub account_balance: U128,
    // Conservative: pending transfers may already have left the account.
    pub fully_backed_including_inflight: bool,
}
