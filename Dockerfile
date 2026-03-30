# Use a multi-stage build for a smaller final image
FROM rust:1.88-slim-bookworm AS builder

# Set the working directory
WORKDIR /app

# Install dependencies for building
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Create a dummy project to cache dependencies
RUN cargo new --bin oxidize
WORKDIR /app/oxidize
COPY Cargo.toml .
RUN cargo build --release
RUN rm src/*.rs

# Copy the actual source code
COPY src ./src
COPY static ./static

# Build for release
RUN touch src/main.rs && cargo build --release

# Final stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/oxidize/target/release/oxidize .

# Copy the static files
COPY static ./static

# Expose the port
EXPOSE 8080

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=8080

# Run the binary
CMD ["./oxidize"]
