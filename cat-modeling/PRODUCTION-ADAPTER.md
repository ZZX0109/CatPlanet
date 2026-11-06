# 生产猫模型适配器规范草案

这是后续适配器的交付规范，**当前 CLI 仅支持 README 中的原创 fixture 引擎**，不接受下列生产请求，也不会将 fixture 外观导入现有房间。新增引擎应独立登记版本、许可来源和验收集，不能扩大现有 fixture validator 的能力声明。

## 请求和任务身份

`request.json` 应包含命名空间、`requestSchemaVersion`、`engineId`/`engineRevision`、输入文件的相对路径和 SHA-256、显式来源/授权证据引用、目标 `topologyVersion`、规范化设计参数、随机种子及用途（`restricted-review` / `distribution`）。不包含照片原始 URL、账号信息、邮箱、真实回忆或凭据。身份摘要覆盖规范化请求、引擎版本和输入哈希；任务追加不可变事件，不能将失败任务覆盖为成功。

许可记录须区分修改、产品运行、公共分发、训练、权重和生成结果的授权。`unknown` 或缺证据只能做受限审查；请求自称 `verified` 不能代替授权审核。未经确认的远程服务和训练在适配器执行前即拒绝。

## 外观和二进制

`appearance.json` 对当前生产母模使用 `format: miaoxing.cat.appearance` 的外层封装及 `design`，其中 `design` 必须经 `parseCreatorDesign` 迁移/校验，包含规范 `designSchemaVersion:5` 和保留的旧客户端别名 `schemaVersion:5`。封装还包含 `templateId`、`topologyVersion`、`groomSchemaVersion` 与引用的资产摘要。参数不可在读取时默默截断；不同品种/骨架需显式适配器。该封装不能直接当作现有房间的外观 JSON 导入，交接时使用校验后的 `design`。

`model.glb` 必须自包含、GLB 2.0、有限坐标，约定米制、Y-up、+Z forward。交付报告记录真实导出器版本、骨架/绑定、mesh primitive、morph 名称和 accessor 维数。不能只比较 morph 数量：必须逐控制验证 `_low/high` 的方向/范围、Blink 和其修正组合，确认中性形变不变。动画语义逐项映射到实际 clip/tracks，并标记站姿、程序姿态和源动画的区别。

## Groom 和显式表面

`groom.json` 使用独立 `groomSchemaVersion`，声明 `representation`（如 `none`、`mesh-cards`、`curves-sidecar`）、毛层、长度/密度单位及随机种子。绑定字段必须包括精确 bodySurface 节点/primitive/材质角色、拓扑摘要、三角形索引与重心坐标、局部方向及 guide 数据。重心权重非负且和为 1；拓扑或顶点顺序改变即拒绝旧绑定，不能自动重贴到“最大网格”。

显式节点可能被 glTF 多材质导出拆成多个 primitive，必须保留并核实身体/眼球等语义。`creatorRole:body-surface` 与 `creatorRole:eye-globe` 是当前运行时支持的角色；旧文件只使用有代码依据的母模节点和光学材质映射。静态毛层应声明支持的姿态范围，不能把它标为可随骨架动画。Blender 原生毛曲线/Cycles closure 不属于标准 GLB 默认能力，必须交付独立侧车或说明转换和损失。

## Manifest、验证和发布

`manifest.json` 应包含全部文件哈希/字节数、输入到输出谱系、四类独立版本、坐标和单位、显式表面、材质/纹理/groom 表示、真实 morph 与骨骼清单、语义动画映射、支持的 design 版本、许可审核引用以及工具版本。`assetRevision` 是不可变二进制摘要；拓扑版本不能由 design 版本代替。

`validation.json` 应分别记录结构/完整性、设计迁移、骨架/形变、groom、许可和视觉的 `passed` / `failed` / `blocked` / `unrun`，附执行命令、工具版本、源文件/截图哈希和限制。四阶段视觉对照使用 `lib/cat-visual-scenario.json` 的相同设计、姿态、视角和名义光照；必须另记 Cycles/Three 材质与光照差异及生产场景差异。单个汇总 `valid:true`、高像素相似度或已编辑的历史报告不能替代重算和人工视觉确认。

未来正式发布只能选择不可变的新资产 ID：全部要求通过、展示目标/预览/限制、取得针对本次任务的明确确认后，再执行独立发布事务和保留回滚入口。未知许可、缺失原模型或视觉阶段受阻时拒绝激活。当前 CLI `publish` 只支持原创 fixture 的独立 release 暂存；旧 `models:publish-room` 也不会激活当前模型。
