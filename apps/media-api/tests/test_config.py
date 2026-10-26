import pytest

from app.config import (ConfigError, apply_pot_policy, load_settings, parse_domains, parse_extractor_args,
                        parse_rate_limit)
from app.logging_setup import redact


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("20/minute", (20, 60)), ("5/10s", (5, 10)), ("100/hour", (100, 3600)), (" 3 / second ", (3, 1))],
)
def test_rate_limit(raw: str, expected: tuple[int, int]) -> None:
    assert parse_rate_limit(raw) == expected


@pytest.mark.parametrize("raw", ["", "20", "20/fortnight", "0/minute", "x/minute"])
def test_bad_rate_limit(raw: str) -> None:
    with pytest.raises(ConfigError):
        parse_rate_limit(raw)


def test_domains() -> None:
    assert parse_domains(" YouTube.com, youtu.be ,,x.com.") == ("youtube.com", "youtu.be", "x.com")
    with pytest.raises(ConfigError):
        parse_domains("evil.com/x")
    with pytest.raises(ConfigError):
        parse_domains(" , ")


def test_extractor_args() -> None:
    parsed = parse_extractor_args("youtubepot-bgutilhttp:base_url=http://ytapi-bgutil:4416|youtube:player_client=default,mweb")
    assert parsed == {
        "youtubepot-bgutilhttp": {"base_url": ["http://ytapi-bgutil:4416"]},
        "youtube": {"player_client": ["default", "mweb"]},
    }
    assert parse_extractor_args("") == {}


def test_token_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_TOKEN", "short")
    with pytest.raises(ConfigError):
        load_settings()
    monkeypatch.setenv("API_TOKEN", "x" * 32)
    settings = load_settings()
    assert settings.max_concurrent == 2 and settings.rate_limit == (20, 60)


def test_root_path_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_TOKEN", "x" * 32)
    monkeypatch.setenv("ROOT_PATH", "/media/")
    assert load_settings().root_path == "/media"
    monkeypatch.setenv("ROOT_PATH", "media")
    with pytest.raises(ConfigError):
        load_settings()


@pytest.mark.parametrize(
    "text",
    [
        "GET /dl?url=x&token=SECRET123 HTTP/1.1",
        "Authorization: Bearer SECRET123",
        '{"api_token": "SECRET123"}',
        "token=SECRET123",
    ],
)
def test_redaction(text: str) -> None:
    assert "SECRET123" not in redact(text)


def test_pot_policy_without_server():
    # Plugin absent: nothing added.
    assert apply_pot_policy({}, plugin_installed=False) == {}
    # Plugin baked in but no bgutil base_url: PO token fetching disabled.
    assert apply_pot_policy({}, plugin_installed=True) == {"youtube": {"fetch_pot": ["never"]}}
    # Server configured: untouched.
    configured = parse_extractor_args("youtubepot-bgutilhttp:base_url=http://bgutil-pot:4416")
    assert "youtube" not in apply_pot_policy(configured, plugin_installed=True)
    # An explicit user choice wins.
    explicit = parse_extractor_args("youtube:fetch_pot=auto;player_client=default")
    assert apply_pot_policy(explicit, plugin_installed=True)["youtube"] == {"fetch_pot": ["auto"], "player_client": ["default"]}
