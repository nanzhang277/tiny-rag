"""评测(Evaluation):没有指标就没有优化 —— 先量化,再动手调。

三块能力:
1. 检索指标(纯数学,零成本): recall@k(该找到的找到了几成) / MRR(最好答案排多前)
2. 配置对比: chunking × retrieval × rerank 组合开关,输出对比表 —— "能对比"是核心诉求
3. GLM 自评: 让 LLM 按评分表给忠实度/相关性打 1-5 分(花小钱,只跑默认组合)

评测库建在 data/eval/ 临时路径,不碰用户已建的知识库。
"""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from pathlib import Path

from rag.config import Config
from rag.embedding import BaseEmbedding, VectorStore, ZhipuEmbedding
from rag.generation import GLMClient, answer_question, build_context
from rag.pipeline import ingest
from rag.rerank import BaseReranker, build_reranker
from rag.retrieval import BM25Retriever, HybridRetriever, SearchResult, VectorRetriever

SAMPLE_DOCS_DIR = Path("data/docs")
EVAL_SET_FILE = Path("data/eval/eval_set.json")
EVAL_TMP_VECTORS = Path("data/eval/tmp_vectors.npz")
EVAL_TMP_META = Path("data/eval/tmp_meta.jsonl")
TOP_K = 5


@dataclass
class EvalConfig:
    """一组对比开关:eval 的灵魂是"同题不同配置,指标可对比"。"""

    chunking: str   # fixed | recursive
    retrieval: str  # vector | hybrid
    rerank: bool    # 精排开/关


def recall_at_k(retrieved_ids: list, relevant_ids: set, k: int) -> float:
    """recall@k = 前 k 名里命中的正确答案数 / 正确答案总数。"""
    if not relevant_ids:
        return 0.0
    return len(set(retrieved_ids[:k]) & relevant_ids) / len(relevant_ids)


def mrr(retrieved_ids: list, relevant_ids: set) -> float:
    """MRR = 第一条正确答案的排名倒数:第 1 名 → 1.0,第 2 名 → 0.5,没中 → 0。"""
    for rank, rid in enumerate(retrieved_ids, start=1):
        if rid in relevant_ids:
            return 1.0 / rank
    return 0.0


def load_eval_set() -> list[dict]:
    """读内置评测集(问答对 + 标注出处),并做最小 schema 校验。"""
    items = json.loads(EVAL_SET_FILE.read_text(encoding="utf-8"))
    for it in items:
        if not {"question", "answer", "source"} <= set(it):
            raise ValueError(f"评测集条目缺字段(question/answer/source): {it}")
    return items


JUDGE_PROMPT = """你是一个严格的评测员。请依据"参考资料"评估"AI 回答"的质量,只输出一行 JSON:
{{"faithfulness": <1-5 的整数>, "relevance": <1-5 的整数>}}

评分标准:
- faithfulness 忠实度:回答是否只依据资料、没有编造。5=完全忠于资料;3=部分超出资料;1=大量编造。
- relevance 相关性:回答是否切题且信息完整。5=准确完整;3=部分切题;1=答非所问。

参考资料:
{context}

用户问题:{question}

AI 回答:{answer}

只输出 JSON:"""


def llm_judge(llm: GLMClient, question: str, context: str, answer: str) -> dict:
    """让 GLM 按 1-5 分自评忠实度与相关性。"""
    raw = llm.complete(JUDGE_PROMPT.format(context=context, question=question, answer=answer))
    return _parse_scores(raw)


def _parse_scores(raw: str) -> dict:
    """从模型回答里宽容地抠出评分 JSON(模型可能裹 ```json 代码块或多说话)。"""
    m = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
    if not m:
        return {"faithfulness": 0, "relevance": 0}
    try:
        obj = json.loads(m.group())
        return {"faithfulness": int(obj["faithfulness"]), "relevance": int(obj["relevance"])}
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return {"faithfulness": 0, "relevance": 0}


