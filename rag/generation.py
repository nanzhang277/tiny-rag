"""生成(Generation):把检索到的块组装成 Prompt,让 LLM 生成带引用的回答。

RAG 生成的三件事:
1. Prompt 组装:问题 + 编号资料区 + "只依据材料回答"的指令。
2. 引用标注:要求模型在论断句尾标 [1][2],编号对应资料序号 —— 可溯源是 RAG 的灵魂。
3. 流式输出:逐段打印,体验上"秒回"。

上下文超长策略:检索结果已按相关性降序,从尾部(得分最低)开始丢弃,直到装得下。
"""
from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass

import httpx

from rag.config import Config
from rag.retry import APIError, with_retries
from rag.retrieval import SearchResult


# "装得下"判定的固定安全余量:上下文预算不打满,为 Prompt 模板固定文案、
# 丢弃后的编号重排等开销留缓冲。取最小可行值 10(默认预算 4000 下仅 0.25% 松弛)。
CONTEXT_HEADROOM = 10


def build_context(results: list[SearchResult], max_chars: int = 4000) -> str:
    """把检索结果拼成带编号的资料区,并处理上下文超长。

    超长策略:结果已按相关性降序,从尾部(得分最低)开始丢弃,直到装得下;
    "装得下" = len(context) + CONTEXT_HEADROOM <= max_chars。
    """
    results = list(results)
    while results:
        blocks = [f"[{i + 1}] {sr.chunk.text}" for i, sr in enumerate(results)]
        context = "\n\n".join(blocks)
        if len(context) + CONTEXT_HEADROOM <= max_chars:
            return context
        results = results[:-1]  # 丢掉得分最低的一条
    return ""


def parse_sse_line(line: str) -> str | None:
    """解析 SSE 数据行,返回文本增量;非数据行/结束标记/坏行返回 None。"""
    if not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if data == "[DONE]":
        return None
    try:
        delta = json.loads(data)["choices"][0]["delta"].get("content")
    except (json.JSONDecodeError, KeyError, IndexError):
        return None  # 单行坏数据直接跳过,不让整次回答崩掉
    return delta or None


class GLMClient:
    """智谱 GLM chat 客户端:阻塞一次生成 + 流式两种调用。

    单独成类的原因:chat 能力被"问答生成"和"LLM 打分降级 rerank"两处共用,
    抽出来 DRY。模型名/温度/地址全部来自配置 —— 换模型不改代码。
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def complete(self, prompt: str) -> str:
        """一次性生成,返回完整文本(给 rerank 降级打分等场景用)。"""

        def call() -> str:
            resp = httpx.post(
                f"{self.cfg.api_base_url}/chat/completions",
                headers=self._headers(),
                json={
                    "model": self.cfg.llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": self.cfg.temperature,
                    "max_tokens": self.cfg.max_output_tokens,
                    "stream": False,
                },
                timeout=self.cfg.timeout_seconds,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        return with_retries(call, stage="generation", max_retries=self.cfg.max_retries)

    def stream(self, prompt: str) -> Iterator[str]:
        """流式生成,逐段 yield 增量文本。

        教学取舍:流式响应中途断连不做自动续传重试(重发会导致已打印内容重复),
        只把错误包进 APIError 指明出在 generation 环节。SSE 行的解析逻辑
        (parse_sse_line)已由测试覆盖,本方法的 httpx 管道部分离线不直测。
        """
        try:
            with httpx.stream(
                "POST",
                f"{self.cfg.api_base_url}/chat/completions",
                headers=self._headers(),
                json={
                    "model": self.cfg.llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": self.cfg.temperature,
                    "max_tokens": self.cfg.max_output_tokens,
                    "stream": True,
                },
                timeout=self.cfg.timeout_seconds,
            ) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    delta = parse_sse_line(line)
                    if delta:
                        yield delta
        except httpx.HTTPError as exc:
            raise APIError("generation", f"流式请求失败: {exc}") from exc

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.cfg.require_api_key()}"}


@dataclass
class Answer:
    """一次问答的产出:回答全文 + 本次依据的块(已被超长策略裁剪)。"""

    text: str
    used_chunks: list[SearchResult]


PROMPT_TEMPLATE = """你是一个严谨的问答助手。请仅依据下面的参考资料回答用户问题。

要求:
1. 只使用参考资料中的信息,不要编造;资料不足以回答时,明确说明。
2. 引用资料时在句末标注编号,如 [1]、[2],编号对应下方资料的序号。

参考资料:
{context}

用户问题:{question}

回答:"""


def answer_question(
    llm,
    question: str,
    results: list[SearchResult],
    max_context_chars: int = 4000,
    stream_cb=None,
) -> Answer:
    """问答主入口:组装 Prompt → 生成 → 返回带引用的回答。

    引用标注:要求模型在论断句尾标 [1][2],编号对应资料序号 —— 可溯源是 RAG 的灵魂。
    llm 参数接受任何实现 complete 的对象 —— 测试可注入假 LLM。
    max_context_chars 交给 build_context 做超长裁剪;传 stream_cb(如 print)时
    改走流式:每段增量回调一次,返回值仍是拼接后的全文。
    """
    if not results:  # 空检索如实告知,不硬编
        return Answer(text="知识库中没有相关内容,无法回答这个问题。", used_chunks=[])
    context = build_context(results, max_context_chars)
    prompt = PROMPT_TEMPLATE.format(context=context, question=question)
    if stream_cb is not None:
        parts: list[str] = []
        for delta in llm.stream(prompt):
            parts.append(delta)
            stream_cb(delta)
        return Answer(text="".join(parts), used_chunks=list(results))
    return Answer(text=llm.complete(prompt), used_chunks=list(results))
