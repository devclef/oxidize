# Repository Guidelines

## Project Structure & Module Organization

The project is a Rust-based backend using `actix-web`.

- `src/`: Contains the core application logic.
  - `handlers/`: Route handlers.
  - `models/`: Data structures and types.
  - `storage/`: Database and persistence logic.
  - `client/`: External API client implementations.
  - `config.rs`: Configuration management.
  - `main.rs`: Application entry point.
- `tests/`: Integration and robustness tests.
- `api_specs/`: OpenAPI/Swagger specifications.
- `static/`: Frontend assets.

## Build, Test, and Development Commands

Use `cargo` for all development tasks.

- `cargo build`: Compile the project.
- `cargo run`: Run the server locally.
- `cargo test`: Run all unit and integration tests.
- `cargo fmt`: Format code to comply with project standards.
- `cargo clippy`: Run linting tools to check for common Rust mistakes.

## Coding Style & Naming Conventions

- **Style**: The project follows standard Rust idioms. Always run `cargo fmt` before committing.
- **Naming**:
  - Variables and functions: `snake_case`.
  - Structs and Enums: `PascalCase`.
  - Constants: `SCREAMING_SNAKE_CASE`.
- **Linting**: Use `clippy` to maintain high code quality.

## Testing Guidelines

- **Framework**: Uses the built-in Rust test framework with `tokio` for async tests.
- **Integration Tests**: Located in the `tests/` directory.
- **Naming**: Test functions should be descriptive, e.g., `test_feature_name_with_input`.

## Commit & Pull Request Guidelines

- **Commits**: Follow the pattern `[Issue ID]: [Description]` (e.g., `OXI-22: Implement period comparison for expenses graph`).
- **Pull Requests**:
  - Ensure all tests pass before submitting.
  - Provide a clear description of changes.
  - Link relevant issues in the description.
  - Run `cargo fmt` and `cargo clippy` to ensure compliance.
