# tiny-rag 的设计取舍

tiny-rag 是一个仅供学习的迷你 RAG 系统,理念是"麻雀虽小,五脏俱全"。向量检索内核用 numpy 手写:向量归一化后,矩阵乘法就是全部相似度计算,取前 k 名就是检索。BM25 与 RRF 融合也是手写简版,方便逐行理解。

系统不引入 LangChain、LlamaIndex 等重型框架;模型服务用智谱 GLM,一个 API key 覆盖对话、向量化与重排。CLI 提供 ingest、ask、eval 三个子命令。API key 只从环境变量读取,永不写入代码库。
