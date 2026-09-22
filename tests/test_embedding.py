"""向量化与本地向量库测试:持久化往返、行数校验、批量顺序还原。全部离线。"""
import httpx
import numpy as np
import pytest

from fakes import FakeResponse
from rag.chunking import Chunk
from rag.config import Config
from rag.embedding import VectorStore, ZhipuEmbedding
from rag.retry import APIError


def test_store_roundtrip(tmp_path):
    vectors = np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32)
    chunks = [
        Chunk(text="第一块", metadata={"source": "a.md", "chunk_index": 0}),
        Chunk(text="第二块", metadata={"source": "a.md", "chunk_index": 1}),
    ]
    store = VectorStore(tmp_path / "vectors.npz", tmp_path / "meta.jsonl")
    store.save(vectors, chunks)
    loaded_vecs, loaded_chunks = store.load()
    assert np.allclose(loaded_vecs, vectors)
    assert [c.text for c in loaded_chunks] == ["第一块", "第二块"]  # 行号与元数据对齐
    assert loaded_chunks[0].metadata["source"] == "a.md"


def test_store_rejects_row_mismatch(tmp_path):
    store = VectorStore(tmp_path / "vectors.npz", tmp_path / "meta.jsonl")
    with pytest.raises(ValueError):
        store.save(np.zeros((2, 3), dtype=np.float32), [Chunk(text="只有一块")])


def test_store_load_detects_row_mismatch(tmp_path):
    """save 与 load 都要校验行数:落盘后元数据被改动,load 必须报错而不是静默错位。"""
    store = VectorStore(tmp_path / "vectors.npz", tmp_path / "meta.jsonl")
    store.save(
        np.zeros((2, 3), dtype=np.float32),
        [Chunk(text="甲"), Chunk(text="乙")],
    )
    with open(store.meta_file, "a", encoding="utf-8") as f:  # 模拟元数据被追加/损坏
        f.write('{"text": "多出来的一行", "metadata": {}}\n')
    with pytest.raises(ValueError):
        store.load()


def test_embed_restores_api_order(monkeypatch):
    """API 不保证按输入顺序返回,必须按 index 字段还原 —— 不对齐后面全错。"""
    captured = {}

    def fake_post(url, **kwargs):
        captured["json"] = kwargs["json"]
        return FakeResponse({"data": [
            {"index": 1, "embedding": [0.3, 0.4]},
            {"index": 0, "embedding": [0.1, 0.2]},
        ]})

    monkeypatch.setattr(httpx, "post", fake_post)
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.embedding_dimensions = 2
    cfg.api_key = "fake-key"  # 本地测试环境没有真实 key,注入假 key 才能走到出网逻辑
    result = ZhipuEmbedding(cfg).embed_texts(["甲", "乙"])
    assert captured["json"]["input"] == ["甲", "乙"]
    assert result[0].tolist() == pytest.approx([0.1, 0.2])  # 甲 → index 0 的向量
    assert result[1].tolist() == pytest.approx([0.3, 0.4])


def test_embed_retry_exhausted_reports_stage(monkeypatch):
    """出网调用走 with_retries:重试耗尽后报错要指明 embedding 环节。"""

    def always_fail(url, **kwargs):
        raise httpx.ConnectError("连接失败")

    monkeypatch.setattr(httpx, "post", always_fail)
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.max_retries = 0  # 只试一次即耗尽,测试不必真等退避延迟
    cfg.api_key = "fake-key"
    with pytest.raises(APIError) as excinfo:
        ZhipuEmbedding(cfg).embed_texts(["甲"])
    assert "embedding" in str(excinfo.value)


def test_embed_batches_and_keeps_order_across_batches(monkeypatch):
    """按 embedding_batch_size 分批请求,且跨批拼接后顺序仍与输入一致。"""
    calls: list[list[str]] = []

    def fake_post(url, **kwargs):
        batch = kwargs["json"]["input"]
        calls.append(batch)
        return FakeResponse({"data": [
            {"index": i, "embedding": [float(len(calls)), float(i)]}
            for i, _ in enumerate(batch)
        ]})

    monkeypatch.setattr(httpx, "post", fake_post)
    cfg = Config.load(config_path="nonexistent.yaml")
    cfg.embedding_dimensions = 2
    cfg.embedding_batch_size = 2
    cfg.api_key = "fake-key"
    result = ZhipuEmbedding(cfg).embed_texts(["一", "二", "三"])
    assert calls == [["一", "二"], ["三"]]  # 按 batch_size 切两批
    assert result.shape == (3, 2)
    # 跨批拼接后仍是输入顺序:第 i 行对应第 i 条文本
    assert result[:, 0].tolist() == pytest.approx([1.0, 1.0, 2.0])


def test_embed_empty_input():
    cfg = Config.load(config_path="nonexistent.yaml")
    out = ZhipuEmbedding(cfg).embed_texts([])
    assert out.shape == (0, cfg.embedding_dimensions)
