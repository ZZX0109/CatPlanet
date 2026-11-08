# 喵星猫模型接口与隔离 CLI

当前版本提供严格协议、现有模型的本地结构检查、文件校验和本地 Blender 任务交接。**没有可调用的生产猫模型、已注册权重、训练、外部推理服务或生产发布后端**。默认 `infer` 返回 `MODEL_UNAVAILABLE`，不会用测试几何冒充 AI 输出；`publish` 返回 `PRODUCTION_PUBLISH_UNAVAILABLE`。Next.js 不执行这些离线操作。

## 生产协议

[contracts/README.md](contracts/README.md) 定义请求、appearance、groom、features、manifest、validation，以及 A 形态、B 毛色纹理、C groom 三个独立的接口版本。`contracts/index.mjs` 的严格 Zod 对象用于运行时校验；同目录 `*.schema.json` 是生成的跨语言 JSON Schema。重心坐标和、头型混合和、重复特征／参考、操作条件、拓扑绑定及 CPU/GPU 预算关系还由运行时语义校验检查。未知字段不会默默接受。

```sh
# 仅查看真实可用能力；无文件生成或后台任务
node cat-modeling/cli.mjs inspect
# 原模型的受限本地元数据检查，许可、语义和视觉仍未验收
node cat-modeling/cli.mjs inspect --file /path/to/approved/model.glb
# 仅检查协议结构；明确不代替私有模型文件验收
node cat-modeling/cli.mjs validate --contract request \
  --file cat-modeling/contracts/examples/request.v1.json --dry-run
# 生产模型目前不可用；exit 6，不生成任何代替模型
node cat-modeling/cli.mjs infer \
  --request cat-modeling/contracts/examples/request.v1.json --dry-run
# 完整交付包检查：需要下面列出的全部文件、正确摘要与资源预算
node cat-modeling/cli.mjs validate --request /path/to/job/request.json \
  --input-root /path/to/authorized/package --dry-run
# 本地源资产检查与 Blender 任务描述；不会启动 Blender
node cat-modeling/cli.mjs preview --request /path/to/job/request.json \
  --input-root /path/to/authorized/input --dry-run
node --test cat-modeling/tests/*.test.mjs
```

生产请求使用 `requestVersion:1` 和独立 `jobId`，记录操作 `model-fit`、`local-edit`、`groom-adjust`、`model-validate`（兼容 `groom-validate`）、modelId、原模型 SHA-256、模板／拓扑版本、米制右手 Y-up/+Z-forward 坐标约定、名义尺寸、几何／纹理预算及执行预算（超时、内存、CPU/GPU、显存）。执行预算当前只交接，不会启动推理去消耗它。参考图必须显式声明本地审查许可、主人同意、来源证据及内容摘要；未知／未授权字段失败。输入不包含照片远程 URL、账号、邮箱或真实记忆。

示例模型 ID／全零摘要是占位符，示例许可字段仅演示结构，不能视为真实授权证据。只有示例的一像素 PNG 是本次原创协议测试数据。运行示例的完整文件检查会得到缺少私有模型的结果，不会假通过。[Python → Node 示例](contracts/examples/README.md) 只准备 JSON，不执行模型、Blender、网络或文件复制。

### 源检查与完整交付包检查

`inspect --request` 与 `preview --request` 检查输入 `model.glb` 的原模型摘要及参考文件，并可报告真实结构。`validate --request` 校验完整输出包，强制存在 `manifest.json`，以及 manifest 列出的 `appearance.json`、`model.glb`、`groom.json`、`features.json`、`preview.png`、`validation.json`。重新计算全部字节数／摘要，核对 request/job/model/template、四类版本、声明的尺寸／坐标／预算、输出 groom 的拓扑／表面、实际 GLB morph/骨骼/clip/材质清单和内嵌纹理摘要。历史 validation 报告须有正确身份和摘要，但不能替代本次重新检查。

局部编辑和拟合可产出新 appearance 值；输出仍必须满足同一模板与 designSchemaVersion，不能将不同拓扑参数套用旧资产。manifest 的许可不能比请求自报的权限扩大。自报 `verified` 只代表调用者提供了合法声明，独立授权证据审阅仍标为 `unrun`。

GLB 检查器验证二进制长度、嵌入资源、accessor 范围、有限值、primitive/index/morph 引用、三角网格资源、节点变换与树结构、皮肤引用和纹理摘要；支持标准 sparse accessor、隐式全零与 dense+稀疏覆盖；拒绝外部纹理和非三角 primitive。它不是完整 Khronos conformance validator，不会从名字推断骨骼/动画/眼控语义；不会从米制/Y-up 字段推断真实解剖朝向、落地或实测尺寸。这些项目以及实际材质／毛发／视觉审查始终分别标 `unrun`，不存在“私有素材检查通过”的替代结论。

### 隔离、日志和本地交接

