use chrono::{DateTime, Utc};
use log::debug;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::storage::PersistentCache;

/// Cache entry with expiration time
#[derive(Debug, Clone)]
struct CacheEntry<T> {
    data: T,
    expires_at: DateTime<Utc>,
}

/// Two-tier cache: in-memory HashMap backed by persistent SQLite storage.
/// - In-memory: fast, but lost on restart
/// - Persistent: survives restarts, slightly slower but still fast (SQLite)
///
/// Get flow: in-memory -> persistent (load into memory) -> miss
/// Set flow: in-memory + persistent
/// Clear flow: in-memory + persistent
pub struct DataCache {
    accounts: RwLock<HashMap<String, CacheEntry<String>>>,
    balance_history: RwLock<HashMap<String, CacheEntry<String>>>,
    budgets: RwLock<HashMap<String, CacheEntry<String>>>,
    budget_spent: RwLock<HashMap<String, CacheEntry<String>>>,
    budget_spent_history: RwLock<HashMap<String, CacheEntry<String>>>,
    earned_spent: RwLock<HashMap<String, CacheEntry<String>>>,
    expenses_by_category: RwLock<HashMap<String, CacheEntry<String>>>,
    net_worth: RwLock<HashMap<String, CacheEntry<String>>>,
    subcategory_spend: RwLock<HashMap<String, CacheEntry<String>>>,
    categories: RwLock<HashMap<String, CacheEntry<String>>>,
    ttl_seconds: u64,
}

