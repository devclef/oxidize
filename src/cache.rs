use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

/// Cache entry with expiration time
#[derive(Debug, Clone)]
struct CacheEntry<T> {
    data: T,
    expires_at: DateTime<Utc>,
}

/// Cache for accounts and balance history data
pub struct DataCache {
    /// Cache for account lists, keyed by account type filter
    accounts: RwLock<HashMap<String, CacheEntry<String>>>,
    /// Cache for balance history, keyed by query parameters
    balance_history: RwLock<HashMap<String, CacheEntry<String>>>,
    /// Cache for budget lists, keyed by date range
    budgets: RwLock<HashMap<String, CacheEntry<String>>>,
    /// Cache for budget spending chart, keyed by date range
    budget_spent: RwLock<HashMap<String, CacheEntry<String>>>,
    /// Default TTL in seconds (5 minutes)
    ttl_seconds: u64,
}

impl DataCache {
    pub fn new(ttl_seconds: u64) -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            balance_history: RwLock::new(HashMap::new()),
            budgets: RwLock::new(HashMap::new()),
            budget_spent: RwLock::new(HashMap::new()),
            ttl_seconds,
        }
    }

    /// Generate a cache key for account queries
    fn account_key(type_filter: Option<&str>) -> String {
        match type_filter {
            Some(t) => format!("accounts:{}", t),
            None => "accounts:all".to_string(),
        }
    }

    /// Generate a cache key for balance history queries
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

    /// Check if a cache entry has expired
    fn is_expired<T>(entry: &CacheEntry<T>) -> bool {
        Utc::now() > entry.expires_at
    }

    /// Get cached accounts data
    pub fn get_accounts(&self, type_filter: Option<String>) -> Option<String> {
        let key = Self::account_key(type_filter.as_deref());
        let cache = self.accounts.read().ok()?;
        let entry = cache.get(&key)?;

        if Self::is_expired(entry) {
            return None;
        }

        Some(entry.data.clone())
    }

    /// Set cached accounts data
    pub fn set_accounts(&self, type_filter: Option<String>, data: String) {
        let key = Self::account_key(type_filter.as_deref());
        let expires_at = Utc::now() + chrono::Duration::seconds(self.ttl_seconds as i64);
        let entry = CacheEntry { data, expires_at };

        if let Ok(mut cache) = self.accounts.write() {
            cache.insert(key, entry);
        }
    }

    /// Get cached balance history data
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
        let cache = self.balance_history.read().ok()?;
        let entry = cache.get(&key)?;

        if Self::is_expired(entry) {
            return None;
        }

        Some(entry.data.clone())
    }

    /// Set cached balance history data
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
        let expires_at = Utc::now() + chrono::Duration::seconds(self.ttl_seconds as i64);
        let entry = CacheEntry { data, expires_at };

        if let Ok(mut cache) = self.balance_history.write() {
            cache.insert(key, entry);
        }
    }

    /// Clear all cached data
    pub fn clear_all(&self) {
        if let Ok(mut cache) = self.accounts.write() {
            cache.clear();
        }
        if let Ok(mut cache) = self.balance_history.write() {
            cache.clear();
        }
        if let Ok(mut cache) = self.budgets.write() {
            cache.clear();
        }
        if let Ok(mut cache) = self.budget_spent.write() {
            cache.clear();
        }
    }

    /// Clear only accounts cache
    pub fn clear_accounts(&self) {
        if let Ok(mut cache) = self.accounts.write() {
            cache.clear();
        }
    }

    /// Clear only balance history cache
    pub fn clear_balance_history(&self) {
        if let Ok(mut cache) = self.balance_history.write() {
            cache.clear();
        }
    }

    /// Generate a cache key for budget list queries
    fn budget_key(start_date: Option<&str>, end_date: Option<&str>) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        format!("budgets:{}:{}", start, end)
    }

    /// Generate a cache key for budget spending chart queries
    fn budget_spent_key(start_date: Option<&str>, end_date: Option<&str>) -> String {
        let start = start_date.unwrap_or("default");
        let end = end_date.unwrap_or("default");
        format!("budget_spent:{}:{}", start, end)
    }

    /// Get cached budget list data
    pub fn get_budgets(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Option<String> {
        let key = Self::budget_key(
            start_date.as_deref(),
            end_date.as_deref(),
        );
        let cache = self.budgets.read().ok()?;
        let entry = cache.get(&key)?;

        if Self::is_expired(entry) {
            return None;
        }

        Some(entry.data.clone())
    }

    /// Set cached budget list data
    pub fn set_budgets(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        data: String,
    ) {
        let key = Self::budget_key(
            start_date.as_deref(),
            end_date.as_deref(),
        );
        let expires_at = Utc::now() + chrono::Duration::seconds(self.ttl_seconds as i64);
        let entry = CacheEntry { data, expires_at };

        if let Ok(mut cache) = self.budgets.write() {
            cache.insert(key, entry);
        }
    }

    /// Get cached budget spending chart data
    pub fn get_budget_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Option<String> {
        let key = Self::budget_spent_key(
            start_date.as_deref(),
            end_date.as_deref(),
        );
        let cache = self.budget_spent.read().ok()?;
        let entry = cache.get(&key)?;

        if Self::is_expired(entry) {
            return None;
        }

        Some(entry.data.clone())
    }

    /// Set cached budget spending chart data
    pub fn set_budget_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        data: String,
    ) {
        let key = Self::budget_spent_key(
            start_date.as_deref(),
            end_date.as_deref(),
        );
        let expires_at = Utc::now() + chrono::Duration::seconds(self.ttl_seconds as i64);
        let entry = CacheEntry { data, expires_at };

        if let Ok(mut cache) = self.budget_spent.write() {
            cache.insert(key, entry);
        }
    }

    /// Clear only budgets cache
    pub fn clear_budgets(&self) {
        if let Ok(mut cache) = self.budgets.write() {
            cache.clear();
        }
    }

    /// Clear only budget spending cache
    pub fn clear_budget_spent(&self) {
        if let Ok(mut cache) = self.budget_spent.write() {
            cache.clear();
        }
    }
}

impl Default for DataCache {
    fn default() -> Self {
        // Default TTL of 5 minutes
        Self::new(300)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_cache() {
        let cache = DataCache::new(300);
        let accounts = r#"["account1", "account2"]"#.to_string();

        cache.set_accounts(Some("asset".to_string()), accounts.clone());

        let cached = cache.get_accounts(Some("asset".to_string()));
        assert_eq!(cached, Some(accounts));
    }

    #[test]
    fn test_balance_history_cache() {
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
        let cache = DataCache::new(300);
        cache.set_accounts(Some("asset".to_string()), r#"["a"]"#.to_string());

        cache.clear_all();

        let cached = cache.get_accounts(Some("asset".to_string()));
        assert_eq!(cached, None);
    }
}
