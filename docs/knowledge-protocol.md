# 知识协议：数据模型与验证规则

本文档描述当前 v1 实现中的规范性数据模型。文档中的 **必须**、**不得**、**应当** 用于区分协议约束与界面展示约定。

## 1. 节点数据结构

持久化节点使用 `KnowledgeNodeRecord`，创建请求使用 `KnowledgeNodeDraft`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 节点的稳定唯一标识；创建后不得改变。 |
| `title` | `string` | 是 | 去除首尾空白后不得为空。 |
| `type` | `KnowledgeNodeType` | 是 | 节点的认识论类型，见下表。 |
| `status` | `KnowledgeNodeStatus` | 是 | 知识验证状态；新节点固定为 `pending`。 |
| `mastery` | `KnowledgeMastery` | 是 | 用户掌握程度；新节点固定为 `none`，不属于知识真值。 |
| `reasoning` | `string` | 是 | 节点描述；对于 `reasoning` 节点，它是可检查的推理过程。去除首尾空白后不得为空。 |
| `premises` | `string[]` | 是 | 直接前提节点的 ID；草稿省略时归一化为空数组。 |
| `tags` | `string[]` | 是 | 检索标签；草稿省略时归一化为空数组。 |
| `domain` | `KnowledgeDomain` | 是 | 学科域；草稿省略时使用 `general`。 |
| `version` | `number` | 是 | 节点内容版本；新节点为 `1`。 |
| `createdAt` | ISO 8601 `string` | 是 | 首次创建时间。 |
| `updatedAt` | ISO 8601 `string` | 是 | 最近更新时间；创建时与 `createdAt` 相同。 |
| `author` | `string` | 否 | 作者或提交者标识。 |

节点类型：

| 值 | 含义 |
| --- | --- |
| `axiom` | 在当前体系内作为推理起点接受的公理。 |
| `definition` | 对概念、符号或边界的定义。 |
| `fact` | 经观察或来源支持的事实陈述。 |
| `theorem` | 由前提推导并完成验证的定理。 |
| `hypothesis` | 尚待充分检验的假说。 |
| `prediction` | 可由未来观察检验的预测。 |
| `opinion` | 可争论的解释或主张。 |
| `value` | 价值判断或规范性主张。 |
| `reasoning` | 位于前提结论与结论之间的推理过程知识球。 |

学科域枚举为 `logic`、`mathematics`、`physics`、`biology`、`chemistry`、`computer-science`、`economics`、`history`、`philosophy`、`general`。

### 示例

```json
{
  "id": "node-modus-ponens",
  "title": "肯定前件式",
  "type": "theorem",
  "status": "verified",
  "mastery": "touched",
  "reasoning": "由条件命题与其前件推出后件。",
  "premises": ["node-conditional", "node-antecedent"],
  "tags": ["演绎", "命题逻辑"],
  "domain": "logic",
  "version": 1,
  "createdAt": "2026-08-08T00:00:00.000Z",
  "updatedAt": "2026-08-08T00:00:00.000Z",
  "author": "example"
}
```

## 2. 关系类型与方向

v1 使用同一种有向依赖边表达两段关系：**前提结论进入推理过程**，以及**推理过程产出结论**。

```text
前提节点 --input-of--> 推理过程知识球 --produces--> 结论节点
```

关系不单独存储。每个节点通过 `premises` 保存直接上游节点 ID，图投影按以下规则派生边：

```ts
{ from: premiseId, to: conclusionId }
```

因此：

- `premises` 的顺序不表达优先级或推理顺序。
- 一个推理过程可以有一个或多个前提；一个前提也可以进入多个推理过程。
- 非原始结论必须直接依赖一个 `reasoning` 节点。不得再用“结论直接依赖前提”的方式省略推理过程知识球。
- “反驳”“相似”“引用”“包含”等关系尚未进入 v1 协议，不得编码为 `premises` 的特殊字符串。
- 依赖传播沿 `from → to` 方向进行：前提被证伪时，其所有可达结论会被悬置。

## 3. 前提与结论结构

除 `reasoning` 类型外，每个节点是一条结论（知识主张）。一条完整推理链由 `ReasoningChain` 表示：`premiseIds`、`reasoningId`、`conclusionId`。

