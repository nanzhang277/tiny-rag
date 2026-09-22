"""检索(Retrieval):从知识库里找出与问题最相关的 top-k 块。

本章是全项目最大的"祛魅"点 —— 向量检索没有任何魔法:
    1. 把问题和所有 chunk 都变成向量
    2. 逐行算余弦相似度(归一化 + 矩阵乘法)
    3. 取分数最大的前 k 个

混合检索 = 向量(语义) + BM25(字面) 两路结果用 RRF 融合:
向量懂"意思相近",BM25 懂"词面命中",两种信号互补。
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass

import jieba
import numpy as np

from rag.chunking import Chunk
from rag.embedding import BaseEmbedding, VectorStore

jieba.setLogLevel(60)  # 静默 jieba 首次加载的建库日志,保持输出干净


@dataclass
class SearchResult:
    """一条检索结果:chunk + 分数。

    注意:不同检索器的分数量纲不同(余弦 / BM25 / RRF),分数只用于本路内部
    排序;跨路合并请走 rrf_fuse 的"排名融合",不要直接比较原始分数。
    """

    chunk: Chunk
    score: float


class BaseRetriever(ABC):
    """检索器接口。实现一个 search,即可接入 pipeline 与 eval 的对比框架。"""

    @abstractmethod
    def search(self, query: str, top_k: int) -> list[SearchResult]:
        """返回至多 top_k 条结果,按分数降序。"""


def cosine_top_k(query_vec: np.ndarray, matrix: np.ndarray, k: int) -> list[tuple[int, float]]:
    """手写余弦相似度 top-k —— 向量检索的全部本质。

    余弦相似度 = 点积 / (两向量模长之积)。把所有向量先归一化(除以自身模长),
    点积就直接等于余弦值 —— 于是"全库检索"变成一次矩阵乘向量。

    返回 [(矩阵行号, 相似度), ...],按相似度降序,至多 k 个。
    """
    if len(matrix) == 0:
        return []
    q = query_vec / (np.linalg.norm(query_vec) + 1e-10)  # 1e-10 防零向量除零
    m = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-10)
    sims = m @ q  # 一次矩阵乘 = 全库相似度
    k = min(k, len(sims))
    top = np.argsort(-sims, kind="stable")[:k]  # stable:并列分数顺序可复现
    return [(int(i), float(sims[i])) for i in top]


def tokenize(text: str) -> list[str]:
    """分词:中文用 jieba,英文/数字自然成词。检索器可注入自己的分词器。"""
    return [w for w in jieba.lcut(text) if w.strip()]


class VectorRetriever(BaseRetriever):
    """向量检索器:问题 → 向量化 → 余弦 top-k。"""

    def __init__(self, embedder: BaseEmbedding, store: VectorStore):
        self.embedder = embedder
        self.store = store
        self._vectors: np.ndarray | None = None
        self._chunks: list[Chunk] = []

    def _ensure_loaded(self) -> None:
        """懒加载:第一次 search 才把向量库读进内存。"""
        if self._vectors is None:
            self._vectors, self._chunks = self.store.load()

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        self._ensure_loaded()
        qvec = self.embedder.embed_texts([query])[0]
        return [
            SearchResult(chunk=self._chunks[i], score=s)
            for i, s in cosine_top_k(qvec, self._vectors, top_k)
        ]


class BM25Retriever(BaseRetriever):
    """手写 BM25(简版,约 50 行):经典关键词检索算法,ES/Lucene 的默认评分。

    直觉:一个词在"这一块"出现越多、在其他块出现越少,这块就越相关。
    score(query, doc) = Σ_w IDF(w) · tf·(k1+1) / (tf + k1·(1-b+b·len/avg_len))
    教学价值优先;若想省事换 rank-bm25 轻库,只是配置级改动 —— 这正是
    "手写为了理解,接口为了替换"的示范。
    """

    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75, tokenizer=tokenize):
        self.k1 = k1
        self.b = b
        self.tokenizer = tokenizer
        self.chunks = chunks
        self.doc_tokens = [tokenizer(c.text) for c in chunks]
        self.doc_lens = [len(t) for t in self.doc_tokens]
        self.avg_len = sum(self.doc_lens) / len(self.doc_lens) if self.doc_lens else 0.0
        # 预计算:每块的词频表 tf[i][term],以及每个词出现在多少块 df[term]
        self.tf: list[dict[str, int]] = [{} for _ in chunks]
        self.df: dict[str, int] = {}
        for i, tokens in enumerate(self.doc_tokens):
            for tok in tokens:
                self.tf[i][tok] = self.tf[i].get(tok, 0) + 1
            for tok in self.tf[i]:
                self.df[tok] = self.df.get(tok, 0) + 1

    def _idf(self, term: str) -> float:
        n = len(self.chunks)
        df = self.df.get(term, 0)
        # +1.0 平滑项保证恒正:出现在所有块里的词 IDF 也不会为负
        return math.log((n - df + 0.5) / (df + 0.5) + 1.0)

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        scores = [0.0] * len(self.chunks)
        for term in set(self.tokenizer(query)):
            idf = self._idf(term)
            for i, counter in enumerate(self.tf):
                tf = counter.get(term, 0)
                if tf == 0:
                    continue
                denom = tf + self.k1 * (1 - self.b + self.b * self.doc_lens[i] / (self.avg_len or 1.0))
                scores[i] += idf * tf * (self.k1 + 1) / denom
        ranked = sorted(range(len(scores)), key=lambda i: -scores[i])[:top_k]
        return [SearchResult(chunk=self.chunks[i], score=scores[i]) for i in ranked if scores[i] > 0]


def _chunk_key(c: Chunk) -> tuple:
    """chunk 的唯一键:同一块在不同检索路里能对上号,RRF 才能累加分数。"""
    m = c.metadata
    return (m.get("source"), m.get("chunk_index"))


def rrf_fuse(result_lists: list[list[SearchResult]], k: int = 60) -> list[SearchResult]:
    """RRF(Reciprocal Rank Fusion):按"排名倒数"融合多路检索结果。

    每路结果里排第 r 名的候选得 1/(k+r+1),同一候选跨路累加。
    为什么用排名不用原始分数?向量相似度和 BM25 分数量纲完全不同,没法直接加;
    排名是无量纲的,天然可比。k=60 是论文经验值,用来平滑头部的权重差。
    """
    scores: dict[tuple, float] = {}
    best: dict[tuple, Chunk] = {}
    for results in result_lists:
        for rank, sr in enumerate(results):
            key = _chunk_key(sr.chunk)
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
            best.setdefault(key, sr.chunk)  # 记住该候选首次出现时的 chunk,用于构造融合结果
    fused = sorted(scores.items(), key=lambda kv: -kv[1])
    return [SearchResult(chunk=best[key], score=s) for key, s in fused]


class HybridRetriever(BaseRetriever):
    """混合检索:向量一路 + BM25 一路,RRF 融合后取前 top_k。"""

    def __init__(self, vector: BaseRetriever, bm25: BaseRetriever, rrf_k: int = 60):
        self.vector = vector
        self.bm25 = bm25
        self.rrf_k = rrf_k

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        # 两路各取 top_k;融合后仍取 top_k(两路强重合时自然收紧)
        fused = rrf_fuse(
            [self.vector.search(query, top_k), self.bm25.search(query, top_k)],
            k=self.rrf_k,
        )
        return fused[:top_k]
