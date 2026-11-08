# 猫咪建模云端接入与本地制作边界

本记录基于 `feat/cat-modeling-foundation` 分支，延续 `1cb9a80` 的第一轮基础架构修复；对应远端应用基线为 `d29ff75`。以下区分当前代码路径、已有公开测试能够证明的行为，以及后续 worker 接口要求。最终执行结果见本轮测试记录与 Draft PR，不能用本页的目标接口当作已运行的 AI 能力。

公开仓库没有 `audit-output/cat-modeling-audit.md`、Norwegian/Sphynx 私有基础 GLB、房间不可变存档 GLB、作者 Blender 文件和原生 groom。`.gitignore` 有意排除了这些内容。原 Mac 上未提交内容及审查之后的本地变化无法通过 GitHub 自动核对；合回前必须在 Mac 单独比对，不用云端文件覆盖它们。此次不清理数据库、不训练、不自动激活模型，也不将测试 fixture 称作生产猫。

## 当前完整调用链

### 编辑、解析与保存

`components/CatCreator.tsx` 使用 `useCatCreatorDesign` 管理当前外观。`lib/cat-creator-design.ts` 定义 14 个脸部控制与 6 个毛量/毛长控制，范围 0–100；圆润/楔形混合权重之和不能大于 100。预设、部位操作、撤销/重做和对照都围绕同一份 CreatorDesign，保存不是生成另一份模型。

本机保存键为 `miaoxing.cat-creator.foundation.v1`，旧 `miaoxing.cat-creator.norwegian.v1` 仅作为恢复来源。导入和恢复统一调用 `parseCreatorDesign`；失败保留原本机记录，只有显式保存才写入新 JSON。导入仅限外观参数，不接受任意远程模型地址。JSON 序列化使用固定键序，供撤销和已保存状态比较。切换品类保留脸型数值，改用对应 profile 的六项毛参默认值；不同母模的相同数值只是相对控制，不保证绝对外观相同。

房间的 `RoomAppearanceControls` 导入同一 JSON，`MemorialRoom` 在宠物草稿中保存 `appearance` 和 `appearanceAsset`。服务端 `app/api/[...path]/route.ts` 再次调用同一解析器，校验登记资产与品类，并使用资料版本号避免覆盖另一设备的新记录。旧客户端省略 appearance 时保留既有外观；显式 null 才移除定制外观。`appearanceAsset` 是已登记的资产 ID，不是任意 URL。`lib/room-draft.ts` 用相同契约恢复本机草稿，不能把云端模型任务直接写入真实宠物档案。

### 母模选择与实际能力

`cat-coat-profiles.ts` 将 `hairless` 映射到 Sphynx，将 `short/long` 都映射到 Norwegian；短/长毛目前不是两套独立完成的解剖网格。profile 定义分区长度范围、底绒/过渡毛/护毛比例、宽度、弯曲、束化、重力等，不能只按单个长度滑块理解。

`CatCreator` 拉取造型室基础 GLB；`RoomCreatorCat` 使用登记资产 URL，先校验真实字节长度和完整 SHA-256，再交由 GLTFLoader 解码。两者均经过 `ownCreatorModel`，复用 metadata、头部范围、五官定位、目标和骨架语义检查，以及显式 `bodySurface` 解析。能力报告应以实际解码对象为证据，不把 manifest 中的 target 数量当作运行时检查结果。

现有作者脚本将身体与光学眼球的多材质导出为一个逻辑节点；GLTFLoader 会拆成多个 SkinnedMesh。解析规则必须支持该分拆，通过节点/角色/受支持旧材质语义区分身体与眼球，不选顶点最多、遍历第一项或“剩下的任意网格”。未知或多义的表面应失败并报告具体缺口。

两份已同步 creator manifest 各声明 53 targets：26 个基础目标（14 个控制对应的 2 个头型目标与 12 组 low/high）、1 个 Blink、26 个 Blink 修正。旧文档的 26 是早期基础目标数量。房间存档与 creator manifest 的哈希不同，真实二进制缺失时不能断言它们具有相同数量、相同位移或相同闭眼表现。

### 毛发与逐帧动作

`lib/norwegian-fur.ts` 在已解析的身体表面使用三角形、重心坐标和 UV 绑定毛根与毛色，按 head/ruff/body 分区生成确定性几何毛束。表面求值包含 morph 和蒙皮，方向随表面传递；毛量决定绘制数量，毛长和 coat profile 决定真实几何。`coatMode:source` 使用原模型及必要细节路径，不把原生表面贴图冒充逐根毛发；`groom` 才启用附加完整程序毛。无毛 Sphynx 不运行 Norwegian 全身 groom。

