use crate::cache::DataCache;
use crate::config::Config;
use crate::models::{
    AccountArray, AvgCostBudget, AvgCostMode, AvgCostMonthlyPoint, AvgCostResponse,
    BudgetComparison, BudgetComparisonProjections, BudgetListResponse, BudgetPeriodLimit,
    CategoryListResponse, ChartDataSet, ChartLine, ParentCategory, SankeyFlowData, SankeyFlowType,
    SankeyLink, SimpleAccount,
};
use chrono::{Datelike, Duration, Utc};
use log::{debug, error, info};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use std::sync::Arc;

/// Parse a date string from Firefly III into a NaiveDateTime.
/// Accepts ISO 8601 with any timezone offset (+HH:MM or +HHMM), 'Z', or plain date.
fn parse_tx_date(date_str: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%:z")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%#z"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%SZ"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3f%:z"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3f%#z"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3fZ"))
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
        })
        .ok()
}

/// Determines whether a journal entry counts as "spent" from the perspective
/// of the selected accounts.
///
/// - Withdrawals: always spent
/// - Transfers: spent only when source is in selected accounts and dest is NOT
///   (money leaving the selected set). If no accounts selected, all transfers count.
/// - Deposits and other types: never spent.
fn is_journal_spent(
    journal: &serde_json::Value,
    selected_ids: &std::collections::HashSet<String>,
) -> bool {
    let journal_type = journal.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let source_id = journal
        .get("source_id")
        .and_then(|s| s.as_str())
        .unwrap_or("");
    let dest_id = journal
        .get("destination_id")
        .and_then(|d| d.as_str())
        .unwrap_or("");

    match journal_type {
        "withdrawal" => true,
        "transfer" => {
            if selected_ids.is_empty() {
                !source_id.is_empty()
            } else {
                selected_ids.contains(source_id) && !selected_ids.contains(dest_id)
            }
        }
        _ => false,
    }
}

pub struct FireflyClient {
    client: reqwest::Client,
    config: Config,
    cache: Arc<DataCache>,
}

impl FireflyClient {
    pub fn new(config: Config) -> Self {
        let ttl = config.cache_ttl;
        let cache_config = config.clone();
        Self::with_cache(cache_config, DataCache::new(ttl))
    }

    pub fn with_cache(config: Config, cache: DataCache) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Oxidize/0.1.0")
            .build()
            .unwrap();

