"""共享测试替身:假 HTTP 响应、假 embedding、假 LLM —— 让测试完全离线。"""
import numpy as np

from rag.embedding import BaseEmbedding


class FakeResponse:
    """httpx.Response 的最小替身,只实现测试用到的方法。"""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class FakeEmbedding(BaseEmbedding):
    """确定性假向量化:任何文本都映到 [0, 1] —— 只为离线验证数据流。"""

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        return np.zeros((len(texts), 2), dtype=np.float32) + np.array([0.0, 1.0])


class FakeLLM:
    """假 LLM:普通 prompt 返回固定带引用回答;评测 prompt 返回评分 JSON。"""

    def complete(self, prompt: str) -> str:
        if "faithfulness" in prompt:
            return '{"faithfulness": 4, "relevance": 5}'
        return "依据资料[1]得出的回答。"

    def stream(self, prompt: str):
        yield "依据资料[1]"
        yield "得出的回答。"