造型室的 `CatCreatorScene` 调用程序动作适配器：stand/rest、呼吸和闲置眨眼；根据身体/眼睛变化按节流刷新毛发，远景降低预览细节，导出仍使用设定的完整毛量。当前能力依赖原骨架语义，源文件存在动画片段不能证明其 walk/sleep 已获得统一语义或毛发绑定验收。

房间 `RoomCreatorCat` 当前不推进造型室的逐帧动作：应用外观后保持静态姿态，轻触时旋转整个组。基础 Toon/Vuena 的旧动作映射独立保留；定制猫的房间走路/休息按钮仍禁用。不能将造型室趴卧可预览宣传为房间动画交付完成。

### GLB 导出与发布

`cloneCreatorForExport` 使用 SkeletonUtils 克隆，恢复真正材质/可见性、应用当前权重，再生成全设定毛量的静态 groom 快照。导出明确移除动画，避免源骨架动作使皮肤离开静态毛层。它保留外观元数据，但不是完整可再次编辑的 Blender 原生 groom，也不是动画毛发交付。原生 Hair Curves、粒子毛和 Cycles closure 没有默认的 GLB 支持承诺。

`room-model-assets.json` 保存不可变资产身份，`current` 只是推荐指针；旧宠物仍引用旧 asset ID。运行时 groom/形变实现也影响画面，因此固定 GLB 字节不等于完整冻结历史渲染效果。

第一轮已把 `scripts/publish-room-models.mjs` 改为默认拒绝激活。`--plan` 只读；显式确认后的 `--local-review-only` 只向受限目录暂存，不更新 current、公开目录或数据库。`docs/MODEL-INTEGRATION.md` 本轮同步移除了旧的“直接发布并更新登记”指令。CLI 默认生产 `publish` 明确返回不可用；只有显式 fixture 模式支持原创样本的隔离暂存。正式发布还需要内容校验、来源/用途许可、视觉验收和用户明确确认。

## 版本、渲染器与旧数据兼容

| 字段 | 当前含义 | 不能替代的证明 |
| --- | --- | --- |
| `designSchemaVersion` | 参数 JSON 的语义和迁移；现有 `schemaVersion` 为兼容旧客户端保留的别名 | 不能代表二进制、骨架或毛根布局 |
| `assetRevision` | 特定交付模型字节的 SHA-256；引用不可变文件 | 同哈希证明同字节，不证明许可、视觉或动画合格 |
| `topologyVersion` | 顶点/面/UV/骨架/形变绑定所属契约；当前按底模区分 | 模板字符串本身不能证明实际 GLB 符合契约，须检查能力与布局 |
| `groomSchemaVersion` | 毛根、引导、长度/密度/方向及表示方式的数据契约 | 不能把原生 Blender 曲线和静态 GLB 几何视作同格式 |
| `rendererCompatibility` | 独立的渲染器 ID、契约版本和支持的 renderer 版本列表 | 不能代表 glTF 材质与 Blender BSDF 完全一致；不支持的运行时应在加载所有权建立前拒绝 |
| `capabilities` | 资产登记的 `requirements-only` 能力需求与加载后的实际观察分开；检查 morph 缓冲、体表、绑定和材质 | 不能把“需要此能力”写成“私有二进制已验收”；缺少真实文件仍为 blocked |

| 输入或资产 | 当前/目标处理 | 验证边界 |
| --- | --- | --- |
| v3 `norwegian-cat-v1` 外观 | 迁移至 foundation v5；保留脸型和已有毛参，只补缺少的旧 groom 默认值，默认完整 groom | 不改旧本机原文；不可套用到 legacy structural v2 |
| v4 `cat-foundation-v1` 外观 | 迁移至 v5，保留数值和品类，按既有 v5 迁移策略恢复完整 groom | 不能把旧 v4 source 显示策略误称为逐像素保持；需人工视觉对照 |
| v5 外观 | 保留显式 source/groom；两个版本别名同时存在必须一致 | 未知字段、未来版本、非法数值或混合越界应拒绝 |
| 旧房间登记 `schemaVersion:4` | 保留原 URL、字节、哈希和 current；与外观版本不再直接判等，分别检查支持范围/拓扑/groom/资产身份 | 私有旧 GLB 未到位时能力与真实旧外观应为 blocked，而非“已兼容” |
| 原创 fixture 外观 | 独立命名空间和版本，仅用于隔离 pipeline 回归 | 不转名冒充 creator v5，不直接导入真实房间 |
| 后续 worker 输出 | 严格输入版本、来源、目标底模和实际能力；先验证，再受限预览 | worker 声称某字段/某许可证不构成可信授权或正式发布批准 |

