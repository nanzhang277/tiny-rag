"""端到端冒烟:真实调用智谱 API 跑 ingest → ask。默认跳过;
设 TINY_RAG_E2E=1 且有 ZHIPUAI_API_KEY 时运行。"""
import os
import pathlib
import shutil

import pytest

from rag.config import Config
from rag.pipeline import ingest, query

SAMPLE_DOCS = pathlib.Path(__file__).resolve().parents[1] / "data" / "docs"

pytestmark = pytest.mark.skipif(
    not (os.environ.get("TINY_RAG_E2E") and os.environ.get("ZHIPUAI_API_KEY")),
    reason="端到端冒烟需真实 key:设 TINY_RAG_E2E=1 与 ZHIPUAI_API_KEY 后开启",
)


def test_ingest_then_ask(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    shutil.copytree(SAMPLE_DOCS, "data/docs")
    cfg = Config.load()  # 读项目根默认配置
    stats = ingest("data/docs", cfg)
    assert stats["chunks"] > 0

    printed: list[str] = []
    ans = query("RAG 解决了哪些问题?", cfg, stream_cb=printed.append)
    assert ans.text
    assert printed  # 流式回调确实逐段发生了
    assert "[" in ans.text  # 回答带引用标注