设前提为 `P1`、`P2`，推理过程为 `R`，结论为 `C`，必须存为 `R.premises = [P1, P2]` 和 `C.premises = [R]`，形成 `P1/P2 → R → C`。当 `P1` 本身由上一条推理链产生时，`P1` 正是上一条链的结论。

无前提节点仅用于公理、定义或原始事实。协议层尚未区分“联合前提”（全部成立才支持结论）和“备选前提”（任一成立即可支持结论）；v1 将同一数组视为一组直接依赖，任意一个前提被证伪都会触发下游悬置。

## 4. 知识编辑协议

所有编辑先验证再应用。替换不删除历史：旧节点改为 `suspended` 或 `falsified`，并用 `supersededBy` 指向替代节点。四种合法修改如下。

### 4.1 否定 `negate`

- **否定前提或结论**：必须列举至少一个已存在的反例知识节点 `counterexampleIds`；没有反例的直接否定无效。
- **否定推理过程**：目标必须是 `reasoning` 节点，并必须提交新的 `correctedReasoning`。正确推理继承原推理的全部前提，原结论改为依赖正确推理，错误推理标记为 `falsified`。
- 否定前提或结论后，既有级联规则继续将所有下游知识悬置。

### 4.2 分解 `decompose`

当一个推理过程还可以拆为两个或更多可检查步骤时，可以分解。分解必须：

1. 保持整条链的原始 `premiseIds` 和 `conclusionId` 不变。
2. 提供至少两个 `reasoningSteps`。
3. 在每两个相邻推理过程之间添加恰好一个新的中间结论，因此中间结论数必须等于推理步骤数减一。
4. 将第一步连接到原前提、最后一步连接到原结论，并将旧推理过程标记为被替代。

例如 `P → R → C` 分解为 `P → R1 → M1 → R2 → C`；端点仍然是同一 `P` 和 `C`。

### 4.3 合并 `merge`

合并用于多条链拥有相同前提、相同推理过程，而结论只是命名或描述不同、语义实际相同的情况。合并必须：

1. 至少包含两条有效推理链，并具有相同的前提集合。
2. 推理文本规范化（去除多余空白并忽略大小写）后相同；若不同，必须先编辑或合并推理过程，不能直接合并结论。
3. 提供非空 `semanticKey`，明确声明结论的语义等价性。
4. 先建立统一的 `mergedReasoning`，再建立依赖它的 `mergedConclusion`。
5. 将原结论名称保存在合并结论的 `aliases` 中，并用 `supersededBy` 保留来源链。

### 4.4 增加 `add`

增加一条知识链时必须一次提交三个部分：

1. 标记一个或多个已存在的所需前提 `requiredPremiseIds`，不得重复。
2. 新建 `reasoning` 类型的推理过程知识球。
3. 新建非 `reasoning` 类型的结论及其描述。

应用后形成 `requiredPremiseIds → reasoning → conclusion`，不允许绕过推理知识球直接连接两个结论。

## 5. 知识状态

### 5.1 验证状态 `status`

| 状态 | 含义 | 产生方式 |
| --- | --- | --- |
| `pending` | 已提交，尚未完成验证。 | 创建节点的初始状态。 |
| `verified` | 当前验证流程已接受。 | `NodeResolved`。 |
| `disputed` | 存在待解决的异议。 | `NodeDisputed`。 |
| `suspended` | 暂停采信，通常因依赖前提失效。 | `NodeSuspended` 或证伪级联。 |
| `falsified` | 已被证伪。 | `NodeFalsified`；当前投影中为终止状态。 |

当前事件投影的状态规则：

1. `NodeCreated` 总是产生 `pending` 节点。
2. `NodeResolved` 将非 `falsified` 节点设为 `verified`。
3. `NodeSuspended` 将非 `falsified` 节点设为 `suspended`。
4. `NodeDisputed` 将节点设为 `disputed`。
5. `NodeFalsified` 将节点设为 `falsified`，并对所有可达下游节点追加 `NodeSuspended`。
6. 当前实现没有“撤销证伪”事件；要改变已证伪主张，应创建新版本或新节点，而不是直接覆盖历史。

### 5.2 掌握状态 `mastery`

`none`（未接触）、`touched`（接触过）、`mastered`（完全掌握）仅描述用户与知识的关系。它与 `status` 正交，不得用来表示节点是否真实或有效。

## 6. 版本机制

系统存在两个不同层级的版本号，不得混用：

### 6.1 节点内容版本 `KnowledgeNodeRecord.version`

