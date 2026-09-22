"""重试助手测试:成功即返回、失败按指数退避重试、耗尽后报错指明环节。"""
import pytest

from rag.retry import APIError, with_retries


def test_returns_first_success():
    assert with_retries(lambda: 42, stage="x") == 42


def test_retries_then_succeeds():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("boom")
        return "ok"

    assert with_retries(flaky, stage="embedding", max_retries=3, base_delay=0) == "ok"
    assert calls["n"] == 3


def test_exhausted_raises_with_stage():
    def always_fail():
        raise RuntimeError("quota")

    with pytest.raises(APIError) as ei:
        with_retries(always_fail, stage="rerank", max_retries=1, base_delay=0)
    assert "rerank" in str(ei.value)  # 报错信息直接指向出错环节
