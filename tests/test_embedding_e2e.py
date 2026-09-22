"""真实调用智谱 embedding 的冒烟测试。默认跳过:
设 TINY_RAG_E2E=1 且 ZHIPUAI_API_KEY 存在时才会运行。"""
import os

import numpy as np
import pytest

from rag.config import Config
from rag.embedding import ZhipuEmbedding

pytestmark = pytest.mark.skipif(
    not (os.environ.get("TINY_RAG_E2E") and os.environ.get("ZHIPUAI_API_KEY")),
    reason="端到端冒烟需真实 key:设 TINY_RAG_E2E=1 与 ZHIPUAI_API_KEY 后开启",
)


def test_real_embedding():
    cfg = Config.load()
    vec = ZhipuEmbedding(cfg).embed_texts(["你好，世界"])
    assert vec.shape == (1, cfg.embedding_dimensions)
