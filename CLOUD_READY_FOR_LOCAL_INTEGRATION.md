# Cloud ready for local integration — CatPlanet

日期：2026-11-08（Asia/Shanghai）。分支：`feat/cat-modeling-foundation`。本轮准备的是**本地真实资产集成前置工程**，不是生产发布、真实猫美术验收或 AI 照片转三维已完成。

本页记录 Sparse/本地回传基础阶段的证据。下一阶段视觉驱动设计与校准实验见 [CAT-VISION-DRIVEN-MODELING.md](docs/CAT-VISION-DRIVEN-MODELING.md)；其合成图像反馈结果不能替代本页的真实资产待验项，也不表示已安装猫专用视觉模型。

## 已完成

- 支持 glTF Sparse Accessor：无基础 bufferView 的零初始化、dense+稀疏覆盖、UBYTE/USHORT/UINT 索引、偏移/对齐/范围/有限值、矩阵列填充及合法尾部省略。primitive 索引、动画时间使用实际解码值。测试在临时隔离仓库运行真实 `compact-creator-glb.mjs`，得到合法 sparse 和全零 morph，没有替换真实模型。
- 检查器加入文件/JSON/描述符/累计扫描/哈希上限、重复范围缓存及迭代图遍历；拒绝 normalized primitive indices、无效逆绑定矩阵。资源限制不能由调用者提高，超限明确返回 `FILES_INVALID / exit 4`，不是进程崩溃或默许通过。
- 旧房间 registry 保留原 ID、URL、SHA、字节数、current 和用户外观。`requiredDesignSchemaVersions` 只是加载要求，`validationEvidence` 明确 unverified/not-provided；不凭 schema、手填 passed 或合成 fixture 证明真实旧模型兼容。实际加载仍需检查解码场景。
- inspect/validate/preview 的真实子进程矩阵覆盖正常、缺文件、非法路径/链接、版本冲突、部分 I/O 失败、dry-run 和执行日志。源检查不能借输出 manifest 的 assetRevision 绕过请求 modelRevision；fixture 显式隔离且不能覆盖已有文件。
- 本地执行器有严格 local-task/local-result 契约、固定安全 argv、请求/任务/脚本/场景摘要、工具版本、输出与结果回传。metadata-only 不读取证据文件；authorized-evidence 需要明确批准，只核验允许的图片/报告/脱敏日志，不接受原模型、照片或 `.blend`。
- PNG 证据使用锁定 `pngjs@7.0.0` 解码 CRC/真实像素，并在解码前限制尺寸/文件/像素数；伪造头部、不完整数据和无界 interlaced 路径会拒绝。该检查不授予视觉或发布批准。
- Skill 与实际 CLI 参数、错误码和回传模式一致。工作分支 push 可触发公开 CI；container 发布 job 仍只针对 main，不会因本分支测试而发布网站或资产。

## 本地实际测试证据

