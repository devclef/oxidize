# Troubleshooting

## Common Issues

### "Connection refused" when opening Oxidize

- Ensure the server is running (`cargo run` or the Docker container is active)
- Check that you're using the correct host and port (default: `http://localhost:8080`)

### "Invalid URL" or startup error about Firefly III URL

- The `FIREFLY_III_URL` must be a valid URL with `http` or `https` scheme
- It cannot point to localhost, 127.0.0.1, or any private IP address (SSRF protection)
- Example of a valid URL: `https://firefly.example.com` (no `/api` suffix)

### "Invalid token" or 401 errors

- Verify your `FIREFLY_III_ACCESS_TOKEN` (or the token saved on the Settings page) is correct and hasn't expired
- Use **Test connection** on `/settings` to check a URL/token pair
- In Firefly III, go to Settings → User details and regenerate or create a new token

### Chart shows no data

- Check that selected accounts have transaction history in Firefly III
- Try a wider date range
- Clear the cache: `POST /api/refresh`
- Check server logs for errors (`RUST_LOG=debug`)

### Dashboard widgets won't load

- Ensure `DATA_DIR` points to a valid, writable directory (default: `~/.oxidize/data`)
- Verify `oxidize.db` exists in that directory

### A page returns 404

Optional pages (Monthly Summary, Reimbursements, Budget Comparison, Average Cost, Spending Labels) can be disabled. Enable them under `/settings` → Features. The Monthly Summary is off by default.

### Docker volume loses data

Always mount a volume for persistence:

```bash
docker run -v oxidize-data:/app/data oxidize
```

## Logging

Control log verbosity with `RUST_LOG`:

| Level | Use Case |
|-------|----------|
| `trace` | Every HTTP request, response, internal detail |
| `debug` | API calls, cache hits/misses, DB operations |
| `info` | Server start/stop, major events (default) |
| `warn` | Non-breaking warnings |
| `error` | Failed operations |

```bash
RUST_LOG=debug cargo run
```

## Cache Debugging

1. **TTL defaults to 1 hour** (`CACHE_TTL`, or the Settings page) -- wait for expiry or clear manually.
2. **Clear all caches**: `curl -X POST http://localhost:8080/api/refresh`
3. **Clear specific caches**: `curl -X POST http://localhost:8080/api/accounts/refresh`
4. **From the UI**: Each widget has a refresh button.
5. **Check logs**: With `RUST_LOG=debug`, watch for `cache hit` / `cache miss` messages.
