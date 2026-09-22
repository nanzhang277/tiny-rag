"""精排测试:LLM 打分降级排序、坏输出容错、智谱 rerank 结果解析、配置装配。"""
import pytest

from fakes import FakeResponse
from rag.chunking import Chunk
from rag.config import Config
from rag.rerank import LLMReranker, ZhipuReranker, build_reranker
from rag.retrieval import SearchResult


def _rs(text: str) -> SearchResult:
    return SearchResult(chunk=Chunk(text=text), score=0.0)


class ScoreFakeLLM:
    """按候选文本内容给固定分的假 LLM。"""

    def complete(self, prompt: str) -> str:
        return "9" if "好内容" in prompt else "2"


def test_llm_reranker_orders_by_score():
    rs = [_rs("差内容"), _rs("好内容")]
    out = LLMReranker(ScoreFakeLLM()).rerank("问题", rs, top_n=2)
    assert out[0].chunk.text == "好内容"
    assert out[0].score == 9.0
    assert out[1].score == 2.0


def test_llm_reranker_tolerates_unparsable_score():
    class BadLLM:
        def complete(self, prompt):
            return "我觉得还行"  # 模型没按指令给数字

    out = LLMReranker(BadLLM()).rerank("问题", [_rs("内容")], top_n=1)
    assert out[0].score == 0.0  # 抠不出分数 → 0 分沉底,不崩


def test_llm_reranker_top_n_truncates():
    rs = [_rs("甲"), _rs("乙"), _rs("丙")]
    out = LLMReranker(ScoreFakeLLM()).rerank("问题", rs, top_n=1)
    assert len(out) == 1


def test_zhipu_reranker_parses_results(monkeypatch):
    import httpx

    def fake_post(url, **kw):
        assert kw["json"]["query"] == "问题"
        return FakeResponse({"results": [
            {"index": 1, "relevance_score": 0.9},
            {"index": 0, "relevance_score": 0.1},
        ]})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("ZHIPUAI_API_KEY", "test-key")
    rs = [_rs("甲"), _rs("乙")]
    out = ZhipuReranker(Config.load(config_path="nonexistent.yaml")).rerank("问题", rs, top_n=2)
    assert out[0].chunk.text == "乙"  # index 1 → 乙,分数 0.9 排第一
    assert out[0].score == 0.9


def test_build_reranker_respects_config(monkeypatch):
    monkeypatch.setenv("ZHIPUAI_API_KEY", "test-key")
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.rerank_enabled = False
    assert build_reranker(cfg, ScoreFakeLLM()) is None
    cfg.rerank_enabled = True
    cfg.rerank_provider = "llm"
    assert isinstance(build_reranker(cfg, ScoreFakeLLM()), LLMReranker)
    cfg.rerank_provider = "zhipu"
    assert isinstance(build_reranker(cfg, ScoreFakeLLM()), ZhipuReranker)