impl DataCache {
    pub fn new(ttl_seconds: u64) -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            balance_history: RwLock::new(HashMap::new()),
            budgets: RwLock::new(HashMap::new()),
            budget_spent: RwLock::new(HashMap::new()),
            budget_spent_history: RwLock::new(HashMap::new()),
            earned_spent: RwLock::new(HashMap::new()),
            expenses_by_category: RwLock::new(HashMap::new()),
            net_worth: RwLock::new(HashMap::new()),
            subcategory_spend: RwLock::new(HashMap::new()),
            categories: RwLock::new(HashMap::new()),
            ttl_seconds,
        }
    }

    fn is_expired<T>(entry: &CacheEntry<T>) -> bool {
        Utc::now() > entry.expires_at
    }

    fn make_entry(data: String, ttl_seconds: u64) -> CacheEntry<String> {
        let expires_at = Utc::now() + chrono::Duration::seconds(ttl_seconds as i64);
        CacheEntry { data, expires_at }
    }

    // ── Generic helpers ──────────────────────────────────────────────

    /// Try in-memory cache; on miss, try persistent cache and promote to memory.
    fn get_tiered(
        mem_cache: &RwLock<HashMap<String, CacheEntry<String>>>,
        persist_key: &str,
    ) -> Option<String> {
        // 1. In-memory check
        if let Ok(cache) = mem_cache.read() {
            if let Some(entry) = cache.get(persist_key) {
                if !Self::is_expired(entry) {
                    return Some(entry.data.clone());
                }
            }
        }

        // 2. Persistent cache check -> promote to memory
        if let Some(data) = PersistentCache::get(persist_key) {
            debug!("Persistent cache hit: {}", persist_key);
            if let Ok(mut cache) = mem_cache.write() {
                let entry = Self::make_entry(data.clone(), 3600); // 1h in-memory TTL on promote
                cache.insert(persist_key.to_string(), entry);
            }
            return Some(data);
        }

        None
    }

    /// Write to both in-memory and persistent cache.
    fn set_tiered(
        mem_cache: &RwLock<HashMap<String, CacheEntry<String>>>,
        persist_key: &str,
        data: &str,
        ttl_seconds: u64,
    ) {
        // In-memory
        if let Ok(mut cache) = mem_cache.write() {
            let entry = Self::make_entry(data.to_string(), ttl_seconds);
            cache.insert(persist_key.to_string(), entry);
        }
        // Persistent
        PersistentCache::set(persist_key, data, ttl_seconds);
    }

    /// Clear both tiers for a specific cache map and optional prefix.
    fn clear_tiered(
        mem_cache: &RwLock<HashMap<String, CacheEntry<String>>>,
        persist_prefix: Option<&str>,
    ) {
        if let Ok(mut cache) = mem_cache.write() {
            cache.clear();
        }
        if let Some(prefix) = persist_prefix {
            PersistentCache::clear_prefix(prefix);
        }
    }

    // ── Accounts ─────────────────────────────────────────────────────

    fn account_key(type_filter: Option<&str>) -> String {
        match type_filter {
            Some(t) => format!("accounts:{}", t),
            None => "accounts:all".to_string(),
        }
    }

    pub fn get_accounts(&self, type_filter: Option<String>) -> Option<String> {
        let key = Self::account_key(type_filter.as_deref());
        Self::get_tiered(&self.accounts, &key)
    }

    pub fn set_accounts(&self, type_filter: Option<String>, data: String) {
        let key = Self::account_key(type_filter.as_deref());
        Self::set_tiered(&self.accounts, &key, &data, self.ttl_seconds);
    }

    // ── Balance history ──────────────────────────────────────────────

    fn balance_history_key(
        account_ids: Option<&[String]>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
    ) -> String {
        let accounts = match account_ids {
            Some(ids) => ids.join(","),
            None => "all".to_string(),
        };
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        format!("balance:{}:{}:{}:{}", accounts, start, end, period)
    }

    pub fn get_balance_history(
        &self,
        account_ids: Option<Vec<String>>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Option<String> {
        let key = Self::balance_history_key(
            account_ids.as_deref(),
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
        );
        Self::get_tiered(&self.balance_history, &key)
    }

    pub fn set_balance_history(
        &self,
        account_ids: Option<Vec<String>>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        data: String,
    ) {
        let key = Self::balance_history_key(
            account_ids.as_deref(),
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
        );
        Self::set_tiered(&self.balance_history, &key, &data, self.ttl_seconds);
    }

    // ── Budgets ──────────────────────────────────────────────────────

    fn budget_key(start_date: Option<&str>, end_date: Option<&str>) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        format!("budgets:{}:{}", start, end)
    }

    pub fn get_budgets(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Option<String> {
        let key = Self::budget_key(start_date.as_deref(), end_date.as_deref());
        Self::get_tiered(&self.budgets, &key)
    }

    pub fn set_budgets(&self, start_date: Option<String>, end_date: Option<String>, data: String) {
        let key = Self::budget_key(start_date.as_deref(), end_date.as_deref());
        Self::set_tiered(&self.budgets, &key, &data, self.ttl_seconds);
    }

    // ── Budget spent ─────────────────────────────────────────────────

    fn budget_spent_key(start_date: Option<&str>, end_date: Option<&str>) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        format!("budget_spent:{}:{}", start, end)
    }

    pub fn get_budget_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Option<String> {
        let key = Self::budget_spent_key(start_date.as_deref(), end_date.as_deref());
        Self::get_tiered(&self.budget_spent, &key)
    }

    pub fn set_budget_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        data: String,
    ) {
        let key = Self::budget_spent_key(start_date.as_deref(), end_date.as_deref());
        Self::set_tiered(&self.budget_spent, &key, &data, self.ttl_seconds);
    }

    // ── Budget spent history (time-series) ──────────────────────────

    fn budget_spent_history_key(
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
        account_ids: Option<&[String]>,
    ) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        let accounts = match account_ids {
            Some(ids) => ids.join(","),
            None => "all".to_string(),
        };
        format!(
            "budget_spent_hist:{}:{}:{}:{}",
            start, end, period, accounts
        )
    }

    pub fn get_budget_spent_history(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Option<String> {
        let key = Self::budget_spent_history_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::get_tiered(&self.budget_spent_history, &key)
    }

    pub fn set_budget_spent_history(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        data: String,
    ) {
        let key = Self::budget_spent_history_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::set_tiered(&self.budget_spent_history, &key, &data, self.ttl_seconds);
    }

    // ── Earned / Spent ───────────────────────────────────────────────

    fn earned_spent_key(
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
        account_ids: Option<&[String]>,
    ) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        let accounts = match account_ids {
            Some(ids) => ids.join(","),
            None => "all".to_string(),
        };
        format!("earned_spent:{}:{}:{}:{}", start, end, period, accounts)
    }

    pub fn get_earned_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Option<String> {
        let key = Self::earned_spent_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::get_tiered(&self.earned_spent, &key)
    }

    pub fn set_earned_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        data: String,
    ) {
        let key = Self::earned_spent_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::set_tiered(&self.earned_spent, &key, &data, self.ttl_seconds);
    }

    // ── Expenses by category ─────────────────────────────────────────

    fn expenses_category_key(
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
        account_ids: Option<&[String]>,
    ) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        let accounts = match account_ids {
            Some(ids) => ids.join(","),
            None => "all".to_string(),
        };
        format!("expenses_cat:{}:{}:{}:{}", start, end, period, accounts)
    }

    pub fn get_expenses_by_category(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Option<String> {
        let key = Self::expenses_category_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::get_tiered(&self.expenses_by_category, &key)
    }

    pub fn set_expenses_by_category(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        data: String,
    ) {
        let key = Self::expenses_category_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::set_tiered(&self.expenses_by_category, &key, &data, self.ttl_seconds);
    }

    // ── Net worth ────────────────────────────────────────────────────

    fn net_worth_key(
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
    ) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        format!("net_worth:{}:{}:{}", start, end, period)
    }

    pub fn get_net_worth(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Option<String> {
        let key = Self::net_worth_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
        );
        Self::get_tiered(&self.net_worth, &key)
    }

    pub fn set_net_worth(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        data: String,
    ) {
        let key = Self::net_worth_key(
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
        );
        Self::set_tiered(&self.net_worth, &key, &data, self.ttl_seconds);
    }

    // ── Subcategory spend ────────────────────────────────────────────

    fn subcategory_spend_key(
        parent_categories: &[String],
        subcategories: &[String],
        start_date: Option<&str>,
        end_date: Option<&str>,
        period: Option<&str>,
        account_ids: Option<&[String]>,
    ) -> String {
        let parents = parent_categories.join(",");
        let subcats = subcategories.join(",");
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        let period = period.unwrap_or("default");
        let accounts = match account_ids {
            Some(ids) => ids.join(","),
            None => "all".to_string(),
        };
        format!(
            "subcat_spend:{}:{}:{}:{}:{}:{}",
            parents, subcats, start, end, period, accounts
        )
    }

    pub fn get_subcategory_spend(
        &self,
        parent_categories: &[String],
        subcategories: &[String],
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Option<String> {
        let key = Self::subcategory_spend_key(
            parent_categories,
            subcategories,
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::get_tiered(&self.subcategory_spend, &key)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_subcategory_spend(
        &self,
        parent_categories: &[String],
        subcategories: &[String],
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        data: String,
    ) {
        let key = Self::subcategory_spend_key(
            parent_categories,
            subcategories,
            start_date.as_deref(),
            end_date.as_deref(),
            period.as_deref(),
            account_ids.as_deref(),
        );
        Self::set_tiered(&self.subcategory_spend, &key, &data, self.ttl_seconds);
    }

    // ── Categories ───────────────────────────────────────────────────

    fn categories_key() -> String {
        "categories".to_string()
    }

    pub fn get_categories(&self) -> Option<String> {
        let key = Self::categories_key();
        Self::get_tiered(&self.categories, &key)
    }

    pub fn set_categories(&self, data: String) {
        let key = Self::categories_key();
        Self::set_tiered(&self.categories, &key, &data, self.ttl_seconds);
    }

    // ── Clear operations ─────────────────────────────────────────────

    pub fn clear_all(&self) {
        self.clear_accounts();
        self.clear_balance_history();
        self.clear_budgets();
        self.clear_budget_spent();
        self.clear_budget_spent_history();
        self.clear_earned_spent();
        self.clear_expenses_by_category();
        self.clear_net_worth();
        self.clear_subcategory_spend();
        self.clear_categories();
    }

    pub fn clear_accounts(&self) {
        Self::clear_tiered(&self.accounts, Some("accounts:"));
    }

    pub fn clear_balance_history(&self) {
        Self::clear_tiered(&self.balance_history, Some("balance:"));
    }

    pub fn clear_budgets(&self) {
        Self::clear_tiered(&self.budgets, Some("budgets:"));
    }

    pub fn clear_budget_spent(&self) {
        Self::clear_tiered(&self.budget_spent, Some("budget_spent:"));
    }

    pub fn clear_budget_spent_history(&self) {
        Self::clear_tiered(&self.budget_spent_history, Some("budget_spent_hist:"));
    }

    pub fn clear_earned_spent(&self) {
        Self::clear_tiered(&self.earned_spent, Some("earned_spent:"));
    }

    pub fn clear_expenses_by_category(&self) {
        Self::clear_tiered(&self.expenses_by_category, Some("expenses_cat:"));
    }

    pub fn clear_net_worth(&self) {
        Self::clear_tiered(&self.net_worth, Some("net_worth:"));
    }

    pub fn clear_subcategory_spend(&self) {
        Self::clear_tiered(&self.subcategory_spend, Some("subcat_spend:"));
    }

    pub fn clear_categories(&self) {
        Self::clear_tiered(&self.categories, Some("categories"));
    }
}

impl Default for DataCache {
    fn default() -> Self {
        // Default TTL of 1 hour (3600s) — chart data doesn't change that often
        Self::new(3600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    fn init_test_data_dir() {
        INIT.call_once(|| {
            // Use a temp directory for tests
            let test_dir = std::env::temp_dir().join("oxidize_test");
            let _ = std::fs::create_dir_all(&test_dir);
            crate::storage::init_data_dir(test_dir.to_string_lossy().to_string());
        });
    }

    #[test]
    fn test_account_cache() {
        init_test_data_dir();
        let cache = DataCache::new(300);
        let accounts = r#"["account1", "account2"]"#.to_string();

        cache.set_accounts(Some("asset".to_string()), accounts.clone());

        let cached = cache.get_accounts(Some("asset".to_string()));
        assert_eq!(cached, Some(accounts));
    }

    #[test]
    fn test_balance_history_cache() {
        init_test_data_dir();
        let cache = DataCache::new(300);
        let data = r#"{"key": "value"}"#.to_string();

        cache.set_balance_history(
            Some(vec!["1".to_string()]),
            Some("2024-01-01".to_string()),
            Some("2024-01-31".to_string()),
            Some("1D".to_string()),
            data.clone(),
        );

        let cached = cache.get_balance_history(
            Some(vec!["1".to_string()]),
            Some("2024-01-01".to_string()),
            Some("2024-01-31".to_string()),
            Some("1D".to_string()),
        );
        assert_eq!(cached, Some(data));
    }

    #[test]
    fn test_cache_clear() {
        init_test_data_dir();
        let cache = DataCache::new(300);
        cache.set_accounts(Some("asset".to_string()), r#"["a"]"#.to_string());

        cache.clear_all();

        let cached = cache.get_accounts(Some("asset".to_string()));
        assert_eq!(cached, None);
    }
}
