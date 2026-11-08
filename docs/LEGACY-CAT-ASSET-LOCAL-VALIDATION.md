# 旧猫咪存档的本地验证要求

两份旧房间 GLB 未提供给本轮云端审查。本文件是本地待执行方案，**不是已通过的兼容性或视觉报告**。造型室当前 manifest、原创工程 fixture 和旧房间存档具有不同的字节；任意一方通过不能替另一方背书。

## 当前证据与不可变身份

| 基础类型 | 完整旧存档 ID / SHA-256 | 登记字节数 | 本轮结果 |
| --- | --- | ---: | --- |
| Norwegian | `norwegian-9ea85df159dd1e06e06919e9e958d385192a9ba10677b0ea62a7833df59bbc66` / `9ea85df159dd1e06e06919e9e958d385192a9ba10677b0ea62a7833df59bbc66` | 16897868 | 未提供，未验证 |
| Sphynx | `sphynx-de29f2f3df0f5d988a898fcfe41489b2fb5ad6dcd25c193d673cbc6a2b7cd784` / `de29f2f3df0f5d988a898fcfe41489b2fb5ad6dcd25c193d673cbc6a2b7cd784` | 23528408 | 未提供，未验证 |

URL 仍为 `/models/room/<完整 ID>.glb`，`current`、ID、URL、SHA-256、字节数及已保存 `appearanceAsset` 均不改动。旧 `schemaVersion:4` 保留为历史登记信息；它不能证明 v5 参数能在旧二进制中正常呈现。

登记表现在使用 `requiredDesignSchemaVersions:[5]`，表示当前加载适配器要求迁移后的参数 v5。删除原来容易误读的 `supportedDesignSchemaVersions` 名称。`topologyVersion`、`groomSchemaVersion`、`rendererCompatibility.rendererVersions` 和 `capabilities.required/optional` 同样是加载要求，均不是对旧字节的实测支持清单。

每份旧存档另有 `validationEvidence`：`status=unverified`、`binaryStatus=not-provided`、`auditContext=cloud-public-checkout`、`declarationScope=load-requirements-only`；已验证哈希、拓扑、groom 版本及报告均为空，已验证设计/渲染器版本列表为空。这是本轮收到的证据范围，不能用于判断其他机器当前是否已有文件。`roomAssetValidationStatus()` 没有读取二进制或认证的本地报告，始终返回未验证和待本地执行项；手改登记状态、添加报告路径或工程 fixture 通过都不会令它返回通过。

未验证状态本身不会禁止现有猫咪加载。查表仍保留既有参数迁移和存档选择，房间下载后仍需先核对实际字节长度及完整哈希，再检查实际 GLB 解码后的 morph 缓冲、明确身体表面、骨骼绑定和材质能力。缺失或损坏仍走失败/重试流程，不能清空外观、改绑当前造型室模型或降低原有功能。

## 本地执行前提

1. 使用当前功能分支的独立副本或可回滚快照，记录 `git rev-parse HEAD`、工具版本和测试时间。保留全部原始模型、现有未提交改动、草稿和用户数据库。
2. 只在获得审查权限的机器上提供原始旧存档，按其原 URL 路径放入被忽略的 `public/models/room/`；目标已存在时先比较哈希，不覆盖。原始文件与审查副本都不提交到仓库，也不进入训练集或公开分发。
3. 需要 Blender 对照时另提供对应制作源文件、授权说明及源文件到旧存档的可追溯关系。当前造型室 manifest 的新哈希不是旧存档的来源证明。无法找回准确制作源时，将 Blender 对照记为阻塞，不能借用新模型照片冒充。
4. 旧账号验证使用脱敏快照、mock API 或隔离测试数据库；不要连接或重置生产数据库。原账号和真实照片、回忆、验证码或令牌不得进入测试输出。此方案不需要执行 `db:migrate`、`cleanup`、模型重建或发布命令。

首先只读验证现有存档：

```sh
npm ci
npm run models:check-room
npm run typecheck
node --import tsx tests/cat-model-contract.node.ts
```

`models:check-room` 缺文件、长度错误或哈希错误必须失败。修复方式是找到正确的原始存档；不能重建一个新 GLB 后改登记哈希、忽略错误或用 fixture 替换。

## 必须逐项记录的本地检查

以下六项针对**每份实际旧存档完整哈希**分别执行。报告应保留输入参数 JSON 的哈希、工具/适配器版本、输出截图哈希、实际观测数据及失败原因；各项使用 `passed / failed / blocked / unrun`，不得将未运行写成通过。

