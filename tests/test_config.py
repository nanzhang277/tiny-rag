"""配置管理测试:YAML 覆盖默认值、密钥只认环境变量、报错可操作。"""
import textwrap

import pytest

from rag.config import Config, MissingAPIKeyError


def test_defaults_without_yaml(tmp_path):
    """没有配置文件时全部取默认值,也能正常加载。"""
    cfg = Config.load(config_path=tmp_path / "not_exist.yaml")
    assert cfg.llm_model == "glm-4-flash"
    assert cfg.chunking_strategy == "recursive"
    assert cfg.rrf_k == 60


def test_yaml_overrides_defaults(tmp_path):
    """YAML 里的值覆盖默认值 —— 换模型只改配置不改代码。"""
    p = tmp_path / "config.yaml"
    p.write_text(
        textwrap.dedent("""
        llm:
          model: glm-4-plus
        chunking:
          size: 200
          overlap: 20
        """),
        encoding="utf-8",
    )
    cfg = Config.load(config_path=p)
    assert cfg.llm_model == "glm-4-plus"
    assert cfg.chunk_size == 200
    assert cfg.chunk_overlap == 20
    assert cfg.embedding_model == "embedding-3"  # 未覆盖的仍是默认


def test_api_key_only_from_env(tmp_path, monkeypatch):
    """API key 只来自环境变量;配置文件里写了也不认 —— 密钥不进配置层。"""
    p = tmp_path / "config.yaml"
    p.write_text("llm:\n  model: m\n", encoding="utf-8")
    monkeypatch.delenv("ZHIPUAI_API_KEY", raising=False)
    cfg = Config.load(config_path=p)
    assert cfg.api_key == ""
    with pytest.raises(MissingAPIKeyError):
        cfg.require_api_key()
    monkeypatch.setenv("ZHIPUAI_API_KEY", "test-key-123")
    assert Config.load(config_path=p).require_api_key() == "test-key-123"
