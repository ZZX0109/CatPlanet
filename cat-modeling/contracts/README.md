# 猫模型任务契约 v1

`index.mjs` 提供 Zod 运行时严格验证，旁边的 JSON Schema 用于语言无关交接；`parseContract(kind, value)` 同时执行跨字段约束，包括头型混合比例、参考必需性、拓扑匹配与 guide 重心绑定。JSON Schema 的单字段通过不能替代这些跨字段检查。

修改契约后用 `node cat-modeling/contracts/generate-schemas.mjs --write` 更新机器可读文件；`--check` 只读检查同步状态。公开回归测试会核对全部 JSON Schema 与 Zod 定义，防止跨语言契约漂移。该维护命令只更新本目录规范，不执行模型任务。

规范 `$id` 使用 `urn:miaoxing:cat-modeling:contracts:*:1`，与历史 fixture 的 schema ID 分开，避免跨语言校验器缓存将两套 v1 协议混为一谈。

这些契约用于把网页中的设计参数与独立本地建模任务衔接。契约本身不提供猫专用模型、AI 权重、照片重建、训练器或远程服务；`infer` 默认必须明确报告 `MODEL_UNAVAILABLE`。固定原创几何测试引擎独立放在 fixture 路径，不能替代真实推理结果。

## 请求边界

`requestVersion` 描述本任务协议；`jobId` 标识隔离任务；`operation` 区分 `model-fit`、`local-edit`、`groom-adjust`、`model-validate` 和兼容保留的 `groom-validate`。模型选择由 `modelId`、具体二进制摘要 `modelRevision`、`templateId` 及 `topologyVersion` 共同约束。版本、标识、数值范围和未知字段由本目录严格机器可读契约及运行时验证器共同约束，错误必须保留机器可读错误码。

| 字段 | 约束及用途 |
| --- | --- |
| `coordinates` | 右手坐标系、米制、Y 向上、+Z 向前、地面中心原点。不得在读取时默默换算、翻轴或移动原模型。 |
| `dimensions` | `height`、`width`、`length` 为米制目标尺寸；正有限数值且受上限约束。不能将请求尺寸直接记为实测尺寸。 |
| `budgets` | 顶点、三角形、关节及纹理字节上限。预算声明不代表当前模型满足预算，需实际读取交付物检查。 |
| `executionBudget` | 声明本地执行器的超时、内存、设备与显存预算。示例为 CPU、300 秒、4096 MiB 内存、0 MiB 显存；这只是限制，不代表已经启动执行或实际资源已满足。 |
| `appearance` | design schema v5 的外观参数，保留当前 20 项控制语义；参数范围严格校验，不截断。 |
| `groom` | 独立 groom schema 版本，显式节点／拓扑绑定、表示及 guides；不从最大网格或第一个蒙皮网格猜测生长面。 |
| `features` | 带坐标、来源与置信度的显式 landmarks；`inferred` 不能伪装成用户确认或实测。 |
| `references` | 相对输入根的文件路径、SHA-256、类型、来源和授权证据、用途许可及主人同意。model-fit 必须有合法参考；参考授权元数据不替代证据审查。 |

设计参数语义版本、具体模型修订、顶点／骨骼／morph 拓扑版本与 groom 编码版本互相独立。仅把 `schemaVersion:4` 改为 5 不能证明兼容，也不能把 fixture 的独立外观格式直接套入房间。旧 design 迁移仍由应用当前迁移器与其回归测试负责。

## 三模块接口

| 模块 | 输入与边界 | 可接受交付及校验 |
| --- | --- | --- |
| A：形态（morphology） | 授权参考、目标尺寸、特征坐标、模型／模板／拓扑、v5 参数。操作限定于已登记参数或显式适配器，不重写原造型室。 | 新外观及自包含 GLB，记录实际支持的控制、morph 名称、绑定和语义动画，按真实文件检查预算和坐标。不声称任意照片自动重建。 |
| B：毛色花纹（coat pattern） | 授权参考、材质／UV 布局及已有外观。与形态独立版本化，避免颜色变更造成拓扑改变。 | 材质／纹理和映射说明，明确色彩空间、UV 与文件摘要；不得用花纹假装脸型或毛束形变。未实现适配器时报告 unavailable。 |
| C：毛发（groom） | 显式 bodySurface、拓扑、原点／单位、分区参数及 guides。绑定依赖真实三角形、重心坐标与方向。 | 独立 groom 数据及表示能力；明确 `none`、网页几何、卡片或侧车曲线。Blender 原生 Hair Curves／Cycles closure 不属于标准 GLB 默认能力。拓扑变化必须拒绝旧绑定。 |

三个机器可读模块分别为 `module-a-morphology.schema.json`、`module-b-coat-pattern.schema.json` 和 `module-c-groom.schema.json`，共有 `interfaceVersion:1`、请求摘要、模型标识／修订、拓扑和坐标字段；模块 `state` 区分 `unavailable` 与 `validated-output`。A 携带 appearance、model 文件引用和 features；B 携带 UV 布局修订、pattern 版本、类型、来源和纹理引用；C 携带独立 groom。`unavailable` 状态不能被当成实测或已生成输出。

第一轮接口只规定模块边界和版本化交接。是否支持某个 representation、模块及 operation 以当前运行时契约为准；文档不能扩大实际 validator 或执行器的能力。模块未实现时不得生成虚假的成功资产或权重。

## 输出与本地执行器交接

交付目录保存 `request.json`、`appearance.json`、`model.glb`、groom 数据、`manifest.json`、`validation.json` 和固定场景预览证据。manifest 将输入摘要、工具／引擎版本、四项独立版本及输出摘要连成可追溯谱系。validation 分开报告结构、文件、许可、模型可用性和视觉状态；缺失原资产、未执行的检查或私有模型无法访问必须是 blocked／unrun，不能写 passed。

CLI 可以准备本地 Blender 可读取的任务描述，但不会在网页请求或云端 CLI 内启动 Blender、Python 推理或下载权重。由用户确认的本地执行器负责读取隔离输入、核验授权、执行约定操作并写入隔离输出。任务描述只说明操作，不是已经执行的证据。

固定预览应记录相机、灯光、设计参数、姿态、坐标规范及各输入摘要。Blender、造型室、GLB 回读和纪念房间的报告须区分引擎材质／光照差异与资产能力损失；缺少任何阶段时不得宣布四阶段视觉验收通过。

## 权限、隔离和发布

未知授权、缺证据或不同用途的授权不可相互替代。参考图路径／摘要校验不能证明训练权；真实模型可本地查看也不代表可以公开分发。来源不明素材只进入受限本地审查，不进入训练、公共资产或线上模型。

所有非 dry-run 操作只写隔离 job 目录，保留执行日志和机器可读错误；dry-run 不写目录、任务或日志。原始资产、数据库和真实用户记录不移动、不清空、不重置。现有目录／输出不覆盖。正式发布必须有完整重新校验证据、许可和人工针对本任务的明确确认；当前缺少生产执行器和验收证据时保持 unavailable，不能用 fixture 的暂存功能激活生产模型。

跨语言 JSON 交接示例见 [examples/README.md](./examples/README.md)。示例只序列化请求，不证明真实素材或推理已经可用。