干净 `npm ci` 已通过。本机 Node.js 24.22.1，GitHub 工作流配置 Node.js 22。

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| `npm run test:cat-modeling` | **81/81 passed，0 failed/skipped** | 16 版本/旧资产契约 + 2 固定视觉契约 + 63 CLI/协议/稀疏/回传/PNG 测试；其中 Sparse/资源17项，CLI子进程矩阵11组 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:cat-modeling:browser` | **8/8 passed** | 合成GLB真实导出回读、草稿恢复与隔离、三类移动设备模拟；不是私有猫或真机美术验收 |
| `npm run typecheck` | passed | 类型检查 |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | passed | 生产构建，没有部署 |
| `node cat-modeling/contracts/generate-schemas.mjs --check` | 11份一致 | Zod/JSON Schema 同步及与 fixture 的命名空间隔离 |
| 生产 infer / publish | 明确拒绝，exit 6 / 7 | 没有模型或发布后端，不产出替代模型 |
| 私有旧GLB、真实Blender/毛发/骨架/动作/四阶段视觉 | **blocked / unrun** | 缺少授权源文件与本地证据，不能计入上述通过数 |

原始本机测试日志在被忽略的 `artifacts/cloud-ready-local-integration/node-tests.log`。测试用临时目录和原创合成数据，没有真实用户记录。远端 CI 必须按该分支提交 SHA 独立核对，不能把本机 passed 冒充 GitHub Actions 状态；最终交付会列出实际 run 链接和结果。

## 本地 Agent 需要提供什么

文件通过获准的本地/私有路径处理，不提交公开仓库：

1. `audit-output/cat-modeling-audit.md`，以及 Mac 工作区尚未推送的差异摘要，用于对照审查与并发改动。
2. `public/models/creator/norwegian-cat.glb`、`sphynx-cat.glb`；以及 `lib/room-model-assets.json` 中两份**原哈希**对应的 `public/models/room/*.glb`，不能重建后修改登记 SHA。
3. 对应作者副本 `assets/authored/norwegian-creator.blend`、`sphynx-creator.blend`，外部贴图/原生 groom/缓存（如未内嵌），源作者工具和插件版本。来源和本地审查许可必须核实，不能因为用户提供就默认有训练或分发权。
4. 脱敏 v3/v4/v5 appearance 样例、原 appearanceAsset、参数极值/组合以及 source/groom/short/long/hairless 的验证报告。禁止使用生产账号数据库做回归或清空真实记录。
5. 按[旧资产六类本地用例](docs/LEGACY-CAT-ASSET-LOCAL-VALIDATION.md)逐哈希验证：原字节、迁移数值、bodySurface多图元、dense/sparse/Blink、骨骼材质groom姿态、旧存档/草稿重载与失败恢复。
6. 按[本地执行/回传协议](cat-modeling/LOCAL-BLENDER-EXECUTOR.md)返回 `local-result.json`：原任务摘要、实际工具版本、源前后SHA、真实退出码/失败阶段、输出摘要、明确 unrun/blocked 和限制。默认仅元数据；批准后才提供限定的预览/报告/脱敏日志副本，不回传原模型或照片。

核心返回命令：

```sh
node cat-modeling/cli.mjs validate --contract local-result --file local-result.json \
  --task-file blender-task.json --dry-run
# 仅在获准回传证据副本时增加 --input-root <证据目录>
```

工具版本不明确、源哈希改变、非零退出、任务混用、证据损坏或缺文件均不能标完成。`metadata-accepted-unverified` 与 `evidence-integrity-verified-unapproved` 不等于真实本地集成/视觉批准；结果始终保留 `approved:false`、`productionIntegrationReady:false`。许可、私有源字节、内存/设备预算、真实动画与美术仍需人工/本地确认。

## 尚未实现与阻断项

- 没有猫专用预测模型、合法训练集、权重、GPU执行器或第三方推理服务。A形态/B毛色/C毛流只有版本化接口，生产 infer 继续 `MODEL_UNAVAILABLE`。没有训练、下载权重或照片重建。
- 本地 Agent 必须执行固定任务并回传证据；云端没有实际执行其私有 `.blend`。原生 Hair Curves/Cycles 材质与标准 GLB 的转换损失、完整动作和原旧外观仍未验收。
- 当前环境对 `api.github.com/graphql` 返回代理 Forbidden，Draft PR API 创建被阻。域名需求已在环境配置草稿中；启用前不能宣称 PR 已存在。GitHub公开网页可读，因此本分支 push 仍可触发并观察 Actions，不需要修改 main。
- PNG返回支持有界非交错格式；原始参考图目前只验证文件摘要/声明与 MIME 签名，不将签名匹配称为图像内容或版权通过。GLB检查器也不是完整Khronos或美术验证器。

## 主要修改文件

| 范围 | 文件 |
| --- | --- |
| 稀疏/资源检查 | `cat-modeling/contracts/glb-inspector.mjs`、`tests/sparse-accessors.test.mjs` |
| 资产声明 | `lib/room-model-assets.json`、`lib/room-model-assets.ts`、`tests/cat-model-contract.node.ts` |
| CLI访问/失败/隔离 | `cat-modeling/cli.mjs`、`production.mjs`、`pipeline.mjs`、`file-access.mjs`、`tests/cli-matrix.test.mjs`及既有断言 |
| 本地交接与证据 | `contracts/local-executor-contracts.mjs`、`contracts/index.mjs`、两份schema及示例、`local-executor.mjs`、`png-evidence.mjs`、对应测试、`package.json/package-lock.json` |
| Skill/文档/CI | `.agents/skills/miaoxing-cat-model/SKILL.md`、`.github/workflows/ci.yml`、CLI README、本地协议、旧资产用例、本文件及当前PR说明 |

不合并 main，不新增宠物世界功能，不修改正式数据库，不删除旧模型，不自动发布网站，不上传未经授权的模型/照片/密钥/训练数据。
