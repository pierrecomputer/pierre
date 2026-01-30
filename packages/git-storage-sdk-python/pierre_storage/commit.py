"""Commit builder for Pierre Git Storage SDK."""

import base64
import json
import uuid
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

import httpx

from pierre_storage.errors import RefUpdateError, infer_ref_update_reason
from pierre_storage.types import (
    CommitResult,
    CreateCommitOptions,
    FileSource,
    GitFileMode,
    RefUpdate,
)
from pierre_storage.version import get_user_agent

MAX_CHUNK_BYTES = 4 * 1024 * 1024  # 4 MiB
DEFAULT_TTL_SECONDS = 3600  # 1 hour


def _normalize_commit_options(options: CreateCommitOptions) -> Dict[str, Any]:
    """Validate and normalize commit options."""
    normalized: Dict[str, Any] = {}

    if options is None:
        raise ValueError("createCommit options are required")

    target_branch = (options.get("target_branch") or "").strip()
    if not target_branch:
        raise ValueError("createCommit target_branch is required")
    if target_branch.startswith("refs/"):
        raise ValueError("createCommit target_branch must not include refs/ prefix")
    normalized["target_branch"] = target_branch

    commit_message = (options.get("commit_message") or "").strip()
    if not commit_message:
        raise ValueError("createCommit commit_message is required")
    normalized["commit_message"] = commit_message

    author = options.get("author")
    if not author:
        raise ValueError("createCommit author is required")
    author_name = (author.get("name") or "").strip()
    author_email = (author.get("email") or "").strip()
    if not author_name or not author_email:
        raise ValueError("createCommit author name and email are required")
    normalized["author"] = {"name": author_name, "email": author_email}

    expected_head_sha = options.get("expected_head_sha")
    if expected_head_sha:
        normalized["expected_head_sha"] = expected_head_sha.strip()

    base_branch = options.get("base_branch")
    if base_branch:
        trimmed_base = base_branch.strip()
        if not trimmed_base:
            pass
        elif trimmed_base.startswith("refs/"):
            raise ValueError("createCommit base_branch must not include refs/ prefix")
        else:
            normalized["base_branch"] = trimmed_base

    if "ephemeral" in options:
        normalized["ephemeral"] = bool(options["ephemeral"])

    if "ephemeral_base" in options:
        normalized["ephemeral_base"] = bool(options["ephemeral_base"])

    if normalized.get("ephemeral_base") and "base_branch" not in normalized:
        raise ValueError("createCommit ephemeral_base requires base_branch")

    if "committer" in options and options["committer"]:
        normalized["committer"] = options["committer"]

    if "ttl" in options and options["ttl"]:
        normalized["ttl"] = options["ttl"]

    return normalized


def _base_metadata_from_options(options: Dict[str, Any]) -> Dict[str, Any]:
    """Build common metadata fields shared by commit requests."""
    metadata: Dict[str, Any] = {
        "target_branch": options["target_branch"],
        "commit_message": options["commit_message"],
        "author": options["author"],
    }

    if options.get("expected_head_sha"):
        metadata["expected_head_sha"] = options["expected_head_sha"]

    if options.get("base_branch"):
        metadata["base_branch"] = options["base_branch"]

    if options.get("ephemeral"):
        metadata["ephemeral"] = True

    if options.get("ephemeral_base"):
        metadata["ephemeral_base"] = True

    if options.get("committer"):
        metadata["committer"] = options["committer"]

    return metadata


def _to_ref_update(result: Dict[str, Any]) -> RefUpdate:
    """Convert result payload to ref update info."""
    return {
        "branch": result.get("branch", ""),
        "old_sha": result.get("old_sha", ""),
        "new_sha": result.get("new_sha", ""),
    }


def _build_commit_result(ack: Dict[str, Any]) -> CommitResult:
    """Convert commit-pack style acknowledgment into CommitResult."""
    result = ack.get("result", {})
    ref_update = _to_ref_update(result)

    if not result.get("success"):
        raise RefUpdateError(
            result.get("message", f"Commit failed with status {result.get('status')}"),
            status=result.get("status"),
            ref_update=ref_update,
        )

    commit = ack.get("commit", {})
    return {
        "commit_sha": commit["commit_sha"],
        "tree_sha": commit["tree_sha"],
        "target_branch": commit["target_branch"],
        "pack_bytes": commit["pack_bytes"],
        "blob_count": commit["blob_count"],
        "ref_update": ref_update,
    }


