"""Version information for Pierre Storage SDK."""

PACKAGE_NAME = "code-storage-py-sdk"
PACKAGE_VERSION = "0.12.1"


def get_user_agent() -> str:
    """Get user agent string for API requests.

    Returns:
        User agent string in format: {name}/{version}
    """
    return f"{PACKAGE_NAME}/{PACKAGE_VERSION}"
