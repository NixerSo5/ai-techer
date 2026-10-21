# AI Teacher

> 一个把「任意主题」变成「可循序渐进学习路径」的 AI 教学 Agent。
> An AI teaching agent that turns any topic into a step-by-step learning path and teaches it, one node at a time.

---

## 中文

### 这是什么

AI Teacher 不是聊天机器人，也不是题库。它先帮你把要学的东西拆成一张**知识图谱**，再在图的约束下排出一条**学习路径**，最后沿着路径**逐节点教学**——讲清楚、出题、判分，过关了才往下走。

整个流程是强制的：

```
确定主题 → 生成大纲 → 用户确认 → 建知识图谱 → 生成学习路径 → 逐节点教学
```

任何一步都不能跳。大纲没有经过你确认，就不会建图；当前节点的验收没有通过，就不会推进到下一个节点。

### 解决什么问题

自学最大的坑不是「找不到资料」，而是：

- 不知道**先学什么后学什么**（顺序错了，越学越挫败）
- 不知道**自己到底会不会**（看懂了 ≠ 做对了）
- 内容难度和**自己的水平不匹配**（给小学生讲微积分，给成年人讲拼音）

AI Teacher 用三件事对应解决：

| 问题 | 做法 |
|---|---|
| 不知道顺序 | 显式的 `prerequisite`（前置）边 + DAG 拓扑排序，路径由图的约束算出，不由模型随口说 |
| 不知道会不会 | 每个节点有结构化单选题，答案只在服务端，答错就重讲，答对才解锁下一节点 |
| 难度不匹配 | 学习者画像（`child` / `teen` / `adult` + 年级 1–12）贯穿大纲生成、讲解措辞、题目选项数量与验收标准 |

### 核心设计

**1. 知识图谱即约束**

节点之间存在两类边：`contains`（章节包含）与 `prerequisite`（学习前置）。写入前置边前做环检测，保证图始终是 DAG。学习路径是「在已确认的框架内 + 满足所有前置关系」的拓扑序列，而不是让模型自由发挥。

**2. 大纲必须先确认**

大纲有版本、有快照。用户确认之后，后续的建图与路径生成只允许使用确认过的节点集合，防止模型在后续环节悄悄扩纲或改纲。

**3. 教学过程是状态机**

每个教学会话绑定一个节点和一个状态（讲解 / 提问 / 判定）。未通过当前节点的验收，状态机不会迁移到下一个节点。

**4. 画像驱动表达**

同一个知识点，对 `child` 用大白话 + 生活类比 + 小步子；对 `teen` 用教材级严谨表述（矢量、正交分解这类概念照常出现）；对 `adult` 直接用领域术语。题目选项数量也随之变化（低龄 3 选 1，成人 4 选 1）。

**5. 模型可换，密钥自填**

只依赖 OpenAI 兼容的 `/chat/completions` 接口，DeepSeek 是默认端点。模型地址、模型名、API Key 全部在界面里配置并存在本地数据库，**不预置、不写死、不进仓库**。未配置时回落到离线 mock provider，保证流程仍可跑通。

### 项目结构

```
server/                  Fastify 后端（TypeScript, ESM）
  src/db/                SQLite schema、连接、迁移
  src/parsers/           Parser 接口 + TXT/Markdown 实现（可扩展）
  src/core/              DAG 拓扑排序与环检测
  src/skills/            outline-gen 等 LLM skill
  src/providers/         LLM 与搜索 provider 抽象
  src/services/          大纲、图谱、路径、教学会话
  src/routes/            REST API
web/                     React + Vite 前端
  src/pages/             建课 / 大纲确认 / 路径 / 教学 / 设置 / 课程列表
desktop/                 Electron 外壳（进程内起后端 + 独立窗口）
  main.cjs               主进程：启动 Fastify、开 BrowserWindow
desktop/scripts/         prepare-dist.mjs：组装打包产物
```

技术选型：Fastify + better-sqlite3（本地 SQLite，递归 CTE 查图）+ React + Electron。没有外部数据库，没有云依赖，数据全部留在本机。

### 快速开始（开发）

```bash
npm install
npm run build --workspace=server
npm run dev --workspace=server      # 后端 http://127.0.0.1:3000
npm run dev --workspace=web         # 前端（Vite）
```

首次启动打开设置页，填入 API Key 即可（Base URL 与模型名有默认值，可改）。

桌面版：

```bash
npm run desktop:dev      # Electron 内直接跑
npm run desktop:pack     # 生成目录版
npm run desktop:dist     # 生成 NSIS 安装包
```

> 打包前需确保 `better-sqlite3` 已按 Electron ABI 安装：
> `npx prebuild-install --runtime=electron --target=33.4.11`

### 配置

界面设置优先于环境变量：

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `llmBaseUrl` | `https://api.deepseek.com` | 任意 OpenAI 兼容端点 |
| `llmModel` | `deepseek-chat` | 模型名 |
| `llmApiKey` | 空 | 必填；仅存本地 DB |
| `enableWiki` | `false` | 是否用 Wikipedia 增强主题搜索 |

