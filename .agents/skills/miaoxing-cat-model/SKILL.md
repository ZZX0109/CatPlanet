---
name: miaoxing-cat-model
description: 在保留现有造型室和纪念房间的前提下，生成隔离猫模型任务、校验实际资产能力和许可，并制作可追溯预览；当前仅有确定性测试引擎。
---

# 喵星猫模型操作

先读取仓库根 `AGENTS.md`、`cat-modeling/README.md`、请求和相关模型 manifest。每个云任务已经隔离，使用现有检出；除非用户要求，不另建 worktree。涉及现有资产修复时先核对 Git 状态、审查基线及未提交更改，建立用户要求的分支／完整可回滚快照。不得覆盖并发开发内容。

## 支持的第一版操作

1. 检查来源、授权、设计／拓扑／groom 版本和实际资产能力；不能仅比较 morph 数量或把 design schema 版本当 asset revision。`bodySurface` 必须来自明确节点或 manifest，不按最大顶点数或第一个 SkinnedMesh 猜测。
2. 使用 `node cat-modeling/cli.mjs infer --request <request.json> --dry-run` 先检查任务。第一版只能使用仓库原创的 `miaoxing-geometric-cat-v1` fixture 和合法尺寸参数，不是真实 AI 推理。不创建或下载“占位 AI 权重”，不启动训练，不调用未经用户确认的第三方服务。
3. 用户授权生成模型任务后，在默认 `cat-modeling/jobs/` 或专用临时目录运行 infer。保存 request、appearance、model.glb、groom、manifest、validation；相同任务不能覆盖。如需新变体，使用新合法参数。
4. 运行 validate 和 preview 的 dry-run，再制作诊断 SVG。该 SVG 只验证 GLB 几何投影和接口链路；必须明确它没有物理毛发／灯光。生产视觉验收必须用统一相机、灯光、参数及原资产对比 Blender、造型室、GLB 回读和房间，并把未执行／缺失资产／不支持能力分别记入报告，不能宣布视觉通过。原生 Blender 毛发不是 GLB 默认支持能力。
5. 运行 `node --test cat-modeling/tests/*.test.mjs`。涉及生产契约时还需运行原造型室到房间的迁移和能力测试，不能用 fixture 测试替代。

## 发布与数据保护

`publish --dry-run` 只检查并展示隔离 release 的确认令牌。**正式调用不带 --dry-run 的 publish 前，必须向用户展示本次任务、校验结果、预览限制和具体目标目录，并取得明确确认。** 不能自行提供确认令牌作为批准；当前实现只支持 jobs/releases 的新目录暂存，不支持线上发布或自动切换当前模型。

保留原始资产、数据库和真实记录；不清空、不重置、不执行清理脚本。不要把用户照片／原模型放进公共测试 fixture。未知授权的素材仅供受限本地审查，禁止训练、公开分发或公共预览；不得修改 manifest 假装许可通过。现有 creator v3/v4/v5 数据通过项目自身迁移器处理，不能直接重命名版本数字套入 fixture。

结束时报告变更文件、实际执行命令和测试结果、各阶段未执行原因、视觉差异、许可和发布状态。区分“任务可生成”与“真实猫外观已验收”。
