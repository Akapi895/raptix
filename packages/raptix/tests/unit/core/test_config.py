"""Unit tests for raptix_core.utils.config"""

from raptix_core.utils.config import RaptixConfig, load_config


class TestRaptixConfig:
    def test_default_values(self):
        config = RaptixConfig()
        assert config.debug is False

    def test_llm_defaults(self):
        config = RaptixConfig()
        assert config.llm.proxy_url == "http://localhost:4000"
        assert config.llm.proxy_api_key == "sk-raptix-master"

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("RAPTIX_DEBUG", "true")
        config = RaptixConfig()
        assert config.debug is True


class TestLoadConfig:
    def test_returns_defaults(self):
        config = load_config()
        assert config.llm.proxy_url == "http://localhost:4000"
