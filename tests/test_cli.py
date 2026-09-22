"""CLI 测试:参数解析与退出码,不触发出网逻辑。"""
import pytest

from cli import main


def test_help_exits_zero():
    with pytest.raises(SystemExit) as ei:
        main(["--help"])
    assert ei.value.code == 0


def test_ask_requires_question():
    with pytest.raises(SystemExit) as ei:
        main(["ask"])
    assert ei.value.code != 0


def test_unknown_command_rejected():
    with pytest.raises(SystemExit) as ei:
        main(["nope"])
    assert ei.value.code != 0


def test_error_goes_to_stderr_with_exit_code_1(capsys):
    # ingest 一个不存在的路径:加载环节即抛 FileNotFoundError,不出网
    assert main(["ingest", "no_such_dir"]) == 1
    captured = capsys.readouterr()
    assert captured.err  # 错误信息统一走 stderr
    assert not captured.out  # 标准输出保持干净


def test_eval_subcommand_wired_and_errors_cleanly(tmp_path, monkeypatch, capsys):
    # eval 子命令已接线:空目录离线跑(无 key、无评测集)应报错退出而非"未知命令"
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ZHIPUAI_API_KEY", raising=False)
    assert main(["eval"]) == 1
    captured = capsys.readouterr()
    assert captured.err  # 错误信息统一走 stderr,与 ingest/ask 同款处理
