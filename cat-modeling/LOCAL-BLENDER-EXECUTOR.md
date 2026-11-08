# 本地 Blender 执行与回传协议 v1

云端只计划、校验及收集获准证据，不运行 Blender。`contracts/local-task.schema.json` 和 `local-result.schema.json` 由严格 Zod 定义生成；`local-executor.mjs` 只读核对回传，不启动命令、不上传文件、不更新资产或数据库。

## 输入及执行批准

1. 请求必须有独立 jobId、原模型 SHA、获准本地审查的 `model.glb`、设计/拓扑/groom、预算及参考文件摘要。源文件只读。来源或权限不明时，不为过校验把状态改成 verified；仅可用 `inspect --file` 做受限结构审查，执行保持 blocked。
2. `preview --request <request.json> --input-root <隔离输入目录>` 在新 run 中生成 `blender-task.json`。缺文件也能生成 blocked 计划，但不是执行批准；dry-run 不落盘。任务记录请求 SHA、原模型修订、固定操作 argv、脚本/场景 SHA、相机灯光、设计、预算、待确认 `.blend`、工具版本和四个预期渲染输出。
3. 本地 Agent 核实源 `.blend` 的本地审查/修改许可、来源、SHA 和准确 Blender 版本。原 Sphynx 制作记录为 3.6.23，Norwegian 为 4.5.15 LTS；其他可用版本不能替代。无法确认就返回 blocked。云端版本要求为 null 时，结果继续保留工具兼容待人工复核，不能自动成为“已兼容”。
4. 取得本次本地执行的明确批准，保留批准引用；另行批准证据回传范围。执行批准不授权把模型、照片、截图或日志提交公开仓库。默认只返回元数据。

## 固定调用

核对本地 repository 的 `scripts/render-cat-validation.py` 和 `lib/cat-visual-scenario.json` 字节 SHA 与任务一致。将 task.appearance 原样写入全新 job 目录的 appearance.json，不把整个 request 当作设计。替换本地路径占位符后，以参数数组、`shell:false` 调用固定操作：

```text
blender --background --disable-autoexec --threads 2 <获准只读作者副本.blend>
  --python-exit-code 1 --python <repository>/scripts/render-cat-validation.py
  -- --design <isolated-job>/appearance.json
  --output <repository>/artifacts/local-preview-<jobId>
```

不要把不可信路径拼入 shell 字符串，不接受任意用户脚本/`--python-expr`。输出目录必须不存在；使用新 job/目录，不清空旧目录。本地监督进程落实 timeout、内存与设备限制，记录真实退出码、耗时、超时和日志；无法落实/测量的预算明确 unrun。执行前后计算源 SHA，原件不保存、不覆盖。

现有脚本输出 front.png、three.png、side.png、validation.json，记录实际工具版本、源摘要、设计、场景、材质/骨骼/毛发观察和图片摘要；另保留脱敏 execution.log。脚本不做照片推理、训练或生产发布。原生毛发不默认成为 GLB 能力，Blender 单阶段也不等于 creator/GLB回读/room 四阶段验收。

## 结果与返回 Codex

local-result 严格包含 jobId、规范化任务 SHA、请求 SHA、completed/failed/blocked、返回方式和授权引用、Blender 版本、源 SHA before/after、脚本/场景 SHA、命令是否执行/退出码/耗时/失败阶段、五个文件的字节数/SHA、检查和限制。

- `completed` 要求获准执行、退出0、未超时、源 SHA 不变，并报告 input-integrity、source-unchanged、tool-version、render-completed、output-integrity 五项 passed。失败或部分产出必须 failed，缺文件/工具为 blocked；保留真实失败阶段，不能改写成功。
- `metadata-only` 默认只把 local-result.json 和原已知任务交给 Codex，artifacts 只含摘要清单。没有图像、原模型或内联数据。只能得到 `metadata-accepted-unverified`；文件字节仍 unrun。
- `authorized-evidence` 另需 evidenceReturnApproved 和批准引用，只接受 front/three/side PNG、validation.json、脱敏 execution.log 的获准副本。图片最多32MiB、4M像素，必须可解码且CRC有效，固定场景尺寸匹配。当前有界解码器拒绝 interlaced PNG，避免该解压路径无界；使用固定脚本的非交错输出。
- 日志不含密钥、环境变量、Cookie、用户记忆或原图。脱敏日志/报告副本重新计算摘要并说明关系，不能沿用原摘要。不得上传 `.blend`、GLB、私人照片或训练数据。

任务摘要是 `sha256(JSON.stringify(parseContract('local-task', task), null, 2) + '\n')`。CLI 的 canonicalSha256 用于这类规范化身份；fileSha256 是原文件字节，两者不混用。Codex 必须使用自己保留的原任务文件，不能只信任回传方另给的新任务。

```sh
node cat-modeling/cli.mjs validate --contract local-task --file blender-task.json --dry-run
node cat-modeling/cli.mjs validate --contract local-result --file local-result.json \
  --task-file blender-task.json --dry-run
# 仅在明确批准回传这些证据文件之后：
node cat-modeling/cli.mjs validate --contract local-result --file local-result.json \
  --task-file blender-task.json --input-root <获准证据副本目录> --dry-run
```

没有 task-file 时仅检查协议结构，不能证明任务或产物。带 task-file 的只读核对包括 job/request/task、当前仓库脚本/场景、源一致性声明、工具要求（如已确定）、执行状态、文件摘要、PNG像素和报告链接。源私有字节、许可、内存/设备、真实骨骼/毛发/动作及四阶段美术仍需本地/人工证据。

即使证据完整，仍返回 `approved:false`、`productionIntegrationReady:false`，不批准发布。失败/受阻以非零码返回，不能用旧 validation 替代重算。`contracts/examples/local-result.blocked.v1.json` 明确没有执行或截图；测试中的合成PNG/报告只验证协议，不能证明真实Blender能力。
