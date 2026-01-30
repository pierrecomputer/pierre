"""Webhook validation utilities for Pierre Git Storage SDK."""

import hashlib
import hmac
import json
import time
from datetime import datetime
from typing import Any, Dict, Optional, Sequence, Union

from pierre_storage.types import (
    ParsedWebhookSignature,
    WebhookEventPayload,
    WebhookPushEvent,
    WebhookUnknownEvent,
    WebhookValidationOptions,
    WebhookValidationResult,
)

__all__ = [
    "WebhookPushEvent",
    "parse_signature_header",
    "validate_webhook",
    "validate_webhook_signature",
]

PayloadInput = Union[str, bytes, bytearray]
HeaderValue = Union[str, bytes, Sequence[str]]
HeaderMap = Dict[str, HeaderValue]


def parse_signature_header(signature: str) -> Optional[ParsedWebhookSignature]:
    """Parse the X-Pierre-Signature header.

    Args:
        signature: The signature header value (format: "t=timestamp,sha256=signature")

    Returns:
        Parsed signature components if valid, otherwise None.
    """
    if not isinstance(signature, str):
        return None

    timestamp = ""
    sig = ""

    for part in signature.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key == "t":
            timestamp = value
        elif key == "sha256":
            sig = value

    if not timestamp or not sig:
        return None

    return {"timestamp": timestamp, "signature": sig}


def validate_webhook_signature(
    payload: PayloadInput,
    signature_header: str,
    secret: str,
    options: Optional[WebhookValidationOptions] = None,
) -> WebhookValidationResult:
    """Validate a webhook signature and timestamp."""
    if not secret:
        return {"valid": False, "error": "Empty secret is not allowed"}

    parsed = parse_signature_header(signature_header)
    if not parsed:
        return {"valid": False, "error": "Invalid signature header format"}

    try:
        timestamp = int(parsed["timestamp"])
    except (TypeError, ValueError):
        return {"valid": False, "error": "Invalid timestamp in signature"}

    max_age = (options or {}).get("max_age_seconds", 300)
    if max_age and max_age > 0:
        now = int(time.time())
        age = now - timestamp
        if age > max_age:
            return {
                "valid": False,
                "error": f"Webhook timestamp too old ({age} seconds)",
                "timestamp": timestamp,
            }
        if age < -60:
            return {
                "valid": False,
                "error": "Webhook timestamp is in the future",
                "timestamp": timestamp,
            }

    payload_str = payload.decode("utf-8") if isinstance(payload, (bytes, bytearray)) else payload
    if not isinstance(payload_str, str):
        payload_str = str(payload_str)

    signed_payload = f"{parsed['timestamp']}.{payload_str}"
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    expected_bytes = expected_signature.encode("utf-8")
    actual_bytes = parsed["signature"].encode("utf-8")

    if len(expected_bytes) != len(actual_bytes):
        return {"valid": False, "error": "Invalid signature", "timestamp": timestamp}

    if not hmac.compare_digest(expected_bytes, actual_bytes):
        return {"valid": False, "error": "Invalid signature", "timestamp": timestamp}

    return {"valid": True, "timestamp": timestamp}


def validate_webhook(
    payload: PayloadInput,
    headers: HeaderMap,
    secret: str,
    options: Optional[WebhookValidationOptions] = None,
) -> WebhookValidationResult:
    """Validate a webhook request and return structured payload data."""
    signature_header_raw = headers.get("x-pierre-signature") or headers.get("X-Pierre-Signature")
    signature_header = _normalize_header_value(signature_header_raw)
    if signature_header is None:
        return {
            "valid": False,
            "error": "Missing or invalid X-Pierre-Signature header",
        }

    event_header_raw = headers.get("x-pierre-event") or headers.get("X-Pierre-Event")
    event_header = _normalize_header_value(event_header_raw)
    if event_header is None:
        return {
            "valid": False,
            "error": "Missing or invalid X-Pierre-Event header",
        }

    validation = validate_webhook_signature(payload, signature_header, secret, options)
    if not validation.get("valid"):
        return validation

    payload_str = payload.decode("utf-8") if isinstance(payload, (bytes, bytearray)) else payload
    if not isinstance(payload_str, str):
        payload_str = str(payload_str)

    try:
        data = json.loads(payload_str)
    except json.JSONDecodeError:
        return {
            "valid": False,
            "error": "Invalid JSON payload",
            "timestamp": validation.get("timestamp"),
        }

    event_type = str(event_header)
    conversion = _convert_webhook_payload(event_type, data)
    if not conversion["valid"]:
        error_msg = conversion.get("error", "Unknown error")
        assert isinstance(error_msg, str)
        return {
            "valid": False,
            "error": error_msg,
            "timestamp": validation.get("timestamp"),
        }

    payload_data = conversion["payload"]
    assert isinstance(payload_data, dict)
    return {
        "valid": True,
        "event_type": event_type,
        "timestamp": validation.get("timestamp"),
        "payload": payload_data,
    }


def parse_push_event(payload: Dict[str, Any]) -> WebhookPushEvent:
    """Parse a push event webhook payload.

    Args:
        payload: Parsed JSON webhook payload

    Returns:
        Parsed push event

    Raises:
        ValueError: If payload is not a valid push event
    """
    try:
        pushed_at_str = payload.get("pushed_at", "")
        pushed_at = datetime.fromisoformat(pushed_at_str.replace("Z", "+00:00"))

        return {
            "type": "push",
            "repository": payload["repository"],
            "ref": payload["ref"],
            "before": payload["before"],
            "after": payload["after"],
            "customer_id": payload["customer_id"],
            "pushed_at": pushed_at,
            "raw_pushed_at": pushed_at_str,
        }
    except (KeyError, ValueError) as e:
        raise ValueError(f"Invalid push event payload: {e}") from e


def _normalize_header_value(value: Optional[HeaderValue]) -> Optional[str]:
    """Normalize header values to a single string."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return None
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(value, str) and value.strip():
        return value
    return None


def _convert_webhook_payload(
    event_type: str,
    raw: Any,
) -> Dict[str, Union[bool, str, WebhookEventPayload]]:
    """Convert raw webhook payload into structured event data."""
    if event_type == "push":
        try:
            payload = parse_push_event(raw)
        except (ValueError, TypeError) as exc:
            return {"valid": False, "error": f"Invalid push payload: {exc}"}
        return {"valid": True, "payload": payload}

    fallback_payload: WebhookUnknownEvent = {"type": event_type, "raw": raw}
    return {"valid": True, "payload": fallback_payload}
