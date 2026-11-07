# 跨语言请求示例

`request.v1.json` 演示 `local-edit` 契约。`modelId` 与全零 `modelRevision` 是明确占位符，示例中没有私有模型文件。`modelLicense` 的 `verified` 只是展示严格契约的合法字段形态，`example-only-not-evidence` 不是授权证据；实际使用前必须替换为拥有本地审查权限的模型、真实 SHA-256 和确认过的授权记录。尺寸是接口演示的名义值，不是本次测量结果。`executionBudget` 固定示例为 CPU、300 秒、4096 MiB 内存和 0 MiB 显存；其他操作包括 `groom-adjust`、`model-validate` 及兼容保留的 `groom-validate`。请求契约通过不代表模型已存在、授权已经核验、推理可用或视觉验收通过；CLI 应将缺失原模型报告为受阻。

`request.model-fit.v1.json` 演示带授权元数据和内容摘要的参考输入。`references/synthetic-pixel.png` 是在本示例中通过 PNG 规范写出的原创一像素 RGB 图，没有宠物照片、外部素材或用户记录。该示例图按 CC0 1.0 供协议测试使用；请求额外限制为本地审查、禁止训练和公共分发。这一声明只涉及该合成像素，不涉及 Norwegian/Sphynx 模型或其他仓库文件。`provenance.evidence` 引用本节 `synthetic-pixel-original`，是测试证据，不是任何真实照片的授权凭据。

## Python 准备、Node 校验

从仓库根执行：

```sh
python3 cat-modeling/contracts/examples/prepare_request.py \
  --job-id job-example-cross-language > /tmp/cat-request.json
# 用当前 CLI 的 validate dry-run 验证 /tmp/cat-request.json；
# 模型文件缺失时仍会得到明确的阻塞结果，而不是假成功。
node cat-modeling/cli.mjs validate --request /tmp/cat-request.json --dry-run
```

Python 程序只读取本地 JSON、按需替换 job ID 并向标准输出序列化；不创建模型文件、不启动进程、不运行 Blender、不上传或读取参考文件内容。使用 `--input request.model-fit.v1.json` 可选择第二份请求。完整严格校验由 Node 契约入口执行，Python 示例没有实现第二套可能漂移的规则，也不把 JSON 可解析当作业务合法。

需要实际文件校验时，将获准审查的 `model.glb` 及请求引用的 `references/` 文件放入隔离输入根，按 CLI 使用说明传入输入路径；不要从原资产目录移动／覆盖文件。示例一像素图无法用于猫咪拟合，当前 `infer` 默认也没有真实模型可调用。
