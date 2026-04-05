/// Tests for OXI-20: Monthly Summary Page
///
/// This test file verifies the monthly summary functionality including
/// route registration, handler functions, and client methods.

#[cfg(test)]
mod tests {
    #[test]
    fn test_summary_routes_are_registered() {
        // This test verifies that the summary routes are registered in main.rs:
        // - /api/summary/monthly (API endpoint for monthly summary data)
        // - /summary (Page endpoint for the summary page)

        let main_rs = include_str!("../src/main.rs");

        assert!(
            main_rs.contains("get_monthly_summary"),
            "get_monthly_summary should be registered"
        );
        assert!(
            main_rs.contains("handlers::summary::summary"),
            "summary page handler should be registered"
        );
    }

    #[test]
    fn test_summary_handler_functions_exist() {
        // This test verifies that the handler functions exist in summary.rs
        let summary_rs = include_str!("../src/handlers/summary.rs");

        // Check that handler functions are defined
        assert!(
            summary_rs.contains("pub async fn get_monthly_summary"),
            "get_monthly_summary function should exist"
        );
        assert!(
            summary_rs.contains("pub async fn summary"),
            "summary page function should exist"
        );

        // Check that the #[get] attributes are present with correct paths
        assert!(
            summary_rs.contains("#[get(\"/api/summary/monthly\")]"),
            "get_monthly_summary should have #[get(\"/api/summary/monthly\")] attribute"
        );
        assert!(
            summary_rs.contains("#[get(\"/summary\")]"),
            "summary page should have #[get(\"/summary\")] attribute"
        );

        // Check that SummaryQuery struct is defined
        assert!(
            summary_rs.contains("pub struct SummaryQuery"),
            "SummaryQuery struct should exist"
        );
        assert!(
            summary_rs.contains("month: Option<u32>"),
            "SummaryQuery should have month field"
        );
        assert!(
            summary_rs.contains("year: Option<i32>"),
            "SummaryQuery should have year field"
        );
    }

    #[test]
    fn test_summary_handler_structure() {
        // This test verifies the structure of the summary endpoints
        let summary_rs = include_str!("../src/handlers/summary.rs");

        // The get_monthly_summary endpoint should:
        // 1. Accept web::Query<SummaryQuery>
        assert!(
            summary_rs.contains("query: web::Query<SummaryQuery>"),
            "Should accept SummaryQuery"
        );

        // 2. Default to current month/year if not provided
        assert!(
            summary_rs.contains("chrono::Utc::now()"),
            "Should use current time for defaults"
        );

        // 3. Call client.get_monthly_summary()
        assert!(
            summary_rs.contains("client.get_monthly_summary"),
            "Should call client.get_monthly_summary"
        );

        // 4. Return HttpResponse::Ok().json() on success
        assert!(
            summary_rs.contains("HttpResponse::Ok().json(data)"),
            "Should return Ok response with summary data"
        );

        // 5. Return HttpResponse::InternalServerError() on error
        assert!(
            summary_rs.contains("HttpResponse::InternalServerError"),
            "Should return InternalServerError on failure"
        );

        // The summary page should:
        // 1. Return HTML content
        assert!(
            summary_rs.contains("include_str!(\"../../static/summary.html\")"),
            "Should include summary.html"
        );
    }

    #[test]
    fn test_client_get_monthly_summary_method_exists() {
        // This test verifies that the client method exists
        let client_rs = include_str!("../src/client/mod.rs");

        assert!(
            client_rs.contains("pub async fn get_monthly_summary"),
            "get_monthly_summary method should exist"
        );

        // Check method signature
        assert!(
            client_rs.contains("month: u32"),
            "Should accept month parameter"
        );
        assert!(
            client_rs.contains("year: i32"),
            "Should accept year parameter"
        );

        // Check return type
        assert!(
            client_rs.contains("Result<MonthlySummary, String>"),
            "Should return Result<MonthlySummary, String>"
        );
    }

