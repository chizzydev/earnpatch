use near_sdk::{near,env,AccountId};
#[near(serializers=[borsh,json])]
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct FeatureId {pub owner:AccountId,pub product:String,pub feature:String,pub version:u32}
impl FeatureId {pub fn validate(&self){id(&self.product);id(&self.feature);assert!(self.version>0,"INVALID_VERSION");}}
#[near(serializers=[json])]
pub struct SourceRelease {pub id:FeatureId,pub developer:AccountId,pub terms_hash:String,pub accepted_hash:Option<String>,pub approved_sha256:Option<String>,pub submitted_sha256:Option<String>,pub status:String}
pub fn source(bytes:&[u8],feature:&FeatureId,developer:&AccountId,terms:&str)->Option<String>{let f=near_sdk::serde_json::from_slice::<Option<SourceRelease>>(bytes).ok()??;if &f.id!=feature||&f.developer!=developer||f.terms_hash!=terms||f.accepted_hash.as_deref()!=Some(terms)||!matches!(f.status.as_str(),"live"|"paused"){return None;}let a=f.approved_sha256?;if !is_digest(&a)||f.submitted_sha256.as_deref()!=Some(&a){return None;}Some(a)}
pub fn id(s:&str){assert!(!s.is_empty()&&s.len()<=64&&s.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'_'||c==b'-'),"INVALID_ID");}
pub fn is_digest(s:&str)->bool{s.len()==64&&s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))}
pub fn digest(s:&str){assert!(is_digest(s),"INVALID_DIGEST");}
pub fn add(a:u128,b:u128)->u128{a.checked_add(b).expect("OVERFLOW")}
pub fn cost(n:u64)->u128{(n as u128).checked_mul(env::storage_byte_cost().as_yoctonear()).expect("OVERFLOW")}
pub fn private(){assert_eq!(env::predecessor_account_id(),env::current_account_id(),"PRIVATE_CALLBACK");assert_eq!(env::promise_results_count(),1,"ONE_RESULT_REQUIRED");}
pub fn event(name:&str,data:impl near_sdk::serde::Serialize){env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"earnpatch-finance","version":"1.0.0","event":name,"data":[data]})));}
