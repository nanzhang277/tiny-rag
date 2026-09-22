"""生成模块测试:Prompt 组装、超长丢弃、SSE 解析、空结果、重试。全部离线。"""
import httpx
import pytest

from fakes import FakeResponse
from rag.chunking import Chunk
from rag.config import Config
from rag.generation import (
    GLMClient,
    answer_question,
    build_context,
    parse_sse_line,
)
from rag.retrieval import SearchResult


def _rs(text: str, score: float) -> SearchResult:
    return SearchResult(chunk=Chunk(text=text), score=score)


def test_build_context_numbers_blocks():
    ctx = build_context([_rs("甲内容", 0.9), _rs("乙内容", 0.8)], max_chars=10_000)
    assert ctx == "[1] 甲内容\n\n[2] 乙内容"


def test_build_context_drops_lowest_score_when_too_long():
    rs = [_rs("长" * 60, 0.9), _rs("短", 0.5)]
    ctx = build_context(rs, max_chars=80)
    # 组装超限 → 从尾部(得分最低)开始丢 → 只剩第一条且能装下
    assert ctx == "[1] " + "长" * 60


def test_build_context_all_dropped_returns_placeholder():
    assert build_context([_rs("超" * 500, 1.0)], max_chars=10) == ""


def test_parse_sse_line():
    assert parse_sse_line('data: {"choices":[{"delta":{"content":"你"}}]}') == "你"
    assert parse_sse_line("data: [DONE]") is None
    assert parse_sse_line(": keep-alive") is None
    assert parse_sse_line("data: not-json") is None
    assert parse_sse_line('data: {"choices":[{"delta":{}}]}') is None


def test_answer_question_empty_results():
    ans = answer_question(GLMClient(Config.load(config_path="nonexistent.yaml")), "问题", [])
    assert "没有相关内容" in ans.text  # 空检索如实告知,不硬编
    assert ans.used_chunks == []


def test_answer_question_passes_context_to_llm():
    captured = {}

    class FakeLLM:
        def complete(self, prompt):
            captured["prompt"] = prompt
            return "依据资料[1]的回答"

    ans = answer_question(FakeLLM(), "什么是RAG", [_rs("证据内容", 1.0)])
    assert "证据内容" in captured["prompt"]
    assert "什么是RAG" in captured["prompt"]
    assert ans.text == "依据资料[1]的回答"
    assert ans.used_chunks[0].chunk.text == "证据内容"


def test_complete_retries_on_network_error(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, **kw):
        calls["n"] += 1
        if calls["n"] < 2:
            raise httpx.ConnectError("boom")
        return FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.max_retries = 2
    cfg.api_key = "fake-key"  # 本地测试环境没有真实 key,注入假 key 才能走到出网逻辑
    assert GLMClient(cfg).complete("hi") == "ok"
    assert calls["n"] == 2
