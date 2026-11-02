//! Official standard implementation fixture. TestEPUSD is NOT USDC/USDT.
use near_sdk::{near,AccountId,PanicOnDefault,NearToken,PromiseOrValue};
use near_sdk::json_types::U128;
use near_contract_standards::fungible_token::{FungibleToken,metadata::{FungibleTokenMetadata,FungibleTokenMetadataProvider,FT_METADATA_SPEC}};
use near_contract_standards::fungible_token::{FungibleTokenCore,FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageManagement,StorageBalance,StorageBalanceBounds};
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsd{token:FungibleToken,metadata:FungibleTokenMetadata}
#[near]
impl TestUsd{
 #[init]pub fn new(owner_id:AccountId,total_supply:U128)->Self{assert!(!near_sdk::env::state_exists(),"ALREADY_INITIALIZED");let mut token=FungibleToken::new(b"t".to_vec());token.internal_register_account(&owner_id);token.internal_deposit(&owner_id,total_supply.0);Self{token,metadata:FungibleTokenMetadata{spec:FT_METADATA_SPEC.into(),name:"EarnPatch test dollar — no redemption value".into(),symbol:"TestEPUSD".into(),icon:None,reference:None,reference_hash:None,decimals:6}}}
}
#[near]
impl FungibleTokenCore for TestUsd{
 #[payable]fn ft_transfer(&mut self,receiver_id:AccountId,amount:U128,memo:Option<String>){self.token.ft_transfer(receiver_id,amount,memo);}
 #[payable]fn ft_transfer_call(&mut self,receiver_id:AccountId,amount:U128,memo:Option<String>,msg:String)->PromiseOrValue<U128>{self.token.ft_transfer_call(receiver_id,amount,memo,msg)}
 fn ft_total_supply(&self)->U128{self.token.ft_total_supply()}
 fn ft_balance_of(&self,account_id:AccountId)->U128{self.token.ft_balance_of(account_id)}
}
#[near]
impl FungibleTokenResolver for TestUsd{
 #[private]fn ft_resolve_transfer(&mut self,sender_id:AccountId,receiver_id:AccountId,amount:U128)->U128{assert_eq!(near_sdk::env::predecessor_account_id(),near_sdk::env::current_account_id(),"PRIVATE_RESOLVER");self.token.ft_resolve_transfer(sender_id,receiver_id,amount)}
}
#[near]
impl StorageManagement for TestUsd{
 #[payable]fn storage_deposit(&mut self,account_id:Option<AccountId>,registration_only:Option<bool>)->StorageBalance{self.token.storage_deposit(account_id,registration_only)}
 #[payable]fn storage_withdraw(&mut self,amount:Option<NearToken>)->StorageBalance{self.token.storage_withdraw(amount)}
 #[payable]fn storage_unregister(&mut self,force:Option<bool>)->bool{self.token.storage_unregister(force)}
 fn storage_balance_bounds(&self)->StorageBalanceBounds{self.token.storage_balance_bounds()}
 fn storage_balance_of(&self,account_id:AccountId)->Option<StorageBalance>{self.token.storage_balance_of(account_id)}
}
#[near]
impl FungibleTokenMetadataProvider for TestUsd{fn ft_metadata(&self)->FungibleTokenMetadata{self.metadata.clone()}}
