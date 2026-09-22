"""CLI 入口:ingest / ask 两个子命令(eval 在评测模块就绪后由下一任务接入)。

用法:
    export ZHIPUAI_API_KEY=<你的智谱 key>
    python cli.py ingest data/docs     # 建库(文件或目录)
    python cli.py ask "什么是RAG?"     # 问答,流式输出
    python cli.py --verbose ask "..."  # 打开 DEBUG 日志
"""
from __future__ import annotations

import argparse
import sys

from rag.config import Config, MissingAPIKeyError
from rag.pipeline import ingest, query, setup_logging
from rag.retry import APIError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tiny-rag", description="学习版 RAG 系统")
    parser.add_argument("--config", default=None, help="配置文件路径(默认项目根 config.yaml)")
    parser.add_argument("--verbose", action="store_true", help="输出 DEBUG 级日志")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="文档建库:加载→切块→向量化→持久化")
    p_ingest.add_argument("path", help="文档文件或目录(.md/.txt)")

    p_ask = sub.add_parser("ask", help="问答:混合检索→精排→流式生成")
    p_ask.add_argument("question", help="你的问题")
    p_ask.add_argument("--no-stream", action="store_true", help="关闭流式,等完整回答后一次打印")

    args = parser.parse_args(argv)
    cfg = Config.load(args.config)
    setup_logging(args.verbose)

    try:
        if args.command == "ingest":
            stats = ingest(args.path, cfg)
            print(f"建库完成: {stats}")
        elif args.command == "ask":
            cb = None if args.no_stream else (lambda delta: print(delta, end="", flush=True))
            answer = query(args.question, cfg, stream_cb=cb)
            print()  # 流式结束后补一个换行
            if args.no_stream:
                print(answer.text)
    except (MissingAPIKeyError, APIError, FileNotFoundError, ValueError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