def _eval_library(cfg: Config, embedder, chunking: str) -> Config:
    """为某 chunking 策略在临时路径重建评测库,不碰用户已建的库。"""
    ecfg = copy.deepcopy(cfg)
    ecfg.chunking_strategy = chunking
    ecfg.vectors_file = EVAL_TMP_VECTORS
    ecfg.meta_file = EVAL_TMP_META
    ingest(str(SAMPLE_DOCS_DIR), ecfg, embedder=embedder)
    return ecfg


def _build_retriever(ecfg: Config, combo: EvalConfig, embedder):
    """按组合开关装配检索器(精排器由 _eval_retrieval 按 rerank 开关另配)。"""
    store = VectorStore(ecfg.vectors_file, ecfg.meta_file)
    vector_ret = VectorRetriever(embedder, store)
    if combo.retrieval == "vector":
        return vector_ret
    _, chunks = store.load()
    return HybridRetriever(vector_ret, BM25Retriever(chunks), rrf_k=ecfg.rrf_k)


def _eval_retrieval(ecfg: Config, combo: EvalConfig, eval_set, embedder, llm) -> dict:
    retriever = _build_retriever(ecfg, combo, embedder)
    reranker: BaseReranker | None = build_reranker(ecfg, llm) if combo.rerank else None
    recall_sum = mrr_sum = 0.0
    for item in eval_set:
        results = retriever.search(item["question"], TOP_K)
        if reranker is not None:
            results = reranker.rerank(item["question"], results, TOP_K)
        ids = [r.chunk.metadata.get("source") for r in results]
        relevant = {item["source"]}
        recall_sum += recall_at_k(ids, relevant, TOP_K)
        mrr_sum += mrr(ids, relevant)
    n = max(len(eval_set), 1)
    return {"recall": recall_sum / n, "mrr": mrr_sum / n}


def run_eval(cfg: Config, embedder: BaseEmbedding | None = None, llm: GLMClient | None = None) -> str:
    """跑全部配置组合,返回 Markdown 对比表。GLM 自评只跑默认组合,控制成本。"""
    embedder = embedder or ZhipuEmbedding(cfg)
    llm = llm or GLMClient(cfg)
    eval_set = load_eval_set()

    combos = [
        EvalConfig("fixed", "vector", False),
        EvalConfig("fixed", "hybrid", False),
        EvalConfig("recursive", "vector", False),
        EvalConfig("recursive", "hybrid", False),
        EvalConfig("recursive", "hybrid", True),  # rerank on 的对照行
    ]

    libs: dict[str, Config] = {}  # 同 chunking 策略只重建一次库(向量不必重算)
    rows: list[str] = []
    for combo in combos:
        if combo.chunking not in libs:
            libs[combo.chunking] = _eval_library(cfg, embedder, combo.chunking)
        s = _eval_retrieval(libs[combo.chunking], combo, eval_set, embedder, llm)
        rows.append(
            f"| {combo.chunking} | {combo.retrieval} | {'on' if combo.rerank else 'off'} "
            f"| {s['recall']:.3f} | {s['mrr']:.3f} |"
        )

    # GLM 自评:默认组合 = 递归切块 + 混合检索 + 精排
    lib = libs["recursive"]
    retriever = _build_retriever(lib, EvalConfig("recursive", "hybrid", False), embedder)
    reranker = build_reranker(lib, llm)
    f_sum = r_sum = 0.0
    for item in eval_set:
        results = retriever.search(item["question"], cfg.vector_top_k + cfg.bm25_top_k)
        if reranker is not None:
            results = reranker.rerank(item["question"], results, cfg.rerank_top_n)
        ans = answer_question(llm, item["question"], results, max_context_chars=cfg.max_context_chars)
        scores = llm_judge(llm, item["question"], build_context(list(results), cfg.max_context_chars), ans.text)
        f_sum += scores["faithfulness"]
        r_sum += scores["relevance"]
    n = max(len(eval_set), 1)

    return "\n".join([
        "## 检索指标对比",
        "",
        "| chunking | retrieval | rerank | recall@5 | MRR |",
        "|---|---|---|---|---|",
        *rows,
        "",
        "## GLM 自评(recursive + hybrid + rerank on)",
        "",
        f"- faithfulness 忠实度: {f_sum / n:.2f} / 5",
        f"- relevance 相关性: {r_sum / n:.2f} / 5",
    ])
