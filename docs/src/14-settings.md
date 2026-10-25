# Settings

The Settings page (`/settings`) changes Oxidize's configuration **at runtime**, without a restart. Values are stored in the SQLite database and survive restarts.

## Sections

| Section | Settings |
|---------|----------|
| **Firefly III** | Base URL and access token, with a **Test connection** button |
| **Accounts** | Account types shown in the filter dropdown; auto-fetch accounts on page load |
| **Caching** | Chart cache TTL |
| **Time ranges** | Available presets and the pre-selected range |
| **Server** | Read-only: host/port, data directory and log level (these need a restart) |
| **Features** | Optional pages: Monthly Summary (off by default), Reimbursements, Budget Comparison, Average Cost, Spending Labels (on by default) |

Environment variables are the **defaults**: a saved value wins, and clearing a field reverts it to the environment value. Changing the Firefly III connection clears the data cache.

Disabled pages and their API endpoints return 404, and their nav links are hidden on every page.

## API

```
GET   /api/settings
PATCH /api/settings          {"monthly_summary_enabled": true}
POST  /api/settings/test-firefly
```
