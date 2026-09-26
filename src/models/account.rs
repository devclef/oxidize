use serde::{Deserialize, Serialize};

/// The account types Firefly III's `GET /v1/accounts?type=` accepts.
///
/// The export feature must offer these regardless of the configured
/// `ACCOUNT_TYPES`, because its purpose is to export data straight from
/// Firefly III, not what the dashboard filter happens to show.
pub const ALL_FIRELY_ACCOUNT_TYPES: [&str; 5] =
    ["asset", "cash", "liability", "revenue", "expense"];

#[derive(Serialize, Deserialize, Debug)]
pub struct AccountArray {
    pub data: Vec<AccountRead>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AccountRead {
    pub id: String,
    pub attributes: AccountAttributes,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AccountAttributes {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub current_balance: String,
    pub currency_symbol: String,
    // Optional, version-stable details carried through for CSV export.
    #[serde(default)]
    pub iban: Option<String>,
    #[serde(default)]
    pub account_number: Option<String>,
    #[serde(default)]
    pub currency_code: Option<String>,
    #[serde(default)]
    pub include_net_worth: Option<bool>,
    #[serde(default)]
    pub liability_type: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SimpleAccount {
    pub id: String,
    pub name: String,
    pub balance: String,
    pub currency: String,
    pub account_type: String,
    // Optional details (None when Firefly III does not report them or a
    // pre-existing cache entry predates them).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iban: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_net_worth: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liability_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Escape a single value for use in an unquoted/quoted CSV field (RFC 4180).
pub fn csv_escape(value: &str) -> String {
    if value.chars().any(|c| matches!(c, ',' | '"' | '\n' | '\r')) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Serialize accounts to CSV with a header row.
pub fn accounts_to_csv(accounts: &[SimpleAccount]) -> String {
    const HEADER: &str = "id,name,account_type,iban,account_number,currency_code,\
currency_symbol,current_balance,include_net_worth,liability_type,created_at,\
updated_at,notes";
    let mut csv = String::from(HEADER);
    for a in accounts {
        let row = [
            &a.id,
            &a.name,
            &a.account_type,
            a.iban.as_deref().unwrap_or(""),
            a.account_number.as_deref().unwrap_or(""),
            a.currency_code.as_deref().unwrap_or(""),
            &a.currency,
            &a.balance,
            a.include_net_worth
                .map(|b| b.to_string())
                .as_deref()
                .unwrap_or(""),
            a.liability_type.as_deref().unwrap_or(""),
            a.created_at.as_deref().unwrap_or(""),
            a.updated_at.as_deref().unwrap_or(""),
            a.notes.as_deref().unwrap_or(""),
        ]
        .iter()
        .map(|v| csv_escape(v))
        .collect::<Vec<_>>()
        .join(",");
        csv.push('\n');
        csv.push_str(&row);
    }
    csv
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: &str, name: &str, balance: &str, account_type: &str) -> SimpleAccount {
        SimpleAccount {
            id: id.into(),
            name: name.into(),
            balance: balance.into(),
            currency: "$".into(),
            account_type: account_type.into(),
            iban: None,
            account_number: None,
            currency_code: None,
            include_net_worth: None,
            liability_type: None,
            notes: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn test_csv_escape_plain_value_unchanged() {
        assert_eq!(csv_escape("Checking"), "Checking");
        assert_eq!(csv_escape("1000.00"), "1000.00");
    }

    #[test]
    fn test_csv_escape_comma_is_quoted() {
        assert_eq!(csv_escape("Savings, High Yield"), "\"Savings, High Yield\"");
    }

    #[test]
    fn test_csv_escape_quotes_are_doubled() {
        assert_eq!(csv_escape("A \"Pay\" account"), "\"A \"\"Pay\"\" account\"");
    }

    #[test]
    fn test_csv_escape_newline_is_quoted() {
        assert_eq!(csv_escape("line1\nline2"), "\"line1\nline2\"");
    }

    #[test]
    fn test_accounts_to_csv_empty_is_header_only() {
        assert_eq!(accounts_to_csv(&[]), accounts_to_csv(&[]));
        let csv = accounts_to_csv(&[]);
        assert!(csv.starts_with("id,name,account_type,"));
        assert_eq!(csv.lines().count(), 1);
    }

    #[test]
    fn test_accounts_to_csv_rows() {
        let accounts = vec![
            account("1", "Checking", "100.50", "asset"),
            account("2", "Card, Visa", "-20.00", "liability"),
        ];
        let csv = accounts_to_csv(&accounts);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[1], "1,Checking,asset,,,,$,100.50,,,,,");
        assert_eq!(lines[2], "2,\"Card, Visa\",liability,,,,$,-20.00,,,,,");
    }

    #[test]
    fn test_accounts_to_csv_optional_fields() {
        let mut a = account("9", "Mortgage", "-250000.00", "liabilities");
        a.iban = Some("NL91ABNA0417164300".into());
        a.currency_code = Some("EUR".into());
        a.include_net_worth = Some(true);
        a.liability_type = Some("mortgage".into());
        a.notes = Some("House, paid 2020".into());
        a.created_at = Some("2020-01-01T00:00:00Z".into());
        let csv = accounts_to_csv(std::slice::from_ref(&a));
        let line = csv.lines().nth(1).unwrap();
        assert_eq!(
            line,
            "9,Mortgage,liabilities,NL91ABNA0417164300,,EUR,$,-250000.00,true,mortgage,2020-01-01T00:00:00Z,,\"House, paid 2020\""
        );
    }

    #[test]
    fn test_all_firefly_types_match_api_contract() {
        // The API query parameter and these labels must stay in sync.
        assert_eq!(
            ALL_FIRELY_ACCOUNT_TYPES,
            ["asset", "cash", "liability", "revenue", "expense"]
        );
    }

    #[test]
    fn test_simple_account_deserializes_without_optional_fields() {
        // Pre-existing cache entries (written before the extra fields
        // existed) must still deserialize.
        let json =
            r#"{"id":"1","name":"Checking","balance":"10","currency":"$","account_type":"asset"}"#;
        let a: SimpleAccount = serde_json::from_str(json).unwrap();
        assert_eq!(a.iban, None);
        assert_eq!(a.include_net_worth, None);
        assert_eq!(a.notes, None);
    }
}
