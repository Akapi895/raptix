from __future__ import annotations

import pytest
from pydantic import ValidationError

from raptix.execution.tools.webshell.profile import WebShellProfile, normalize_target


def _profile(**overrides):
    data = {
        "provider": "http-form-command",
        "target": "10.129.88.4",
        "endpoint": "http://10.129.88.4/dev/phpbash.php",
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "command_parameter": "cmd",
        "probe_command": "id;hostname",
        "probe_pattern": "uid=33",
        "expected_user": "www-data",
    }
    data.update(overrides)
    return data


def test_valid_profile_normalizes_target():
    profile = WebShellProfile.model_validate(_profile(target="10.129.88.4"))
    assert profile.target == "10.129.88.4"
    assert normalize_target("[::1]") == "::1"


@pytest.mark.parametrize(
    "overrides",
    [
        {"endpoint": "http://10.129.88.5/dev/phpbash.php"},
        {"endpoint": "ftp://10.129.88.4/dev/phpbash.php"},
        {"endpoint": "http://user:pass@10.129.88.4/dev/phpbash.php"},
        {"endpoint": "http://10.129.88.4/dev/phpbash.php#fragment"},
        {"target": "http://10.129.88.4"},
        {"target": "10.129.88.4:8080"},
        {"command_parameter": "cmd;id"},
        {"probe_pattern": "a,b"},
        {"probe_pattern": ".*"},
        {"headers": {"X-Forwarded-For": "127.0.0.1"}},
        {"headers": {"Content-Type": "application/json"}},
        {"headers": {"User-Agent": "ok\r\nX-Evil: 1"}},
        {"extra": True},
    ],
)
def test_rejects_invalid_profiles(overrides):
    with pytest.raises(ValidationError):
        WebShellProfile.model_validate(_profile(**overrides))


def test_allows_only_allowlisted_headers():
    profile = WebShellProfile.model_validate(
        _profile(
            headers={"User-Agent": "raptix", "Content-Type": "application/x-www-form-urlencoded"}
        )
    )
    items = dict(profile.header_items())
    assert items["User-Agent"] == "raptix"
    assert items["Content-Type"] == "application/x-www-form-urlencoded"


def test_ipv6_endpoint_matches_bracketed_target():
    profile = WebShellProfile.model_validate(
        _profile(target="[::1]", endpoint="http://[::1]:8080/shell.php")
    )
    assert profile.target == "::1"
