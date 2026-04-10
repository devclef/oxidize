/// Tests for OXI-14 and OXI-15: Route registration verification
///
/// This test file verifies that all API endpoints are properly registered
/// to prevent 404 errors.

#[cfg(test)]
mod tests {
    #[test]
    fn test_all_routes_are_registered() {
        // This test verifies that the following routes are registered in main.rs:
        // - /api/accounts
        // - /api/accounts/balance-history
        // - /api/accounts/refresh
        // - /api/accounts/balance-history/refresh
        // - /api/refresh
        // - /api/earned-spent
        // - /api/expenses-by-category  (was missing - OXI-14)
        // - /api/net-worth             (was missing - OXI-14)
        // - /dashboard
        // - /api/widgets
        // - /api/saved-lists

        // Read main.rs to verify route registration
        let main_rs = include_str!("../src/main.rs");

        // Check that all expected route registrations are present
        assert!(
            main_rs.contains("get_accounts"),
            "get_accounts should be registered"
        );
        assert!(
            main_rs.contains("get_balance_history"),
            "get_balance_history should be registered"
        );
        assert!(
            main_rs.contains("refresh_accounts"),
            "refresh_accounts should be registered"
        );
        assert!(
            main_rs.contains("refresh_balance_history"),
            "refresh_balance_history should be registered"
        );
        assert!(
            main_rs.contains("refresh_all"),
            "refresh_all should be registered"
        );
        assert!(
            main_rs.contains("get_earned_spent"),
            "get_earned_spent should be registered"
        );
        assert!(
            main_rs.contains("get_expenses_by_category"),
            "get_expenses_by_category should be registered (OXI-14 fix)"
        );
        assert!(
            main_rs.contains("get_net_worth"),
            "get_net_worth should be registered (OXI-14 fix)"
        );
        assert!(
            main_rs.contains("dashboard"),
            "dashboard should be registered"
        );
        assert!(
            main_rs.contains("list_widgets"),
            "list_widgets should be registered"
        );
        assert!(
            main_rs.contains("create_widget"),
            "create_widget should be registered"
        );
        assert!(
            main_rs.contains("update_widget"),
            "update_widget should be registered"
        );
        assert!(
            main_rs.contains("delete_widget"),
            "delete_widget should be registered"
        );
    }

    #[test]
    fn test_endpoint_handler_functions_exist() {
        // This test verifies that the handler functions exist in account.rs
        let account_rs = include_str!("../src/handlers/account.rs");

        // Check that all expected handler functions are defined
        assert!(
            account_rs.contains("pub async fn get_accounts"),
            "get_accounts function should exist"
        );
        assert!(
            account_rs.contains("pub async fn get_balance_history"),
            "get_balance_history function should exist"
        );
        assert!(
            account_rs.contains("pub async fn refresh_accounts"),
            "refresh_accounts function should exist"
        );
        assert!(
            account_rs.contains("pub async fn refresh_balance_history"),
            "refresh_balance_history function should exist"
        );
        assert!(
            account_rs.contains("pub async fn refresh_all"),
            "refresh_all function should exist"
        );
        assert!(
            account_rs.contains("pub async fn get_earned_spent"),
            "get_earned_spent function should exist"
        );
        assert!(
            account_rs.contains("pub async fn get_expenses_by_category"),
            "get_expenses_by_category function should exist"
        );
        assert!(
            account_rs.contains("pub async fn get_net_worth"),
            "get_net_worth function should exist"
        );

        // Check that the #[get] attributes are present with correct paths
        assert!(
            account_rs.contains("#[get(\"/api/net-worth\")]"),
            "get_net_worth should have #[get(\"/api/net-worth\")] attribute"
        );
        assert!(
            account_rs.contains("#[get(\"/api/expenses-by-category\")]"),
            "get_expenses_by_category should have #[get(\"/api/expenses-by-category\")] attribute"
        );
    }

    #[test]
    fn test_net_worth_endpoint_structure() {
        // This test verifies the structure of the net worth endpoint
        let account_rs = include_str!("../src/handlers/account.rs");

        // The endpoint should:
        // 1. Parse start, end, and period query parameters
        // 2. Call client.get_net_worth()
        // 3. Return HttpResponse::Ok().json() on success
        // 4. Return HttpResponse::InternalServerError() on error

        assert!(
            account_rs.contains("get_net_worth"),
            "Should contain get_net_worth"
        );
        assert!(
            account_rs.contains("client.get_net_worth"),
            "Should call client.get_net_worth"
        );
        assert!(
            account_rs.contains("HttpResponse::Ok().json(net_worth)"),
            "Should return Ok response with net_worth data"
        );
        assert!(
            account_rs.contains("HttpResponse::InternalServerError"),
            "Should return InternalServerError on failure"
        );
    }

    #[test]
    fn test_expenses_by_category_endpoint_structure() {
        // This test verifies the structure of the expenses by category endpoint
        let account_rs = include_str!("../src/handlers/account.rs");

        // The endpoint should:
        // 1. Parse start, end, and accounts[] query parameters
        // 2. Call client.get_expenses_by_category()
        // 3. Return HttpResponse::Ok().json() on success
        // 4. Return HttpResponse::InternalServerError() on error

        assert!(
            account_rs.contains("get_expenses_by_category"),
            "Should contain get_expenses_by_category"
        );
        assert!(
            account_rs.contains(".get_expenses_by_category"),
            "Should call .get_expenses_by_category"
        );
        assert!(
            account_rs.contains("HttpResponse::Ok().json(categories)"),
            "Should return Ok response with categories data"
        );
        assert!(
            account_rs.contains("HttpResponse::InternalServerError"),
            "Should return InternalServerError on failure"
        );
    }
}
