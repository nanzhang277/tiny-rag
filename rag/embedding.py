"""向量化(Embedding):把文本变成高维向量,并持久化到本地。

Embedding 把"语义相近"变成"向量夹角小" —— 这是向量检索的物理基础。
本模块职责:
1. 调智谱 embedding API 批量生成向量(批量 = 省请求数)
2. 带指数退避重试(网络抖动/限流是常态)
3. 持久化:vectors.npz 存向量矩阵,meta.jsonl 存每行对应的 chunk 文本与元数据。
   两者按行号一一对应 —— "矩阵第 i 行 ↔ jsonl 第 i 行"这个对齐约定是全系统的地基。
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

import httpx
import numpy as np

from rag.chunking import Chunk
from rag.config import Config
from rag.retry import with_retries


class BaseEmbedding(ABC):
    """向量化接口。换 provider = 新写一个子类,检索层零改动。"""

    @abstractmethod
    def embed_texts(self, texts: list[str]) -> np.ndarray:
        """texts[i] 对应返回矩阵的第 i 行,shape = (len(texts), dim)。"""


class ZhipuEmbedding(BaseEmbedding):
    """智谱 embedding 实现:批量 + 指数退避重试。"""

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.cfg.embedding_dimensions), dtype=np.float32)
        vectors: list[list[float]] = []
        for i in range(0, len(texts), self.cfg.embedding_batch_size):
            batch = texts[i : i + self.cfg.embedding_batch_size]
            vectors.extend(self._embed_batch(batch))
        return np.asarray(vectors, dtype=np.float32)

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        def call() -> list[list[float]]:
            resp = httpx.post(
                f"{self.cfg.api_base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.cfg.require_api_key()}"},
                json={
                    "model": self.cfg.embedding_model,
                    "input": batch,
                    "dimensions": self.cfg.embedding_dimensions,
                },
                timeout=self.cfg.timeout_seconds,
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            # API 不保证按输入顺序返回,按 index 字段还原 —— 顺序错 = 全库错位
            ordered = sorted(data, key=lambda d: d["index"])
            return [item["embedding"] for item in ordered]

        return with_retries(call, stage="embedding", max_retries=self.cfg.max_retries)


class VectorStore:
    """本地向量库:一个矩阵 + 一份元数据,行号对齐。

    为什么不用数据库或 FAISS?学习版原则:用最裸的形态看清本质 ——
    向量检索的全部家当就是"一个矩阵 + 逐行比相似度"(见 retrieval.py)。
    学习版假设一次性建库,save 是全量覆盖,不做增量更新(YAGNI)。
    """

    def __init__(self, vectors_file: str | Path, meta_file: str | Path):
        self.vectors_file = Path(vectors_file)
        self.meta_file = Path(meta_file)

    def save(self, vectors: np.ndarray, chunks: list[Chunk]) -> None:
        if len(vectors) != len(chunks):
            raise ValueError(f"向量数({len(vectors)})与 chunk 数({len(chunks)})不一致")
        self.vectors_file.parent.mkdir(parents=True, exist_ok=True)
        np.savez(self.vectors_file, vectors=vectors)
        with open(self.meta_file, "w", encoding="utf-8") as f:
            for c in chunks:
                # 每行 = {"text": 块原文, "metadata": {...}},行号对齐矩阵行
                f.write(json.dumps({"text": c.text, "metadata": c.metadata}, ensure_ascii=False) + "\n")

    def load(self) -> tuple[np.ndarray, list[Chunk]]:
        """读回 (向量矩阵, chunks)。问答与评测都要先过这里。"""
        with np.load(self.vectors_file) as npz:
            vectors = npz["vectors"]
        chunks: list[Chunk] = []
        with open(self.meta_file, encoding="utf-8") as f:
            for line in f:
                obj = json.loads(line)
                chunks.append(Chunk(text=obj["text"], metadata=obj["metadata"]))
        if len(vectors) != len(chunks):
            raise ValueError(
                f"向量库损坏:矩阵 {len(vectors)} 行但元数据 {len(chunks)} 行,请重新 ingest"
            )
        return vectors, chunks