        Self {
            client,
            config,
            cache: Arc::new(cache),
        }
    }

    pub fn clear_cache(&self) {
        self.cache.clear_all();
        info!("Cache cleared");
    }

    pub fn clear_accounts_cache(&self) {
        self.cache.clear_accounts();
        info!("Accounts cache cleared");
    }

    pub fn clear_balance_history_cache(&self) {
        self.cache.clear_balance_history();
        info!("Balance history cache cleared");
    }

    pub fn clear_budget_spent_cache(&self) {
        self.cache.clear_budget_spent();
        info!("Budget spent cache cleared");
    }

    pub fn clear_earned_spent_cache(&self) {
        self.cache.clear_earned_spent();
        info!("Earned/spent cache cleared");
    }

    pub fn clear_expenses_category_cache(&self) {
        self.cache.clear_expenses_by_category();
        info!("Expenses by category cache cleared");
    }

    pub fn clear_net_worth_cache(&self) {
        self.cache.clear_net_worth();
        info!("Net worth cache cleared");
    }

    pub fn clear_subcategory_spend_cache(&self) {
        self.cache.clear_subcategory_spend();
        info!("Subcategory spend cache cleared");
    }

    pub fn clear_card_paydown_cache(&self) {
        self.cache.clear_card_paydown();
        info!("Card paydown cache cleared");
    }

    pub fn clear_budget_spent_history_cache(&self) {
        self.cache.clear_budget_spent_history();
        info!("Budget spent history cache cleared");
    }

    pub fn clear_budget_limit_cache(&self) {
        self.cache.clear_budget_limit();
        info!("Budget limit cache cleared");
    }

    /// Analyze credit card paydown activity for the given liability accounts.
    /// Returns monthly breakdown of payments (debt-reducing), spending (debt-increasing),
    /// and interest (derived from balance delta), along with monthly ending balances and summary stats.
    ///
    /// When `debug` is true, bypasses caching and includes raw data in the response
    /// (account types, classified transactions, balance points) for troubleshooting.
    pub async fn get_card_paydown(
        &self,
        account_ids: Vec<String>,
        start_date: Option<String>,
        end_date: Option<String>,
        debug: bool,
    ) -> Result<serde_json::Value, String> {
        if account_ids.is_empty() {
            return Err("No card accounts specified".to_string());
        }

        // Check cache (skip when in debug mode)
        if !debug {
            if let Some(cached) =
                self.cache
                    .get_card_paydown(&account_ids, start_date.clone(), end_date.clone())
            {
                debug!("Cache hit for card paydown");
                return serde_json::from_str(&cached)
                    .map_err(|e| format!("Failed to deserialize cached card paydown: {}", e));
            }
        }

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });

        // Fetch all transactions involving the card accounts
        let transactions = self
            .fetch_all_transactions(&start, &end, Some(&account_ids), None)
            .await?;

        let card_ids: std::collections::HashSet<String> = account_ids.iter().cloned().collect();

        // Fetch account types to properly classify transfers.
        // Transfers from card to expense/revenue = spending (debt-increasing).
        // Transfers from card to asset/liability = payment (debt-reducing).
        // Firefly III's /v1/accounts defaults to asset-only without a type filter,
        // so we must explicitly fetch each account type.
        let all_account_types: std::collections::HashMap<String, String> = {
            let mut map = std::collections::HashMap::new();
            for atype in &["asset", "expense", "revenue", "liability", "cash"] {
                if let Ok(accounts) = self.get_accounts(Some(atype.to_string())).await {
                    for a in accounts {
                        map.insert(a.id, a.account_type);
                    }
                }
            }
            map
        };
        let account_types = &all_account_types;

        // Debug: collect raw classification details
        let mut debug_classifications: Vec<serde_json::Value> = Vec::new();

        // Classify journals: payments and spending only.
        // Interest is derived from balance delta (see below).
        let mut monthly_payments: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new(); // month -> payments
        let mut monthly_spending: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new(); // month -> spending
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        for tx in &transactions {
            let Some(journals) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            else {
                continue;
            };

            for journal in journals {
                let journal_type = journal.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let source_id = journal
                    .get("source_id")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                let dest_id = journal
                    .get("destination_id")
                    .and_then(|d| d.as_str())
                    .unwrap_or("");
                let amount_str = journal
                    .get("amount")
                    .and_then(|a| a.as_str())
                    .unwrap_or("0");
                let amount = amount_str.parse::<f64>().unwrap_or(0.0);
                let date_str = journal.get("date").and_then(|d| d.as_str()).unwrap_or("");
                let description = journal
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("");

                // Extract month key (YYYY-MM)
                let month_key = if date_str.len() >= 7 {
                    &date_str[..7]
                } else {
                    continue;
                };

                // Get currency info from first valid journal
                if currency_symbol.is_none() {
                    currency_symbol = journal
                        .get("currency_symbol")
                        .and_then(|s| s.as_str())
                        .map(String::from);
                    currency_code = journal
                        .get("currency_code")
                        .and_then(|s| s.as_str())
                        .map(String::from);
                }

                // Classification for liability (credit card) accounts:
                // - "withdrawal" from card = spending (debt-increasing)
                // - "transfer" from card to expense/revenue = spending (debt-increasing)
                // - "transfer" from card to asset/liability = payment (debt-reducing)
                // - "transfer" from card to another card = skip
                // Interest is NOT classified from transactions; it's derived from balance delta.
                if !card_ids.contains(source_id) {
                    // Journal where card is NOT the source — skip for classification
                    // (these are the reverse-perspective journals from Firefly III)
                    continue;
                }

                let dest_type = account_types.get(dest_id).map(|s| s.as_str());
                // Check if this is an interest withdrawal (e.g. "Interest: Amex Elite")
                let is_interest = description.to_lowercase().starts_with("interest:");
                let classification = match journal_type {
                    "withdrawal" => {
                        if is_interest {
                            // Interest charges are derived from the balance delta,
                            // so we skip them here to avoid double-counting.
                            "skip(interest, derived from delta)"
                        } else {
                            // Spending on the card (increases debt)
                            *monthly_spending.entry(month_key.to_string()).or_insert(0.0) += amount;
                            "spending(withdrawal)"
                        }
                    }
                    "transfer" => {
                        if card_ids.contains(dest_id) {
                            "skip(card-to-card)";
                            continue;
                        }
                        match dest_type {
                            Some("expense") | Some("revenue") => {
                                *monthly_spending.entry(month_key.to_string()).or_insert(0.0) +=
                                    amount;
                                &format!("spending(transfer->{:?})", dest_type)
                            }
                            _ => {
                                *monthly_payments.entry(month_key.to_string()).or_insert(0.0) +=
                                    amount;
                                &format!("payment(transfer->{:?})", dest_type)
                            }
                        }
                    }
                    _ => "skip(unknown_type)",
                };

                if debug {
                    debug_classifications.push(serde_json::json!({
                        "tx_id": tx.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                        "date": date_str,
                        "month": month_key,
                        "type": journal_type,
                        "amount": amount,
                        "source_id": source_id,
                        "dest_id": dest_id,
                        "dest_type": dest_type.unwrap_or("unknown"),
                        "description": description,
                        "classified_as": classification,
                    }));
                }
            }
        }

        // Generate all month keys in range for completeness
        let mut all_months: Vec<String> = Vec::new();
        let start_date =
            chrono::NaiveDate::parse_from_str(&start, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let end_date =
            chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let mut current = start_date;
        while current <= end_date {
            all_months.push(current.format("%Y-%m").to_string());
            // Move to next month
            let next_month = if current.month() == 12 {
                current
                    .with_year(current.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap()
            } else {
                current.with_month(current.month() + 1).unwrap()
            };
            current = next_month;
        }

        // Fetch balance history — start one month earlier to get previous month's
        // ending balance, which is needed to derive interest for the first month.
        let balance_start = if start_date.month() == 1 {
            start_date
                .with_year(start_date.year() - 1)
                .unwrap()
                .with_month(12)
                .unwrap()
        } else {
            start_date.with_month(start_date.month() - 1).unwrap()
        };
        let balance_start_str = balance_start.format("%Y-%m-%d").to_string();

        // Only use liability (credit card) accounts for balance-based interest derivation.
        // Including asset accounts (checking) would contaminate the delta with unrelated
        // outflows (savings transfers, bills, etc.), producing wildly wrong "interest".
        let balance_account_ids: Vec<String> = account_ids
            .iter()
            .filter(|id| {
                all_account_types
                    .get(id.as_str())
                    .map(|t| t == "liability")
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        let balances = if balance_account_ids.is_empty() {
            // Fallback to all card_ids if no liability accounts identified
            self.fetch_card_balances(&account_ids, &balance_start_str, &end).await
        } else {
            self.fetch_card_balances(&balance_account_ids, &balance_start_str, &end).await
        };

        // Helper: compute previous month key (e.g. "2026-01" -> "2025-12")
        let prev_month = |m: &str| -> String {
            let y: u32 = m[..4].parse().unwrap_or(0);
            let mo: u32 = m[5..7].parse().unwrap_or(1);
            if mo == 1 {
                format!("{:04}-{:02}", y - 1, 12)
            } else {
                format!("{:04}-{:02}", y, mo - 1)
            }
        };

        // Build monthly activity — interest is derived from balance delta:
        //   interest = end_balance - start_balance - spending + payments
        //   net_paydown = start_balance - end_balance
        let mut monthly_activity: Vec<serde_json::Value> = Vec::new();
        let mut total_payments = 0.0;
        let mut total_spending = 0.0;
        let mut total_interest = 0.0;
        let mut months_with_activity = 0;
        let mut total_net_paydown = 0.0;

        for month in &all_months {
            let payments = *monthly_payments.entry(month.clone()).or_insert(0.0);
            let spending = *monthly_spending.entry(month.clone()).or_insert(0.0);

            // Look up start (previous month end) and end balances
            let prev = prev_month(month);
            let (start_bal, end_bal) = if let Ok(ref bal_map) = balances {
                (bal_map.get(&prev).copied(), bal_map.get(month).copied())
            } else {
                (None, None)
            };

            // Derive interest from balance delta when both balances are available
            let (interest, balance, net_paydown) =
                if let (Some(sb), Some(eb)) = (start_bal, end_bal) {
                    let interest = eb - sb - spending + payments;
                    let net_paydown = sb - eb;
                    (interest, eb, net_paydown)
                } else if let Some(eb) = end_bal {
                    // Only end balance available (e.g. first month without prior data)
                    (0.0, eb, payments - spending)
                } else {
                    (0.0, 0.0, payments - spending)
                };

            if payments > 0.01 || spending > 0.01 || interest.abs() > 0.01 {
                months_with_activity += 1;
                total_payments += payments;
                total_spending += spending;
                total_interest += interest;
                total_net_paydown += net_paydown;
            }

            monthly_activity.push(serde_json::json!({
                "month": month,
                "payments": payments,
                "spending": spending,
                "interest": interest,
                "net_paydown": net_paydown,
                "balance": balance,
            }));
        }

        // Calculate avg monthly net paydown (only for months with activity)
        let avg_monthly = if months_with_activity > 0 {
            total_net_paydown / months_with_activity as f64
        } else {
            0.0
        };

        // Find best month
        let best_month = monthly_activity
            .iter()
            .filter_map(|m| {
                let net = m.get("net_paydown").and_then(|n| n.as_f64())?;
                if net > 0.0 {
                    Some((m.get("month").unwrap().as_str().unwrap(), net))
                } else {
                    None
                }
            })
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(m, n)| serde_json::json!({ "month": m, "net_paydown": n }));

        // Project payoff: months until balance is 0 at current avg rate
        let last_balance = monthly_activity
            .last()
            .and_then(|m| m.get("balance").and_then(|b| b.as_f64()))
            .unwrap_or(0.0);
        let projected_months = if avg_monthly > 0.0 && last_balance > 0.0 {
            Some((last_balance / avg_monthly).ceil() as i32)
        } else {
            None
        };

        let mut result = serde_json::json!({
            "monthly_activity": monthly_activity,
            "summary": {
                "total_payments": total_payments,
                "total_spending": total_spending,
                "total_interest": total_interest,
                "total_net_paydown": total_net_paydown,
                "avg_monthly_paydown": avg_monthly,
                "current_balance": last_balance,
                "projected_payoff_months": projected_months,
                "best_month": best_month,
                "currency_symbol": currency_symbol,
                "currency_code": currency_code,
            }
        });

        // Attach debug data when requested
        if debug {
            let debug_balances: Vec<serde_json::Value> = if let Ok(ref bal_map) = balances {
                bal_map
                    .iter()
                    .map(|(k, v)| serde_json::json!({ "month": k, "balance": v }))
                    .collect::<Vec<_>>()
            } else {
                vec![serde_json::json!({ "error": "balance fetch failed" })]
            };

            let debug_account_types: Vec<serde_json::Value> = account_types
                .iter()
                .map(|(id, t)| serde_json::json!({ "id": id, "type": t }))
                .collect();

            result["debug"] = serde_json::json!({
                "params": {
                    "start": &start,
                    "end": &end,
                    "card_ids": account_ids,
                },
                "accounts_fetched": debug_account_types,
                "transactions_total": transactions.len(),
                "classifications": debug_classifications,
                "balances_raw": debug_balances,
                "balance_fetch_url": format!(
                    "{}/v1/chart/account/overview?start={}&end={}&period=1M{}",
                    self.config.firefly_url.as_str(),
                    balance_start_str,
                    end,
                    account_ids.iter().map(|id| format!("&accounts[]={}", id)).collect::<String>()
                ),
            });
        } else {
            // Cache only non-debug results
            if let Ok(json) = serde_json::to_string(&result) {
                self.cache
                    .set_card_paydown(&account_ids, Some(start), Some(end), json);
            }
        }

        Ok(result)
    }

    /// Fetch monthly ending balances for card accounts.
    /// Returns a HashMap of month key (YYYY-MM) -> total balance across all cards.
    async fn fetch_card_balances(
        &self,
        account_ids: &[String],
        start: &str,
        end: &str,
    ) -> Result<std::collections::HashMap<String, f64>, String> {
        // Fetch balance history with monthly period for specific card accounts
        let mut query_params = vec![
            ("start".to_string(), start.to_string()),
            ("end".to_string(), end.to_string()),
            ("period".to_string(), "1M".to_string()),
        ];

        for id in account_ids {
            query_params.push(("accounts[]".to_string(), id.clone()));
        }

        let url = format!(
            "{}/v1/chart/account/overview",
            self.config.firefly_url.as_str()
        );
        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query_params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            debug!("Balance history fetch failed: {}", response.status());
            return Ok(std::collections::HashMap::new());
        }

        let chart_line: ChartLine = response.json().await.map_err(|e| e.to_string())?;

        // Aggregate balances by month across all card datasets
        let mut monthly_balances: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();

        for dataset in &chart_line {
            for (date, value) in parse_chart_entries(&dataset.entries) {
                // Extract YYYY-MM from date string (handles "2026-01-31", "2026-01-31T00:00:00+00:00", etc.)
                let date_part = date.split('T').next().unwrap_or(&date);
                let month_key = if date_part.len() >= 7 {
                    &date_part[..7]
                } else {
                    continue;
                };
                *monthly_balances.entry(month_key.to_string()).or_insert(0.0) += value;
            }
        }

        Ok(monthly_balances)
    }

    pub async fn get_accounts(
        &self,
        type_filter: Option<String>,
    ) -> Result<Vec<SimpleAccount>, String> {
        let type_filter = if type_filter.as_deref() == Some("all") {
            None
        } else {
            type_filter
        };

        if let Some(cached_json) = self.cache.get_accounts(type_filter.clone()) {
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached accounts: {}", e));
        }

        let headers = self.get_headers();
        let mut url = format!("{}/v1/accounts", self.config.firefly_url.as_str());
        if let Some(ref t) = type_filter {
            url = format!("{}?type={}", url, t);
        }

        let response = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("API request failed with status: {}. Body: {}", status, body);
            return Err(format!("API request failed with status: {}", status));
        }

        let account_array: AccountArray = response.json().await.map_err(|e| e.to_string())?;
        let simple_accounts: Vec<SimpleAccount> = account_array
            .data
            .into_iter()
            .map(|a| SimpleAccount {
                id: a.id,
                name: a.attributes.name,
                balance: a.attributes.current_balance,
                currency: a.attributes.currency_symbol,
                account_type: a.attributes.account_type,
            })
            // Filter client-side to ensure correct results even when the API
            // doesn't honor the type filter (e.g., mock servers, some Firefly III versions).
            .filter(|a| {
                type_filter
                    .as_deref()
                    .map(|t| a.account_type == t)
                    .unwrap_or(true)
            })
            .collect();

        if let Ok(json) = serde_json::to_string(&simple_accounts) {
            self.cache.set_accounts(type_filter, json);
        }

        Ok(simple_accounts)
    }

    pub async fn get_balance_history(
        &self,
        account_ids: Option<Vec<String>>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
        if let Some(cached_json) = self.cache.get_balance_history(
            account_ids.clone(),
            start_date.clone(),
            end_date.clone(),
            period.clone(),
        ) {
            debug!("Cache hit for balance history");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached balance history: {}", e));
        }

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.clone().unwrap_or_else(|| "1D".to_string());

        // Firefly III doesn't support quarterly periods, so map 1Q -> 1M and aggregate locally
        let api_period = if period_val == "1Q" {
            "1M"
        } else {
            &period_val
        };

        let mut query_params = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), api_period.to_string()),
        ];

        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                for id in ids {
                    query_params.push(("accounts[]".to_string(), id.clone()));
                }
            } else {
                query_params.push(("preselected".to_string(), "assets".to_string()));
            }
        } else {
            query_params.push(("preselected".to_string(), "assets".to_string()));
        }

        let url = format!(
            "{}/v1/chart/account/overview",
            self.config.firefly_url.as_str()
        );
        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query_params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "API request failed with status: {}",
                response.status()
            ));
        }

        let chart_line: ChartLine = response.json().await.map_err(|e| e.to_string())?;

        let chart_line = if period_val == "1Q" {
            aggregate_monthly_to_quarterly(chart_line)
        } else {
            chart_line
        };

        if let Ok(json) = serde_json::to_string(&chart_line) {
            self.cache.set_balance_history(
                account_ids,
                Some(start),
                Some(end),
                Some(period_val),
                json,
            );
        }

        Ok(chart_line)
    }

    pub async fn get_earned_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Result<ChartLine, String> {
        // Check cache first
        if let Some(cached_json) = self.cache.get_earned_spent(
            start_date.clone(),
            end_date.clone(),
            period.clone(),
            account_ids.clone(),
        ) {
            debug!("Cache hit for earned/spent");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached earned/spent: {}", e));
        }

        let result = self
            .get_earned_spent_with_since(
                start_date.clone(),
                end_date.clone(),
                period.clone(),
                account_ids.clone(),
                None,
            )
            .await;

        if let Ok(ref chart_line) = result {
            if let Ok(json) = serde_json::to_string(chart_line) {
                self.cache
                    .set_earned_spent(start_date, end_date, period, account_ids, json);
            }
        }

        result
    }

    pub async fn get_earned_spent_with_since(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        since: Option<String>,
    ) -> Result<ChartLine, String> {
        use crate::models::chart::ChartDataSet;

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = since.clone().or(start_date).unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.unwrap_or_else(|| "1D".to_string());

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref(), None)
            .await?;

        // Build a set of selected account IDs for transfer filtering
        let selected_ids: std::collections::HashSet<String> = account_ids
            .as_ref()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();

        // Flatten all transactions into individual journal entries
        let mut all_journals: Vec<serde_json::Value> = Vec::new();
        for tx in &all_transactions {
            if let Some(trans_arr) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for journal in trans_arr {
                    all_journals.push(journal.clone());
                }
            }
        }

        // Classify each journal individually.
        // A journal counts as earned if it's a deposit INTO a selected account
        // from outside (source not selected). A journal counts as spent if it's
        // a withdrawal FROM a selected account to outside (dest not selected).
        // Transfers between selected accounts are excluded entirely.
        let mut earned_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut spent_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        // Seed all period keys with 0.0
        let period_keys = Self::generate_period_keys(&start, &end, &period_val).unwrap_or_default();
        let last_period_key = period_keys.last().cloned();
        for key in &period_keys {
            earned_entries.insert(key.clone(), 0.0);
            spent_entries.insert(key.clone(), 0.0);
        }

        let get_period_key = |date_str: &str, period: &str| -> String {
            let key = Self::get_period_key(date_str, period, Some(&end));
            // Fallback: if the static method couldn't parse the date, try date-only parsing
            if key == date_str {
                if let Some(date_part) = date_str.split('T').next() {
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
                        let parsed_key = date.format("%Y-%m-%dT00:00:00+00:00").to_string();
                        // If the parsed key isn't in the generated period keys
                        // (partial end month), fall back to the last period key
                        return if period_keys.contains(&parsed_key) {
                            parsed_key
                        } else {
                            last_period_key.clone().unwrap_or(parsed_key)
                        };
                    }
                }
            }
            // If the key isn't in the generated period keys (partial end month),
            // fall back to the last period key so amounts flow into the prior
            // full month's chart point instead of creating a dangling point.
            if period_keys.contains(&key) {
                key
            } else {
                last_period_key.clone().unwrap_or(key)
            }
        };

        for journal in &all_journals {
            let journal_type = journal.get("type").and_then(|t| t.as_str()).unwrap_or("");

            let source_id = journal
                .get("source_id")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let dest_id = journal
                .get("destination_id")
                .and_then(|d| d.as_str())
                .unwrap_or("");

            // Classify based on type and direction of flow
            let is_earned = match journal_type {
                "deposit" => !selected_ids.contains(source_id) || selected_ids.is_empty(),
                "transfer" => {
                    // Transfer into selected account from outside
                    selected_ids.contains(dest_id)
                        && (!selected_ids.contains(source_id) || selected_ids.is_empty())
                }
                _ => false,
            };

            let is_spent = match journal_type {
                "withdrawal" => !selected_ids.contains(dest_id) || selected_ids.is_empty(),
                "transfer" => {
                    // Transfer out of selected account to outside
                    selected_ids.contains(source_id)
                        && (!selected_ids.contains(dest_id) || selected_ids.is_empty())
                }
                _ => false,
            };

            if is_earned || is_spent {
                if let Some(amount_str) = journal.get("amount").and_then(|a| a.as_str()) {
                    if let Ok(amount) = amount_str.parse::<f64>() {
                        if let Some(date) = journal.get("date").and_then(|d| d.as_str()) {
                            let key = get_period_key(date, &period_val);
                            if is_earned {
                                *earned_entries.entry(key.clone()).or_insert(0.0) += amount;
                            }
                            if is_spent {
                                *spent_entries.entry(key).or_insert(0.0) += amount;
                            }
                            if currency_symbol.is_none() {
                                currency_symbol = journal
                                    .get("currency_symbol")
                                    .and_then(|s| s.as_str())
                                    .map(String::from);
                                currency_code = journal
                                    .get("currency_code")
                                    .and_then(|s| s.as_str())
                                    .map(String::from);
                            }
                        }
                    }
                }
            }
        }

        Ok(vec![
            ChartDataSet {
                label: "earned".to_string(),
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: serde_json::to_value(earned_entries).unwrap(),
            },
            ChartDataSet {
                label: "spent".to_string(),
                currency_symbol,
                currency_code,
                entries: serde_json::to_value(spent_entries).unwrap(),
            },
        ])
    }

    /// Sum all numeric values in a ChartDataSet entries object
    fn sum_entries(entries: &serde_json::Value) -> f64 {
        if let serde_json::Value::Object(map) = entries {
            map.values().filter_map(|v| v.as_f64()).sum()
        } else {
            0.0
        }
    }

    pub async fn get_expenses_by_category(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        graph_mode: Option<String>,
    ) -> Result<ChartLine, String> {
        let is_parent_mode = graph_mode.as_deref() == Some("parent");
        // Check cache first
        if let Some(cached_json) = self.cache.get_expenses_by_category(
            start_date.clone(),
            end_date.clone(),
            period.clone(),
            account_ids.clone(),
            graph_mode.clone(),
        ) {
            debug!("Cache hit for expenses by category");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached expenses: {}", e));
        }

        use crate::models::chart::ChartDataSet;

        let end = end_date
            .clone()
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.clone().unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.clone().unwrap_or_else(|| "1M".to_string());

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref(), None)
            .await?;

        // Flatten transactions into journal entries
        let mut all_journals: Vec<serde_json::Value> = Vec::new();
        for tx in &all_transactions {
            if let Some(trans_arr) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for journal in trans_arr {
                    all_journals.push(journal.clone());
                }
            }
        }

        // Build selected account set for transfer filtering
        let selected_ids: std::collections::HashSet<String> = account_ids
            .as_ref()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();

        // Filter to "spent" journals (withdrawals + outbound transfers), group by category + period
        let mut category_entries: std::collections::HashMap<
            String,
            std::collections::HashMap<String, f64>,
        > = std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        for journal in &all_journals {
            if !is_journal_spent(journal, &selected_ids) {
                continue;
            }

            let full_category = journal
                .get("category_name")
                .and_then(|c| c.as_str())
                .map(String::from)
                .unwrap_or_else(|| "Uncategorized".to_string());

            // In parent mode, extract just the part before ":" as the label
            let category_name = if is_parent_mode {
                full_category
                    .split(':')
                    .next()
                    .unwrap_or(&full_category)
                    .trim()
                    .to_string()
            } else {
                full_category
            };

            if let Some(amount_str) = journal.get("amount").and_then(|a| a.as_str()) {
                if let Ok(amount) = amount_str.parse::<f64>() {
                    if let Some(date) = journal.get("date").and_then(|d| d.as_str()) {
                        let period_key = Self::get_period_key(date, &period_val, Some(&end));

                        let entries = category_entries.entry(category_name).or_default();
                        *entries.entry(period_key).or_insert(0.0) += amount;
                    }
                }
            }

            if currency_symbol.is_none() {
                currency_symbol = journal
                    .get("currency_symbol")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                currency_code = journal
                    .get("currency_code")
                    .and_then(|s| s.as_str())
                    .map(String::from);
            }
        }

        // Convert to ChartLine: one ChartDataSet per category
        let mut chart: Vec<ChartDataSet> = category_entries
            .into_iter()
            .map(|(label, entries)| ChartDataSet {
                label,
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: serde_json::to_value(entries).unwrap(),
            })
            .collect();

        // Sort by total spend descending
        chart.sort_by(|a, b| {
            let sum_a = Self::sum_entries(&a.entries);
            let sum_b = Self::sum_entries(&b.entries);
            sum_b
                .partial_cmp(&sum_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Cache the result
        if let Ok(json) = serde_json::to_string(&chart) {
            self.cache.set_expenses_by_category(
                start_date,
                end_date,
                period,
                account_ids,
                graph_mode,
                json,
            );
        }

        Ok(chart)
    }

    pub async fn get_net_worth(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
        // Check cache first
        if let Some(cached_json) =
            self.cache
                .get_net_worth(start_date.clone(), end_date.clone(), period.clone())
        {
            debug!("Cache hit for net worth");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached net worth: {}", e));
        }

        use crate::models::chart::ChartDataSet;

        let end = end_date
            .clone()
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.clone().unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.clone().unwrap_or_else(|| "1M".to_string());

        let url = format!(
            "{}/v1/chart/account/overview",
            self.config.firefly_url.as_str()
        );

        let asset_query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period_val.clone()),
            ("preselected".to_string(), "assets".to_string()),
        ];
        let asset_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&asset_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let asset_data: ChartLine = asset_response.json().await.map_err(|e| e.to_string())?;

        let liability_query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period_val.clone()),
            ("preselected".to_string(), "liabilities".to_string()),
        ];
        let liability_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&liability_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let liability_data: ChartLine =
            liability_response.json().await.map_err(|e| e.to_string())?;

        let mut net_worth_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        for dataset in &asset_data {
            for (date, amount) in parse_chart_entries(&dataset.entries) {
                let date_part = date.split('T').next().unwrap_or(&date).to_string();
                *net_worth_entries.entry(date_part).or_insert(0.0) += amount;
                if currency_symbol.is_none() {
                    currency_symbol = dataset.currency_symbol.clone();
                    currency_code = dataset.currency_code.clone();
                }
            }
        }

        for dataset in &liability_data {
            for (date, amount) in parse_chart_entries(&dataset.entries) {
                let date_part = date.split('T').next().unwrap_or(&date).to_string();
                *net_worth_entries.entry(date_part).or_insert(0.0) -= amount;
            }
        }

        let mut entries_vec: Vec<serde_json::Value> = net_worth_entries
            .into_iter()
            .map(|(date, ba)| serde_json::json!({"date": date, "ba": ba}))
            .collect();
        entries_vec.sort_by(|a, b| {
            a["date"]
                .as_str()
                .unwrap_or("")
                .cmp(b["date"].as_str().unwrap_or(""))
        });

        let result = vec![ChartDataSet {
            label: "Net Worth".to_string(),
            currency_symbol,
            currency_code,
            entries: serde_json::Value::Array(entries_vec),
        }];

        // Cache the result
        if let Ok(json) = serde_json::to_string(&result) {
            self.cache.set_net_worth(start_date, end_date, period, json);
        }

        Ok(result)
    }

    pub async fn get_budgets(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Result<Vec<crate::models::BudgetRead>, String> {
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });

        // Check cache
        if let Some(cached) = self
            .cache
            .get_budgets(Some(start.clone()), Some(end.clone()))
        {
            debug!("Cache hit for budgets: {} to {}", start, end);
            let response: BudgetListResponse =
                serde_json::from_str(&cached).map_err(|e| e.to_string())?;
            return Ok(response.budgets());
        }
        debug!("Cache miss for budgets: {} to {}", start, end);

        let url = format!("{}/v1/budgets", self.config.firefly_url.as_str());
        let query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
        ];

        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let body = response.text().await.map_err(|e| e.to_string())?;

        // Cache the raw JSON
        self.cache.set_budgets(Some(start), Some(end), body.clone());

        let budget_response: BudgetListResponse =
            serde_json::from_str(&body).map_err(|e| e.to_string())?;
        Ok(budget_response.budgets())
    }

    pub async fn get_budget_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Result<ChartLine, String> {
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });

        // Check cache
        if let Some(cached) = self
            .cache
            .get_budget_spent(Some(start.clone()), Some(end.clone()))
        {
            debug!("Cache hit for budget_spent: {} to {}", start, end);
            let chart: ChartLine = serde_json::from_str(&cached).map_err(|e| e.to_string())?;
            return Ok(chart);
        }
        debug!("Cache miss for budget_spent: {} to {}", start, end);

        let url = format!(
            "{}/v1/chart/budget/overview",
            self.config.firefly_url.as_str()
        );
        let query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
        ];

        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let body = response.text().await.map_err(|e| e.to_string())?;

        // Cache the raw JSON
        self.cache
            .set_budget_spent(Some(start), Some(end), body.clone());

        let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let chart = match &value {
            serde_json::Value::Array(_arr) => {
                // Direct array format
                serde_json::from_value(value).map_err(|e| e.to_string())?
            }
            serde_json::Value::Object(map) => {
                // Object format: collect all arrays into a single ChartLine
                let mut all_datasets = Vec::new();
                for (_key, val) in map {
                    if let serde_json::Value::Array(arr) = val {
                        for item in arr {
                            if let Ok(ds) = serde_json::from_value::<ChartDataSet>(item.clone()) {
                                all_datasets.push(ds);
                            }
                        }
                    }
                }
                all_datasets
            }
            _ => return Err("Unexpected budget chart response format".to_string()),
        };
        debug!("budget_spent: {} datasets parsed", chart.len());
        Ok(chart)
    }

    fn get_period_key(date_str: &str, period: &str, end_date: Option<&str>) -> String {
        let end_parsed =
            end_date.and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        if let Some(date) = parse_tx_date(date_str) {
            let key = match period {
                "1M" => {
                    let first_of_next = chrono::NaiveDate::from_ymd_opt(
                        if date.month() == 12 {
                            date.year() + 1
                        } else {
                            date.year()
                        },
                        if date.month() == 12 {
                            1
                        } else {
                            date.month() + 1
                        },
                        1,
                    )
                    .unwrap();
                    let last_of_month = first_of_next - chrono::Duration::days(1);
                    let key_date = if let Some(ref end_dt) = end_parsed {
                        if last_of_month > *end_dt {
                            *end_dt
                        } else {
                            last_of_month
                        }
                    } else {
                        last_of_month
                    };
                    key_date.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                "1Q" => {
                    let quarter_month = match date.month() {
                        1..=3 => 1,
                        4..=6 => 4,
                        7..=9 => 7,
                        10..=12 => 10,
                        _ => 1,
                    };
                    chrono::NaiveDate::from_ymd_opt(date.year(), quarter_month, 1)
                        .unwrap()
                        .format("%Y-%m-%dT00:00:00+00:00")
                        .to_string()
                }
                "1W" => {
                    let monday =
                        date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                    monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                "1Y" => chrono::NaiveDate::from_ymd_opt(date.year(), 1, 1)
                    .unwrap()
                    .format("%Y-%m-%dT00:00:00+00:00")
                    .to_string(),
                _ => date.format("%Y-%m-%dT00:00:00+00:00").to_string(),
            };
            return key;
        }
        date_str.to_string()
    }

    pub async fn get_budget_spent_history(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Result<ChartLine, String> {
        // Check cache first
        if let Some(cached_json) = self.cache.get_budget_spent_history(
            start_date.clone(),
            end_date.clone(),
            period.clone(),
            account_ids.clone(),
        ) {
            debug!("Cache hit for budget spent history");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached budget spent hist: {}", e));
        }

        use crate::models::chart::ChartDataSet;

        let end = end_date
            .clone()
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.clone().unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.clone().unwrap_or_else(|| "1D".to_string());

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref(), None)
            .await?;

        // Flatten transactions into journal entries
        let mut all_journals: Vec<serde_json::Value> = Vec::new();
        for tx in &all_transactions {
            if let Some(trans_arr) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for journal in trans_arr {
                    all_journals.push(journal.clone());
                }
            }
        }

        // Filter to journal entries with budget_name, group by date+budget
        let mut budget_entries: std::collections::HashMap<
            String,
            std::collections::HashMap<String, f64>,
        > = std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        // Build selected account set for transfer filtering
        let selected_ids: std::collections::HashSet<String> = account_ids
            .as_ref()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();

        for journal in &all_journals {
            let journal_type = journal.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let source_id = journal
                .get("source_id")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let dest_id = journal
                .get("destination_id")
                .and_then(|d| d.as_str())
                .unwrap_or("");

            // Only count "spent" transactions (withdrawals and outbound transfers to outside)
            let is_spent = match journal_type {
                "withdrawal" => true,
                "transfer" => {
                    // Transfer out of selected account to outside (dest not selected)
                    if selected_ids.is_empty() {
                        // No account filter: count all outbound transfers
                        !source_id.is_empty()
                    } else {
                        selected_ids.contains(source_id) && !selected_ids.contains(dest_id)
                    }
                }
                _ => false,
            };

            if !is_spent {
                continue;
            }

            // Only include journal entries that have a budget_name
            let budget_name = match journal.get("budget_name").and_then(|n| n.as_str()) {
                Some(name) if !name.is_empty() => name.to_string(),
                _ => continue,
            };

            if let Some(amount_str) = journal.get("amount").and_then(|a| a.as_str()) {
                if let Ok(amount) = amount_str.parse::<f64>() {
                    if let Some(date) = journal.get("date").and_then(|d| d.as_str()) {
                        let period_key = Self::get_period_key(date, &period_val, Some(&end));

                        let entries = budget_entries.entry(budget_name).or_default();
                        *entries.entry(period_key).or_insert(0.0) += amount;
                    }
                }
            }

            if currency_symbol.is_none() {
                currency_symbol = journal
                    .get("currency_symbol")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                currency_code = journal
                    .get("currency_code")
                    .and_then(|s| s.as_str())
                    .map(String::from);
            }
        }

        // Convert to ChartLine: one ChartDataSet per budget
        let mut chart: Vec<ChartDataSet> = budget_entries
            .into_iter()
            .map(|(label, entries)| ChartDataSet {
                label,
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: serde_json::to_value(entries).unwrap(),
            })
            .collect();

        // Sort by total spend descending
        chart.sort_by(|a, b| {
            let sum_a = Self::sum_entries(&a.entries);
            let sum_b = Self::sum_entries(&b.entries);
            sum_b
                .partial_cmp(&sum_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        debug!(
            "budget_spent_history: {} budgets, {} to {}",
            chart.len(),
            start,
            end
        );

        // Cache the result
        if let Ok(json) = serde_json::to_string(&chart) {
            self.cache
                .set_budget_spent_history(start_date, end_date, period, account_ids, json);
        }

        Ok(chart)
    }

    /// Fetch budget limit data from Firefly III for a specific budget and date range.
    /// Returns a list of BudgetPeriodLimit entries (one per period within the range).
    pub async fn get_budget_limit(
        &self,
        budget_id: &str,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Result<Vec<BudgetPeriodLimit>, String> {
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            chrono::NaiveDate::from_ymd_opt(Utc::now().year(), 1, 1)
                .unwrap()
                .format("%Y-%m-%d")
                .to_string()
        });

        // Check cache
        if let Some(cached) =
            self.cache
                .get_budget_limit(budget_id, Some(start.clone()), Some(end.clone()))
        {
            debug!("Cache hit for budget limit: budget {}", budget_id);
            return serde_json::from_str(&cached)
                .map_err(|e| format!("Failed to deserialize cached budget limit: {}", e));
        }

        let url = format!("{}/v1/budget/limit", self.config.firefly_url.as_str());
        let query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("budget_id".to_string(), budget_id.to_string()),
        ];

        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "API request for budget limit failed with status: {}",
                response.status()
            ));
        }

        let body = response.text().await.map_err(|e| e.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

        // Firefly III returns either a single object or an array of objects
        let limits: Vec<BudgetPeriodLimit> = match &value {
            serde_json::Value::Array(arr) => arr
                .iter()
                .filter_map(BudgetPeriodLimit::from_value)
                .collect(),
            _ => {
                if let Some(limit) = BudgetPeriodLimit::from_value(&value) {
                    vec![limit]
                } else {
                    vec![]
                }
            }
        };

        // Cache the result
        if let Ok(json) = serde_json::to_string(&limits) {
            self.cache
                .set_budget_limit(budget_id, Some(start), Some(end), json);
        }

        debug!(
            "budget limit: {} periods for budget {}",
            limits.len(),
            budget_id
        );

        Ok(limits)
    }

    /// Build a BudgetComparison for the given budget names.
    /// Fetches budget spent history for current and previous year,
    /// budget limits, and computes projections.
    pub async fn get_budget_comparison(
        &self,
        budget_names: Vec<String>,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> Result<Vec<BudgetComparison>, String> {
        let now = Utc::now();
        let current_year = now.year();
        let previous_year = current_year - 1;

        // Determine end date (default to end of current month)
        let end = end_date.unwrap_or_else(|| now.format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            chrono::NaiveDate::from_ymd_opt(current_year, 1, 1)
                .unwrap()
                .format("%Y-%m-%d")
                .to_string()
        });

        // Previous year date range
        let prev_start = chrono::NaiveDate::from_ymd_opt(previous_year, 1, 1)
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();

        // Parse end date to determine which months should have data
        let end_naive =
            chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").unwrap_or(now.date_naive());
        let current_month = end_naive.month();

        // Fetch budget list to get IDs
        let budgets = self
            .get_budgets(Some(prev_start.clone()), Some(end.clone()))
            .await?;

        // Fetch current year spent history
        let current_spent = self
            .get_budget_spent_history(
                Some(start.clone()),
                Some(end.clone()),
                Some("1M".to_string()),
                None,
            )
            .await?;

        // Fetch previous year spent history
        let prev_end = chrono::NaiveDate::from_ymd_opt(previous_year, 12, 31)
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();
        let prev_spent = self
            .get_budget_spent_history(
                Some(prev_start.clone()),
                Some(prev_end.clone()),
                Some("1M".to_string()),
                None,
            )
            .await?;

        let months: Vec<String> = (1..=12)
            .map(|m| {
                chrono::NaiveDate::from_ymd_opt(current_year, m, 1)
                    .unwrap()
                    .format("%b")
                    .to_string()
            })
            .collect();

        // Build comparison for each budget
        let mut results: Vec<BudgetComparison> = Vec::new();

        for budget in &budgets {
            // Skip if budget_names filter is specified and this budget is not in it
            if !budget_names.is_empty() && !budget_names.contains(&budget.name) {
                continue;
            }

            // Extract current year monthly spent
            let current_ds = current_spent.iter().find(|ds| ds.label == budget.name);
            let mut current_spent: Vec<Option<f64>> = vec![None; 12];
            if let Some(ds) = current_ds {
                if let Some(entries) = ds.entries.as_object() {
                    for (date_key, value) in entries {
                        if let Some(month_idx) = Self::month_index_from_date_key(date_key) {
                            let val = value
                                .as_f64()
                                .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
                                .map(|v| v.abs());
                            current_spent[month_idx as usize] = val;
                        }
                    }
                }
            }

            // Extract previous year monthly spent
            let prev_ds = prev_spent.iter().find(|ds| ds.label == budget.name);
            let mut prev_spent: Vec<Option<f64>> = vec![None; 12];
            if let Some(ds) = prev_ds {
                if let Some(entries) = ds.entries.as_object() {
                    for (date_key, value) in entries {
                        if let Some(month_idx) = Self::month_index_from_date_key(date_key) {
                            let val = value
                                .as_f64()
                                .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
                                .map(|v| v.abs());
                            prev_spent[month_idx as usize] = val;
                        }
                    }
                }
            }

            // Fetch and extract limits for this budget
            let mut current_limit: Vec<Option<f64>> = vec![None; 12];
            let mut prev_limit: Vec<Option<f64>> = vec![None; 12];

            if let Ok(limits) = self
                .get_budget_limit(&budget.id, Some(start.clone()), Some(end.clone()))
                .await
            {
                for limit in &limits {
                    if let (Some(month_idx), Some(year)) = (limit.month_index(), limit.year()) {
                        if year == current_year {
                            current_limit[month_idx as usize] = Some(limit.period_limit);
                        }
                    }
                }
            }

            if let Ok(limits) = self
                .get_budget_limit(&budget.id, Some(prev_start.clone()), Some(prev_end.clone()))
                .await
            {
                for limit in &limits {
                    if let (Some(month_idx), Some(year)) = (limit.month_index(), limit.year()) {
                        if year == previous_year {
                            prev_limit[month_idx as usize] = Some(limit.period_limit);
                        }
                    }
                }
            }

            // Build running totals
            let mut current_running: Vec<Option<f64>> = vec![None; 12];
            let mut running_sum: f64 = 0.0;
            let mut has_any = false;
            for i in 0..12 {
                if let Some(val) = current_spent[i] {
                    running_sum += val;
                    current_running[i] = Some(running_sum);
                    has_any = true;
                } else if has_any {
                    current_running[i] = Some(running_sum);
                }
            }

            let mut prev_running: Vec<Option<f64>> = vec![None; 12];
            running_sum = 0.0;
            has_any = false;
            for i in 0..12 {
                if let Some(val) = prev_spent[i] {
                    running_sum += val;
                    prev_running[i] = Some(running_sum);
                    has_any = true;
                } else if has_any {
                    prev_running[i] = Some(running_sum);
                }
            }

            // Zero out months beyond current month for current year
            for i in current_month as usize..12 {
                current_spent[i] = None;
                current_running[i] = None;
            }

            // Calculate projections
            let ytd_total: f64 = current_spent.iter().filter_map(|v| *v).sum();
            let prev_total: f64 = prev_spent.iter().filter_map(|v| *v).sum();
            let current_limit_total: Option<f64> = if current_limit.iter().any(|v| v.is_some()) {
                Some(current_limit.iter().filter_map(|v| *v).sum())
            } else {
                None
            };
            let prev_limit_total: Option<f64> = if prev_limit.iter().any(|v| v.is_some()) {
                Some(prev_limit.iter().filter_map(|v| *v).sum())
            } else {
                None
            };

            let months_elapsed = current_month as f64;
            let avg_monthly = if months_elapsed > 0.0 {
                ytd_total / months_elapsed
            } else {
                0.0
            };
            let projected_annual = avg_monthly * 12.0;

            let vs_last_year = if prev_total > 0.0 {
                let pct = ((projected_annual / prev_total) - 1.0) * 100.0;
                format!("{:+.1}%", pct)
            } else if projected_annual > 0.0 {
                "N/A (no previous data)".to_string()
            } else {
                "0.0%".to_string()
            };

            let vs_limit: Option<String> = current_limit_total.and_then(|limit| {
                if limit > 0.0 {
                    let pct = ((projected_annual / limit) - 1.0) * 100.0;
                    Some(format!("{:+.1}%", pct))
                } else {
                    None
                }
            });

            let on_track = current_limit_total
                .map(|limit| projected_annual <= limit)
                .unwrap_or(true);

            // Get currency from chart data
            let currency_symbol = current_ds
                .and_then(|ds| ds.currency_symbol.clone())
                .or_else(|| prev_ds.and_then(|ds| ds.currency_symbol.clone()));
            let currency_code = current_ds
                .and_then(|ds| ds.currency_code.clone())
                .or_else(|| prev_ds.and_then(|ds| ds.currency_code.clone()));

            results.push(BudgetComparison {
                budget_name: budget.name.clone(),
                current_year,
                previous_year,
                months: months.clone(),
                current_year_spent: current_spent,
                previous_year_spent: prev_spent,
                current_year_limit: current_limit,
                previous_year_limit: prev_limit,
                current_year_running: current_running,
                previous_year_running: prev_running,
                projections: BudgetComparisonProjections {
                    current_year_total: ytd_total,
                    current_year_projected: projected_annual,
                    previous_year_total: prev_total,
                    current_year_limit_total: current_limit_total,
                    previous_year_limit_total: prev_limit_total,
                    vs_last_year,
                    vs_limit,
                    on_track,
                },
                currency_symbol,
                currency_code,
            });
        }

        Ok(results)
    }

    /// Extract a month index (0-based, 0=January) from a date key string.
    /// Handles formats like "2026-01-01T00:00:00+00:00", "2026-01-01", etc.
    fn month_index_from_date_key(date_key: &str) -> Option<u32> {
        let date_str = date_key.split('T').next()?;
        let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
        Some(date.month() - 1) // 0-indexed
    }
    fn get_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));
        headers
    }

    fn chunk_date_range(start: &str, end: &str) -> Result<Vec<(String, String)>, String> {
        let start =
            chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").map_err(|e| e.to_string())?;

        let mut chunks = Vec::new();
        let mut current = start;

        while current <= end {
            let chunk_start = current;
            // Find the first day of the next month
            let mut next_month = current.with_day(1).unwrap();
            if next_month.month() == 12 {
                next_month = next_month
                    .with_year(next_month.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap();
            } else {
                next_month = next_month.with_month(next_month.month() + 1).unwrap();
            }
            // Last day of current month = day before first day of next month
            let chunk_end = next_month.pred_opt().unwrap();

            // Clamp chunk_end to the overall end date
            let actual_end = if chunk_end > end { end } else { chunk_end };

            chunks.push((
                chunk_start.format("%Y-%m-%d").to_string(),
                actual_end.format("%Y-%m-%d").to_string(),
            ));

            // Move to the first day of the next month, or past end to stop
            current = if next_month > end {
                end + chrono::Duration::days(1)
            } else {
                next_month
            };
        }

        Ok(chunks)
    }

    async fn fetch_all_transactions(
        &self,
        start: &str,
        end: &str,
        account_ids: Option<&Vec<String>>,
        type_filter: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let chunks = Self::chunk_date_range(start, end)?;
        let mut all_transactions = std::collections::HashMap::new();

        for (chunk_start, chunk_end) in &chunks {
            let url = format!("{}/v1/transactions", self.config.firefly_url.as_str());
            let mut offset = 0;
            let page_size = 500;

            loop {
                let mut params = vec![
                    ("start".to_string(), chunk_start.clone()),
                    ("end".to_string(), chunk_end.clone()),
                    ("limit".to_string(), "500".to_string()),
                    ("offset".to_string(), offset.to_string()),
                ];
                if let Some(t) = type_filter {
                    params.push(("type".to_string(), t.to_string()));
                }

                let response = self
                    .client
                    .get(&url)
                    .headers(self.get_headers())
                    .query(&params)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !response.status().is_success() {
                    return Err(format!(
                        "Failed to fetch transactions: {}",
                        response.status()
                    ));
                }

                let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
                let data = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .cloned()
                    .unwrap_or_default();

                if data.is_empty() {
                    break;
                }
                for tx in &data {
                    if let Some(id) = tx.get("id").and_then(|i| i.as_str()) {
                        all_transactions.insert(id.to_string(), tx.clone());
                    }
                }
                offset += page_size;
                if data.len() < page_size {
                    break;
                }
            }
        }

        let mut all_transactions: Vec<serde_json::Value> = all_transactions.into_values().collect();

        if let Some(ids) = account_ids {
            if !ids.is_empty() {
                let id_set: std::collections::HashSet<String> = ids.iter().cloned().collect();
                all_transactions.retain(|tx| self.transaction_involves_account(tx, &id_set));
            }
        }
        Ok(all_transactions)
    }

    fn transaction_involves_account(
        &self,
        tx: &serde_json::Value,
        account_ids: &std::collections::HashSet<String>,
    ) -> bool {
        tx.get("attributes")
            .and_then(|a| a.get("transactions"))
            .and_then(|t| t.as_array())
            .map(|transactions| {
                transactions.iter().any(|t| {
                    let source_match = t
                        .get("source_id")
                        .and_then(|s| s.as_str())
                        .map(|s| account_ids.contains(s))
                        .unwrap_or(false);
                    let dest_match = t
                        .get("destination_id")
                        .and_then(|d| d.as_str())
                        .map(|d| account_ids.contains(d))
                        .unwrap_or(false);
                    source_match || dest_match
                })
            })
            .unwrap_or(false)
    }

    fn generate_period_keys(
        start_date: &str,
        end_date: &str,
        period: &str,
    ) -> Result<Vec<String>, String> {
        let start =
            chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let end =
            chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = match period {
                "1M" => {
                    let first_of_next = chrono::NaiveDate::from_ymd_opt(
                        if current.month() == 12 {
                            current.year() + 1
                        } else {
                            current.year()
                        },
                        if current.month() == 12 {
                            1
                        } else {
                            current.month() + 1
                        },
                        1,
                    )
                    .unwrap();
                    let last_of_month = first_of_next - chrono::Duration::days(1);
                    // If the month is partial (end date doesn't reach month end)
                    // and we already have a key for a previous month, skip this
                    // partial bucket to avoid showing two points one day apart
                    // (e.g., Aug 31 + Sep 1 when end date is Sep 1).
                    if last_of_month > end && !keys.is_empty() {
                        // Don't emit a key — advance past this partial month.
                        if current.month() == 12 {
                            current = current
                                .with_year(current.year() + 1)
                                .unwrap()
                                .with_month(1)
                                .unwrap();
                        } else {
                            current = current.with_month(current.month() + 1).unwrap();
                        }
                        continue;
                    }
                    // For the last (possibly partial) month, clamp key to end date.
                    let key_date = if last_of_month > end {
                        end
                    } else {
                        last_of_month
                    };
                    key_date.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                "1Q" => {
                    let quarter_month = match current.month() {
                        1..=3 => 1,
                        4..=6 => 4,
                        7..=9 => 7,
                        10..=12 => 10,
                        _ => 1,
                    };
                    current
                        .with_month(quarter_month)
                        .unwrap()
                        .format("%Y-%m-%dT00:00:00+00:00")
                        .to_string()
                }
                "1W" => {
                    let monday = current
                        - chrono::Duration::days(current.weekday().num_days_from_monday() as i64);
                    monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                _ => current.format("%Y-%m-%dT00:00:00+00:00").to_string(),
            };
            keys.push(key);
            match period {
                "1M" => {
                    if current.month() == 12 {
                        current = current
                            .with_year(current.year() + 1)
                            .unwrap()
                            .with_month(1)
                            .unwrap();
                    } else {
                        current = current.with_month(current.month() + 1).unwrap();
                    }
                }
                "1Q" => {
                    let current_quarter = ((current.month() - 1) / 3) + 1;
                    let next_quarter_start = current_quarter * 3 + 1;
                    if next_quarter_start > 12 {
                        current = current
                            .with_year(current.year() + 1)
                            .unwrap()
                            .with_month(1)
                            .unwrap();
                    } else {
                        current = current.with_month(next_quarter_start).unwrap();
                    }
                }
                "1W" => current += chrono::Duration::days(7),
                _ => current += chrono::Duration::days(1),
            }
        }
        Ok(keys)
    }

    /// Extract currency info from a list of transaction objects (from fetch_all_transactions).
    fn get_currency_from_transaction_list(
        txs: &[serde_json::Value],
    ) -> (Option<String>, Option<String>) {
        txs.iter()
            .filter_map(|t| t.get("attributes"))
            .filter_map(|attr| attr.get("transactions"))
            .filter_map(|trans_array| trans_array.as_array())
            .flatten()
            .find_map(|trans| {
                let symbol = trans
                    .get("currency_symbol")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                let code = trans
                    .get("currency_code")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                if symbol.is_some() || code.is_some() {
                    Some((symbol, code))
                } else {
                    None
                }
            })
            .unwrap_or((None, None))
    }

    /// Fetch all categories from Firefly III, cached.
    /// Returns a list of ParentCategory objects (categories with subcategories derived from ":" splitting).
    pub async fn get_categories(&self) -> Result<Vec<ParentCategory>, String> {
        // Check cache first
        if let Some(cached_json) = self.cache.get_categories() {
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached categories: {}", e));
        }

        let headers = self.get_headers();
        let url = format!("{}/v1/categories", self.config.firefly_url.as_str());

        let response = self
            .client
            .get(&url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("API request failed with status: {}. Body: {}", status, body);
            return Err(format!("API request failed with status: {}", status));
        }

        let category_array: CategoryListResponse =
            response.json().await.map_err(|e| e.to_string())?;
        let categories = category_array.categories();

        // Group by parent category (split by ":")
        let mut parent_map: std::collections::BTreeMap<String, std::collections::BTreeSet<String>> =
            std::collections::BTreeMap::new();
        for cat in &categories {
            let parts: Vec<&str> = cat.name.splitn(2, ':').collect();
            let parent = parts[0].trim().to_string();
            let subcat = if parts.len() > 1 {
                parts[1].trim().to_string()
            } else {
                "Other".to_string()
            };
            parent_map.entry(parent).or_default().insert(subcat);
        }

        let result: Vec<ParentCategory> = parent_map
            .into_iter()
            .map(|(name, subcats)| ParentCategory {
                name: name.clone(),
                category_type: name,
                subcategories: subcats.into_iter().collect(),
            })
            .collect();

        // Cache the result
        if let Ok(json) = serde_json::to_string(&result) {
            self.cache.set_categories(json);
        }

        Ok(result)
    }

    /// Get subcategory spend chart data for selected parent categories.
    /// When graph_mode is "parent", groups by parent category (one line per parent).
    /// Otherwise (default), groups by subcategory (one line per "parent > subcat").
    #[allow(clippy::too_many_arguments)]
    pub async fn get_subcategory_spend_chart(
        &self,
        parent_categories: Vec<String>,
        subcategories: Vec<String>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
        graph_mode: Option<String>,
    ) -> Result<ChartLine, String> {
        let is_parent_mode = graph_mode.as_deref() == Some("parent");
        // Check cache first
        if let Some(cached_json) = self.cache.get_subcategory_spend(
            &parent_categories,
            &subcategories,
            start_date.clone(),
            end_date.clone(),
            period.clone(),
            account_ids.clone(),
            graph_mode.clone(),
        ) {
            debug!("Cache hit for subcategory spend");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached subcat spend: {}", e));
        }

        use crate::models::chart::ChartDataSet;

        let end = end_date
            .clone()
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.clone().unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.clone().unwrap_or_else(|| "1M".to_string());

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref(), None)
            .await?;

        // Build a set of parent categories for filtering
        let parent_set: std::collections::HashSet<String> =
            parent_categories.iter().cloned().collect();

        // Build a set of specific subcategory filters (full "parent:subcat" names).
        // When non-empty, only these exact subcategories are included.
        let subcat_filter: std::collections::HashSet<String> =
            subcategories.iter().cloned().collect();

        // Flatten transactions into journal entries
        let mut all_journals: Vec<serde_json::Value> = Vec::new();
        for tx in &all_transactions {
            if let Some(trans_arr) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for journal in trans_arr {
                    all_journals.push(journal.clone());
                }
            }
        }

        // Build selected account set for transfer filtering
        let selected_ids: std::collections::HashSet<String> = account_ids
            .as_ref()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();

        // Filter to "spent" journals (withdrawals + outbound transfers), group by subcategory + period
        let mut subcat_entries: std::collections::HashMap<
            String,
            std::collections::HashMap<String, f64>,
        > = std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        for journal in &all_journals {
            if !is_journal_spent(journal, &selected_ids) {
                continue;
            }

            let full_category = journal
                .get("category_name")
                .and_then(|c| c.as_str())
                .unwrap_or("");

            // Skip if no category
            if full_category.is_empty() {
                continue;
            }

            // Split by ":" to get parent and subcategory
            let parts: Vec<&str> = full_category.splitn(2, ':').collect();
            let parent = parts[0].trim();
            let subcat = if parts.len() > 1 {
                parts[1].trim()
            } else {
                "Other"
            };

            // Skip if parent category not in selected list
            if !parent_set.contains(parent) {
                continue;
            }

            // If specific subcategories were requested, skip ones not in the filter
            if !subcat_filter.is_empty() {
                let full_name = format!("{}:{}", parent, subcat);
                if !subcat_filter.contains(&full_name) {
                    continue;
                }
            }

            if let Some(amount_str) = journal.get("amount").and_then(|a| a.as_str()) {
                if let Ok(amount) = amount_str.parse::<f64>() {
                    if let Some(date) = journal.get("date").and_then(|d| d.as_str()) {
                        let period_key = Self::get_period_key(date, &period_val, Some(&end));

                        // In parent mode, group by parent only; otherwise by "parent > subcat"
                        let label = if is_parent_mode {
                            parent.to_string()
                        } else {
                            format!("{} > {}", parent, subcat)
                        };

                        let entries = subcat_entries.entry(label).or_default();
                        *entries.entry(period_key).or_insert(0.0) += amount;
                    }
                }
            }

            if currency_symbol.is_none() {
                currency_symbol = journal
                    .get("currency_symbol")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                currency_code = journal
                    .get("currency_code")
                    .and_then(|s| s.as_str())
                    .map(String::from);
            }
        }

        // Convert to ChartLine: one ChartDataSet per subcategory
        let mut chart: Vec<ChartDataSet> = subcat_entries
            .into_iter()
            .map(|(label, entries)| ChartDataSet {
                label,
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: serde_json::to_value(entries).unwrap(),
            })
            .collect();

        // Sort by total spend descending
        chart.sort_by(|a, b| {
            let sum_a = Self::sum_entries(&a.entries);
            let sum_b = Self::sum_entries(&b.entries);
            sum_b
                .partial_cmp(&sum_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Cache the result
        if let Ok(json) = serde_json::to_string(&chart) {
            self.cache.set_subcategory_spend(
                &parent_categories,
                &subcategories,
                start_date,
                end_date,
                period,
                account_ids,
                graph_mode,
                json,
            );
        }

        Ok(chart)
    }

    /// Calculate average cost per budget with configurable mode and account filtering.
    /// - LastNMonths: average monthly spend over the last N months
    /// - PreviousYearSameMonth: spend from the same months in the previous year (YTD)
    #[allow(clippy::too_many_arguments)]
    pub async fn get_avg_cost(
        &self,
        budget_names: Vec<String>,
        mode: AvgCostMode,
        months_count: u32,
        account_ids: Option<Vec<String>>,
        target_month: Option<u32>,
        target_year: Option<i32>,
    ) -> Result<AvgCostResponse, String> {
        let now = Utc::now();
        let current_year = now.year();
        let current_month = now.month();

        // Use target month/year if provided, otherwise default to current
        let (use_year, use_month) = match (&mode, target_year, target_month) {
            (AvgCostMode::PreviousYearSameMonth, Some(y), Some(m)) => (y, m),
            (AvgCostMode::PreviousYearSameMonth, None, None) => (current_year - 1, current_month),
            (_, _, _) => (current_year, current_month),
        };

        // Determine date range based on mode
        let (start_date, end_date, data_period_months) = match &mode {
            AvgCostMode::LastNMonths => {
                let n = months_count.clamp(1, 24);
                // Go back N months manually
                let mut year = current_year;
                let mut month = current_month as i32;
                for _ in 0..n {
                    month -= 1;
                    if month < 1 {
                        month = 12;
                        year -= 1;
                    }
                }
                let start = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
                    .ok_or_else(|| "Failed to compute start date".to_string())?
                    .format("%Y-%m-%d")
                    .to_string();
                let end_str = now.format("%Y-%m-%d").to_string();
                (start, end_str, n)
            }
            AvgCostMode::PreviousYearSameMonth => {
                // Show only the specified month from the target year
                let start = chrono::NaiveDate::from_ymd_opt(use_year, use_month, 1)
                    .ok_or_else(|| "Failed to compute start date".to_string())?
                    .format("%Y-%m-%d")
                    .to_string();
                // Last day of that month
                let next_month = use_month + 1;
                let (end_year, end_month) = if next_month > 12 {
                    (use_year + 1, 1)
                } else {
                    (use_year, next_month)
                };
                let end = chrono::NaiveDate::from_ymd_opt(end_year, end_month, 1)
                    .ok_or_else(|| "Failed to compute end date".to_string())?
                    - chrono::Duration::days(1);
                let end_str = end.format("%Y-%m-%d").to_string();
                (start, end_str, 1)
            }
        };

        // Fetch budget spent history for the date range with monthly granularity
        let spent_history = self
            .get_budget_spent_history(
                Some(start_date.clone()),
                Some(end_date.clone()),
                Some("1M".to_string()),
                account_ids.clone(),
            )
            .await?;

        let month_labels = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];

        // Build per-budget results
        let mut results: Vec<AvgCostBudget> = Vec::new();

        for dataset in &spent_history {
            // Filter by budget names if specified
            if !budget_names.is_empty() && !budget_names.contains(&dataset.label) {
                continue;
            }

            let entries = match &dataset.entries {
                serde_json::Value::Object(map) => map,
                _ => continue,
            };

            // Extract monthly data points: parse date keys and amounts
            let mut monthly_points: Vec<(i32, u32, String, f64)> = Vec::new();
            for (date_key, value) in entries {
                // Date keys are in format "2026-01-01T00:00:00+00:00" or "2026-01-31T..."
                if date_key.len() < 7 {
                    continue;
                }
                let year_str = &date_key[..4];
                let month_str = &date_key[5..7];
                let year = year_str.parse::<i32>().unwrap_or(0);
                let month = month_str.parse::<u32>().unwrap_or(0);
                if year == 0 || month == 0 || month > 12 {
                    continue;
                }
                let amount = value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let label = format!("{} {}", month_labels[(month - 1) as usize], year);
                monthly_points.push((year, month, label, amount));
            }

            // Sort by date
            monthly_points.sort_by_key(|(y, m, _, _)| (*y as u64) * 100 + (*m as u64));

            // Build serialized monthly data
            let monthly_data: Vec<AvgCostMonthlyPoint> = monthly_points
                .iter()
                .map(|(_, _, label, amount)| AvgCostMonthlyPoint {
                    label: label.clone(),
                    amount: *amount,
                })
                .collect();

            let total: f64 = monthly_points.iter().map(|(_, _, _, a)| a).sum();
            let count = monthly_points.len() as f64;
            let average = if count > 0.0 { total / count } else { 0.0 };
            let min_spend = monthly_points
                .iter()
                .map(|(_, _, _, a)| *a)
                .fold(f64::MAX, f64::min);
            let max_spend = monthly_points
                .iter()
                .map(|(_, _, _, a)| *a)
                .fold(0.0_f64, f64::max);

            results.push(AvgCostBudget {
                budget_name: dataset.label.clone(),
                mode: mode.clone(),
                months_count: data_period_months,
                monthly_data,
                average_cost: average,
                total_spend: total,
                min_spend: if count > 0.0 { min_spend } else { 0.0 },
                max_spend: if count > 0.0 { max_spend } else { 0.0 },
                currency_symbol: dataset.currency_symbol.clone(),
                currency_code: dataset.currency_code.clone(),
            });
        }

        // Sort by average cost descending
        results.sort_by(|a, b| {
            b.average_cost
                .partial_cmp(&a.average_cost)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        debug!(
            "avg_cost: {} budgets, mode={:?}, months={}, range={} to {}",
            results.len(),
            mode,
            months_count,
            start_date,
            end_date
        );

        let (resp_target_month, resp_target_year) = match &mode {
            AvgCostMode::PreviousYearSameMonth => (Some(use_month), Some(use_year)),
            _ => (None, None),
        };

        Ok(AvgCostResponse {
            budgets: results,
            mode,
            months_count: data_period_months,
            start_date,
            end_date,
            target_month: resp_target_month,
            target_year: resp_target_year,
        })
    }

    /// Calculate Sankey flow data for selected source accounts.
    /// Flow types:
    /// - Budget: groups withdrawals by budget assignment
    /// - Category: groups withdrawals by main category (before ":")
    /// - Subcategory: groups withdrawals by full "Parent > Subcat" name
    /// - Destination: groups all transactions by destination account name
    #[allow(clippy::too_many_arguments)]
    pub async fn get_sankey_flows(
        &self,
        account_ids: Vec<String>,
        flow_type: SankeyFlowType,
        start_date: Option<String>,
        end_date: Option<String>,
        categories: Option<Vec<String>>,
        subcategories: Option<Vec<String>>,
        budgets: Option<Vec<String>>,
    ) -> Result<SankeyFlowData, String> {
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });

        // Check cache first
        if let Some(cached_json) =
            self.cache
                .get_sankey_flow(&account_ids, &flow_type, Some(&start), Some(&end))
        {
            debug!("Cache hit for sankey flow");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached sankey flow: {}", e));
        }

        let all_transactions = self
            .fetch_all_transactions(&start, &end, Some(&account_ids), None)
            .await?;

        let flow_type_label = match &flow_type {
            SankeyFlowType::Budget => "budget".to_string(),
            SankeyFlowType::Category => "category".to_string(),
            SankeyFlowType::Subcategory => "subcategory".to_string(),
            SankeyFlowType::Destination => "destination".to_string(),
        };

        // Flatten transactions into journal entries
        let mut all_journals: Vec<serde_json::Value> = Vec::new();
        for tx in &all_transactions {
            if let Some(trans_arr) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for journal in trans_arr {
                    all_journals.push(journal.clone());
                }
            }
        }

        let links = match &flow_type {
            SankeyFlowType::Destination => {
                self.aggregate_sankey_destination(&all_journals, &account_ids)
            }
            SankeyFlowType::Budget => {
                self.aggregate_sankey_budget(&all_journals, &account_ids, budgets.as_ref())
            }
            SankeyFlowType::Category => {
                self.aggregate_sankey_category(&all_journals, &account_ids, categories.as_ref())
            }
            SankeyFlowType::Subcategory => self.aggregate_sankey_subcategory(
                &all_journals,
                &account_ids,
                subcategories.as_ref(),
            ),
        };

        // Extract currency from the transaction list
        let (currency_symbol, currency_code) =
            Self::get_currency_from_transaction_list(&all_transactions);

        let total: f64 = links.iter().map(|l| l.amount).sum();

        let result = SankeyFlowData {
            nodes: Vec::new(), // populated by frontend from unique names
            links,
            total,
            currency_symbol,
            currency_code,
            flow_type: flow_type_label,
        };

        // Cache the result
        if let Ok(json) = serde_json::to_string(&result) {
            self.cache
                .set_sankey_flow(&account_ids, &flow_type, start.clone(), end.clone(), json);
        }

        Ok(result)
    }

    /// Aggregate for "destination" flow type: all transaction types grouped by destination account.
    fn aggregate_sankey_destination(
        &self,
        journals: &[serde_json::Value],
        source_account_ids: &[String],
    ) -> Vec<SankeyLink> {
        let source_set: std::collections::HashSet<String> =
            source_account_ids.iter().cloned().collect();
        self.aggregate_sankey_by_names(journals, &source_set, |journal, source_set| {
            let source_id = journal
                .get("source_id")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if !source_set.contains(source_id) {
                return None;
            }
            let source_name = journal
                .get("source_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let dest_name = journal
                .get("destination_name")
                .and_then(|d| d.as_str())
                .unwrap_or("");
            if dest_name.is_empty() || source_name.is_empty() {
                return None;
            }
            let amount = journal
                .get("amount")
                .and_then(|a| a.as_str())
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0);
            Some((source_name.to_string(), dest_name.to_string(), amount))
        })
    }

    /// Aggregate for "budget" flow type: spent transactions grouped by budget name.
    /// Includes withdrawals and transfers from selected accounts to non-selected destinations.
    fn aggregate_sankey_budget(
        &self,
        journals: &[serde_json::Value],
        source_account_ids: &[String],
        budget_filter: Option<&Vec<String>>,
    ) -> Vec<SankeyLink> {
        let source_set: std::collections::HashSet<String> =
            source_account_ids.iter().cloned().collect();
        let budget_set: Option<std::collections::HashSet<&str>> =
            budget_filter.map(|v| v.iter().map(|s| s.as_str()).collect());
        self.aggregate_sankey_by_names(journals, &source_set, |journal, ss| {
            if !is_journal_spent(journal, ss) {
                return None;
            }
            let source_name = journal
                .get("source_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if source_name.is_empty() {
                return None;
            }
            let budget_name = journal
                .get("budget_name")
                .and_then(|b| b.as_str())
                .unwrap_or("Unbudgeted");
            if let Some(ref set) = budget_set {
                if !set.contains(budget_name) {
                    return None;
                }
            }
            let amount = journal
                .get("amount")
                .and_then(|a| a.as_str())
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0);
            Some((source_name.to_string(), budget_name.to_string(), amount))
        })
    }

    /// Aggregate for "category" flow type: spent transactions grouped by main category (before ":").
    /// Includes withdrawals and transfers from selected accounts to non-selected destinations.
    fn aggregate_sankey_category(
        &self,
        journals: &[serde_json::Value],
        source_account_ids: &[String],
        category_filter: Option<&Vec<String>>,
    ) -> Vec<SankeyLink> {
        let source_set: std::collections::HashSet<String> =
            source_account_ids.iter().cloned().collect();
        let cat_set: Option<std::collections::HashSet<&str>> =
            category_filter.map(|v| v.iter().map(|s| s.as_str()).collect());
        self.aggregate_sankey_by_names(journals, &source_set, |journal, ss| {
            if !is_journal_spent(journal, ss) {
                return None;
            }
            let source_name = journal
                .get("source_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if source_name.is_empty() {
                return None;
            }
            let full_category = journal
                .get("category_name")
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let parts: Vec<&str> = full_category.splitn(2, ':').collect();
            let cat_name = if parts[0].trim().is_empty() {
                "Uncategorized"
            } else {
                parts[0].trim()
            };
            if let Some(ref set) = cat_set {
                if !set.contains(cat_name) {
                    return None;
                }
            }
            let amount = journal
                .get("amount")
                .and_then(|a| a.as_str())
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0);
            Some((source_name.to_string(), cat_name.to_string(), amount))
        })
    }

    /// Aggregate for "subcategory" flow type: spent transactions grouped by "Parent > Subcat".
    /// Includes withdrawals and transfers from selected accounts to non-selected destinations.
    fn aggregate_sankey_subcategory(
        &self,
        journals: &[serde_json::Value],
        source_account_ids: &[String],
        subcategory_filter: Option<&Vec<String>>,
    ) -> Vec<SankeyLink> {
        let source_set: std::collections::HashSet<String> =
            source_account_ids.iter().cloned().collect();
        let subcat_set: Option<std::collections::HashSet<&str>> =
            subcategory_filter.map(|v| v.iter().map(|s| s.as_str()).collect());
        self.aggregate_sankey_by_names(journals, &source_set, |journal, ss| {
            if !is_journal_spent(journal, ss) {
                return None;
            }
            let source_name = journal
                .get("source_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if source_name.is_empty() {
                return None;
            }
            let full_category = journal
                .get("category_name")
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let parts: Vec<&str> = full_category.splitn(2, ':').collect();
            let parent = if parts[0].trim().is_empty() {
                "Uncategorized"
            } else {
                parts[0].trim()
            };
            let subcat = if parts.len() > 1 && !parts[1].trim().is_empty() {
                parts[1].trim()
            } else {
                "Other"
            };
            let cat_name = format!("{} > {}", parent, subcat);
            if let Some(ref set) = subcat_set {
                if !set.contains(&cat_name.as_str()) {
                    return None;
                }
            }
            let amount = journal
                .get("amount")
                .and_then(|a| a.as_str())
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0);
            Some((source_name.to_string(), cat_name.to_string(), amount))
        })
    }

    /// Generic aggregator: iterate journals, apply selector, aggregate by (source, target) name.
    fn aggregate_sankey_by_names<F>(
        &self,
        journals: &[serde_json::Value],
        source_set: &std::collections::HashSet<String>,
        selector: F,
    ) -> Vec<SankeyLink>
    where
        F: Fn(
            &serde_json::Value,
            &std::collections::HashSet<String>,
        ) -> Option<(String, String, f64)>,
    {
        let mut links_map: std::collections::HashMap<(String, String), f64> =
            std::collections::HashMap::new();

        for journal in journals {
            if let Some((source, target, amount)) = selector(journal, source_set) {
                let key = (source, target);
                let entry = links_map.entry(key).or_insert(0.0);
                *entry += amount;
            }
        }

        let mut links: Vec<SankeyLink> = links_map
            .into_iter()
            .map(|((source, target), amount)| SankeyLink {
                source,
                target,
                amount,
            })
            .collect();

        links.sort_by(|a, b| {
            b.amount
                .partial_cmp(&a.amount)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        links
    }
}

/// Parse chart entries into (date, value) pairs.
/// Handles both Firefly III entry formats:
/// - Object: {"2026-01-01T00:00:00+00:00": "5000", ...}
/// - Array: [{key: "2026-01-01", value: "5000"}, ...]
/// Also handles internal {date, ba} format from cached/derived data.
fn parse_chart_entries(entries: &serde_json::Value) -> Vec<(String, f64)> {
    let mut result = Vec::new();

    // Array format: [{key/date, value/ba}, ...]
    if let Some(entries_arr) = entries.as_array() {
        for item in entries_arr {
            let key = item
                .get("key")
                .or_else(|| item.get("date"))
                .and_then(|k| k.as_str());
            let value = item
                .get("value")
                .or_else(|| item.get("ba"))
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    item.get("value")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                });
            if let (Some(k), Some(v)) = (key, value) {
                result.push((k.to_string(), v));
            }
        }
    }
    // Object format: {"2026-01-01T...": "5000", ...}
    else if let Some(entries_obj) = entries.as_object() {
        for (key, value) in entries_obj {
            let v = value
                .as_f64()
                .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()));
            if let Some(v) = v {
                result.push((key.clone(), v));
            }
        }
    }

    result
}

