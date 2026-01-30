# Development Guide

This document provides technical details for developers working on the Pierre
Storage Python SDK.

## Architecture

The SDK is organized into the following modules:

### Core Modules

- **`client.py`**: Main `GitStorage` class for creating/finding repositories
- **`repo.py`**: `RepoImpl` class implementing all repository operations
- **`commit.py`**: `CommitBuilderImpl` for creating commits with streaming
  support
- **`auth.py`**: JWT token generation and signing
- **`errors.py`**: Custom exception classes
- **`types.py`**: Type definitions using TypedDict and Enums
- **`webhook.py`**: Webhook signature validation utilities

### Design Patterns

1. **Protocol-based interfaces**: Uses `Protocol` classes for type checking
   without inheritance
2. **Fluent builder**: `CommitBuilder` provides chainable methods for composing
   commits
3. **Async/await**: All I/O operations are async for better performance
4. **Streaming**: Large files are streamed in 4MB chunks to avoid memory issues

## Module Details

### Authentication (`auth.py`)

JWT generation with automatic algorithm detection:

- ES256 for elliptic curve keys (most common)
- RS256 for RSA keys
- EdDSA for Ed25519/Ed448 keys

Uses `cryptography` library for key loading and PyJWT for signing.

### Commit Builder (`commit.py`)

Key features:

- Fluent API for building commits
- Streaming support for large files
- Chunking into 4MB segments
- NDJSON protocol for server communication
- Error handling with detailed ref update information

### Repository Operations (`repo.py`)

Implements all Git storage API endpoints:

- File operations (get, list)
- Branch and commit listing with pagination
- Diff operations (branch, commit)
- Pull upstream
- Restore commits
- Commit creation

### Type System (`types.py`)

Uses TypedDict for better IDE support and runtime type checking:

- All API options are typed
- Results are structured with TypedDict
- Enums for constants (DiffFileState, GitFileMode)

## Testing Strategy

### Unit Tests (`tests/test_client.py`, `tests/test_webhook.py`)

- Mock HTTP responses using `unittest.mock`
- Test error conditions and validation
- Verify JWT generation and structure
- Test webhook signature validation

### Integration Tests (`tests/test_full_workflow.py`)

- End-to-end workflow testing
- Configurable via environment variables
- Mirrors TypeScript test for consistency
- Uses `wait_for` helper for async polling

## Dependencies

### Required

- **httpx**: Async HTTP client with streaming support
- **pyjwt**: JWT encoding/decoding
- **cryptography**: Key management and crypto operations
- **pydantic**: Data validation (future use)
- **typing-extensions**: Backport of typing features for Python 3.8+

### Development

- **pytest**: Test framework
- **pytest-asyncio**: Async test support
- **pytest-cov**: Coverage reporting
- **mypy**: Static type checking
- **ruff**: Fast linter and formatter

## Code Style

### Type Hints

All public functions must have type hints:

```python
async def create_repo(
    self,
    options: Optional[CreateRepoOptions] = None
) -> Repo:
    """Create a new repository."""
    ...
```

### Docstrings

Use Google-style docstrings:

```python
def generate_jwt(
    key_pem: str,
    issuer: str,
    repo_id: str,
    scopes: Optional[List[str]] = None,
    ttl: int = 31536000,
) -> str:
    """Generate a JWT token for Git storage authentication.

    Args:
        key_pem: Private key in PEM format (PKCS8)
        issuer: Token issuer (customer name)
        repo_id: Repository identifier
        scopes: List of permission scopes
        ttl: Time-to-live in seconds

    Returns:
        Signed JWT token string

    Raises:
        ValueError: If key is invalid or cannot be loaded
    """
    ...
```

### Error Handling

Use specific exception types:

```python
try:
    repo = await storage.create_repo({"id": "test"})
except ApiError as e:
    # Handle API errors
    print(f"API error: {e.status_code}")
except RefUpdateError as e:
    # Handle ref update failures
    print(f"Ref update failed: {e.status}")
```

## Performance Considerations

### Streaming

Large files are streamed to avoid memory issues:

```python
async def _chunkify(self, source: FileSource) -> AsyncIterator[Dict[str, Any]]:
    """Chunkify a file source into MAX_CHUNK_BYTES segments."""
    # Yields 4MB chunks as they're read
    ...
```

### Connection Pooling

Uses `httpx.AsyncClient` which provides connection pooling by default.

### Async Operations

All I/O is async, allowing concurrent operations:

```python
# Run multiple operations concurrently
results = await asyncio.gather(
    repo.list_files(),
    repo.list_commits(),
    repo.list_branches(),
)
```

## Debugging

### Enable HTTP logging

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Inspect JWT tokens

```python
import jwt

token = "eyJ..."
payload = jwt.decode(token, options={"verify_signature": False})
print(payload)
```

### Verbose test output

```bash
pytest -vv --log-cli-level=DEBUG
```

## Building and Publishing

### Install dependencies

```bash
# Install all dependencies (including dev dependencies)
uv sync

# Install only production dependencies
uv sync --no-dev
```

### Build package

```bash
uv build
```

### Check package

```bash
uv run twine check dist/*
```

### Upload to PyPI

```bash
uv run twine upload dist/*
```

### Test installation

```bash
uv pip install dist/pierre_storage-0.1.4-py3-none-any.whl
```

## Compatibility

- **Python**: 3.8+ (uses TypedDict, Protocol)
- **Operating Systems**: All (uses pure Python)
- **Async Runtime**: asyncio (standard library)

## Future Improvements

Potential areas for enhancement:

1. **Retry logic**: Automatic retry with exponential backoff
2. **Caching**: Optional caching of frequently accessed data
3. **Progress callbacks**: Report upload/download progress
4. **Batch operations**: Optimize multiple API calls
5. **Better error messages**: More context in error messages
6. **Pluggable transports**: Allow custom HTTP clients

## Maintenance

### Updating dependencies

```bash
# Update to latest compatible versions
uv lock --upgrade

# Update a specific package
uv lock --upgrade-package httpx

# Check for security updates
uv run pip-audit
```

### Version bumping

Update version in `pyproject.toml`:

```toml
[project]
version = "0.2.0"
```

### Changelog

Document changes in CHANGELOG.md following Keep a Changelog format.

## Resources

- [Pierre API Documentation](https://docs.pierre.io/api)
- [TypeScript SDK](../git-storage-sdk) - Reference implementation
- [httpx Documentation](https://www.python-httpx.org/)
- [PyJWT Documentation](https://pyjwt.readthedocs.io/)
