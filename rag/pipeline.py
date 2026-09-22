"""流水线编排:把各环节串成 ingest / query 两条链,并给每环节打耗时点。

编排层不写业务逻辑,只做三件事:
1. 依赖装配(谁用谁 = 看构造参数,一目了然)
2. 顺序调用(数据怎么流 = 看调用顺序)
3. 耗时打点(每环节花多久,性能优化的第一手证据)

所有出网组件(embedder / llm / reranker)都能从参数注入替身 ——
这让编排与评测的测试完全离线,也演示了"面向接口编程"的换件能力。
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from rag.chunking import Chunk, build_chunker
from rag.config import Config
from rag.embedding import BaseEmbedding, VectorStore, ZhipuEmbedding
from rag.generation import Answer, GLMClient, answer_question
from rag.loaders import load_document, load_documents_from_dir
from rag.rerank import BaseReranker, build_reranker
from rag.retrieval import BM25Retriever, HybridRetriever, VectorRetriever

logger = logging.getLogger("rag")

# 哨兵:区分"调用方没传"(按配置装配)与"显式传 None"(强制关闭精排)
_AUTO = "auto"


def setup_logging(verbose: bool = False) -> None:
    """初始化日志:INFO 起步,--verbose 开 DEBUG。环节明细走 log_event 的 JSON 行。"""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def log_event(stage: str, **fields) -> None:
    """结构化日志:一个环节一行 JSON,机器可读、可 grep、可做耗时分析。"""
    logger.info(json.dumps({"stage": stage, **fields}, ensure_ascii=False, default=str))


def ingest(path: str, cfg: Config, embedder: BaseEmbedding | None = None) -> dict:
    """离线建库:加载 → 切块 → 向量化 → 持久化。返回统计信息。"""
    t_all = time.perf_counter()
    target = Path(path)
    docs = load_documents_from_dir(target) if target.is_dir() else [load_document(target)]
    log_event("load", files=len(docs))

    chunker = build_chunker(cfg.chunking_strategy, cfg.chunk_size, cfg.chunk_overlap)
    chunks: list[Chunk] = [c for d in docs for c in chunker.split(d)]
    log_event("chunking", strategy=cfg.chunking_strategy, chunks=len(chunks))
    if not chunks:
        raise ValueError(f"没有切出任何 chunk:检查文档是否为空({path})")

    embedder = embedder or ZhipuEmbedding(cfg)
    t0 = time.perf_counter()
    vectors = embedder.embed_texts([c.text for c in chunks])
    log_event(
        "embedding",
        model=cfg.embedding_model,
        rows=int(vectors.shape[0]),
        seconds=round(time.perf_counter() - t0, 3),
    )

    store = VectorStore(cfg.vectors_file, cfg.meta_file)
    store.save(vectors, chunks)
    total = round(time.perf_counter() - t_all, 3)
    log_event("save", vectors_file=str(cfg.vectors_file), total_seconds=total)
    return {"documents": len(docs), "chunks": len(chunks), "dim": int(vectors.shape[1]), "seconds": total}


def query(
    question: str,
    cfg: Config,
    stream_cb=None,
    embedder: BaseEmbedding | None = None,
    llm: GLMClient | None = None,
    reranker: BaseReranker | None | str = _AUTO,
) -> Answer:
    """在线问答:混合检索 → (可选)精排 → 组装生成。"""
    t_all = time.perf_counter()
    store = VectorStore(cfg.vectors_file, cfg.meta_file)
    embedder = embedder or ZhipuEmbedding(cfg)
    llm = llm or GLMClient(cfg)

    # 向量检索一路;BM25 不需要向量,基于已持久化的 chunk 文本构建 —— 两种信号互补
    vector_ret = VectorRetriever(embedder, store)
    _, chunks = store.load()
    retriever = HybridRetriever(vector_ret, BM25Retriever(chunks), rrf_k=cfg.rrf_k)

    t0 = time.perf_counter()
    results = retriever.search(question, cfg.vector_top_k + cfg.bm25_top_k)
    log_event("retrieval", hits=len(results), seconds=round(time.perf_counter() - t0, 3))

    if reranker is _AUTO:
        reranker = build_reranker(cfg, llm)
    if reranker is not None:
        t0 = time.perf_counter()
        results = reranker.rerank(question, results, cfg.rerank_top_n)
        log_event("rerank", provider=cfg.rerank_provider, kept=len(results),
                  seconds=round(time.perf_counter() - t0, 3))

    answer = answer_question(llm, question, results, max_context_chars=cfg.max_context_chars, stream_cb=stream_cb)
    log_event("generation", model=cfg.llm_model, chars=len(answer.text))
    log_event("query_total", seconds=round(time.perf_counter() - t_all, 3))
    return answer
