# FAQ

## General

### Do I need my own Firefly III instance?

Yes. Oxidize is a frontend that depends on Firefly III as its data source. You need a running instance and a valid access token.

### Can I use the Firefly III demo site?

Yes, for testing. Set `FIREFLY_III_URL=https://demo.firefly-iii.org`. The demo may reset periodically.

### Is my financial data stored locally?

Only widget, group, and dashboard configs are stored locally (SQLite). Financial data comes from Firefly III in real time with a 5-minute in-memory cache.

### Does Oxidize send data to any third party?

No. Communication is only between Oxidize and your Firefly III instance. No analytics or telemetry.

## Security

### Where is my Firefly III token stored?

In memory only. It's read from environment variables at startup and never written to disk.

### Why can't I point Oxidize at localhost?

SSRF protection prevents the Firefly URL from resolving to localhost, loopback, or private IPs. If both services run on the same machine, use the LAN IP or a hostname.

## Performance

### Why is the first page load slow?

First load involves multiple API calls to Firefly III, possibly with date range chunking. Subsequent loads benefit from the 5-minute cache.

### What happens if Firefly III is down?

Cached data is available until it expires (5 minutes). After that, requests fail until Firefly III is back.

## Configuration

### How do I change the port?

```bash
PORT=3000 cargo run
```

### How do I show only certain account types?

```bash
ACCOUNT_TYPES=asset,cash
```

### How do I enable auto-fetch?

Set `AUTO_FETCH_ACCOUNTS=true`.

## Dashboard

### Can I export my widgets?

Widgets are stored in SQLite (`{DATA_DIR}/oxidize.db`). Back up the database file directly. No built-in import/export yet.

### How many widgets can I have?

No hard limit. Performance depends on Firefly III and the date ranges configured per widget.

## Troubleshooting

### Charts look blank or broken

- Check browser console for JS errors
- Ensure Chart.js/d3 load correctly (loaded from CDN)
- Clear browser cache and reload

### Dark mode isn't working

- Theme preference is stored in localStorage -- clearing it resets to light mode
- Check that `theme.js` loads (browser console)