/// Aggregate monthly chart data into quarterly buckets.
/// For balance data, takes the last value of each quarter (end-of-quarter balance).
/// Handles both object entries {"date": value} and array entries [{key, value}].
fn aggregate_monthly_to_quarterly(mut chart_line: ChartLine) -> ChartLine {
    for dataset in chart_line.iter_mut() {
        // Normalize entries to object format first
        if let Some(entries_arr) = dataset.entries.as_array() {
            let mut obj = serde_json::Map::new();
            for item in entries_arr {
                if let (Some(key), Some(value)) = (
                    item.get("key")
                        .or_else(|| item.get("date"))
                        .and_then(|k| k.as_str()),
                    item.get("value"),
                ) {
                    obj.insert(key.to_string(), value.clone());
                }
            }
            dataset.entries = serde_json::Value::Object(obj);
        }

        if let Some(entries_obj) = dataset.entries.as_object() {
            // Parse all entries into (date, quarter_key, value) tuples and sort by date
            let mut sorted: Vec<(chrono::NaiveDate, String, f64)> = entries_obj
                .iter()
                .filter_map(|(key, value)| {
                    let date_part = key.split('T').next()?;
                    let date = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
                    let quarter = ((date.month() - 1) / 3) + 1;
                    let q_key = format!("{}-Q{}", date.year(), quarter);
                    let v = value
                        .as_f64()
                        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))?;
                    Some((date, q_key, v))
                })
                .collect();
            sorted.sort_by_key(|(date, _, _)| *date);

            // Take the last value per quarter (end-of-quarter balance), preserving order
            let mut quarterly: std::collections::BTreeMap<String, f64> =
                std::collections::BTreeMap::new();
            for (_date, q_key, value) in sorted {
                quarterly.insert(q_key, value);
            }

            dataset.entries = serde_json::Value::Object(
                quarterly
                    .into_iter()
                    .filter_map(|(k, v)| {
                        serde_json::Number::from_f64(v).map(|n| (k, serde_json::Value::Number(n)))
                    })
                    .collect(),
            );
        }
    }
    chart_line
}