| 检查 ID | 输入及操作 | 通过证据与失败边界 |
| --- | --- | --- |
| `archived-bytes-sha256` | 对登记 URL 对应的原始文件核对字节数、完整 SHA-256、GLB 头/块范围和嵌入依赖；加载前后复查哈希。 | 实际字节与上表一致，没有替换源文件或外部远程依赖。缺失标为 `blocked`，不能认为注册表有效即文件有效。 |
| `v3-v4-v5-appearance-values` | 建立脱敏 v3、v4、v5 样例；包括非默认脸型、20 个 shape 控件、0/100 毛量毛长，以及 v3 缺毛发字段的历史样例。通过 `parseCreatorDesign` 迁移、序列化、重新读取，再对真实旧 GLB 应用。 | 脸部数值和已有毛发数值不变；只有缺失的 v3 毛发字段采用历史默认值。v3/v4 恢复 groom，v5 显式 source 保留。样例存档 ID 保持原值；参数解析通过与视觉相同必须分开记录。 |
| `body-surface-multi-primitive` | 用实际 `GLTFLoader` 解码，记录所有节点、材质角色、mesh/primitive、UV、skin 属性及实际被选中的 bodySurface。分别检查有无明确标记的历史形式。 | 按显式身体角色或已记录的旧节点/眼球材质语义选择唯一皮肤。眼球、胡须或较大的附加 mesh 不会因排列/顶点数被选中。角色缺失或歧义应明确失败。 |
| `morph-dense-sparse-and-blink` | 记录旧 GLB 的 accessor、稀疏索引和目标名称；验证 26 项基础脸部 morph 的实际位置缓冲、索引唯一性及各参数单独和组合的位移；对实际存在的 Blink/26 个 Blink 校正分别检查。 | 必须区分“26 个基础形变”和“53 个含 Blink/校正的形变”。稀疏数据回读后的顶点数、值、默认权重、局部位移与相应稠密参考相符，0 位移/缺字段不能靠名字通过。若制作临时稠密对照文件，只写全新审查目录并记录其新哈希，不覆盖旧存档。未提供校正的旧模型不应被写成支持校正。 |
| `rig-material-groom-pose` | 记录皮肤实际绑定关节、逆绑定矩阵、head/neck/pelvis 语义及各支链；固定站姿/眨眼/时间/机位和材质参数，对比制作源、造型室、GLB 回读和旧房间。分开审查 short/long/source/groom 与 hairless。 | 身体与眼部形变协调；毛根不跳到眼球，皮肤/毛发静态或动态绑定边界明确；原材质、透明/法线/粗糙度和落地姿态差异如实记录。原生 Blender hair、曲线和 BSDF 不能默认视为 GLB 支持。存在动画片段不证明 walk/rest 或动态毛发通过。 |
| `reload-and-old-account-restore` | 用隔离账号 fixture 或脱敏快照导入旧 appearance+原 appearanceAsset，刷新、重新登录/重新读取、切换会话并恢复草稿；再模拟文件缺失、长度错误、哈希错误和缺失 morph。 | 正常读取保持旧 ID 和原 shape；失败有可重试提示，用户姓名/回忆/照片引用/外观快照不被清空或改绑；测试前后原数据及原资产未修改。不得因新造型室文件可用而掩盖旧房间文件缺失。 |

## 固定机位与报告

现有固定场景定义位于 `lib/cat-visual-scenario.json`。先预览计划，然后在本机已运行的服务上写入**全新**审查目录：

```sh
npm run models:visual:plan -- --design /private/review/appearance-v5.json
npm run models:visual -- --design /private/review/appearance-v5.json --origin http://127.0.0.1:3000 --browser /path/to/chromium --output artifacts/legacy-review-NEW
```

具体 browser 路径按本机安装指定。审查工具使用 `creator / roundtrip / room` 三阶段；它读取 `current`，**不会仅凭工具运行就覆盖所有账号引用的历史存档**。当前两份存档恰为 current 时逐个品类执行；以后有新 current 时，应在隔离副本/受限审查入口按原 `appearanceAsset` 明确选择旧存档，禁止为方便比较修改生产 current。未实际选中原哈希的 room 结果不能记到旧存档名下。

需要 Blender 参照时，先在全新目录产生来源可追溯的报告；脚本仅读取原 `.blend`，不保存源文件：

```sh
/path/to/blender --background /private/review/approved-source.blend --disable-autoexec --python scripts/render-cat-validation.py -- --design /private/review/appearance-v5.json --output artifacts/legacy-blender-NEW
```

再将该次 `validation.json` 通过 `--blender-report` 交给 Web 审查工具。Blender 的制作源身份及站姿帧仍需人工核对；缺源文件、哈希不符或两阶段参数不同应阻塞相应对照。该链路输出的 `measured-not-approved` 是数值/画面测量，不是人工视觉验收，也不是原生 groom 可移植证明。当前 room 适配器的暖色灯光、静态转身及真实保存/恢复仍需单独实测。

建议每份旧存档另存本地受限报告，至少包括：`assetId`、登记/实际 SHA-256 和字节数、源码 commit、工具版本、渲染器与参数版本、完整参数样例及其哈希、六项检查结果、固定机位图片及哈希、实际 bodySurface/morph/骨骼/材质/groom 数据、已知差异、未运行项目和人工审查结论。真实用户信息不进入报告。缺少任一真实输入时保留该项 `blocked`，不要在登记表手填 `passed` 冒充证据。

即便本地全部通过，本轮也不自动更新 `validationEvidence`、不切换 current、不替换旧模型、不发布新文件。正式启用新的资产或分发仍需独立验证授权、校验和明确确认。

## 工程回归的证据范围

`node --import tsx tests/cat-model-contract.node.ts` 验证迁移、声明与观测分离、原 ID/URL/哈希保持不变，以及伪造元数据不能绕过实际能力检查；原创内存网格不等于上表两份 GLB。`npm run test:cat-modeling:browser` 中的原创合成 GLB 回读和 mock 草稿测试也不构成旧文件/真实账号已验收的证明。当前旧文件的六项本地检查均为未运行。