兼容性包括两层：参数迁移/契约检查可在公开 fixture 上验证；真实旧猫的几何、毛根、材质、动作与视觉等价必须用对应旧文件运行，不能互相替代。

## 第一轮已覆盖与仍缺内容

已建立的基础包括共用解析/权重、分离版本身份、显式表面选择、多图元回读测试、两端能力报告、隔离 deterministic CLI、固定视觉方案、发布保护和 Skill 操作边界。第一轮的详细文件与当时测试结果见 `CAT-MODELING-FOUNDATION-REPORT.md`，本轮修改后仍须重跑相关检查，不能照搬旧数字。

尚缺真实母模二进制与原审查基线、来源完整的本地 Blender 验收材料、实际 room/creator morph 与绑定差异结果、完整参数组合的视觉质量、原生 groom 到网页表示的损失测量，以及真实手机/Windows 性能。真实照片输入、猫专用预测、训练权重、GPU worker、对外生产发布和在线服务尚未由 fixture 实现。

## 云端任务与本地 Blender worker

云端负责版本化任务、输入检查、授权元数据引用、资源摘要、状态跟踪和报告收集。任务不能依赖 Mac 上的绝对路径在云端存在，也不能把云端缺少 Blender/资产写成成功。任务输入至少表达：`requestVersion`、`jobId`、`operation`、`modelId`、`modelRevision`、`templateId`，以及授权参考图的标识与 SHA-256、appearance、groom/features、坐标/单位/尺寸、几何预算、执行设备/时间/内存预算和输出需求。字段的实际约束以本轮机器可读 schema 和 CLI 为准，不使用任意 JSON 透传给 worker。

worker 协议应有不含供应商细节的 `capabilities → plan → submit → status → artifacts → validate` 边界。模型版本、运行器版本、输入摘要和 seed 共同形成可追溯任务。服务端不能因为拿到 `jobId` 就向任意文件系统路径写入；所有输出位于新建隔离目录，禁止路径穿越、符号链接逃逸、覆盖原资产和沿用旧 passing report。

没有可用 Blender、对应工具版本或获准原文件时，应导出一个可执行的本地任务包，状态保持 `blocked/awaiting-local-worker`。本地 worker 校验输入摘要、所需 Blender/插件和权限后执行；云端回收结果重新校验，不将生成待办文件称为完成推理或完成渲染。离线原生任务示例：

```sh
blender --background <获准审查的作者副本.blend> \
  --disable-autoexec --threads 2 --python-exit-code 1 \
  --python scripts/render-cat-validation.py -- \
  --design <同一份appearance.json> --output artifacts/<全新目录>
```

这是现有视觉脚本的调用形态，不是允许执行任意用户脚本的通用队列。未来 worker 必须使用固定操作 allowlist；不在 Next.js 请求进程加载 CUDA、训练网络或持有供应商专有实现。Next 只提交任务和读取经校验的状态/产物。提供商适配器、凭据与 GPU 依赖留在独立 worker，取消/失败/重试要保留同一任务输入并防止重复激活。

### 本地返回证据清单