- 新节点从 `1` 开始。
- 它用于标识同一 `id` 下内容的修订代次。
- 当前服务端按 `id` 保存最新记录，尚未自动递增版本，也未保留历史版本。
- 在实现更新接口前，调用方若覆盖节点，应当递增 `version` 并更新 `updatedAt`；服务端后续应使用乐观并发检查拒绝旧版本覆盖。

### 6.2 事件协议版本 `DomainEvent.schemaVersion`

- 当前值为 `1`，表示事件载荷结构的版本。
- 每个事件包含稳定 `id`、事件 `type`、`timestamp`、可选本地顺序号 `seq` 及 `payload`。
- `seq` 由本地 `EventStore` 恢复或追加事件时分配，只表示该存储中的顺序，不是跨客户端全局版本。
- 事件以 ID 去重；命令 ID 根据事件类型、规范化载荷和 5 秒时间桶生成。
- 本地持久化信封也使用 `schemaVersion: 1`。它是存储格式版本，与节点内容版本不同。
- 投影遇到未知事件版本时目前只发出警告；正式升级必须先提供迁移或兼容读取逻辑，再提高当前协议版本。

## 7. 验证规则

### 7.1 当前代码已执行的记录验证

`validateKnowledgeNodeRecord` 当前检查：

- `id`、`title`、`reasoning` 去除首尾空白后非空。
- `type` 属于九种节点类型。
- `status` 属于五种验证状态。
- `mastery` 属于三种掌握状态。
- `domain` 存在。
- `premises` 和 `tags` 均为数组。

创建记录时会对 `title`、`reasoning` 去除首尾空白，并补齐 `premises`、`tags`、`domain`、初始状态、掌握状态、版本和时间戳。

### 7.2 图级完整性规则

写入或导入数据时还应当执行以下规则；这些规则是协议要求，但当前 v1 服务端尚未全部强制：

1. **唯一性**：同一命名空间内 `id` 必须唯一。
2. **引用完整性**：每个 `premises` 条目必须指向同一命名空间中存在的节点。
3. **禁止自引用**：节点不得把自己的 `id` 放入 `premises`。
4. **前提去重**：同一节点的 `premises` 不得包含重复 ID。
5. **无环性**：前提关系应形成有向无环图；新增或编辑关系不得制造环。
6. **时间有效性**：`createdAt`、`updatedAt` 必须是有效 ISO 8601 时间，且 `updatedAt >= createdAt`。
7. **版本有效性**：`version` 必须是大于等于 `1` 的整数；覆盖现有节点时必须大于已存版本。
8. **枚举完整性**：`domain` 也必须属于协议定义的枚举，而不只是非空。
9. **字符串元素**：`premises`、`tags` 中每个值都必须是非空字符串。
10. **状态传播**：前提证伪后，所有传递依赖节点必须悬置；级联过程必须防止重复访问。
11. **推理链完整性**：推理过程必须是 `reasoning` 类型且直接依赖声明的全部前提；非原始结论必须直接依赖推理过程知识球。
12. **编辑证据**：否定、分解、合并、增加必须分别满足第 4 节的反例、端点不变、语义等价和完整链要求。

### 7.3 事件验证规则

事件进入事件存储前应满足：

- `id` 非空且在事件流内唯一。
- `schemaVersion` 为读取方支持的版本。
- `timestamp` 是有效的 Unix 毫秒时间戳。
- `type` 与 `payload` 结构匹配。
- 除 `NodeCreated` 外，目标 `nodeId` 应已存在。
- `NodeCreated.nodeId` 不得与已有节点冲突。
- `NodeEdited.premises` 应通过图级完整性验证。
- `NodeSuspended.causeNodeId` 应存在；独立悬置事件当前用目标节点自身作为原因。

## 8. 当前边界与后续演进

当前代码同时包含事件投影模型（`GraphNode`）和服务端持久化模型（`KnowledgeNodeRecord`）。前者只包含图展示和状态传播需要的字段，后者额外包含标签、学科、作者、内容版本及时间戳。二者应通过显式映射转换，不应把节点内容版本等同于事件协议版本。

建议后续协议升级优先完成：服务端统一校验、前提引用/环检测、带版本条件的更新、历史版本保存，以及需要多种语义关系时新增独立 `KnowledgeRelation`，而不是改变 v1 `premises` 的含义。