async def _parse_commit_error(response: httpx.Response, operation: str) -> Dict[str, Any]:
    """Parse an error response from commit endpoints."""
    default_status = infer_ref_update_reason(str(response.status_code))
    status = default_status
    reason_phrase = response.reason_phrase or ""
    message = f"{operation} request failed ({response.status_code} {reason_phrase})".strip()
    ref_update = None

    try:
        data = await response.aread()
        json_data = json.loads(data)

        if "result" in json_data:
            result = json_data["result"]
            if result.get("status"):
                status = result["status"]
            if result.get("message"):
                message = result["message"]
            ref_update = {
                "branch": result.get("branch"),
                "old_sha": result.get("old_sha"),
                "new_sha": result.get("new_sha"),
            }
            ref_update = {k: v for k, v in (ref_update or {}).items() if v}
        elif "error" in json_data:
            message = json_data["error"]
    except Exception:
        # Preserve default message if parsing fails
        pass

    return {
        "status": status,
        "message": message,
        "ref_update": ref_update,
    }


async def _to_async_iterator(source: FileSource) -> AsyncIterator[bytes]:
    """Convert FileSource inputs into an async iterator of bytes."""
    if isinstance(source, str):
        yield source.encode("utf-8")
    elif isinstance(source, (bytes, bytearray, memoryview)):
        yield bytes(source)
    elif hasattr(source, "__aiter__"):
        async for chunk in source:
            if isinstance(chunk, str):
                yield chunk.encode("utf-8")
            else:
                yield bytes(chunk)
    elif hasattr(source, "__iter__"):
        for chunk in source:
            if isinstance(chunk, str):
                yield chunk.encode("utf-8")
            else:
                yield bytes(chunk)
    else:
        raise TypeError(f"Unsupported file source type: {type(source)}")


