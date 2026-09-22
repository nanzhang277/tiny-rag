"""重排(Rerank):用更重的模型对初筛结果精排。

为什么"检索 ≠ 排序"? 初筛(embedding 双塔 / BM25 词频)是"快而糙"的打分,
对几百个候选各打一个粗分;rerank 是"慢而准"的交叉打分 —— 把(问题,候选)
成对喂给模型细看。先用便宜的初筛缩小范围,再花贵价精排,是性价比套路。

两档实现:
1. ZhipuReranker:智谱 rerank API(首选,一次请求批量打分)。
2. LLMReranker:降级方案,没有 rerank 服务时让 chat 模型逐候选打 0-10 分
   (慢,但任何能聊天的模型都能当 reranker)。
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod

import httpx

from rag.config import Config
from rag.generation import GLMClient
from rag.retry import with_retries
from rag.retrieval import SearchResult


class BaseReranker(ABC):
    """精排器接口。rerank(query, results) 返回按新分数降序的子集。"""

    @abstractmethod
    def rerank(self, query: str, results: list[SearchResult], top_n: int) -> list[SearchResult]: ...


class ZhipuReranker(BaseReranker):
    """智谱 rerank 实现:一次请求对全部候选批量打相关性分。"""

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def rerank(self, query: str, results: list[SearchResult], top_n: int) -> list[SearchResult]:
        if not results:
            return []
        docs = [sr.chunk.text for sr in results]

        def call() -> list[tuple[int, float]]:
            resp = httpx.post(
                f"{self.cfg.api_base_url}/rerank",
                headers={"Authorization": f"Bearer {self.cfg.require_api_key()}"},
                json={"model": self.cfg.rerank_model, "query": query, "documents": docs},
                timeout=self.cfg.timeout_seconds,
            )
            resp.raise_for_status()
            return [(d["index"], d["relevance_score"]) for d in resp.json()["results"]]

        pairs = with_retries(call, stage="rerank", max_retries=self.cfg.max_retries)
        pairs.sort(key=lambda p: -p[1])
        return [SearchResult(chunk=results[i].chunk, score=s) for i, s in pairs[:top_n]]


class LLMReranker(BaseReranker):
    """降级方案:用 chat 模型逐候选打 0-10 分。慢,但零门槛。"""

    SCORE_PROMPT = """请判断下面这段资料对回答问题的帮助程度,只输出一个 0-10 的整数,不要输出其他内容。
0 = 完全无关,10 = 直接包含答案。

问题:{query}

资料:{text}

只输出整数:"""

    def __init__(self, llm: GLMClient):
        self.llm = llm

    def rerank(self, query: str, results: list[SearchResult], top_n: int) -> list[SearchResult]:
        scored = [SearchResult(chunk=sr.chunk, score=self._score_pair(query, sr.chunk.text)) for sr in results]
        scored.sort(key=lambda s: -s.score)
        return scored[:top_n]

    def _score_pair(self, query: str, text: str) -> float:
        answer = self.llm.complete(self.SCORE_PROMPT.format(query=query, text=text))
        m = re.search(r"\d+(\.\d+)?", answer)  # 从回答里抠数字
        return float(m.group()) if m else 0.0  # 抠不出给 0 分,宁可沉底也不崩


def build_reranker(cfg: Config, llm: GLMClient) -> BaseReranker | None:
    """按配置装配精排器。rerank_enabled=false → None(跳过精排环节)。"""
    if not cfg.rerank_enabled:
        return None
    if cfg.rerank_provider == "llm":
        return LLMReranker(llm)
    return ZhipuReranker(cfg)
