# 喵星猫模型任务接口（基础架构第一轮）

本 CLI 只运行仓库原创几何猫测试引擎 `miaoxing-geometric-cat-v1`。它是带身体、头、耳、四肢和尾部的合法 GLB 2.0 测试模型，使用固定拓扑和确定性尺寸；没有 AI 权重、训练、照片重建、第三方推理服务或生产模型替换。它不代表写实母模，也不能证明原造型室与房间视觉一致。

```sh
node cat-modeling/cli.mjs infer --request cat-modeling/examples/request.json --dry-run
node cat-modeling/cli.mjs infer --request cat-modeling/examples/request.json
# 以下 task ID 来自上述响应。相同输入得到相同 ID；已存在的任务不会覆盖。
node cat-modeling/cli.mjs validate --task task-7f6786d86bd7aaeee5841b70 --dry-run
node cat-modeling/cli.mjs preview --task task-7f6786d86bd7aaeee5841b70 --dry-run
node cat-modeling/cli.mjs preview --task task-7f6786d86bd7aaeee5841b70
node cat-modeling/cli.mjs publish --task task-7f6786d86bd7aaeee5841b70 --dry-run
node --test cat-modeling/tests/*.test.mjs
```

`--dry-run` 不创建目录、不写文件、不发布。infer 的 dry-run 在内存中计算任务和资产摘要；validate 的 dry-run 需要已有任务并实际检查文件；preview 计算诊断图但不落盘；publish 重新校验并显示独立暂存目录及所需确认令牌。默认输出 `cat-modeling/jobs/`（已忽略），`--root` 只允许该目录的后代或系统临时目录下的专用目录。拒绝遍历 ID、目录／文件符号链接和覆盖已有文件。输出目录不应由其他不可信进程共同写入。

## 文件契约

机器可读规范位于 `schemas/`。运行时以严格输入校验、逐字节确定性重建与 GLB 二进制检查落实这些约束，而不是信任输入声称的能力或许可。未知字段和不支持的引擎一律失败。

| 文件 | 第一版语义 |
| --- | --- |
| `request.json` | `requestSchemaVersion:1`、引擎 ID 与四项 [0.5,1.5] 有限尺寸参数。规范键序的请求摘要形成 task ID。无用户资料或凭据。 |
| `appearance.json` | `format:miaoxing.fixture.appearance`、fixture 专属 `designSchemaVersion:1`、拓扑和 groom 版本、确定性参数。**此格式不是造型室 v5 外观**，不能直接导入现有房间。生产适配器必须另行调用已有 creator design 迁移器并核对拓扑／能力，禁止只改版本数字。 |
| `model.glb` | 自包含 GLB 2.0，命名节点 `bodySurface` 标记生长表面；无外链资源。没有 morph、骨骼或动画。 |
| `groom.json` | `groomSchemaVersion:1`、显式 bodySurface、`representation:none`、空 guides。不得将原生 Blender Hair Curves 默认视为 GLB 可携带能力。 |
| `manifest.json` | 任务 ID、四项独立版本、文件 SHA-256／字节数、显式表面、实际能力、来源和许可。`assetRevision` 是 `model.glb` 完整字节摘要，不是 design schema 版本。`productionCompatible:false`。 |
| `validation.json` | 当前校验结论、错误、警告及摘要。仅作报告，编辑为 valid 不会放行 publish。 |
| `preview.svg` / `preview.json` | 从已验证 GLB 顶点和节点变换生成固定斜视正交诊断投影、固定平涂材质；保存相机参数和图片摘要。不是 Blender／WebGL 物理渲染，不作为毛发和材质视觉通过结论。 |

设计参数版本控制 appearance 的参数含义；拓扑版本控制顶点、节点、morph 与骨骼语义；groom 版本控制毛根和指南数据；assetRevision 只标识具体交付字节。生产引擎应显式声明支持的设计版本与拓扑组合，提供旧数据迁移及能力映射，不能套用 fixture 接口推断兼容性。

后续生产适配器的请求、groom 绑定、授权证据与交付门槛见 [PRODUCTION-ADAPTER.md](./PRODUCTION-ADAPTER.md)；该草案没有被实现为生产推理接口。

## 校验与发布边界

校验检查实际请求、确定性 GLB 全字节、JSON/BIN 长度、bufferView/accessor 范围、有限顶点、唯一 bodySurface，以及 manifest、appearance、groom 与可信本地引擎重建结果是否一致。输出含每项摘要，可以追溯输入、引擎和资产。此 validator 限定于 fixture，**不是通用任意 GLB 校验器**。

`publish` 在当前版本只表示**独立 release 暂存**。它重新计算全部校验，拒绝未知／被篡改许可；真实写入还要求 `--confirm` 与 dry-run 中的 `stage:<taskId>:<assetRevision>` 完全相同。代理必须先向用户展示校验结果、预览限制和目标目录，取得明确同意后才传令牌。不得将程序自己算出令牌视为用户批准。暂存只复制固定校验文件到 `jobs/releases/<taskId>/`，再次调用会拒绝覆盖，不更新网站、当前模型、数据库或线上资产。正式线上发布未实现，必须另行实现和取得明确确认。

只有本地可信 fixture 引擎的原创几何许可被声明可分发（见 `FIXTURE-LICENSE.md`）。用户或第三方素材授权未知时，只能按受限本地审查流程检查，不能传入当前 fixture 引擎、训练集、公共 release 或公共预览；需要后续引擎支持显式来源、授权证据引用及用途许可后才能扩大使用范围。不得用修改 manifest 的方式“确认授权”。

测试覆盖 dry-run 无写入、参数严格性、确定性 GLB、诊断预览、摘要和许可篡改、伪造 validation、发布确认／无覆盖、路径与链接隔离和 CLI 退出状态。Node 测试运行器及 CLI 子进程在受限沙箱需要允许本地进程创建，否则会报 EPERM；不要将这个沙箱错误记成通过。
