"""Pierre Git Storage SDK for Python.

A Python SDK for interacting with Pierre's git storage system.
"""

from pierre_storage.auth import generate_jwt
from pierre_storage.client import GitStorage, create_client
from pierre_storage.errors import ApiError, RefUpdateError
from pierre_storage.types import (
    BaseRepo,
    BranchInfo,
    CommitInfo,
    CommitResult,
    CommitSignature,
    CreateBranchResult,
    DeleteRepoResult,
    DiffFileState,
    DiffStats,
    FileDiff,
    FilteredFile,
    GetBranchDiffResult,
    GetCommitDiffResult,
    GitStorageOptions,
    GrepFileMatch,
    GrepLine,
    GrepResult,
    ListBranchesResult,
    ListCommitsResult,
    ListFilesResult,
    ListReposResult,
    NoteReadResult,
    NoteWriteResult,
    RefUpdate,
    Repo,
    RepoInfo,
    RestoreCommitResult,
)
from pierre_storage.version import PACKAGE_VERSION
from pierre_storage.webhook import (
    WebhookPushEvent,
    parse_signature_header,
    validate_webhook,
    validate_webhook_signature,
)

__version__ = PACKAGE_VERSION

__all__ = [
    # Main client
    "GitStorage",
    "create_client",
    # Auth
    "generate_jwt",
    # Errors
    "ApiError",
    "RefUpdateError",
    # Types
    "BaseRepo",
    "BranchInfo",
    "CreateBranchResult",
    "CommitInfo",
    "CommitResult",
    "CommitSignature",
    "DeleteRepoResult",
    "DiffFileState",
    "DiffStats",
    "FileDiff",
    "FilteredFile",
    "GetBranchDiffResult",
    "GetCommitDiffResult",
    "GrepFileMatch",
    "GrepLine",
    "GrepResult",
    "GitStorageOptions",
    "ListBranchesResult",
    "ListCommitsResult",
    "ListFilesResult",
    "ListReposResult",
    "NoteReadResult",
    "NoteWriteResult",
    "RefUpdate",
    "RepoInfo",
    "Repo",
    "RestoreCommitResult",
    # Webhook
    "WebhookPushEvent",
    "parse_signature_header",
    "validate_webhook",
    "validate_webhook_signature",
]
