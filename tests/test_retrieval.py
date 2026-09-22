"""检索内核测试:手写余弦 top-k、BM25、RRF 融合,全部构造小矩阵/小语料断言。"""
import numpy as np
import pytest

from fakes import FakeEmbedding
from rag.chunking import Chunk
from rag.embedding import VectorStore
from rag.retrieval import (
    BM25Retriever,
    BaseRetriever,
    HybridRetriever,
    SearchResult,
    VectorRetriever,
    cosine_top_k,
    rrf_fuse,
    tokenize,
)


def _sr(source: str, idx: int) -> SearchResult:
    return SearchResult(chunk=Chunk(text="", metadata={"source": source, "chunk_index": idx}), score=0.0)


def test_cosine_top_k_ranking():
    q = np.array([1.0, 0.0])
    m = np.array([[1.0, 0.0], [0.0, 1.0], [0.7071, 0.7071]])
    hits = cosine_top_k(q, m, k=2)
    assert hits[0][0] == 0
    assert hits[0][1] == pytest.approx(1.0, abs=1e-5)
    assert hits[1][0] == 2
    assert hits[1][1] == pytest.approx(0.7071, abs=1e-3)


def test_cosine_top_k_empty_matrix_and_k_clamp():
    assert cosine_top_k(np.array([1.0, 0.0]), np.zeros((0, 2)), k=3) == []
    hits = cosine_top_k(np.array([1.0, 0.0]), np.eye(2), k=99)
    assert len(hits) == 2  # k 超过行数时收敛到行数


def test_tokenize_chinese():
    toks = tokenize("我爱自然语言处理")
    assert toks and all(t.strip() for t in toks)


def test_bm25_ranks_unique_keyword_first():
    chunks = [
        Chunk(text="apple banana", metadata={"source": "1.md", "chunk_index": 0}),
        Chunk(text="banana cherry", metadata={"source": "1.md", "chunk_index": 1}),
        Chunk(text="cherry date", metadata={"source": "1.md", "chunk_index": 2}),
    ]
    hits = BM25Retriever(chunks, tokenizer=str.split).search("apple", top_k=2)
    assert hits[0].chunk.metadata["chunk_index"] == 0
    assert hits[0].score > 0


def test_bm25_no_hit_returns_empty():
    chunks = [Chunk(text="apple banana", metadata={"source": "1.md", "chunk_index": 0})]
    assert BM25Retriever(chunks, tokenizer=str.split).search("zzz", top_k=3) == []


def test_rrf_fuses_two_lists():
    list1 = [_sr("a", 0), _sr("a", 1), _sr("a", 2)]  # 第一路排名: 0,1,2
    list2 = [_sr("a", 1), _sr("a", 3)]               # 第二路排名: 1,3
    fused = rrf_fuse([list1, list2], k=60)
    keys = [(r.chunk.metadata["source"], r.chunk.metadata["chunk_index"]) for r in fused]
    assert keys[0] == ("a", 1)  # 两路都命中的候选排第一
    assert set(keys) == {("a", 0), ("a", 1), ("a", 2), ("a", 3)}
    assert fused[0].score > fused[1].score  # RRF 分数随排名单调下降


def test_vector_retriever_offline(tmp_path):
    store = VectorStore(tmp_path / "v.npz", tmp_path / "m.jsonl")
    chunks = [
        Chunk(text="目标块", metadata={"source": "s.md", "chunk_index": 0}),
        Chunk(text="正交块", metadata={"source": "s.md", "chunk_index": 1}),
    ]
    store.save(np.array([[0.0, 1.0], [1.0, 0.0]], dtype=np.float32), chunks)
    hits = VectorRetriever(FakeEmbedding(), store).search("任意问题", top_k=1)
    assert len(hits) == 1
    assert hits[0].chunk.text == "目标块"  # [0,1] 与查询向量 [0,1] 同向 → 第一


def test_hybrid_fuses_vector_and_bm25():
    class FakeRetriever(BaseRetriever):
        def __init__(self, keys):
            self.keys = keys

        def search(self, query, top_k):
            return [_sr(s, i) for s, i in self.keys][:top_k]

    hybrid = HybridRetriever(
        FakeRetriever([("a", 0), ("a", 1)]),
        FakeRetriever([("a", 1), ("a", 2)]),
        rrf_k=60,
    )
    hits = hybrid.search("q", top_k=3)
    assert (hits[0].chunk.metadata["source"], hits[0].chunk.metadata["chunk_index"]) == ("a", 1)
