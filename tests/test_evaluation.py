"""评测测试:指标手算断言、评分 JSON 宽容解析、离线跑通对比表。"""
import json
import pathlib
import shutil

import pytest

from fakes import FakeEmbedding, FakeLLM
from rag.config import Config
from rag.evaluation import _parse_scores, load_eval_set, mrr, recall_at_k, run_eval

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_recall_at_k():
    ids = ["a", "b", "c", "d"]
    assert recall_at_k(ids, {"a", "c"}, k=2) == pytest.approx(0.5)
    assert recall_at_k(ids, {"a", "c"}, k=3) == pytest.approx(1.0)
    assert recall_at_k(ids, {"zzz"}, k=3) == 0.0
    assert recall_at_k(ids, set(), k=3) == 0.0  # 没标注就别算分


def test_mrr():
    assert mrr(["x", "a", "b"], {"a"}) == pytest.approx(0.5)
    assert mrr(["a", "x"], {"a"}) == 1.0
    assert mrr(["x", "y"], {"a"}) == 0.0


def test_parse_scores_tolerates_markdown_wrapper():
    raw = '```json\n{"faithfulness": 4, "relevance": 5}\n```'
    assert _parse_scores(raw) == {"faithfulness": 4, "relevance": 5}


def test_parse_scores_on_garbage():
    assert _parse_scores("完全不是 JSON") == {"faithfulness": 0, "relevance": 0}


def test_load_eval_set_validates_schema():
    items = load_eval_set()
    assert len(items) >= 5
    for it in items:
        assert {"question", "answer", "source"} <= set(it)


def test_run_eval_offline_with_fakes(tmp_path, monkeypatch):
    """假 embedding + 假 LLM 离线跑通全部组合,只验证'表能出来'。"""
    monkeypatch.chdir(tmp_path)
    shutil.copytree(ROOT / "data" / "docs", tmp_path / "data" / "docs")
    shutil.copytree(ROOT / "data" / "eval", tmp_path / "data" / "eval")
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.rerank_enabled = False  # 离线无 rerank 服务,走 None 分支
    table = run_eval(cfg, embedder=FakeEmbedding(), llm=FakeLLM())
    assert "recall@5" in table and "MRR" in table
    assert "faithfulness" in table and "relevance" in table
