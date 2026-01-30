"""JWT authentication utilities for Pierre Git Storage SDK."""

import time
from typing import List, Optional

import jwt
from cryptography.hazmat.primitives import serialization


def generate_jwt(
    key_pem: str,
    issuer: str,
    repo_id: str,
    scopes: Optional[List[str]] = None,
    ttl: int = 31536000,  # 1 year default
) -> str:
    """Generate a JWT token for Git storage authentication.

    Args:
        key_pem: Private key in PEM format (PKCS8)
        issuer: Token issuer (customer name)
        repo_id: Repository identifier
        scopes: List of permission scopes (defaults to ['git:write', 'git:read'])
        ttl: Time-to-live in seconds (defaults to 1 year)

    Returns:
        Signed JWT token string

    Raises:
        ValueError: If key is invalid or cannot be loaded
    """
    if not scopes:
        scopes = ["git:write", "git:read"]

    now = int(time.time())
    payload = {
        "iss": issuer,
        "sub": "@pierre/storage",
        "repo": repo_id,
        "scopes": scopes,
        "iat": now,
        "exp": now + ttl,
    }

    # Load the private key and determine algorithm
    try:
        private_key = serialization.load_pem_private_key(
            key_pem.encode("utf-8"),
            password=None,
        )
    except Exception as e:
        raise ValueError(f"Failed to load private key: {e}") from e

    # Determine algorithm based on key type
    key_type = type(private_key).__name__
    if "RSA" in key_type:
        algorithm = "RS256"
    elif "EC" in key_type or "Elliptic" in key_type:
        algorithm = "ES256"
    elif "Ed25519" in key_type or "Ed448" in key_type:
        algorithm = "EdDSA"
    else:
        # Try ES256 as default (most common for Pierre)
        algorithm = "ES256"

    # Sign the JWT
    try:
        token = jwt.encode(
            payload,
            private_key,
            algorithm=algorithm,
            headers={"alg": algorithm, "typ": "JWT"},
        )
    except Exception as e:
        raise ValueError(f"Failed to sign JWT: {e}") from e

    return token
