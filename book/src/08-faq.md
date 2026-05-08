# FAQ

## General

### Do I need my own Firefly III instance?

Yes. Oxidize is a frontend dashboard that depends on Firefly III as its data source. It does not include its own database of transactions. You need a running Firefly III instance and a valid access token.

### Can I use Oxidize with the Firefly III demo site?

Yes, for testing purposes. Set `FIREFLY_III_URL=https://demo.firefly-iii.org` and use a demo token. Note that the demo site may reset periodically and is not intended for production use.

### Is my financial data stored locally?

Only widget and group configurations are stored locally (in SQLite). All financial data comes from Firefly III in real time (with a 5-minute in-memory cache). Oxidize does not maintain its own copy of transactions.

### Does Oxidize send data to any third party?

No. Oxidize only communicates with your Firefly III instance. No analytics, telemetry, or external API calls are made.

## Security

### Where is my Firefly III token stored?

The token is stored only in memory while the server is running. It is read from environment variables at startup and never written to disk.

### Why can't I point Oxidize at localhost?

Oxidize includes SSRF (Server-Side Request Forgery) protection. The Firefly III URL cannot resolve to a localhost, loopback, or private IP address. This prevents attackers from configuring Oxidize to probe internal services. If you're running both Oxidize and Firefly III on the same machine, use the machine's LAN IP or a hostname that resolves to it.

## Performance

### Why is the first page load slow?

The first load requires Oxidize to fetch data from Firefly III, which may involve multiple API calls and date range chunking. Subsequent loads benefit from the 5-minute in-memory cache.

### Can I reduce API calls to Firefly III?

The 5-minute cache already minimizes redundant calls. You can also:
- Use fewer widgets (each widget makes its own API call on first load)
- Use wider date ranges with coarser periods (fewer data points to aggregate)
- Avoid refreshing caches unnecessarily

### What happens if Firefly III is down?

Oxidize will return errors when trying to fetch data. Cached data remains available until it expires (5 minutes). After cache expiry, requests will fail until Firefly III is back online.

## Configuration

### How do I change the port?

Set the `PORT` environment variable:

```bash
PORT=3000 cargo run
```

### How do I show only certain account types?

Set `ACCOUNT_TYPES` to a comma-separated list:

```bash
ACCOUNT_TYPES=asset,cash
```

This shows only asset and cash accounts in the dropdown.

### How do I enable auto-fetch on page load?

Set `AUTO_FETCH_ACCOUNTS=true`. This loads accounts and chart data automatically when the main page opens, instead of requiring manual selection.

## Dashboard

### Can I export my widgets?

Widgets are stored in a local SQLite database. You can back up the database file directly (located at `{DATA_DIR}/oxidize.db`). There is no built-in import/export feature yet.

### How many widgets can I have?

There is no hard limit. Performance depends on your Firefly III instance and the date ranges/periods configured per widget.

## Troubleshooting

### Charts look blank or broken

- Check your browser console for JavaScript errors
- Ensure Chart.js loads correctly (it's loaded from CDN)
- Try a different browser
- Clear your browser cache and reload

### Dark mode isn't working

- Check that your browser supports the `data-theme` attribute
- Verify that `theme.js` loads correctly (check the browser console)
- Your theme preference is stored in localStorage — clearing it resets to light mode

### Docker container won't start

- Check that the required environment variables are set (`FIREFLY_III_URL` and `FIREFLY_III_ACCESS_TOKEN`)
- Check container logs: `docker logs <container-name>`
- Ensure the `DATA_DIR` volume is writable
