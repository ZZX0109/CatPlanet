# 猫咪建模基础架构：证据、边界与下一步

记录日期：2026-11-06（Asia/Shanghai）。本报告区分仓库中可重现的元数据检查、历史文档的结论，以及本轮尚未执行的视觉验收。实现与测试结果以本轮实际命令和任务报告为准。

本页保留第一轮历史快照。2026-11-07 云端重构已将生产入口改为默认不可用，旧测试引擎必须显式选择 `--engine fixture`；当前命令以 `cat-modeling/README.md` 和 `CAT-MODELING-CLOUD-REFACTOR.md` 为准，不直接复制本页历史 CLI 示例。

## 本轮实现与交付状态

已完成可独立验证的基础架构修复：房间资产原 `schemaVersion:4` 与 design v5 直接判等的问题已移除；资产哈希、URL、原二进制和 `current` 指针保持不变。现在独立验证 design、拓扑和 groom 契约，并按二进制 SHA 校验 asset revision。原 v3/v4/v5 数据经现有迁移路径处理，保留脸型与毛量/毛长；v3/v4 恢复完整被毛、v5 保留显式 source 的语义沿用原实现。

造型室/房间共用能力检查和显式 bodySurface 选择。特别处理实际 glTF 多材质分拆：同一身体节点下的身体、左右光学眼球会被解码成三个 SkinnedMesh，按明确角色/既有光学材质语义识别身体，不按顶点数量、第一张网格或遍历顺序猜测。骨骼既需存在，也需真实绑定到身体 skeleton。

新增确定性 CLI、命名空间独立的测试外观、五份机器可读 schema、生产适配规范草案和 Codex Skill。真实生产推理/训练尚未实现。旧房间发布入口默认拒绝激活；CLI publish 也只允许原创 fixture 的明确确认后隔离暂存，本轮没有实际发布。

**尚不能宣称完成全部验收**：缺原始 audit、四份私有 GLB 与 Blender 原文件，无法核查原 Mac 审查后的未提交变动、真实猫旧外观的视觉等价性及四阶段最终效果。合回 Mac 和任何正式发布前必须补齐这些检查。已通过的契约/合成 fixture 测试不替代真实猫视觉验收。

## 改动文件

| 范围 | 文件 |
| --- | --- |
| 版本契约和旧数据 | `lib/cat-model-contract.ts`、`lib/cat-creator-design.ts`、`lib/room-model-assets.ts`、`lib/room-model-assets.json` |
| 统一能力和表面选择 | `lib/cat-asset-capabilities.ts`、`lib/cat-creator-model.ts`、`components/CatCreator.tsx`、`components/RoomCreatorCat.tsx` |
| 未来作者导出标记 | `scripts/build-norwegian-creator.py`、`scripts/build-sphynx-creator.py`、`scripts/refine-foundation-face.py`；只加语义标记，未运行重建 |
| 发布保护 | `scripts/publish-room-models.mjs` |
| 固定视觉链路 | `lib/cat-visual-scenario.json`、`lib/cat-visual-validation.ts`、`components/CatVisualValidation.tsx`、`app/studio/validation/page.tsx`、`scripts/validate-cat-visuals.ts`、`scripts/render-cat-validation.py` |
| CLI 和规范 | `cat-modeling/cli.mjs`、`pipeline.mjs`、`protocol.mjs`、`fixture.mjs`、`schemas/*.json`、`examples/request.json`、`README.md`、`PRODUCTION-ADAPTER.md`、`FIXTURE-LICENSE.md`、`.gitignore` |
| Skill | `.agents/skills/miaoxing-cat-model/SKILL.md` |
| 测试 | `tests/cat-model-contract.node.ts`、`tests/cat-visual-contract.node.ts`、`tests/cat-model-contract.browser.spec.ts`、`tests/cat-foundation.playwright.config.ts`、`cat-modeling/tests/pipeline.test.mjs` |
| 既有回归样本 | `tests/cat-creator.spec.ts` 增加规范版本别名期望；`tests/room-draft.spec.ts` 显式指定短毛样本，修正原默认长毛却断言短毛的不一致 |
| 命令和报告 | `package.json`、本报告；无新增依赖，锁文件不变 |