### 安全与隐私

- API Key 只写本地 SQLite，界面只显示掩码
- 数据库、上传文件、临时调试 JSON 均在 `.gitignore` 中
- 题目答案只保存在服务端，不下发到前端

---

## English

### What it is

AI Teacher is not a chatbot and not a quiz bank. It first decomposes a topic into a **knowledge graph**, derives a **learning path** that respects that graph, then **teaches node by node** — explain, quiz, grade, and only advance once the current node is passed.

The pipeline is enforced, not suggested:

```
topic → outline → user confirms → build graph → generate path → teach step by step
```

No step can be skipped. An unconfirmed outline cannot produce a graph, and a failed check cannot unlock the next node.

### The problem it solves

Self-study rarely fails because material is missing. It fails because you:

- don't know **what to learn first** (wrong order compounds frustration)
- don't know **whether you actually understand it** (reading ≠ solving)
- get material pitched at the **wrong level** (calculus for a 3rd grader, phonics for an adult)

AI Teacher addresses each directly:

| Problem | Approach |
|---|---|
| Unknown order | Explicit `prerequisite` edges + DAG topological sort; the path is computed from graph constraints, not improvised by the model |
| Unknown mastery | Structured single-choice quizzes per node, answers kept server-side; wrong answers trigger re-teaching, correct answers unlock the next node |
| Wrong difficulty | A learner profile (`child` / `teen` / `adult` + grade 1–12) drives outline generation, explanation wording, quiz option count, and acceptance criteria |

### Core design

**1. The graph is the constraint.** Nodes are linked by `contains` and `prerequisite` edges. Cycle detection runs before any prerequisite edge is written, so the graph stays a DAG. A learning path is a topological order *within the confirmed framework*, not free-form model output.

**2. Outlines are versioned and confirmed.** Each outline has a version and a confirmation snapshot. After confirmation, graph building and path generation may only use that frozen node set — the model cannot silently expand or rewrite the syllabus later.

**3. Teaching is a state machine.** Each session is bound to one node and a state (explain / ask / judge). The machine refuses to transition to the next node until the current node's check passes.

**4. The profile shapes the language.** The same concept is explained with plain words, everyday analogies and small steps for `child`; with textbook-level rigor (vectors, orthogonal decomposition) for `teen`; with domain terminology for `adult`. Quiz option counts follow suit (3 for young learners, 4 for adults).

**5. Swappable model, user-supplied key.** Only the OpenAI-compatible `/chat/completions` contract is required; DeepSeek is the default endpoint. Base URL, model name and API key are configured in the UI and stored in the local database — **never preset, never committed**. Without configuration the app falls back to an offline mock provider so the pipeline still runs.

### Layout

```
server/                  Fastify backend (TypeScript, ESM)
  src/db/                SQLite schema, connection, migrations
  src/parsers/           Parser interface + TXT/Markdown impl (extensible)
  src/core/              DAG topological sort and cycle detection
  src/skills/            LLM skills such as outline-gen
  src/providers/         LLM and search provider abstractions
  src/services/          Outline, graph, path, tutoring sessions
  src/routes/            REST API
web/                     React + Vite frontend
  src/pages/             Create course / confirm outline / path / tutor / settings / course list
desktop/                 Electron shell (in-process backend + native window)
  main.cjs               Starts Fastify and opens the BrowserWindow
desktop/scripts/         prepare-dist.mjs: assembles the packaged tree
```

Stack: Fastify + better-sqlite3 (local SQLite, recursive CTEs for graph queries) + React + Electron. No external database, no cloud dependency, all data stays on the machine.

### Getting started (dev)

```bash
npm install
npm run build --workspace=server
npm run dev --workspace=server      # backend at http://127.0.0.1:3000
npm run dev --workspace=web         # frontend via Vite
```

On first launch open Settings and paste an API key (Base URL and model name ship with sensible defaults and remain editable).

Desktop:

```bash
npm run desktop:dev      # run inside Electron
npm run desktop:pack     # unpacked directory build
npm run desktop:dist     # NSIS installer
```

> Before packaging, install `better-sqlite3` against the Electron ABI:
> `npx prebuild-install --runtime=electron --target=33.4.11`

### Configuration

UI settings take precedence over environment variables:

| Setting | Default | Notes |
|---|---|---|
| `llmBaseUrl` | `https://api.deepseek.com` | Any OpenAI-compatible endpoint |
| `llmModel` | `deepseek-chat` | Model name |
| `llmApiKey` | empty | Required; stored locally only |
| `enableWiki` | `false` | Use Wikipedia to enrich topic search |

### Security and privacy

- The API key is written only to the local SQLite database and shown masked in the UI
- The database, uploads and temporary debug JSON are all listed in `.gitignore`
- Quiz answers live server-side and are never sent to the client

---

## License

Private project. Not published for redistribution.