#[cfg(test)]
mod period_key_tests {
    use super::*;

    #[test]
    fn test_monthly_period_key_clamped_to_end_date() {
        // When end date is mid-month and a prior full month already exists,
        // the partial last month is skipped entirely to avoid showing two
        // points one day apart (e.g., Aug 31 + Sep 1 when end date is Sep 1).
        let keys = FireflyClient::generate_period_keys("2025-07-01", "2025-08-05", "1M").unwrap();

        // July: last day is July 31 — full month, included
        assert_eq!(keys[0], "2025-07-31T00:00:00+00:00");

        // August: partial month (only 5 days), skipped because July is already present.
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn test_monthly_period_key_full_months() {
        // When the range covers full months, keys should be last day of each month
        let keys = FireflyClient::generate_period_keys("2025-07-01", "2025-08-31", "1M").unwrap();

        assert_eq!(keys[0], "2025-07-31T00:00:00+00:00");
        assert_eq!(keys[1], "2025-08-31T00:00:00+00:00");
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn test_monthly_period_key_single_partial_month() {
        // Range within a single month
        let keys = FireflyClient::generate_period_keys("2025-08-10", "2025-08-20", "1M").unwrap();

        // Key should be clamped to end date (Aug 20), not Aug 31
        assert_eq!(keys[0], "2025-08-20T00:00:00+00:00");
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn test_daily_period_keys_no_clamping_needed() {
        // Daily keys are the current date itself, so no clamping issue
        let keys = FireflyClient::generate_period_keys("2025-08-01", "2025-08-05", "1D").unwrap();

        assert_eq!(keys.len(), 5);
        assert_eq!(keys[0], "2025-08-01T00:00:00+00:00");
        assert_eq!(keys[4], "2025-08-05T00:00:00+00:00");
    }

    #[test]
    fn test_weekly_period_keys_no_future() {
        // Weekly keys are Monday of each week — should not extend beyond end date
        let keys = FireflyClient::generate_period_keys("2025-08-04", "2025-08-12", "1W").unwrap();

        // Aug 4 is Monday, Aug 11 is Monday
        // Week of Aug 4: key is Aug 4 (Monday)
        // Week of Aug 11: key is Aug 11 (Monday) — within range
        assert_eq!(keys[0], "2025-08-04T00:00:00+00:00");
        assert_eq!(keys[1], "2025-08-11T00:00:00+00:00");
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn test_quarterly_period_keys() {
        let keys = FireflyClient::generate_period_keys("2025-01-01", "2025-07-15", "1Q").unwrap();

        // Q1 starts Jan 1, Q2 starts Apr 1 — both within range
        assert_eq!(keys[0], "2025-01-01T00:00:00+00:00");
        assert_eq!(keys[1], "2025-04-01T00:00:00+00:00");
        // Q3 starts Jul 1 — Jul 1 <= Jul 15, so included
        assert_eq!(keys[2], "2025-07-01T00:00:00+00:00");
        assert_eq!(keys.len(), 3);
    }

    #[test]
    fn test_get_period_key_clamped_to_end() {
        // Without end date, get_period_key returns last day of month (no clamping)
        let key = FireflyClient::get_period_key("2025-08-03T10:00:00+00:00", "1M", None);
        assert_eq!(key, "2025-08-31T00:00:00+00:00");

        // With end date, the key is clamped to the end date
        let key =
            FireflyClient::get_period_key("2025-08-03T10:00:00+00:00", "1M", Some("2025-08-05"));
        assert_eq!(key, "2025-08-05T00:00:00+00:00");

        // When end date is beyond last of month, no clamping needed
        let key =
            FireflyClient::get_period_key("2025-08-03T10:00:00+00:00", "1M", Some("2025-08-31"));
        assert_eq!(key, "2025-08-31T00:00:00+00:00");
    }
}