## 实际测试结果

| 命令/检查 | 结果 | 证明范围 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | TypeScript 集成 |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | 通过 | 现有 Next.js 应用及验收页面生产构建 |
| `npm run test:cat-modeling` | 18/18 通过：7 契约、2 视觉场景契约、9 CLI | 迁移/权重、跨底模拒绝、26/53 能力、真实骨架绑定、显式表面/多图元、安全暂存和 dry-run/篡改/无覆盖 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:cat-modeling:browser` | 8/8 通过 | 原创三图元 GLB 真实导出回读/参数驱动顶点；现有草稿恢复/账号隔离/过期/存储不可用及三种移动设备模拟视图 |
| CLI 示例 infer → validate → preview | 通过 | `task-7f6786d86bd7aaeee5841b70`，模型摘要 `d4827fc1987d7e001053fddc5b1ec1b56a7beeef9b44d7a454238504586019ba`，任务位于被忽略的 `cat-modeling/jobs/` |
| CLI 模型独立 Blender 导入 | 通过 | Blender 4.3.2 解码原创模型，9 个网格与唯一 bodySurface；没有生产骨架/morph/groom 能力声明 |
| Blender 视觉脚本基础测试 | 原创场景三视角渲染通过，截图摘要和源文件未改验证通过 | `artifacts/blender-harness-render-verified/validation.json`；只证明脚本可执行，不代表真实母模 |
| `npm run models:visual:plan` | dry-run 通过 | 固定参数计划，无输出目录写入 |
| `npm run models:visual -- --browser /usr/bin/chromium --output artifacts/cat-visual-foundation-round1` | 退出 1，9 项明确 blocked | Creator/GLB 回读/房间各三视角缺私有模型，HTTP 404；报告在该目录 `validation.json` |
| 私有真实猫/旧外观四阶段视觉验收 | 未执行/受阻 | 原模型、原生 groom 与审查报告缺失，不能宣称通过 |

未运行需要真实数据库/邮件服务的完整账号端到端套件，也没有进行 Windows/手机真机验收；移动端结果是 Chromium 设备模拟。测试发生在隔离浏览器、临时任务目录和原创测试几何内，不读取生产用户记录。

## 复现固定视觉链路

在仓库运行 `npm ci` 后先执行 `npm run test:cat-modeling` 与浏览器测试。浏览器可使用 Playwright 安装版本，或通过 `CHROMIUM_PATH` 指定系统 Chromium。代码契约不需要 `.env.local` 或真实数据库。

补齐获准仅作受限审查的 `public/models/creator/{norwegian,sphynx}-cat.glb`、登记哈希对应的 `public/models/room/*.glb` 及原 Blender 文件后，运行 `npm run dev -- --hostname 127.0.0.1`。使用 `npm run models:visual:plan -- --design <外观JSON>` 查看计划；`npm run models:visual -- --browser /usr/bin/chromium --design <外观JSON> --output artifacts/<新目录>` 生成网页对照。输出必须是新目录；不覆盖旧报告。该入口使用相同真实 loader/design/groom/export 函数和公共 review stage，**不是生产房间暖光/交互页面的截图**，生产灯光和毛发 compositor 差异需另验。

Blender 对照命令：`blender --background <获准审查的作者文件.blend> --disable-autoexec --threads 2 --python-exit-code 1 --python scripts/render-cat-validation.py -- --design <同一外观JSON> --output artifacts/<新的Blender目录>`。脚本禁用不受此构建支持的降噪、不保存源文件，并记录源帧（Norwegian 53 / Sphynx 1）、形变、原生毛、材质节点和骨骼。未来运行应优先使用母模原作者工具版本；4.3.2 只验证了原创测试场景，不能代替原母模 3.6/4.5 兼容测试。

向网页命令增加 `--blender-report <Blender目录/validation.json>` 可核查条件与图片摘要并对比像素；Cycles 与 Three 名义灯光数值和 BSDF 不物理等价，`measured-not-approved` 始终不是人工视觉批准。原生 groom 不会由网页毛量参数自动重建。未知许可素材不得作为公共预览；本轮只做本地请求，没有创建对外预览链接。

## 基线与并发开发保护

本轮从远端 `main` 的 `d29ff75740fbd61b98a0879b100916cd1f817094` 建立独立分支 `fix/cat-modeling-foundation-20261106`；开始时工作区干净。仓库可见的两个提交为：

| 提交 | 时间 | 内容 |
| --- | --- | --- |
| `927bff5` | 2026-11-06 16:58:42 +08:00 | 首次发布应用与部署工作流 |
| `d29ff75` | 2026-11-06 17:04:11 +08:00 | 调整镜像发布与部署变体 |

`audit-output/cat-modeling-audit.md` 未随公开仓库同步，`audit-output/` 被 `.gitignore` 排除。因此不能确认该审查的提交基线，也不能声称已核对“审查之后的全部变化”。新增的 `docs/CAT-PHOTO-REFERENCE-REVISION.md`、`CAT-ORANGE-VARIANT.md` 等显示 11 月 6 日仍有本地 Blender 制作；不能覆盖、回滚或将这些历史记录视作失效。原项目在 Mac 的未提交内容不在云环境可见范围内。合回前应在 Mac 另行比对其工作区和审查报告，避免覆盖并发开发。

本轮不重置数据库、不运行清理命令、不删除或重建用户记录，不替换任何原始 GLB、Blender 文件或当前模型。

## 53 / 26：当前能够确认什么

直接读取 `public/models/creator/norwegian-manifest.json` 与 `sphynx-manifest.json`，两者的 `shapeTargets` 都有 **53 个名称**：

- 26 个基础形变：`Head_round`、`Head_wedge`，以及其余 12 项面部控制各自的 `Shape_<key>_low/high`。
- 1 个独立 `Blink`。
- 26 个 `Blink_*` 联动修正，列在 `creatorFaceRefinement.correctives`。

因此 **14 个可调面部参数、26 个基础目标、53 个总目标是三个不同量**。`docs/USER-CAT-MODELS.md` 中“26 个形状目标”的接入记录属于早期阶段，不能作为当前文件恰好有 26 个目标的证据。新版中性基础目标仍为零权重，附加闭眼/修正不应改变旧脸型参数的语义。

同时，房间存档与造型室元数据记录的是不同字节版本：

| 基础 | 房间登记 SHA-256 | 当前造型室 manifest SHA-256 | 元数据声明 |
| --- | --- | --- | --- |
| Norwegian | `9ea85df159dd1e06e06919e9e958d385192a9ba10677b0ea62a7833df59bbc66` | `bda151cace4e581a2314fe5788bbe27c3fe91cbd589d5ac8f3677d36e481b492` | 造型室 53 targets / 49 bones |
| Sphynx | `de29f2f3df0f5d988a898fcfe41489b2fb5ad6dcd25c193d673cbc6a2b7cd784` | `c43a533f310aaf69b67bae5dfe017829a8e47a7f61d8934a0679c22961f4d498` | 造型室 53 targets / 85 bones |

这四个 GLB 均未同步，`public/models/creator/*` 的二进制和 `public/models/room/` 被忽略。**实际房间存档是 26 还是 53、各 mesh 是否完整拥有目标、稀疏 accessor 是否有效、旧/新顶点位移是否相同，当前均未验证。** 不可把新版 manifest 当作旧存档的能力证明，也不可仅改 `schemaVersion: 4` 为 5 就宣称兼容。

版本应分别表达：`designSchemaVersion` 管外观 JSON 语义和迁移；`assetRevision` 管不可变二进制身份；`topologyVersion` 管顶点/面/UV 与表面绑定；`groomSchemaVersion` 管毛根、引导、密度等数据表示。真正破坏拓扑的变化不能用兼容旧 design 的方式隐式消化。

## 骨骼与动画语义

目前制作与运行时代码存在明确的基础差异：

| 语义 | Norwegian | Sphynx |
| --- | --- | --- |
| metadata 骨骼数 | 49 | 85 |
| 头 | `head` | `HeadSkinJnt` |
| 颈 | `neck_01` | `Neck1SkinJnt` |
| 骨盆 | `PantherPelvis` | `PelvisSkinJnt` |
| 尾链 | `PantherTail1`…`5` | `Tail1SkinJnt`…`8SkinJnt` |
| 默认站姿来源帧 | 53 | 1 |
| Blink 制作 | 眼周皮肤边缘形变，保留眼球 | 源眼睑骨骼动作烘焙为皮肤形变 |

依据为 `lib/cat-creator-motion.ts` 和两份制作 manifest。保留源动画不代表已完成走路/睡眠语义映射；`createCreatorMotion` 的 stand/rest、呼吸和眨眼是程序运行时能力。`cloneCreatorForExport` 明确导出当前静态姿态、移除自动源动画，避免静态毛层与运动皮肤脱离；这不是动画丢失已被修复的承诺。

已直接解析仓库内实际二进制 glTF JSON 的基础模型：

| 文件 | 实际 skin joints | 实际动画 | 实际 morph 数 |
| --- | ---: | --- | ---: |
| `toon_cat_free.glb` | 36 | `Scene` | 0 |
| `vuena_cat.glb` | 19 | `idle`、`idle_alt`、`walk`、`run`、`jump`、`eat`、`sit`、`sleep`、`attack`、`call`、`hit`、`death` | 0 |
| `review/tabby-web.glb` | 无 skin | 无 | 0 |

这些基础模型不能因为“是猫 GLB”而套用造型室的 14 项控制。`lib/models.ts` 为 Toon 的休息使用程序姿态，为 Vuena 使用原生 `sleep`。旧基础猫流程应保留。

## 统一视觉验收的待办与已知差异

必须使用同一份相机、灯光、模型归一化、shape、coat、姿态与时间参数，分别保存 Blender、造型室、GLB 导出回读、纪念房间四阶段图像及结构报告。报告中须有源文件哈希、导出器/Blender/Three.js 版本、渲染器、色彩空间、曝光、分辨率、动画时间和 morph 权重；缺少任何阶段就记为缺失，不能自动通过。

检查应分别覆盖毛根与皮肤位移、毛束轮廓、材质/纹理/透明度、骨骼层级/绑定、面部目标与闭眼修正。Blender Hair Curves、粒子毛与 Cycles closure 不由标准 GLB 自动承载；选择网格化发片/毛束、烘焙纹理或独立 groom runtime 后应显式写入 manifest，并单独记录损失。骨架静态导出不等于动作回读通过。

仓库历史文档仍报告下列未解决问题，**本轮没有原始图片与私有模型，未重新作视觉确认**：

- `CAT-PROCEDURAL-GROOM-REPAIR.md`：胸帘、背颈散线、尾部散线和近景毛束转折仍存在；技术检查与恢复毛量不能证明写实效果。
- `CAT-COAT-TEMPLATES.md`：短/长毛共用 Norwegian 网格，独立短毛形体仍未完成；原表面毛色与毛面不等于可编辑逐根毛发。
- `CAT-PHOTO-REFERENCE-REVISION.md`：原生模型的纯色毛偏颗粒、布偶白 V 顶端偏细；新比例的完整步态、网页轻量化尚待验收。
- 造型室文件与不可变房间存档哈希不同，真实双端材质、Blink、程序毛和姿态一致性未能检查。
- Sphynx 原制作依赖 Blender 3.6.23，Norwegian 依赖 4.5.15；云端自带 Blender 4.3.2 不能未经复验就替代制作环境。

## 规范母模候选比较与素材权限

| 候选 | 已知优点 | 缺口 | 当前使用边界 |
| --- | --- | --- | --- |
| Norwegian 现有副本 | 已有 14 控制、49 骨骼、程序毛生长表面；最接近当前造型室 | 长短毛共用形体、毛束视觉待修、动画与二进制待验收 | 用户分享包作者/分发授权未核实，仅受限本地审查；不进入训练与公共分发 |
| Sphynx 现有副本 | 独立裸皮解剖、85 骨骼，可用于观察无毛结构 | 不可作为有毛模板的零密度替代；不同骨骼/UV/拓扑 | 同上 |
| 用户 Kitten / Persian | 文档记录 72/57 骨骼，适合幼态/特定品种参考 | 无现成面部 morph；原始文件未同步 | 同上，不得因用户提供而默认可训练 |
| Grab3D CC0 Tabby / 旧 structural derivative | 许可文本保留，允许修改，独立旧实验可追溯 | 当前回读 GLB 无骨架/形变；旧结构头非完整动画拓扑，AI-assisted 来源须标注 | 可作为技术参考候选；不能直接升级为写实规范母模或训练数据，仍须核对数据来源与用途记录 |
| Toon / Vuena 免费样本 | 实际可解析骨骼与动作，保留既有房间流程 | 风格化形体，零面部 morph，非写实捏脸底座 | Toon 保留 CC BY 4.0 署名；Vuena CC0 仅涵盖免费样本，不涵盖付费全包 |
| 项目自制确定性测试模型 | 来源清楚、可离线重建、适合协议/安全/工具回归 | 几何示意，不代表生产猫的外形、毛发、绑定质量 | 仅基础架构测试，不冒充 AI 输出、权重或规范生产母模 |
| 后续自制/委托规范成年短毛猫 | 可在合同中明确修改、产品分发、训练等用途，统一拓扑/UV/骨架 | 需要美术制作与合同核实、完整形变/动作/视觉验收 | 建议作为长期生产母模路线；先签明用途再纳入数据 |

`public/models/creator/LICENSE.txt` 明确只覆盖 legacy structural/Grab3D 衍生资产，**明确排除 Norwegian 与 Sphynx**；不得借此 CC0 文本为用户模型授权。`lib/room-model-assets.json` 原登记项为 `local-only-unverified`。未知许可不能通过一个用户输入字符串或命令开关就转换为已核实来源。

## 训练前所需数据清单

当前没有启动训练，也不需要真实用户纪念记录完成此轮架构修复。未来准备数据至少包括：

1. 每个资产/照片/视频的作者、来源 URL/文件哈希、获取日期、许可证原文与范围；分别核实训练、修改、模型权重、生成结果和公共分发权限。宠物主人同意、摄影者版权与模型作者授权分开记录。
2. 同意范围明确的多视角猫照片/标定、分辨率、相机内外参、光照/曝光、去重与个体 ID；独立训练/验证/测试划分以猫个体为单位，避免同猫泄漏。
3. 统一顶点顺序/拓扑、UV、坐标/米制单位、中性站姿、骨架语义、蒙皮权重、面部 morph 与联动修正；每次破坏性变化有新 topologyVersion。
4. 皮肤表面三角形与重心毛根、groom 引导与长度/密度/方向分区、底绒/护毛层次、材质和目标导出表示；毛发专门标定，不能把纹理条纹当几何毛。
5. 同一资产的原生 Blender、标准 GLB、网页版本及可复现固定视角图像；包含极端参数、闭眼、趴卧、步态及皮肤/毛根穿插标注。
6. 原始数据与衍生物分离、哈希谱系、撤回/删除策略、访问控制、失败/禁用资产列表；默认不采集真实用户记忆、邮箱或私人照片。
7. 硬件/耗时/显存预算、误差和视觉评价标准、人工验收、许可审核与上线门槛；在数据充分和明确授权前保持 CPU 确定性基线。

## 后续模型路线建议

第一阶段固定现有参数化契约与显式表面绑定，在受限审查环境补齐双端 GLB 和原始 audit 后完成四阶段视觉基线；先做兼容与数据可追溯，保持现有造型室交互。

第二阶段选定有明确产品/训练权限的成年短毛规范母模，统一拓扑/UV/语义骨架、眼睑联动、groom 和网页 LOD，并以真实渲染与动作验收确定质量，不能用滑块数量或目标数量代替。

第三阶段先做无需训练的确定性参数拟合/手工校准，再评估猫专用形体估计与独立毛发模块；只有数据、许可、预算和验收集满足要求才提出训练任务。现有 `CAT-REALISM.md` 记录的 NeuralFur 研究用途、AnimalLift 的 NC/ND 许可仅作为历史研究线索，真正采用前须重新核实官方版本与商业权限；本轮不下载安装其权重或调用第三方推理。
