"""Main client for Pierre Git Storage SDK."""

import uuid
from typing import Any, Dict, Optional, cast
from urllib.parse import urlencode

import httpx

from pierre_storage.auth import generate_jwt
from pierre_storage.errors import ApiError
from pierre_storage.repo import DEFAULT_TOKEN_TTL_SECONDS, RepoImpl
from pierre_storage.types import (
    BaseRepo,
    DeleteRepoResult,
    ForkBaseRepo,
    GitHubBaseRepo,
    GitStorageOptions,
    ListReposResult,
    Repo,
    RepoInfo,
)
from pierre_storage.version import get_user_agent

DEFAULT_API_BASE_URL = "https://api.{{org}}.code.storage"
DEFAULT_STORAGE_BASE_URL = "{{org}}.code.storage"
DEFAULT_API_VERSION = 1


class GitStorage:
    """Pierre Git Storage client."""

    def __init__(self, options: GitStorageOptions) -> None:
        """Initialize GitStorage client.

        Args:
            options: Client configuration options

        Raises:
            ValueError: If required options are missing or invalid
        """
        # Validate required fields
        if not options or "name" not in options or "key" not in options:
            raise ValueError(
                "GitStorage requires a name and key. Please check your configuration and try again."
            )

        name = options["name"]
        key = options["key"]

        if name is None or key is None:
            raise ValueError(
                "GitStorage requires a name and key. Please check your configuration and try again."
            )

        if not isinstance(name, str) or not name.strip():
            raise ValueError("GitStorage name must be a non-empty string.")

        if not isinstance(key, str) or not key.strip():
            raise ValueError("GitStorage key must be a non-empty string.")

        # Resolve configuration
        api_base_url = options.get("api_base_url") or self.get_default_api_base_url(name)
        storage_base_url = options.get("storage_base_url") or self.get_default_storage_base_url(
            name
        )
        api_version = options.get("api_version") or DEFAULT_API_VERSION
        default_ttl = options.get("default_ttl")

        self.options: GitStorageOptions = {
            "name": name,
            "key": key,
            "api_base_url": api_base_url,
            "storage_base_url": storage_base_url,
            "api_version": api_version,
        }

        if default_ttl:
            self.options["default_ttl"] = default_ttl

    @staticmethod
    def get_default_api_base_url(name: str) -> str:
        """Get default API base URL with org name inserted.

        Args:
            name: Organization name

        Returns:
            API base URL with org name inserted
        """
        return DEFAULT_API_BASE_URL.replace("{{org}}", name)

    @staticmethod
    def get_default_storage_base_url(name: str) -> str:
        """Get default storage base URL with org name inserted.

        Args:
            name: Organization name

        Returns:
            Storage base URL with org name inserted
        """
        return DEFAULT_STORAGE_BASE_URL.replace("{{org}}", name)

    async def create_repo(
        self,
        *,
        id: Optional[str] = None,
        default_branch: Optional[str] = None,
        base_repo: Optional[BaseRepo] = None,
        ttl: Optional[int] = None,
    ) -> Repo:
        """Create a new repository.

        Args:
            id: Repository ID (auto-generated if not provided)
            default_branch: Default branch name (default: "main" for non-forks)
            base_repo: Optional base repository for GitHub sync or fork
                       GitHub: owner, name, default_branch
                       Fork: id, ref, sha
            ttl: Token TTL in seconds

        Returns:
            Created repository instance

        Raises:
            ApiError: If repository creation fails
        """
        repo_id = id or str(uuid.uuid4())
        ttl = ttl or DEFAULT_TOKEN_TTL_SECONDS
        jwt = self._generate_jwt(
            repo_id,
            {"permissions": ["repo:write"], "ttl": ttl},
        )

        url = f"{self.options['api_base_url']}/api/v{self.options['api_version']}/repos"
        body: Dict[str, Any] = {}

        # Match backend priority: base_repo.default_branch > default_branch > 'main'
        explicit_default_branch = default_branch is not None
        resolved_default_branch: Optional[str] = None

        if base_repo:
            if "id" in base_repo:
                fork_repo = cast(ForkBaseRepo, base_repo)
                base_repo_token = self._generate_jwt(
                    fork_repo["id"],
                    {"permissions": ["git:read"], "ttl": ttl},
                )
                base_repo_payload: Dict[str, Any] = {
                    "provider": "code",
                    "owner": self.options["name"],
                    "name": fork_repo["id"],
                    "operation": "fork",
                    "auth": {"token": base_repo_token},
                }
                if fork_repo.get("ref"):
                    base_repo_payload["ref"] = fork_repo["ref"]
                if fork_repo.get("sha"):
                    base_repo_payload["sha"] = fork_repo["sha"]
                body["base_repo"] = base_repo_payload
                if explicit_default_branch:
                    resolved_default_branch = default_branch
                    body["default_branch"] = default_branch
            else:
                github_repo = cast(GitHubBaseRepo, base_repo)
                # Ensure provider is set to 'github' if not provided
                base_repo_with_provider = {
                    "provider": "github",
                    **github_repo,
                }
                body["base_repo"] = base_repo_with_provider
                if github_repo.get("default_branch"):
                    resolved_default_branch = github_repo["default_branch"]
                elif explicit_default_branch:
                    resolved_default_branch = default_branch
                else:
                    resolved_default_branch = "main"
                body["default_branch"] = resolved_default_branch
        else:
            resolved_default_branch = default_branch if explicit_default_branch else "main"
            body["default_branch"] = resolved_default_branch

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Content-Type": "application/json",
                    "Code-Storage-Agent": get_user_agent(),
                },
                json=body,
                timeout=30.0,
            )

            if response.status_code == 409:
                raise ApiError("Repository already exists", status_code=409)

            if not response.is_success:
                raise ApiError(
                    f"Failed to create repository: {response.status_code} {response.reason_phrase}",
                    status_code=response.status_code,
                    response=response,
                )

        # These are guaranteed to be set in __init__
        api_base_url: str = self.options["api_base_url"]  # type: ignore[assignment]
        storage_base_url: str = self.options["storage_base_url"]  # type: ignore[assignment]
        name: str = self.options["name"]
        api_version: int = self.options["api_version"]  # type: ignore[assignment]

        return RepoImpl(
            repo_id,
            resolved_default_branch or "main",
            api_base_url,
            storage_base_url,
            name,
            api_version,
            self._generate_jwt,
        )

    async def list_repos(
        self,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        ttl: Optional[int] = None,
    ) -> ListReposResult:
        """List repositories for the organization."""
        ttl = ttl or DEFAULT_TOKEN_TTL_SECONDS
        jwt = self._generate_jwt(
            "org",
            {"permissions": ["org:read"], "ttl": ttl},
        )

        params: Dict[str, str] = {}
        if cursor:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = str(limit)

        url = f"{self.options['api_base_url']}/api/v{self.options['api_version']}/repos"
        if params:
            url += f"?{urlencode(params)}"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Code-Storage-Agent": get_user_agent(),
                },
                timeout=30.0,
            )

            if not response.is_success:
                raise ApiError(
                    f"Failed to list repositories: {response.status_code} {response.reason_phrase}",
                    status_code=response.status_code,
                    response=response,
                )

            data = response.json()
            repos: list[RepoInfo] = []
            for repo in data.get("repos", []):
                entry: RepoInfo = {
                    "repo_id": repo.get("repo_id", ""),
                    "url": repo.get("url", ""),
                    "default_branch": repo.get("default_branch", "main"),
                    "created_at": repo.get("created_at", ""),
                }
                if repo.get("base_repo"):
                    entry["base_repo"] = repo.get("base_repo")
                repos.append(entry)

            return {
                "repos": repos,
                "next_cursor": data.get("next_cursor"),
                "has_more": data.get("has_more", False),
            }

    async def find_one(self, *, id: str) -> Optional[Repo]:
        """Find a repository by ID.

        Args:
            id: Repository ID to find

        Returns:
            Repository instance if found, None otherwise
        """
        repo_id = id
        jwt = self._generate_jwt(
            repo_id,
            {"permissions": ["git:read"], "ttl": DEFAULT_TOKEN_TTL_SECONDS},
        )

        url = f"{self.options['api_base_url']}/api/v{self.options['api_version']}/repo"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Code-Storage-Agent": get_user_agent(),
                },
                timeout=30.0,
            )

            if response.status_code == 404:
                return None

            if not response.is_success:
                raise ApiError(
                    f"Failed to find repository: {response.status_code} {response.reason_phrase}",
                    status_code=response.status_code,
                    response=response,
                )

            body = response.json()
            default_branch = body.get("default_branch", "main")

        # These are guaranteed to be set in __init__
        api_base_url: str = self.options["api_base_url"]  # type: ignore[assignment]
        storage_base_url: str = self.options["storage_base_url"]  # type: ignore[assignment]
        name: str = self.options["name"]
        api_version: int = self.options["api_version"]  # type: ignore[assignment]

        return RepoImpl(
            repo_id,
            default_branch,
            api_base_url,
            storage_base_url,
            name,
            api_version,
            self._generate_jwt,
        )

    async def delete_repo(
        self,
        *,
        id: str,
        ttl: Optional[int] = None,
    ) -> DeleteRepoResult:
        """Delete a repository by ID.

        Args:
            id: Repository ID to delete
            ttl: Token TTL in seconds

        Returns:
            Deletion result with repo_id and message

        Raises:
            ApiError: If repository not found or already deleted
        """
        repo_id = id
        ttl = ttl or DEFAULT_TOKEN_TTL_SECONDS
        jwt = self._generate_jwt(
            repo_id,
            {"permissions": ["repo:write"], "ttl": ttl},
        )

        url = f"{self.options['api_base_url']}/api/v{self.options['api_version']}/repos/delete"

        async with httpx.AsyncClient() as client:
            response = await client.delete(
                url,
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Content-Type": "application/json",
                    "Code-Storage-Agent": get_user_agent(),
                },
                timeout=30.0,
            )

            if response.status_code == 404:
                raise ApiError("Repository not found", status_code=404)

            if response.status_code == 409:
                raise ApiError("Repository already deleted", status_code=409)

            if not response.is_success:
                raise ApiError(
                    f"Failed to delete repository: {response.status_code} {response.reason_phrase}",
                    status_code=response.status_code,
                    response=response,
                )

            body = response.json()
            return DeleteRepoResult(
                repo_id=body["repo_id"],
                message=body["message"],
            )

    def get_config(self) -> GitStorageOptions:
        """Get current client configuration.

        Returns:
            Copy of current configuration
        """
        return {**self.options}

    def _generate_jwt(
        self,
        repo_id: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Generate JWT token for authentication.

        Args:
            repo_id: Repository identifier
            options: JWT generation options (internal use)

        Returns:
            Signed JWT token
        """
        permissions = ["git:write", "git:read"]
        ttl: int = 31536000  # 1 year default

        if options:
            if "permissions" in options:
                permissions = options["permissions"]
            if "ttl" in options:
                option_ttl = options["ttl"]
                if isinstance(option_ttl, int):
                    ttl = option_ttl
        elif "default_ttl" in self.options:
            default_ttl = self.options["default_ttl"]
            if isinstance(default_ttl, int):
                ttl = default_ttl

        return generate_jwt(
            self.options["key"],
            self.options["name"],
            repo_id,
            permissions,
            ttl,
        )


def create_client(options: GitStorageOptions) -> GitStorage:
    """Create a GitStorage client.

    Args:
        options: Client configuration options

    Returns:
        GitStorage client instance
    """
    return GitStorage(options)
