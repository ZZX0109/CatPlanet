---
name: miaoxing-cat-model
description: 将自然语言猫咪建模需求转为版本化任务，通过统一 CLI 校验、检查或交接本地制作；保留现有造型室、模型与纪念数据，生产预测模型尚未配置。
---

# 喵星猫模型操作

先读取仓库根 `AGENTS.md`、`cat-modeling/README.md`、请求和相关模型 manifest。每个云任务已经隔离，使用现有检出；除非用户要求，不另建 worktree。涉及现有资产修复时先核对 Git 状态、审查基线及未提交更改，建立用户要求的分支／完整可回滚快照。不得覆盖并发开发内容。

## 从自然语言选择操作

1. 先提取用户目标、需要保留的特征和目标母模：形体拟合归入形态操作，局部脸型改动归入局部编辑，毛向/长度/密度归入 groom 调整，单纯确认可加载性归入检查/验证。精确 operation 名称和字段以 `cat-modeling/contracts/` 为准；不将“熟悉感”“像照片”直接解释为训练许可或自动照片重建。
2. 检查模型与参考图的作者/来源、文件 SHA-256、修改/本地审查/训练/分发用途许可及照片使用同意。未知授权只可受限本地审查，不能用于推理参考图、训练或分发。JSON 自称授权不代替证据；只保存证据引用，不复制私钥、真实回忆或账号信息。不要为了通过校验将未知许可改成 verified。
3. 选择 `modelId/modelRevision/templateId`、设计/拓扑/groom/renderer 版本和所需 capabilities；读取实际源文件检查，不凭 morph 数量承诺兼容。`bodySurface` 必须来自明确节点/primitive/材质语义或 manifest，不按最大顶点数/第一个 SkinnedMesh 猜测。
4. 构造新 `jobId` 的标准 request，指定合法外观、groom/features、坐标/尺寸和资源预算。用户未说明的可逆细节按现有模板默认值处理；必要素材/许可缺失时明确报告。A 形态、B 毛色/花纹、C 毛向/长度/密度是独立版本模块，不能混用其输出或默认存在模型权重。

## 通过统一 CLI 执行

使用 `node cat-modeling/cli.mjs`，精确参数参考 `cat-modeling/README.md`。先执行 inspect/validate 和 dry-run，再执行已授权的隔离任务；不要为每次自然语言请求重新生成整套 Blender 脚本，不在 Next.js API 中启动 GPU 工作。

```sh
node cat-modeling/cli.mjs inspect
node cat-modeling/cli.mjs inspect --file <获准本地审查的model.glb> --dry-run
node cat-modeling/cli.mjs validate --contract request --file <request.json> --dry-run
node cat-modeling/cli.mjs preview --request <request.json> --input-root <隔离输入目录> --dry-run
```

纯协议校验不读取私有模型；完整输出校验使用 `validate --request ... --input-root ...` 并要求 manifest 及全部产物。不要用协议结构通过或源模型 inspect 来替代完整交付包检查。错误码、stderr JSON 和检查状态必须保留；修复输入问题后重试使用新请求/新 jobId，不能编辑旧日志消除失败。

- `infer` 是未来生产模型入口。没有已登记模型/权重/执行器时必须保留 `MODEL_UNAVAILABLE`，不能用随机数据、fixture 或虚假“AI 权重”替代。原创 fixture 必须显式选择，且结果始终注明工程测试用途，不导入现有房间。
- `inspect` 只检查真实可读取模型的结构/哈希/坐标/能力。`validate` 区分 JSON 合法、文件完整、能力匹配与人工视觉验收；静态合法不代表私有猫的骨架/毛发/动作已通过。
- `preview` 在云端只生成/描述受控本地执行器任务。没有 Blender 时不安装未经确认的作者插件，不执行任意脚本或 shell 字符串；任务状态保留等待本地证据。使用既有固定操作与参数数组，不能将任务计划当作已生成预览。
- 每项实际任务使用全新隔离目录和 jobId，保留输入摘要、标准错误码与执行日志。dry-run 不写目录/产物。失败不覆盖任务，不把私人参考图上传外部，不修改生产数据库。

运行 `npm run test:cat-modeling`、`npm run test:cat-modeling:browser`、类型检查与必要构建。只运行与变化相关且环境支持的测试；私有资产缺失时如实报告 blocked，不能用公开 fixture 或零测试结果代替真实集成验收。

## 本地 Blender 证据

只向获准的本地执行器交接标准任务。收回后核对 jobId、请求/输入/输出摘要、工具版本、退出码和日志；原文件执行前后摘要保持不变。固定相机、灯光、设计、姿态与时间，对比 Blender、造型室、GLB 回读、房间，分别报告毛发/材质/骨架/形变差异。原生 Blender Hair Curves 和 Cycles closure 不是 GLB 默认支持；静态毛导出也不证明动画绑定合格。缺阶段、未运行和人工批准必须分别记录。

## 发布与数据保护

**正式发布前，必须向用户展示本次任务、真实验收结果、来源许可、预览限制和目标资产/目录，并取得明确确认。** 不能自行提供确认令牌作为批准；当前生产发布入口不可用，不支持线上发布或自动切换当前模型。fixture 的 publish 仅支持已校验原创样本在新隔离 release 目录暂存，同样不能把代理自己算出的令牌当作用户批准。

保留原始资产、数据库和真实记录；不清空、不重置、不执行清理脚本。不要把用户照片／原模型放进公共测试 fixture。未知授权的素材仅供受限本地审查，禁止训练、公开分发或公共预览；不得修改 manifest 假装许可通过。现有 creator v3/v4/v5 数据通过项目自身迁移器处理，不能直接重命名版本数字套入 fixture。

结束时报告变更文件、实际执行命令和测试结果、各阶段未执行原因、视觉差异、许可和发布状态。区分“任务可生成”与“真实猫外观已验收”。
