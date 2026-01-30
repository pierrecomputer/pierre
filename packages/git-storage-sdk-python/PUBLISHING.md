# Publishing to PyPI - Complete Guide

This guide walks you through publishing the `pierre-storage` package to PyPI for
the first time.

## Prerequisites

### 1. Create PyPI Account

First, you need accounts on both PyPI and TestPyPI (for testing):

1. **PyPI (production)**: https://pypi.org/account/register/
2. **TestPyPI (testing)**: https://test.pypi.org/account/register/

> **Note**: These are separate accounts, so register on both!

### 2. Verify Your Email

After registering, check your email and verify your account on both sites.

### 3. Enable 2FA (Required for PyPI)

PyPI requires two-factor authentication:

1. Go to https://pypi.org/manage/account/
2. Click "Add 2FA with authentication application"
3. Use an app like Google Authenticator, Authy, or 1Password
4. Save the recovery codes somewhere safe!

Do the same for TestPyPI if you want (optional but recommended).

### 4. Create API Tokens

Instead of using passwords, we'll use API tokens (more secure):

#### For TestPyPI (testing):

1. Go to https://test.pypi.org/manage/account/token/
2. Click "Add API token"
3. Token name: `pierre-storage-test`
4. Scope: "Entire account" (for first upload)
5. Copy the token (starts with `pypi-...`)
6. **Save it immediately** - you won't see it again!

#### For PyPI (production):

1. Go to https://pypi.org/manage/account/token/
2. Click "Add API token"
3. Token name: `pierre-storage`
4. Scope: "Entire account" (for first upload)
5. Copy the token
6. **Save it securely** (password manager, environment variable, etc.)

## Step-by-Step Publishing Process

### Step 1: Install Publishing Tools

```bash
cd packages/git-storage-sdk-python

# With uv (recommended)
uv sync

# Or with traditional venv
source venv/bin/activate
pip install build twine
```

### Step 2: Prepare the Package

Make sure everything is ready:

```bash
# Run tests to ensure everything works
uv run pytest -v

# Type check
uv run mypy pierre_storage

# Lint check
uv run ruff check pierre_storage

# Format check
uv run ruff format --check pierre_storage
```

All should pass ✅

### Step 3: Build the Package

```bash
# Clean any old builds
rm -rf dist/ build/ *.egg-info

# Build the package with Moon (recommended - cleaner output)
moon git-storage-sdk-python:build

# Or build directly
uv build

# You should see output like:
# Successfully built pierre_storage-0.4.2.tar.gz and pierre_storage-0.4.2-py3-none-any.whl
```

This creates two files in `dist/`:

- `pierre_storage-0.4.2-py3-none-any.whl` (wheel - preferred format)
- `pierre-storage-0.4.2.tar.gz` (source distribution)

### Step 4: Check the Package

Before uploading, verify the package is correct:

```bash
# Check package metadata and contents
uv run twine check dist/*

# Should output:
# Checking dist/pierre_storage-0.4.2-py3-none-any.whl: PASSED
# Checking dist/pierre-storage-0.4.2.tar.gz: PASSED
```

### Step 5: Test Upload to TestPyPI (RECOMMENDED)

Always test on TestPyPI first!

```bash
# Upload to TestPyPI
uv run twine upload --repository testpypi dist/*

# You'll be prompted:
# Enter your username: __token__
# Enter your password: [paste your TestPyPI token starting with pypi-...]
```

> **Important**: Username is literally `__token__` (with two underscores), not
> your username!

If successful, you'll see:

```
Uploading pierre_storage-0.4.2-py3-none-any.whl
Uploading pierre-storage-0.4.2.tar.gz
View at: https://test.pypi.org/project/pierre-storage/0.4.2/
```

### Step 6: Test Installation from TestPyPI

Test that people can actually install it:

```bash
# Test with uv in an isolated environment
uv run --isolated --index https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ \
  python -c "from pierre_storage import GitStorage; print('Success!')"

# Or create a new virtual environment for testing
python3 -m venv test-env
source test-env/bin/activate
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ pierre-storage
python -c "from pierre_storage import GitStorage; print('Success!')"
deactivate
rm -rf test-env
```

> **Note**: We use `--extra-index-url` because dependencies (httpx, pyjwt, etc.)
> are on the real PyPI, not TestPyPI.

### Step 7: Upload to Real PyPI 🚀

If TestPyPI worked perfectly, upload to the real PyPI:

```bash
# Make sure you're in the SDK directory
cd packages/git-storage-sdk-python

# Upload to PyPI
uv run twine upload dist/*

# Enter credentials:
# Username: __token__
# Password: [paste your PyPI token]
```

Success! 🎉

You'll see:

