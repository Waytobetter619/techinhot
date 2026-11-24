
【AI 领域翻译规则 — 本平台的内容是 AI/ML/LLM 行业动态，以及与 AI、芯片和关键技术相关的科技地缘政治，严格遵守】

1. 歧义默认值：以下词在中文有非 AI 歧义，**一律按 AI 含义翻译**：
   - LLM = 大语言模型（绝不译"法学硕士"/"Master of Laws"）
   - Token / tokens = 模型 token（保留英文；绝不译"代币"/"令牌"）
   - Transformer = Transformer 架构（保留英文；不译"变压器"）
   - Diffusion = 扩散模型（AI 生成，不是物理扩散）
   - Agent / Agentic = AI 智能体 / 智能体的（不译"代理人"/"中介"）
   - Alignment = 对齐（AI 安全语境）
   - Inference = 推理（模型生成）
   - Reasoning = 推理（注意：与 inference 都译"推理"，必要时用"链式推理"区分 CoT；reasoning model 指 o1/o3/R1 这类思考型模型）
   - Embedding = 嵌入向量（也可保留英文）
   - Distillation = 知识蒸馏
   - Hallucination = 模型幻觉
   - Fine-tune / Fine-tuning = 微调
   - Pretrain / Pretraining = 预训练
   - Context window = 上下文窗口
   - Prompt = 提示词
   - Skill / Skills = 技能（Claude 等 Agent 框架的能力包，不译"特长"）

2. 以下专有名词**一律保留英文原文**，不翻译不加中文括注：
   - AI 公司：OpenAI / Anthropic / Google DeepMind / xAI / Meta AI / Mistral / DeepSeek / Cohere / HuggingFace（HF）/ Runway / ElevenLabs / Suno / Pika / Midjourney / Perplexity
   - 模型族（举例 + 通用规则）：GPT / Claude / Gemini / Llama / Qwen / Grok / o 系列 / DeepSeek / Mistral / Mixtral / Phi / Sora / Veo / Imagen
     **规则**：任何大模型族名、产品代号一律保留英文
   - 模型版本号（举例 + 通用规则）：GPT-5 / Claude 4.7 / Claude Sonnet 4.6 / Llama 4 / Gemini 3 / o3 / o4 / DeepSeek-V4 / Qwen3.7
     **规则**：版本号一字不改（包括字母数字后缀如 4o / 4.7 / 405B / V4 / R1），绝不"翻译性扩写"（不要把 "405B" 译成 "4050 亿"，不要把 "V4" 译成 "第 4 代"）
   - 技术缩写（举例 + 通用规则）：LLM / RAG / RLHF / DPO / LoRA / QLoRA / PEFT / MoE / CoT / ReAct / KV cache / SOTA / AGI / MCP / ADK / NPU / GPU / TPU
     **规则**：任何 2-5 字母的全大写缩写，默认按 AI/ML 含义保留英文
   - 评测基准（举例 + 通用规则）：MMLU / GPQA / HumanEval / SWE-bench / SWE-bench Verified / AIME / HLE / ARC-AGI / ARC-AGI 2 / MT-Bench / Chatbot Arena / Aider Polyglot / LiveCodeBench
     **规则**：以 -bench / -eval 结尾或全大写的评测名一律保留英文
   - AI 工具/产品：Cursor / Copilot / Codex / Aider / Devin / Cline / Claude Code / Windsurf / Zed / v0 / Bolt / Lovable / Replit Agent
   - Agent 框架：LangChain / LangGraph / LlamaIndex / CrewAI / AutoGen / Pydantic AI / Vercel AI SDK / DSPy
   - 推理/部署：Ollama / vLLM / SGLang / TensorRT / Triton / CUDA / ROCm
   - 通用技术：API / SDK / CLI / IDE / SaaS / CDN / SSO / OAuth / JWT / WebSocket / SSE / gRPC

3. 中国厂商**优先用官方中文品牌名**（首次出现可双标"千问（Qwen3）"，后续选一种保持一致）：
   - 千问（Qwen）/ 文心一言 / 智谱（GLM）/ 月之暗面（Kimi）/ 深度求索（DeepSeek）/ 阶跃星辰（Step）/ 零一万物（Yi）/ 百川 / 豆包（字节）/ 混元（腾讯）/ 可灵（Kling，快手）/ 即梦（Jimeng，字节）/ MiniMax（不译）/ 美团 LongCat / 昆仑万维 Skywork / 面壁 MiniCPM / 华为昇腾 / 寒武纪

4. 代码 / 命令 / URL / 数字单位 **一字不改**保留：
   - 反引号代码 `code` 不翻译
   - 命令如 /code-review、pip install、npm run 不译（不要译"代码审查"）
   - URL 原样
   - 数字+单位：8k context / 175B params / 3.5x speedup / $3 per M tokens / 99.9%
   - 金额、参数量、比例、区间必须保留原文的阿拉伯数字和单位；不要把 $10B-$100B 改写成“数百亿至数千亿美元”等中文数量词

5. 科技地缘与政策类内容（出口管制、制裁、关税、立法、政府间协议）：
   - 歧义词按政策含义翻译：Entity List = 实体清单；Export Administration Regulations（EAR）= 《出口管理条例》；BIS = 美国商务部工业与安全局（首次出现可写“BIS（美国商务部工业与安全局）”）；Foreign Direct Product Rule = 外国直接产品规则；tariff = 关税；sanction = 制裁；license requirement = 许可证要求；de minimis = 最低减让/微量规则（按上下文）。
   - 法规、机构与文件名保留官方名称或通行中文译名，如 EU AI Act（欧盟《人工智能法案》）、CHIPS Act（《芯片与科学法案》）、Section 301（301 条款）、OFAC、CFIUS、MOFCOM（中国商务部）；不自造译名。
   - 只陈述各方的动作、措施内容、生效时间与正式表态，不加入原文没有的立场评价或褒贬词；转述一方说法时写明是谁的说法。
   - 措施所处阶段照原文写清：提案、征求意见、公布、生效、暂缓、撤销，不把“考虑”“据报道”写成已实施。
