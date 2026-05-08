# Troubleshooting

## Common Issues

### "Connection refused" when opening Oxidize

- Ensure the server is running (`cargo run` or the Docker container is active)
- Check that you're using the correct host and port (default: `http://localhost:8080`)
- If you changed the `PORT` environment variable, use the new port

### "Invalid URL" or startup error about Firefly III URL

- The `FIREFLY_III_URL` must be a valid URL with `http` or `https` scheme
- It cannot point to localhost, 127.0.0.1, or any private IP address (SSRF protection)
- Example of a valid URL: `https://firefly.example.com` (note: no `/api` suffix)

### "Invalid token" or 401 errors

- Verify your `FIREFLY_III_ACCESS_TOKEN` is correct and hasn't expired
- In Firefly III, go to Settings → User details and regenerate or create a new token
- Make sure the token has the necessary permissions (read-only is sufficient for Oxidize)

### Chart shows no data

- Check that your selected accounts have transaction history in Firefly III
- Try a wider date range (e.g., last 90 days instead of last 30 days)
- Clear the cache via `POST /api/refresh` and reload the page
- Check the server logs for errors when fetching from Firefly III

### Dashboard widgets won't load

- Ensure the SQLite data directory exists and is writable
- Check that `DATA_DIR` points to a valid directory (default: `./data`)
- Verify the `oxidize.db` file exists in that directory
- Check server logs for SQLite-related errors

### Docker volume loses data

- If you don't mount a volume, your widgets and groups are stored in the container's filesystem and will be lost when the container is removed
- Always use a named volume or bind mount for persistence:
  ```bash
  docker run -v oxidize-data:/app/data oxidize
  ```

## Logging

Oxidize uses the `env_logger` crate. Control log verbosity with the `RUST_LOG` environment variable:

| Level | Use Case |
|-------|----------|
| `trace` | Every HTTP request, response, and internal detail |
| `debug` | API calls, cache hits/misses, database operations |
| `info` | Server start, stopped, major events (default) |
| `warn` | Warnings that don't break functionality |
| `error` | Errors that caused an operation to fail |

Example:

```bash
RUST_LOG=debug cargo run
```

Or in your `.env` file:

```env
RUST_LOG=debug
```

Debug logs are especially useful when:
- Data isn't appearing in charts (shows which API calls succeeded/failed)
- Cache behavior is unexpected (shows cache hits and misses)
- Widgets aren't saving (shows SQLite operations)

## Cache Debugging

If data seems stale or outdated:

1. **Check the cache TTL**: All caches expire after 5 minutes (300 seconds). Wait for expiry or manually clear.

2. **Clear all caches**:
   ```bash
   curl -X POST http://localhost:8080/api/refresh
   ```

3. **Clear specific caches**:
   ```bash
   curl -X POST http://localhost:8080/api/accounts/refresh
   curl -X POST http://localhost:8080/api/accounts/balance-history/refresh
   ```

4. **From the UI**: Each widget has a refresh button that bypasses the cache for that specific widget's data.

5. **Verify with logs**: Set `RUST_LOG=debug` and watch for `cache hit` or `cache miss` messages in the server output.