async def chunk_file_source(
    source: FileSource,
    chunk_size: int = MAX_CHUNK_BYTES,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield chunk dictionaries for streaming requests."""
    pending: Optional[bytes] = None
    produced = False

    async for data in _to_async_iterator(source):
        if pending and len(pending) == chunk_size:
            yield {"chunk": pending, "eof": False}
            produced = True
            pending = None

        merged = pending + data if pending else data

        while len(merged) > chunk_size:
            chunk = merged[:chunk_size]
            merged = merged[chunk_size:]
            yield {"chunk": chunk, "eof": False}
            produced = True

        pending = merged

    if pending is not None:
        yield {"chunk": pending, "eof": True}
        produced = True

    if not produced:
        yield {"chunk": b"", "eof": True}


class FileOperation:
    """Represents a file operation in a commit."""

    def __init__(
        self,
        path: str,
        content_id: str,
        operation: str,
        mode: Optional[str] = None,
        source: Optional[FileSource] = None,
    ) -> None:
        """Initialize a file operation.

        Args:
            path: File path
            content_id: Unique content identifier
            operation: Operation type ('upsert' or 'delete')
            mode: Git file mode
            source: File content source
        """
        self.path = path
        self.content_id = content_id
        self.operation = operation
        self.mode = mode
        self.source = source


class CommitBuilderImpl:
    """Implementation of commit builder for creating commits."""

    def __init__(
        self,
        options: CreateCommitOptions,
        get_auth_token: Callable[[], str],
        base_url: str,
        api_version: int,
    ) -> None:
        """Initialize the commit builder.

        Args:
            options: Commit options
            get_auth_token: Function to get auth token
            base_url: API base URL
            api_version: API version

        Raises:
            ValueError: If required options are missing or invalid
        """
        self.get_auth_token = get_auth_token
        self.url = f"{base_url.rstrip('/')}/api/v{api_version}/repos/commit-pack"
        self.operations: List[FileOperation] = []
        self.sent = False

        self.options = _normalize_commit_options(options)

    def add_file(
        self,
        path: str,
        source: FileSource,
        *,
        mode: Optional[GitFileMode] = None,
    ) -> "CommitBuilderImpl":
        """Add a file to the commit.

        Args:
            path: File path
            source: File content source
            mode: Git file mode (default: regular file)

        Returns:
            Self for chaining

        Raises:
            RuntimeError: If builder has already been sent
        """
        self._ensure_not_sent()
        normalized_path = self._normalize_path(path)
        content_id = str(uuid.uuid4())
        file_mode = mode or GitFileMode.REGULAR

        self.operations.append(
            FileOperation(
                path=normalized_path,
                content_id=content_id,
                operation="upsert",
                mode=file_mode,
                source=source,
            )
        )
        return self

    def add_file_from_string(
        self,
        path: str,
        contents: str,
        *,
        encoding: str = "utf-8",
        mode: Optional[GitFileMode] = None,
    ) -> "CommitBuilderImpl":
        """Add a file from a string.

        Args:
            path: File path
            contents: File contents as string
            encoding: Text encoding (default: utf-8)
            mode: Git file mode (default: regular file)

        Returns:
            Self for chaining
        """
        data = contents.encode(encoding)
        return self.add_file(path, data, mode=mode)

    def delete_path(self, path: str) -> "CommitBuilderImpl":
        """Delete a path from the commit.

        Args:
            path: Path to delete

        Returns:
            Self for chaining

        Raises:
            RuntimeError: If builder has already been sent
        """
        self._ensure_not_sent()
        normalized_path = self._normalize_path(path)
        self.operations.append(
            FileOperation(
                path=normalized_path,
                content_id=str(uuid.uuid4()),
                operation="delete",
            )
        )
        return self

    async def send(self) -> CommitResult:
        """Send the commit to the server.

        Returns:
            Commit result with SHA and ref update info

        Raises:
            RuntimeError: If builder has already been sent
            RefUpdateError: If commit fails
        """
        self._ensure_not_sent()
        self.sent = True

        metadata = self._build_metadata()
        auth_token = self.get_auth_token()

        headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/x-ndjson",
            "Accept": "application/json",
            "Code-Storage-Agent": get_user_agent(),
        }

        async with (
            httpx.AsyncClient() as client,
            client.stream(
                "POST",
                self.url,
                headers=headers,
                content=self._build_request_body(metadata),
                timeout=180.0,
            ) as response,
        ):
            if not response.is_success:
                error_info = await _parse_commit_error(response, "createCommit")
                raise RefUpdateError(
                    error_info["message"],
                    status=error_info["status"],
                    reason=error_info["status"],
                    ref_update=error_info.get("ref_update"),
                )

            result_data = await response.aread()
            result = json.loads(result_data)
            return _build_commit_result(result)

    def _build_metadata(self) -> Dict[str, Any]:
        """Build metadata payload for commit."""
        files = []
        for op in self.operations:
            file_entry: Dict[str, Any] = {
                "path": op.path,
                "content_id": op.content_id,
                "operation": op.operation,
            }
            if op.mode:
                file_entry["mode"] = op.mode
            files.append(file_entry)

        metadata = _base_metadata_from_options(self.options)
        metadata["files"] = files
        return metadata

    async def _build_request_body(self, metadata: Dict[str, Any]) -> AsyncIterator[bytes]:
        """Build NDJSON request body with metadata and blob chunks."""
        # First line: metadata
        yield json.dumps({"metadata": metadata}).encode("utf-8") + b"\n"

        # Subsequent lines: blob chunks
        for op in self.operations:
            if op.operation == "upsert" and op.source is not None:
                async for chunk in chunk_file_source(op.source):
                    blob_chunk = {
                        "blob_chunk": {
                            "content_id": op.content_id,
                            "data": base64.b64encode(chunk["chunk"]).decode("ascii"),
                            "eof": chunk["eof"],
                        }
                    }
                    yield json.dumps(blob_chunk).encode("utf-8") + b"\n"

    def _ensure_not_sent(self) -> None:
        """Ensure the builder hasn't been sent yet."""
        if self.sent:
            raise RuntimeError("createCommit builder cannot be reused after send()")

    def _normalize_path(self, path: str) -> str:
        """Normalize a file path."""
        if not path or not isinstance(path, str) or not path.strip():
            raise ValueError("File path must be a non-empty string")
        return path.lstrip("/")


async def send_diff_commit_request(
    options: CreateCommitOptions,
    diff_source: FileSource,
    get_auth_token: Callable[[], str],
    base_url: str,
    api_version: int,
) -> CommitResult:
    """Send a diff-based commit request."""
    normalized_options = _normalize_commit_options(options)
    metadata = _base_metadata_from_options(normalized_options)

    auth_token = get_auth_token()
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/x-ndjson",
        "Accept": "application/json",
        "Code-Storage-Agent": get_user_agent(),
    }

    async def request_stream() -> AsyncIterator[bytes]:
        yield json.dumps({"metadata": metadata}).encode("utf-8") + b"\n"
        async for chunk in chunk_file_source(diff_source):
            payload = {
                "diff_chunk": {
                    "data": base64.b64encode(chunk["chunk"]).decode("ascii"),
                    "eof": chunk["eof"],
                }
            }
            yield json.dumps(payload).encode("utf-8") + b"\n"

    url = f"{base_url.rstrip('/')}/api/v{api_version}/repos/diff-commit"

    async with (
        httpx.AsyncClient() as client,
        client.stream(
            "POST",
            url,
            headers=headers,
            content=request_stream(),
            timeout=180.0,
        ) as response,
    ):
        if not response.is_success:
            error_info = await _parse_commit_error(response, "createCommitFromDiff")
            raise RefUpdateError(
                error_info["message"],
                status=error_info["status"],
                reason=error_info["status"],
                ref_update=error_info.get("ref_update"),
            )

        result_data = await response.aread()
        result = json.loads(result_data)
        return _build_commit_result(result)


def resolve_commit_ttl_seconds(options: Optional[CreateCommitOptions]) -> int:
    """Resolve TTL for commit operations."""
    if options and "ttl" in options:
        ttl = options["ttl"]
        if ttl and ttl > 0:
            return ttl
    return DEFAULT_TTL_SECONDS
