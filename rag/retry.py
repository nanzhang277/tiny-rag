"""API 重试助手:指数退避。

所有出网调用(embedding / rerank / chat)共用这一份重试逻辑 —— DRY。
重试耗尽后抛出的异常信息带上 stage 名,报错直接指向出错环节。
"""
from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


class APIError(RuntimeError):
    """API 调用最终失败。stage 指明出错环节(如 embedding / rerank / generation)。"""

    def __init__(self, stage: str, message: str):
        self.stage = stage
        super().__init__(f"[{stage}] API 调用失败: {message}")


def with_retries(
    fn: Callable[[], T],
    stage: str,
    max_retries: int = 3,
    base_delay: float = 1.0,
    retry_on: tuple[type[Exception], ...] = (Exception,),
) -> T:
    """执行 fn;失败按指数退避重试(1s, 2s, 4s...),耗尽后抛 APIError。

    max_retries=0 表示只试一次。网络抖动与限流是常态,自动重试是标配。
    """
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except retry_on as exc:
            last_exc = exc
            if attempt == max_retries:
                break
            time.sleep(base_delay * (2**attempt))
    raise APIError(stage, f"重试 {max_retries} 次后仍失败: {last_exc}") from last_exc
