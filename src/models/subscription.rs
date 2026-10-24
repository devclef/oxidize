use serde::{Deserialize, Serialize};

/// A Firefly III subscription (called a "bill" in the v1 API) as shown in
/// the Subscription Cost widget picker.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Subscription {
    pub id: String,
    pub name: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_code: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    /// Expected payment amount range (subscription's own currency).
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_min: Option<f64>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_max: Option<f64>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_avg: Option<f64>,
    /// When the subscription is expected to be due (RFC 3339), if any.
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_expected_match: Option<String>,
    #[serde(default)]
    pub active: bool,
}

/// A Firefly III object group that contains at least one subscription
/// ("bill"), as offered in the widget picker's group list.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SubscriptionGroup {
    pub id: String,
    pub name: String,
    pub bill_count: usize,
    /// All subscription (bill) ids in the group — used to expand a
    /// selected group into its members for the spend chart.
    #[serde(default)]
    pub bill_ids: Vec<String>,
    /// Names of the group's subscriptions (first 20, for display).
    #[serde(default)]
    pub bills: Vec<String>,
}

/// Parse a Firefly III amount string ("123.45", possibly "-123.45") into
/// f64. Empty or unparseable values yield None.
pub fn parse_amount(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_amount_handles_values() {
        assert_eq!(parse_amount("123.45"), Some(123.45));
        assert_eq!(parse_amount("-10"), Some(-10.0));
        assert_eq!(parse_amount(""), None);
        assert_eq!(parse_amount("abc"), None);
    }

    #[test]
    fn subscription_round_trips() {
        let json = r#"{
            "id": "7",
            "name": "Netflix",
            "currency_code": "SEK",
            "currency_symbol": "kr",
            "amount_min": 95.0,
            "amount_max": 95.0,
            "amount_avg": 95.0,
            "next_expected_match": "2026-11-01T00:00:00+00:00",
            "active": true
        }"#;
        let s: Subscription = serde_json::from_str(json).unwrap();
        assert_eq!(s.name, "Netflix");
        assert_eq!(s.amount_avg, Some(95.0));
        assert!(s.active);

        let out = serde_json::to_value(&s).unwrap();
        assert_eq!(out["id"], "7");
        assert_eq!(out["amount_min"], 95.0);
    }

    #[test]
    fn subscription_defaults_missing_optionals() {
        // Older/minimal upstream payloads must still parse.
        let json = r#"{"id": "1", "name": "Rent"}"#;
        let s: Subscription = serde_json::from_str(json).unwrap();
        assert!(s.currency_code.is_none());
        assert!(!s.active);

        let out = serde_json::to_value(&s).unwrap();
        assert!(out.get("currency_code").is_none());
    }
}
