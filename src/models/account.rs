use serde::{Deserialize, Serialize};

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
}

#[derive(Serialize, Deserialize)]
pub struct SimpleAccount {
    pub id: String,
    pub name: String,
    pub balance: String,
    pub currency: String,
    pub account_type: String,
}