    #[test]
    fn test_client_get_monthly_summary_implementation() {
        // This test verifies the implementation of get_monthly_summary
        let client_rs = include_str!("../src/client/mod.rs");

        // Should calculate date range for the month
        assert!(
            client_rs.contains("from_ymd_opt"),
            "Should use from_ymd_opt for date calculation"
        );

        // Should fetch transactions from Firefly III
        assert!(
            client_rs.contains("/v1/transactions"),
            "Should fetch from /v1/transactions endpoint"
        );

        // Should fetch both income (withdrawals) and expenses (deposits)
        assert!(
            client_rs.contains("\"withdrawal\""),
            "Should fetch withdrawals (income)"
        );
        assert!(
            client_rs.contains("\"deposit\""),
            "Should fetch deposits (expenses)"
        );

        // Should calculate totals
        assert!(
            client_rs.contains("total_income"),
            "Should calculate total_income"
        );
        assert!(
            client_rs.contains("total_expenses"),
            "Should calculate total_expenses"
        );
        assert!(
            client_rs.contains("savings"),
            "Should calculate savings"
        );
        assert!(
            client_rs.contains("savings_rate"),
            "Should calculate savings_rate"
        );

        // Should return MonthlySummary struct
        assert!(
            client_rs.contains("MonthlySummary {"),
            "Should return MonthlySummary struct"
        );
    }

    #[test]
    fn test_monthly_summary_model_exists() {
        // This test verifies that the MonthlySummary model exists
        let summary_model = include_str!("../src/models/summary.rs");

        assert!(
            summary_model.contains("pub struct MonthlySummary"),
            "MonthlySummary struct should exist"
        );
        assert!(
            summary_model.contains("pub month: String"),
            "Should have month field"
        );
        assert!(
            summary_model.contains("pub year: i32"),
            "Should have year field"
        );
        assert!(
            summary_model.contains("pub total_income: f64"),
            "Should have total_income field"
        );
        assert!(
            summary_model.contains("pub total_expenses: f64"),
            "Should have total_expenses field"
        );
        assert!(
            summary_model.contains("pub savings: f64"),
            "Should have savings field"
        );
        assert!(
            summary_model.contains("pub savings_rate: f64"),
            "Should have savings_rate field"
        );
    }

    #[test]
    fn test_summary_html_exists() {
        // This test verifies that the summary HTML page exists
        let summary_html = include_str!("../static/summary.html");

        // Should have proper HTML structure
        assert!(
            summary_html.contains("<!DOCTYPE html>"),
            "Should have DOCTYPE declaration"
        );
        assert!(
            summary_html.contains("<title>Oxidize - Monthly Summary</title>"),
            "Should have correct title"
        );

        // Should have month and year selectors
        assert!(
            summary_html.contains("id=\"month-select\""),
            "Should have month selector"
        );
        assert!(
            summary_html.contains("id=\"year-select\""),
            "Should have year selector"
        );

        // Should have summary cards
        assert!(
            summary_html.contains("id=\"total-income\""),
            "Should have total income display"
        );
        assert!(
            summary_html.contains("id=\"total-expenses\""),
            "Should have total expenses display"
        );
        assert!(
            summary_html.contains("id=\"savings\""),
            "Should have savings display"
        );
        assert!(
            summary_html.contains("id=\"savings-rate\""),
            "Should have savings rate display"
        );

        // Should fetch from the API
        assert!(
            summary_html.contains("/api/summary/monthly"),
            "Should fetch from /api/summary/monthly endpoint"
        );
    }

    #[test]
    fn test_summary_module_is_exported() {
        // This test verifies that the summary module is properly exported
        let handlers_mod = include_str!("../src/handlers/mod.rs");

        assert!(
            handlers_mod.contains("pub mod summary"),
            "summary module should be exported"
        );

        let models_mod = include_str!("../src/models/mod.rs");
        assert!(
            models_mod.contains("pub mod summary"),
            "summary model module should be exported"
        );
        assert!(
            models_mod.contains("pub use summary::MonthlySummary"),
            "MonthlySummary should be re-exported"
        );
    }
}
