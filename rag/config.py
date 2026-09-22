"""配置管理:YAML 文件 + 环境变量两层。

设计要点(教学):
- 配置 = "所有可能要改的参数"的集中地。换模型、调切块大小,都只改配置不改代码。
- 两层配置:YAML 存默认值(可入库,不含密钥);环境变量只存密钥(永不入库)。
- API key 只从环境变量 ZHIPUAI_API_KEY 读取 —— 这是密钥安全的底线。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


class MissingAPIKeyError(RuntimeError):
    """API key 未配置。报错信息直接告诉用户怎么修,而不是甩一个堆栈。"""


@dataclass
class Config:
    """整个系统的全部可调参数。字段默认值与 config.yaml 保持一致。"""

    # 模型
    llm_model: str = "glm-4-flash"
    temperature: float = 0.1
    max_output_tokens: int = 1024
    max_context_chars: int = 4000
    embedding_model: str = "embedding-3"
    embedding_batch_size: int = 16
    embedding_dimensions: int = 1024
    rerank_provider: str = "zhipu"  # zhipu | llm
    rerank_model: str = "glm-rerank"
    rerank_top_n: int = 5

    # 检索
    vector_top_k: int = 10
    bm25_top_k: int = 10
    rrf_k: int = 60
    rerank_enabled: bool = True

    # 切块
    chunking_strategy: str = "recursive"  # fixed | recursive
    chunk_size: int = 500
    chunk_overlap: int = 50

    # 路径
    vectors_file: Path = Path("data/vectors.npz")
    meta_file: Path = Path("data/meta.jsonl")

    # API 客户端
    api_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    timeout_seconds: int = 60
    max_retries: int = 3

    api_key: str = field(default="", repr=False)  # 只来自环境变量,repr 中隐藏

    @classmethod
    def load(cls, config_path: str | Path | None = None) -> "Config":
        """加载配置:代码默认值 → YAML 覆盖 → 环境变量注入密钥。"""
        cfg = cls()
        path = Path(config_path) if config_path else _default_config_path()
        if path.exists():
            with open(path, encoding="utf-8") as f:
                _apply(cfg, yaml.safe_load(f) or {})
        cfg.api_key = os.environ.get("ZHIPUAI_API_KEY", "")
        return cfg

    def require_api_key(self) -> str:
        """需要出网时才检查 key,缺 key 时给出可操作的提示。"""
        if not self.api_key:
            raise MissingAPIKeyError(
                "未检测到 API key。请先设置环境变量:export ZHIPUAI_API_KEY=<你的智谱 key>"
            )
        return self.api_key


# YAML 键路径 → Config 字段名。显式映射表:新增配置项在这里登记一行,
# 不用魔法自动绑定 —— 显式比聪明好维护。
_YAML_FIELDS: dict[str, str] = {
    "llm.model": "llm_model",
    "llm.temperature": "temperature",
    "llm.max_output_tokens": "max_output_tokens",
    "llm.max_context_chars": "max_context_chars",
    "embedding.model": "embedding_model",
    "embedding.batch_size": "embedding_batch_size",
    "embedding.dimensions": "embedding_dimensions",
    "rerank.provider": "rerank_provider",
    "rerank.model": "rerank_model",
    "rerank.top_n": "rerank_top_n",
    "retrieval.vector_top_k": "vector_top_k",
    "retrieval.bm25_top_k": "bm25_top_k",
    "retrieval.rrf_k": "rrf_k",
    "chunking.strategy": "chunking_strategy",
    "chunking.size": "chunk_size",
    "chunking.overlap": "chunk_overlap",
    "rerank_enabled": "rerank_enabled",
    "paths.vectors_file": "vectors_file",
    "paths.meta_file": "meta_file",
    "api.base_url": "api_base_url",
    "api.timeout_seconds": "timeout_seconds",
    "api.max_retries": "max_retries",
}


def _apply(cfg: Config, raw: dict) -> None:
    """把 YAML 字典按映射表写入 Config,并做类型对齐(Path/bool/数值)。"""
    for key_path, field_name in _YAML_FIELDS.items():
        node: object = raw
        for part in key_path.split("."):
            if not isinstance(node, dict) or part not in node:
                break
            node = node[part]
        else:
            current = getattr(cfg, field_name)
            if isinstance(current, Path):
                value = Path(str(node))
            elif isinstance(current, bool):
                value = bool(node)
            else:
                value = type(current)(node)
            setattr(cfg, field_name, value)


def _default_config_path() -> Path:
    """默认配置在项目根(与 rag 包同级的 config.yaml),与 cwd 无关。"""
    return Path(__file__).resolve().parent.parent / "config.yaml"
