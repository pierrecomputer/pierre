"""Tests for CommitBuilder."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pierre_storage import GitStorage
from pierre_storage.version import get_user_agent
from pierre_storage.errors import RefUpdateError


class TestCommitBuilder:
    """Tests for CommitBuilder operations."""

    @pytest.mark.asyncio
    async def test_create_commit_with_string_file(self, git_storage_options: dict) -> None:
        """Test creating commit with string file."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"abc123","tree_sha":"def456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"000000","new_sha":"abc123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Add README",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .add_file_from_string("README.md", "# Hello World")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "abc123"
            assert result["tree_sha"] == "def456"
            assert result["target_branch"] == "main"
            assert result["ref_update"]["branch"] == "main"
            assert result["ref_update"]["new_sha"] == "abc123"

    @pytest.mark.asyncio
    async def test_create_commit_with_bytes(self, git_storage_options: dict) -> None:
        """Test creating commit with byte content."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"xyz789","tree_sha":"uvw456","target_branch":"main","pack_bytes":2048,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"abc123","new_sha":"xyz789"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Add binary file",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .add_file("data.bin", b"\x00\x01\x02\x03")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "xyz789"

    @pytest.mark.asyncio
    async def test_create_commit_with_multiple_files(self, git_storage_options: dict) -> None:
        """Test creating commit with multiple files."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"multi123","tree_sha":"multi456","target_branch":"main","pack_bytes":4096,"blob_count":3},"result":{"success":true,"status":"ok","branch":"main","old_sha":"old123","new_sha":"multi123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Multiple files",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .add_file_from_string("README.md", "# Project")
                .add_file_from_string("package.json", '{"name":"test"}')
                .add_file("data.bin", b"\x00\x01")
                .send()
            )

            assert result is not None
            assert result["blob_count"] == 3

    @pytest.mark.asyncio
    async def test_create_commit_with_delete(self, git_storage_options: dict) -> None:
        """Test creating commit with file deletion."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"del123","tree_sha":"del456","target_branch":"main","pack_bytes":512,"blob_count":0},"result":{"success":true,"status":"ok","branch":"main","old_sha":"old123","new_sha":"del123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Delete old file",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .delete_path("old-file.txt")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "del123"

    @pytest.mark.asyncio
    async def test_create_commit_with_expected_head(self, git_storage_options: dict) -> None:
        """Test creating commit with expected head SHA."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"new123","tree_sha":"new456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"expected123","new_sha":"new123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    expected_head_sha="expected123",
                    commit_message="Safe update",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .add_file_from_string("file.txt", "content")
                .send()
            )

            assert result is not None
            assert result["ref_update"]["old_sha"] == "expected123"

    @pytest.mark.asyncio
    async def test_create_commit_ref_update_failed(self, git_storage_options: dict) -> None:
        """Test handling ref update failure."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"fail123","tree_sha":"fail456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":false,"status":"rejected","reason":"conflict","branch":"main","old_sha":"old123","new_sha":"fail123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")

            with pytest.raises(RefUpdateError) as exc_info:
                await (
                    repo.create_commit(
                        target_branch="main",
                        commit_message="Should fail",
                        author={"name": "Test", "email": "test@example.com"},
                    )
                    .add_file_from_string("file.txt", "content")
                    .send()
                )

            assert exc_info.value.status == "rejected"
            assert (
                exc_info.value.reason == "rejected"
            )  # reason defaults to status when not provided

    @pytest.mark.asyncio
    async def test_create_commit_with_custom_encoding(self, git_storage_options: dict) -> None:
        """Test creating commit with custom text encoding."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"enc123","tree_sha":"enc456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"000000","new_sha":"enc123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Latin-1 file",
                    author={"name": "Test", "email": "test@example.com"},
                )
                .add_file_from_string("file.txt", "café", encoding="latin-1")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "enc123"

    @pytest.mark.asyncio
    async def test_create_commit_with_committer(self, git_storage_options: dict) -> None:
        """Test creating commit with separate committer."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"com123","tree_sha":"com456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"000000","new_sha":"com123"}}'
        )

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            # Mock stream() to return an async context manager
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            client_instance.stream = MagicMock(return_value=stream_context)

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Authored by one, committed by another",
                    author={"name": "Author", "email": "author@example.com"},
                    committer={"name": "Committer", "email": "committer@example.com"},
                )
                .add_file_from_string("file.txt", "content")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "com123"

    @pytest.mark.asyncio
    async def test_create_commit_with_base_branch(self, git_storage_options: dict) -> None:
        """Test creating commit with base_branch metadata."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"deadbeef","tree_sha":"cafebabe","target_branch":"feature/one","pack_bytes":1,"blob_count":1},"result":{"success":true,"status":"ok","branch":"feature/one","old_sha":"0000000000000000000000000000000000000000","new_sha":"deadbeef"}}'
        )

        # Capture the request to verify base_branch is included
        captured_body = None

        def capture_stream(*args, **kwargs):
            nonlocal captured_body
            content = kwargs.get("content")

            async def capture_content():
                nonlocal captured_body
                if content:
                    chunks = []
                    async for chunk in content:
                        chunks.append(chunk)
                    captured_body = b"".join(chunks).decode("utf-8")

            # Create stream context that will capture content
            stream_context = MagicMock()

            async def aenter_handler(*args, **kwargs):
                await capture_content()
                return stream_response

            stream_context.__aenter__ = AsyncMock(side_effect=aenter_handler)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            return stream_context

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            client_instance.stream = capture_stream

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="feature/one",
                    base_branch="main",
                    expected_head_sha="abc123",
                    commit_message="branch off main",
                    author={"name": "Author", "email": "author@example.com"},
                )
                .add_file_from_string("docs/base.txt", "hello")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "deadbeef"

            # Verify metadata includes base_branch
            assert captured_body is not None
            import json

            metadata_line = captured_body.split("\n")[0]
            metadata = json.loads(metadata_line)["metadata"]
            assert metadata["base_branch"] == "main"
            assert metadata["expected_head_sha"] == "abc123"
            assert metadata["target_branch"] == "feature/one"

    @pytest.mark.asyncio
    async def test_create_commit_base_branch_without_expected_head(
        self, git_storage_options: dict
    ) -> None:
        """Test creating commit with base_branch but without expected_head_sha."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        # Mock the streaming response
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"abc123","tree_sha":"def456","target_branch":"feature/one","pack_bytes":1,"blob_count":1},"result":{"success":true,"status":"ok","branch":"feature/one","old_sha":"0000000000000000000000000000000000000000","new_sha":"abc123"}}'
        )

        # Capture the request to verify base_branch is included
        captured_body = None

        def capture_stream(*args, **kwargs):
            nonlocal captured_body
            content = kwargs.get("content")

            async def capture_content():
                nonlocal captured_body
                if content:
                    chunks = []
                    async for chunk in content:
                        chunks.append(chunk)
                    captured_body = b"".join(chunks).decode("utf-8")

            # Create stream context that will capture content
            stream_context = MagicMock()

            async def aenter_handler(*args, **kwargs):
                await capture_content()
                return stream_response

            stream_context.__aenter__ = AsyncMock(side_effect=aenter_handler)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            return stream_context

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            client_instance.stream = capture_stream

            repo = await storage.create_repo(id="test-repo")
            result = await (
                repo.create_commit(
                    target_branch="feature/one",
                    base_branch="main",
                    commit_message="branch off",
                    author={"name": "Author", "email": "author@example.com"},
                )
                .add_file_from_string("docs/base.txt", "hello")
                .send()
            )

            assert result is not None
            assert result["commit_sha"] == "abc123"

            # Verify metadata includes base_branch but not expected_head_sha
            assert captured_body is not None
            import json

            metadata_line = captured_body.split("\n")[0]
            metadata = json.loads(metadata_line)["metadata"]
            assert metadata["base_branch"] == "main"
            assert "expected_head_sha" not in metadata

    @pytest.mark.asyncio
    async def test_create_commit_ephemeral_flags_included_in_metadata(
        self, git_storage_options: dict
    ) -> None:
        """Ensure ephemeral options are forwarded in metadata."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"eph123","tree_sha":"eph456","target_branch":"feature/demo","pack_bytes":1,"blob_count":1},"result":{"success":true,"status":"ok","branch":"feature/demo","old_sha":"0000000000000000000000000000000000000000","new_sha":"eph123"}}'
        )

        captured_body = None

        def capture_stream(*args, **kwargs):
            nonlocal captured_body
            content = kwargs.get("content")

            async def capture_content():
                nonlocal captured_body
                if content:
                    chunks = []
                    async for chunk in content:
                        chunks.append(chunk)
                    captured_body = b"".join(chunks).decode("utf-8")

            stream_context = MagicMock()

            async def aenter_handler(*args, **kwargs):
                await capture_content()
                return stream_response

            stream_context.__aenter__ = AsyncMock(side_effect=aenter_handler)
            stream_context.__aexit__ = AsyncMock(return_value=None)
            return stream_context

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)
            client_instance.stream = capture_stream

            repo = await storage.create_repo(id="test-repo")
            await (
                repo.create_commit(
                    target_branch="feature/demo",
                    base_branch="feature/base",
                    ephemeral=True,
                    ephemeral_base=True,
                    commit_message="ephemeral commit",
                    author={"name": "Author", "email": "author@example.com"},
                )
                .add_file_from_string("docs/file.txt", "hello")
                .send()
            )

            assert captured_body is not None
            import json

            metadata_line = captured_body.split("\n")[0]
            metadata = json.loads(metadata_line)["metadata"]
            assert metadata["ephemeral"] is True
            assert metadata["ephemeral_base"] is True
            assert metadata["base_branch"] == "feature/base"

    @pytest.mark.asyncio
    async def test_create_commit_ephemeral_base_requires_base_branch(
        self, git_storage_options: dict
    ) -> None:
        """ephemeral_base should require base_branch."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)

            repo = await storage.create_repo(id="test-repo")

            with pytest.raises(ValueError) as exc_info:
                repo.create_commit(
                    target_branch="feature/demo",
                    commit_message="missing base branch",
                    ephemeral_base=True,
                    author={"name": "Author", "email": "author@example.com"},
                )

            assert "ephemeral_base requires base_branch" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_commit_base_branch_rejects_refs_prefix(
        self, git_storage_options: dict
    ) -> None:
        """Test that base_branch with refs/ prefix is rejected."""
        storage = GitStorage(git_storage_options)

        create_response = MagicMock()
        create_response.status_code = 200
        create_response.is_success = True
        create_response.json.return_value = {"repo_id": "test-repo"}

        with patch("httpx.AsyncClient") as mock_client:
            client_instance = mock_client.return_value.__aenter__.return_value
            client_instance.post = AsyncMock(return_value=create_response)

            repo = await storage.create_repo(id="test-repo")

            with pytest.raises(ValueError) as exc_info:
                repo.create_commit(
                    target_branch="feature/two",
                    base_branch="refs/heads/main",
                    expected_head_sha="abc123",
                    commit_message="branch",
                    author={"name": "Author", "email": "author@example.com"},
                )

            assert "must not include refs/ prefix" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_commit_includes_agent_header(self, git_storage_options: dict) -> None:
        """Test that createCommit includes Code-Storage-Agent header."""
        from unittest.mock import AsyncMock, MagicMock, patch

        storage = GitStorage(git_storage_options)

        mock_response = MagicMock()
        mock_response.json = AsyncMock(
            return_value={"repo_id": "test-repo", "url": "https://example.com/repo.git"}
        )
        mock_response.status_code = 200
        mock_response.is_success = True

        # Mock streaming response for commit
        stream_response = MagicMock()
        stream_response.is_success = True
        stream_response.status_code = 200
        stream_response.aread = AsyncMock(
            return_value=b'{"commit":{"commit_sha":"abc123","tree_sha":"def456","target_branch":"main","pack_bytes":1024,"blob_count":1},"result":{"success":true,"status":"ok","branch":"main","old_sha":"000000","new_sha":"abc123"}}'
        )

        captured_headers = None

        with patch("httpx.AsyncClient") as mock_client:
            # Setup create repo mock
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            # Setup stream mock
            stream_context = MagicMock()
            stream_context.__aenter__ = AsyncMock(return_value=stream_response)
            stream_context.__aexit__ = AsyncMock(return_value=None)

            def capture_stream(*args, **kwargs):
                nonlocal captured_headers
                captured_headers = kwargs.get("headers")
                return stream_context

            mock_client.return_value.__aenter__.return_value.stream = capture_stream

            repo = await storage.create_repo(id="test-repo")
            await (
                repo.create_commit(
                    target_branch="main",
                    commit_message="Test",
                    author={"name": "Author", "email": "author@example.com"},
                )
                .add_file_from_string("test.txt", "test")
                .send()
            )

            # Verify headers include Code-Storage-Agent
            assert captured_headers is not None
            assert "Code-Storage-Agent" in captured_headers
            assert captured_headers["Code-Storage-Agent"] == get_user_agent()