1. **来源与权限**：作者/下载来源、原始许可文件及摘要、获取时间、用户提供范围；本地审查、修改、产品分发、训练和权重发布分别判断。未知授权维持 restricted-local-review，不能在 manifest 写 `verified` 后自我放行。私人照片须有主人同意并确认摄影版权，不携带邮箱、用户记忆或生产数据库。
2. **身份与谱系**：原始 `.blend`、导入 GLB、导出 GLB、groom、贴图的完整摘要；任务输入与 modelRevision；源文件执行前后摘要相同；实际执行命令、工具/插件版本、导出器选项和日志。原文件不保存，研究副本新命名。
3. **实际能力**：按 mesh 的 POSITION/UV/skin/morph 布局、顶点有限性、bodySurface 及 primitive/材质角色、真实骨架层级/蒙皮、动作映射与缺失项；53/26 逐项名称及位移而非只对数字。
4. **固定视觉**：scenario ID/摘要、同一 design/pose/blink/时间、归一化、相机/分辨率、灯光/色彩/曝光；Blender、creator、GLB 回读、room 四阶段三视图原图及图片摘要。报告必须保留缺阶段状态；Cycles 与 Three 的灯光/BSDF 数值不可直接视为等价。
5. **毛发与形变**：头/胸/身体毛量/长度，毛根与变形皮肤误差，原生曲线、几何毛束、材质和动画输出表示；闭眼及脸型组合、趴卧/步态、极值穿插和质量限制。没有测量的项目标记 unrun/blocked。
6. **不可伪造的成功判定**：返回报告只是 worker 的证据载体。云端重新核对实际文件/摘要/请求版本/语义能力，执行已支持的导入检查；保存工具退出码。fixtureOnly、missingAssets、unrun、expected-failure 与 passed 分开，不能用 synthetic fixture 报告为私人猫资产背书。

## A / B / C 后续模型路线

三类模型保持独立、版本化接口；组合时校验同一 template/topology/UV/单位/资源摘要。每类都可先用确定性或人工标注基线实现，未安装模型时应明确 unsupported，不生成虚假权重或随机“预测”。

| 模块 | 输入与输出契约 | 验证门槛与实施顺序 |
| --- | --- | --- |
| **A：猫咪三维形态参数预测** | 输入获准参考图/相机、目标模板和形态范围；输出有置信度与来源的 appearance/features、目标拓扑和维度。输出受现有控制范围与组合约束管理，不任意生成新拓扑 | 先人工标注/确定性参数拟合，检查中性/极值/组合形变、眼睑/眼球/骨架联动和跨视图轮廓；参考缺失、模板不匹配时拒绝。再研究猫个体隔离的数据集和预测训练 |
| **B：毛色与花纹重建** | 输入同一资产 UV/遮罩、获准图像及曝光信息；输出带色彩空间/UV 版本/用途声明的 albedo、花纹 mask 和材质参数，不将固定阴影烘焙为真实毛色 | 先支持可审查的确定性花纹与手工修正；检查左右/背腹/面部接缝、UV 拉伸和统一光照。资产纹理不得从未知授权照片直接进入公共分发 |
| **C：毛发方向/长度/密度预测** | 输入 bodySurface、拓扑/UV、授权参考与区域标注；输出分区方向场、物理单位长度、密度、三角形/重心根和 groom 版本；明确下绒/护毛及目标表示 | 先重用现有根与确定性毛流，回读检查有限值/范围/单位、表面锚定、毛向连续性、动作漂移和性能；再评估独立毛发预测。原生 Blender hair 输出必须显式转换，不能声称 GLB 自带支持 |

A/B/C 交付均先停留隔离任务目录。合并结果的 manifest 记录各模块输入/输出摘要、版本、失败/人工修正和许可来源，validation 保留各阶段状态。任一必需模块失败不能用另一模块的 passing report 替代，也不能自动覆盖当前模型。后续训练任务须另有明确目标、数据许可和预算，不由本次架构改动启动。

## 公开 CI 与私有验收分开

公开 CI 可安装冻结依赖并执行 typecheck、生产 build、Node 契约/CLI 测试与 Chromium 原创 fixture 测试。输入只能使用仓库原创几何、显式授权公开素材和合成用户数据；测试工作目录使用临时或专用新目录。dry-run 必须无写入，实际 infer/preview 输出有输入/产物摘要，篡改、无效版本/范围、路径逃逸和未经确认发布必须失败。

`npm run test:cat-modeling` 与 `npm run test:cat-modeling:browser` 是现有独立入口；新增 worker 契约测试也应纳入公开 CI。浏览器测试可验证真实 GLTFExporter/GLTFLoader、多图元身体选择、旧数据迁移和参数影响顶点，但不能将小三角 fixture 当成私有猫资产视觉通过。不要为通过 CI 下载未授权素材或跳过真实资产所需校验。

私有真实资产套件在获准本地环境另跑，须有对应确切哈希与来源证据；缺文件应输出 blocked 并以失败退出，不能零测试成功、自动忽略或拿公共 fixture 代替。真实数据库/邮件全流程、手机/Windows 真机性能、四阶段美术批准也属于单独证据。Draft PR 可以先提交公开可审查的架构与失败明确的私有验收链路；PR 不合并、不触发模型发布、不宣称真实 AI 已完成。