`--dry-run` 可读取并检查，但不创建目录、不写日志、不生成模型／预览。带请求的非 dry-run 操作写入默认 `cat-modeling/jobs/<jobId>/runs/run-NNNNNN-<command>/`，包含 JSON 结果和 `execution.log.jsonl`；重复运行新增不可变目录，已有 request 的 jobId 不能用于不同输入。日志只含命令、请求摘要、状态和执行事实，不记录照片内容或凭据。无合法 jobId 的参数／JSON 解析失败只有标准错误 JSON，不会猜测目录写入。无状态 inspect、contract-only validation 不写任务。

自定义 `--root` 仅允许默认 jobs 后代或系统临时目录下的专用目录；拒绝遍历 ID、输入／输出符号链接、覆盖现有请求和路径越界。原始模型、数据库和用户记录不会被修改。`--input-root` 中的源文件只读；不会复制私有参考图到任务目录。

`preview` 产生 `blender-task.json`，其中包括原模型／请求／现有渲染脚本／统一场景 SHA-256、真实脚本参数形态、固定相机灯光、执行预算、所需本地源 `.blend`／工具版本和未完成检查。argv 为数组、`shell:false`，包含 `--disable-autoexec`、`--python-exit-code 1` 和线程限制。命令中的路径占位符必须由本地执行器校验后替换，**不是可直接执行的云端命令**。原 `.blend` 授权、摘要与准确 Blender 版本尚待本地确认。任务使用现有 `scripts/render-cat-validation.py` 与 `lib/cat-visual-scenario.json`；当前 CLI 不调用进程、不执行 `.blend` 自动脚本、不渲染图片、不声称 preview 已完成。输出要求是 front/three/side PNG 及本地 validation 证据。原生 Blender hair/Cycles closure 不会被假定为 GLB 能力。

结果以 JSON 输出：成功到 stdout，失败到 stderr。退出码：0 成功；2 参数错误；3 契约非法；4 文件／资源／摘要不合；5 私有资产缺失；6 `MODEL_UNAVAILABLE`；7 `PRODUCTION_PUBLISH_UNAVAILABLE`；8 本地 I/O。检查可用性成功（exit0）与模型可推理是不同事实。没有实际发布确认／后端时，不因请求自报确认而执行生产发布。

## 显式测试 fixture（保留历史接口）

仅加 `--engine fixture` 后才会使用仓库原创几何猫 `miaoxing-geometric-cat-v1`。它有身体、头、耳、四肢和尾部，是合法固定拓扑 GLB 2.0，没有骨骼、morph、动画、毛发或 AI。它的 appearance `designSchemaVersion:1` 命名空间是 `miaoxing.fixture.appearance`，**不是生产造型室 v5，也不能导入现有纪念房间**。旧 `schemas/` 仅属于该 fixture，新增生产协议位于 `contracts/`。

```sh
node cat-modeling/cli.mjs infer --engine fixture \
  --request cat-modeling/examples/request.json --dry-run
node cat-modeling/cli.mjs infer --engine fixture \
  --request cat-modeling/examples/request.json
node cat-modeling/cli.mjs validate --engine fixture \
  --task task-7f6786d86bd7aaeee5841b70 --dry-run
node cat-modeling/cli.mjs preview --engine fixture \
  --task task-7f6786d86bd7aaeee5841b70 --dry-run
node cat-modeling/cli.mjs publish --engine fixture \
  --task task-7f6786d86bd7aaeee5841b70 --dry-run
```

相同 fixture 请求产生相同 task ID 和 GLB 字节；已有任务拒绝覆盖。它写入 request、appearance、model、groom、manifest、validation；preview 的 SVG 是实际 GLB 顶点的固定斜视诊断投影，不是物理毛发／材质视觉验收。`assetRevision` 是 GLB 字节 SHA-256，`topologyVersion` 标识几何契约，`groomSchemaVersion` 与参数版本独立。

fixture 的 `publish` 仍仅为 `jobs/releases/<taskId>/` 的独立暂存。每次重新校验可信确定性引擎输出，拒绝篡改的几何、许可、伪造 validation；真正暂存还需要在展示具体任务、目标、预览限制并取得用户明确批准后传入 dry-run 中的精确确认令牌。代理自己算出令牌不等于用户同意。暂存绝不更新当前模型、网站或数据库；生产发布仍不可用。只有本次原创 fixture 几何按 [CC0 声明](FIXTURE-LICENSE.md) 使用，不能把该许可套给 Norwegian、Sphynx、原 Blender 或用户照片。未知授权素材只做受限本地审查，禁止训练和公共分发。

本地任务和回传的精确协议见 [LOCAL-BLENDER-EXECUTOR.md](LOCAL-BLENDER-EXECUTOR.md)。初始计划、元数据回传、授权文件完整性与真实视觉批准是不同状态；不能互相替代。