```
Uploading pierre_storage-0.4.2-py3-none-any.whl
Uploading pierre-storage-0.4.2.tar.gz
View at: https://pypi.org/project/pierre-storage/0.4.2/
```

### Step 8: Verify Installation

Test the real installation:

```bash
# With uv
uv run --isolated python -c "from pierre_storage import GitStorage; print('Success!')"

# Or with traditional venv
python3 -m venv verify-env
source verify-env/bin/activate
pip install pierre-storage

# Verify
python -c "from pierre_storage import GitStorage; print('Installed successfully!')"

# Clean up
deactivate
rm -rf verify-env
```

## Using a `.pypirc` File (Optional but Recommended)

Instead of entering tokens each time, create a `~/.pypirc` file:

```bash
nano ~/.pypirc
```

Add this content:

```ini
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-YOUR-PRODUCTION-TOKEN-HERE

[testpypi]
repository = https://test.pypi.org/legacy/
username = __token__
password = pypi-YOUR-TEST-TOKEN-HERE
```

**Secure the file:**

```bash
chmod 600 ~/.pypirc
```

Now you can upload without entering credentials:

```bash
# Upload to TestPyPI
twine upload --repository testpypi dist/*

# Upload to PyPI
twine upload dist/*
```

## Publishing Updates

When you release a new version:

### 1. Update Version Number

Edit `pyproject.toml`:

```toml
[project]
version = "0.1.3"  # Increment version
```

### 2. Update CHANGELOG (if you have one)

Document what changed.

### 3. Build and Upload

```bash
# Clean old builds
rm -rf dist/ build/ *.egg-info

# Run tests
pytest -v

# Build
python -m build

# Check
twine check dist/*

# Upload to TestPyPI first
twine upload --repository testpypi dist/*

# Test installation
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ pierre-storage==0.1.3

# If good, upload to PyPI
twine upload dist/*
```

## Troubleshooting

### Error: "File already exists"

You can't re-upload the same version. You must increment the version number.

**Solution**: Update version in `pyproject.toml`, rebuild, and upload.

### Error: "Invalid username or password"

Common mistakes:

- Username should be `__token__` (with two underscores), not your PyPI username
- Password should be the full token starting with `pypi-`
- Make sure you're using the right token (TestPyPI vs PyPI)

### Error: "403 Forbidden"

You don't have permission to upload to that package name.

**Solutions**:

- If it's your first upload, this shouldn't happen
- If someone else owns the name, you need to choose a different name
- Make sure you're logged in to the right account

### Package not found after upload

Wait a few minutes - PyPI can take 5-15 minutes to index new packages.

### Import error after installation

Make sure:

- Your package structure is correct
- `__init__.py` exports the right things
- You're testing in a fresh virtual environment

## Using Moon for Building

You can also use Moon tasks:

```bash
# Build package
moon run git-storage-sdk-python:build

# Then upload
cd packages/git-storage-sdk-python
twine upload dist/*
```

## Security Best Practices

1. **Never commit tokens** to git
2. **Use API tokens**, not passwords
3. **Scope tokens** to specific projects (after first upload)
4. **Rotate tokens** periodically
5. **Enable 2FA** on PyPI
6. **Keep .pypirc secure** (`chmod 600`)

## Scoped Tokens (After First Upload)

After your first successful upload, create project-scoped tokens for better
security:

### For PyPI:

1. Go to https://pypi.org/manage/project/pierre-storage/settings/
2. Scroll to "API tokens"
3. Create new token with scope: "Project: pierre-storage"
4. Update your `~/.pypirc` with the new token

### For TestPyPI:

Do the same at https://test.pypi.org/manage/project/pierre-storage/settings/

## Quick Reference

```bash
# One-time setup
pip install build twine

# For each release
rm -rf dist/ build/ *.egg-info
pytest -v
python -m build
twine check dist/*
twine upload --repository testpypi dist/*  # Test first
twine upload dist/*                         # Then production
```

## Next Steps After Publishing

1. **Add PyPI badge to README**:

   ```markdown
   [![PyPI version](https://badge.fury.io/py/pierre-storage.svg)](https://badge.fury.io/py/pierre-storage)
   ```

2. **Announce the release**:
   - Tweet about it
   - Post on relevant forums
   - Update documentation

3. **Monitor**:
   - Check https://pypi.org/project/pierre-storage/ for stats
   - Watch for issues on GitHub

## Resources

- [PyPI Help](https://pypi.org/help/)
- [Packaging Python Projects](https://packaging.python.org/tutorials/packaging-projects/)
- [Twine Documentation](https://twine.readthedocs.io/)
- [PyPI API Tokens](https://pypi.org/help/#apitoken)

---

**Congratulations on your first PyPI package! 🎉**
