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
| `reasoning` | `string` | 是 | 支持结论的论证、解释或证据摘要，去除首尾空白后不得为空。 |
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

v1 只定义一种可持久化关系：**前提支持结论**。

```text
前提节点 --premise-of/supports--> 结论节点
```

关系不单独存储。结论节点通过 `premises` 保存直接前提 ID，图投影按以下规则派生边：

```ts
{ from: premiseId, to: conclusionId }
```

因此：

- `premises` 的顺序不表达优先级或推理顺序。
- 一个结论可以有零到多个直接前提；一个前提也可以支持多个结论。
- “反驳”“相似”“引用”“包含”等关系尚未进入 v1 协议，不得编码为 `premises` 的特殊字符串。
- 依赖传播沿 `from → to` 方向进行：前提被证伪时，其所有可达结论会被悬置。

## 3. 前提与结论结构

每个节点本身是一条结论（知识主张）；其 `premises` 是直接前提集合，`reasoning` 说明从这些前提到当前结论的推理或证据链。

设节点 `C` 的 `premises = [P1, P2]`，则形成两条边 `P1 → C` 和 `P2 → C`。间接前提不重复写入 `C.premises`，而由图的传递可达关系计算。

当前实现允许无前提节点，用于公理、定义、原始事实或尚未补全论证的草稿。协议层尚未区分“联合前提”（全部成立才支持结论）和“备选前提”（任一成立即可支持结论）；v1 将同一数组视为一组直接依赖，任意一个前提被证伪都会触发下游悬置。

## 4. 知识状态

### 4.1 验证状态 `status`

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

### 4.2 掌握状态 `mastery`

`none`（未接触）、`touched`（接触过）、`mastered`（完全掌握）仅描述用户与知识的关系。它与 `status` 正交，不得用来表示节点是否真实或有效。

## 5. 版本机制

系统存在两个不同层级的版本号，不得混用：

### 5.1 节点内容版本 `KnowledgeNodeRecord.version`

- 新节点从 `1` 开始。
- 它用于标识同一 `id` 下内容的修订代次。
- 当前服务端按 `id` 保存最新记录，尚未自动递增版本，也未保留历史版本。
- 在实现更新接口前，调用方若覆盖节点，应当递增 `version` 并更新 `updatedAt`；服务端后续应使用乐观并发检查拒绝旧版本覆盖。

### 5.2 事件协议版本 `DomainEvent.schemaVersion`

- 当前值为 `1`，表示事件载荷结构的版本。
- 每个事件包含稳定 `id`、事件 `type`、`timestamp`、可选本地顺序号 `seq` 及 `payload`。
- `seq` 由本地 `EventStore` 恢复或追加事件时分配，只表示该存储中的顺序，不是跨客户端全局版本。
- 事件以 ID 去重；命令 ID 根据事件类型、规范化载荷和 5 秒时间桶生成。
- 本地持久化信封也使用 `schemaVersion: 1`。它是存储格式版本，与节点内容版本不同。
- 投影遇到未知事件版本时目前只发出警告；正式升级必须先提供迁移或兼容读取逻辑，再提高当前协议版本。

## 6. 验证规则

### 6.1 当前代码已执行的记录验证

`validateKnowledgeNodeRecord` 当前检查：

- `id`、`title`、`reasoning` 去除首尾空白后非空。
- `type` 属于八种节点类型。
- `status` 属于五种验证状态。
- `mastery` 属于三种掌握状态。
- `domain` 存在。
- `premises` 和 `tags` 均为数组。

创建记录时会对 `title`、`reasoning` 去除首尾空白，并补齐 `premises`、`tags`、`domain`、初始状态、掌握状态、版本和时间戳。

### 6.2 图级完整性规则

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

### 6.3 事件验证规则

事件进入事件存储前应满足：

- `id` 非空且在事件流内唯一。
- `schemaVersion` 为读取方支持的版本。
- `timestamp` 是有效的 Unix 毫秒时间戳。
- `type` 与 `payload` 结构匹配。
- 除 `NodeCreated` 外，目标 `nodeId` 应已存在。
- `NodeCreated.nodeId` 不得与已有节点冲突。
- `NodeEdited.premises` 应通过图级完整性验证。
- `NodeSuspended.causeNodeId` 应存在；独立悬置事件当前用目标节点自身作为原因。

## 7. 当前边界与后续演进

当前代码同时包含事件投影模型（`GraphNode`）和服务端持久化模型（`KnowledgeNodeRecord`）。前者只包含图展示和状态传播需要的字段，后者额外包含标签、学科、作者、内容版本及时间戳。二者应通过显式映射转换，不应把节点内容版本等同于事件协议版本。

建议后续协议升级优先完成：服务端统一校验、前提引用/环检测、带版本条件的更新、历史版本保存，以及需要多种语义关系时新增独立 `KnowledgeRelation`，而不是改变 v1 `premises` 的含义。
