"""编排测试:用假 provider 走通 ingest → query 全流程,并验证耗时打点。"""
import json
import logging

import pytest

from fakes import FakeEmbedding, FakeLLM
from rag.config import Config
from rag.generation import Answer
from rag.pipeline import ingest, query


def _setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "a.txt").write_text("机器学习是人工智能的一个分支。它通过数据训练模型。" * 20, encoding="utf-8")
    cfg = Config.load(config_path="nonexistent.yaml")
    return cfg, str(docs)


def test_ingest_then_query_with_fakes(tmp_path, monkeypatch):
    cfg, docs = _setup(tmp_path, monkeypatch)
    stats = ingest(docs, cfg, embedder=FakeEmbedding())
    assert stats["chunks"] > 0
    assert cfg.vectors_file.exists() and cfg.meta_file.exists()  # 持久化落地

    ans = query("什么是机器学习", cfg, embedder=FakeEmbedding(), llm=FakeLLM(), reranker=None)
    assert isinstance(ans, Answer)
    assert ans.text
    assert ans.used_chunks  # 离线库虽小,检索总能命中至少一块


def test_ingest_empty_dir_raises(tmp_path, monkeypatch):
    cfg, _ = _setup(tmp_path, monkeypatch)
    (tmp_path / "empty").mkdir()
    with pytest.raises(ValueError):
        ingest(str(tmp_path / "empty"), cfg, embedder=FakeEmbedding())


def test_query_logs_stage_timings(tmp_path, monkeypatch, caplog):
    cfg, docs = _setup(tmp_path, monkeypatch)
    ingest(docs, cfg, embedder=FakeEmbedding())
    with caplog.at_level(logging.INFO, logger="rag"):
        query("什么是机器学习", cfg, embedder=FakeEmbedding(), llm=FakeLLM(), reranker=None)
    stages = [json.loads(r.message)["stage"] for r in caplog.records]
    assert "retrieval" in stages
    assert "query_total" in stages


def test_query_without_reranker_assembles_from_config(tmp_path, monkeypatch):
    cfg, docs = _setup(tmp_path, monkeypatch)
    ingest(docs, cfg, embedder=FakeEmbedding())
    calls = {}

    class SpyReranker:
        def rerank(self, q, results, top_n):
            calls["top_n"] = top_n
            return results

    monkeypatch.setattr("rag.pipeline.build_reranker", lambda c, l: SpyReranker())
    query("什么是机器学习", cfg, embedder=FakeEmbedding(), llm=FakeLLM())  # 不传 reranker
    assert calls["top_n"] == cfg.rerank_top_n  # _AUTO:按配置装配并参与流水线