## 2026-11-07 本轮执行结果

本地执行环境为 Node.js 24.22.1、Next.js 16.4.4；GitHub Actions 配置使用 Node.js 22，需由远端工作流实际执行确认，不将本地结果冒充 GitHub 检查状态。

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| `npm run test:cat-modeling` | **43/43 通过**：13 版本/运行时、2 视觉契约、28 CLI/协议 | 含 9 份跨语言 schema 同步/独立 ID 检查，fixture 与生产协议不能共用 schema ID |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:cat-modeling:browser` | **8/8 通过** | 真实 GLB 导出回读、参数驱动顶点、多图元身体选择、草稿恢复/隔离与三类移动视图模拟；不是私人猫或真机验收 |
| `npm run typecheck` | 通过 | 应用和测试的 TypeScript 集成 |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | 通过 | 生产构建；没有部署网站 |
| `node cat-modeling/contracts/generate-schemas.mjs --check` | 9 份规范一致 | 维护生成器也提供 `--write`；检查本身不写文件 |
| `inspect --file <公开GLB> --dry-run` | Toon、Vuena、Tabby 三份实际文件均返回 OK | 只读结构、哈希、资源检查；许可、骨架/动画/眼控语义、真实坐标朝向和视觉仍未验收 |
| 示例 `validate --contract request --file … --dry-run` | OK / exit 0 | 仅协议结构合法；不证明文件/模型存在 |
| 示例 `infer --request …` | **MODEL_UNAVAILABLE / exit 6** | 预期拒绝，已产生隔离执行日志，无替代模型或权重 |
| 示例 `preview --request …` | **PRIVATE_ASSETS_MISSING / exit 5** | 预期受阻，生成 blocked 本地交接任务，未启动 Blender 或生成预览图片 |
| 示例完整输出 `validate --request … --dry-run` | **PRIVATE_ASSETS_MISSING / exit 5** | 缺少完整交付文件时不能通过 |
| 示例生产 `publish --request … --dry-run` | **PRODUCTION_PUBLISH_UNAVAILABLE / exit 7** | 没有生产发布后端；确认字段不能绕过此状态 |
| 私有 Norwegian/Sphynx 及旧房间 GLB | **未执行/受阻** | 文件未同步，不能声明实际旧外观、53/26 形变位移、骨架或材质一致 |
| 本地 Blender、原生 groom、完整动作和四阶段美术验收 | **未执行/受阻** | 缺原文件、对应作者工具版本及本地证据；云端仅有任务协议 |

本轮执行日志保存在被忽略的 `artifacts/cat-modeling-cloud-review/`；示例生产拒绝/交接任务位于 `cat-modeling/jobs/job-example-local-edit/runs/`。它们只含公开样本与执行记录，没有用户照片/生产数据，不是训练集。正式仓库提交包含规范和测试，不包含这些运行输出。

复核发现并已修复：完整包缺 manifest 被漏检、输出能力/许可/拓扑声明与实物矛盾、输出 groom 三角形越界、动画 accessor/channel 及材质引用非法、重复骨骼名称绕过预算、跨语言 schema ID 冲突。对应负例均纳入回归。本轮已补齐标准 sparse accessor、隐式全零与稀疏覆盖；静态检查器继续拒绝外部资源和非三角 primitive；这不等同于完整 Khronos 验证，不能据此给实际毛发/动作视觉签字。

### 变更入口

- 运行时：`lib/cat-model-contract.ts`、`cat-asset-capabilities.ts`、`cat-creator-model.ts`、`room-model-assets.ts/.json`、`components/RoomCreatorCat.tsx`、`CatVisualValidation.tsx`。
- 协议与 CLI：`cat-modeling/contracts/`（Zod、九份 JSON Schema、生成器、GLB 检查器、JSON/Python 示例）、`production.mjs`、`cli.mjs`、README 与接入说明。
- Skill：`.agents/skills/miaoxing-cat-model/SKILL.md`；CI：`.github/workflows/ci.yml`；测试：现有隔离套件、新增协议/生产 CLI 负例。
- 文档：根 README、`docs/MODEL-INTEGRATION.md`、本报告；上一轮报告保留为历史并标明当前命令入口。

原资产文件、房间 current 指针/ID/哈希、数据库和锁文件未更改。没有训练、第三方推理、私人照片上传、网站部署或自动合并。
