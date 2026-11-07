# 生产猫模型适配器接入边界

当前可执行契约和接口位于 [contracts/README.md](contracts/README.md)；统一 CLI 行为见 [README.md](README.md)。请求、输出、坐标、资源／执行预算、A/B/C 模块与许可字段已有严格 Zod 运行时和生成的 JSON Schema，不再只是文字草案。**真正的猫模型、权重、推理提供者和生产发布后端尚未实现**。

## 外观与拓扑

生产 `appearance.json` 目前采用扁平参数契约：`designSchemaVersion:5`、`templateId:cat-foundation-v1`、coatType、coatMode、完整 20 项 shape。应用内部旧别名 schemaVersion 由既有 `parseCreatorDesign` 负责兼容；CLI 交接时不能直接变更旧记录的版本数字。CLI 的生产外观不带数据库／资产 ID，不能把 fixture appearance 导入现有房间。后续应用适配器必须通过既有迁移器、模型能力检查和资产身份映射。

manifest 独立记录原模型 `modelRevision`、交付字节 `assetRevision`、designSchemaVersion、topologyVersion 和 groomSchemaVersion。多个版本各自表达参数、字节、顶点／绑定语义及毛根／guide 数据约定，不能互相替代。GLB 上实际 morph/骨骼/clip 名字只证明结构存在，不证明 face controls 或动画语义正确。

A 形态接口、B 毛色／UV 纹理接口、C groom 接口各自 interfaceVersion1。尚无实现时必须 state unavailable；不能填入伪造 AI 权重、虚假 morph、UV 结果或 groom。B 在 unavailable 时允许空 UV revision，避免编造摘要。

## Groom 与渲染

groom 绑定精确节点、拓扑版本、三角形索引和归一化重心坐标。重新拓扑后旧绑定拒绝，不按最大网格／第一张 SkinnedMesh 重贴。manifest 对眼控、材质、纹理、root binding 和渲染兼容性有显式字段，未验收项目使用 unrun/unverified。Blender 原生毛曲线及 Cycles 材质不是默认 GLB 可移植能力。

四阶段视觉使用 `lib/cat-visual-scenario.json` 的共同设计、视角与名义光照，还需实际记录 Blender/Three 渲染器差异。CLI 只输出安全本地 Blender handoff，不执行 Blender、训练或重建。源 `.blend` 许可、源哈希和精确工具版本需本地核验，不能把云端缺失文件记录为视觉通过。

## 输出、证据与正式发布

完整 validate 强制所有文件存在、hash／资源预算一致，复核输出与 request/manifest 的身份、拓扑和观察到的能力。不能编辑旧 validation.json 来跳过重新校验。原始资产、用户数据和数据库保留；任务目录为隔离、追加、不覆盖。

未来真正发布必须另行实现不可变资产事务、完整验收证据、许可用途审核、针对本次任务的明确确认及回滚入口。现有 CLI 对生产 publish 无条件返回 unavailable；fixture 暂存不等于生产发布。未经确认的外部服务和素材、未知训练权和公开分发权在入口拒绝，当前实现不提供任何远程推理或训练通路。
