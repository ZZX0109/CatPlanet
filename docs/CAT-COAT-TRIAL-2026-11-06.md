# 短毛与长毛猫母模试验（2026-11-06）

## 可看的样张

| 版本 | 全身 | 脸部 | 状态 |
| --- | --- | --- | --- |
| Grey Tabby 原生短毛 | [全身](../artifacts/grey-tabby-trial/original-full-v2.png) | [脸部](../artifacts/grey-tabby-trial/original-face-v2.png) | Blender 本地视觉候选，真实感明显优于当前网页母模 |
| Grey Tabby 原生长毛 R3 | [全身](../artifacts/grey-tabby-trial/native-long-r3/final/three.png)、[正面](../artifacts/grey-tabby-trial/native-long-r3/front.png)、[侧面](../artifacts/grey-tabby-trial/native-long-r3/side.png) | [脸部](../artifacts/grey-tabby-trial/native-long-r3/final/face.png) | 当前本地造型候选：直接编辑原作者毛束、保留原毛色与毛发材质，胸口和体侧分层梳理；尚未转换成网页资产 |
| 旧分区长毛试制（淘汰） | [全身](../artifacts/grey-tabby-trial/long5-full.png) | — | 用户否决；叠加层形成毛帘和灰雾，不再作为后续母模 |
| 直接网页格式转换 | [截图](../artifacts/grey-tabby-trial/web-mesh-only.png) | — | 失败：原生毛发与虎斑皮毛贴图没有保留下来 |

## 小红书观察如何进入建模

- 按毛型科普区分**贴身底绒、过渡毛、外层护毛**。短毛版本保留原模型的密集短毛轮廓；长毛试制保留短毛底层，只向外增加区域化外层毛。
- 按猫脸毛流笔记保留鼻梁、眼周短毛；下脸颊的毛向两侧与下方展开，颈胸向下、体侧向后下、尾巴沿轮廓蓬开。这个分区用实际网格根部位置和法线计算，见 [`long_coat_groom.py`](../artifacts/grey-tabby-trial/long_coat_groom.py)。
- 多轮对比显示：仅放大原模型粒子毛发的 `hair_length` 或单根 `size`，**没有形成长毛体型**；单纯加长脸颊与胸口会形成毛帘、遮住眼睛。第三轮将长毛根部移到下脸颊和胸口，眼鼻仍短，但外层颜色与真实长毛体积仍不理想。
- **纠正此前检查：** 原素材将全部粒子毛发的编辑显示关闭，未经求值的 `hair_keys.co` 为零，但真正的原生曲线一直保存在 `co_local` 中。因此此前关于“原毛束无法修改”的判断过早。打开对应修改器后，能读到原作者毛束的真实方向，并在已求值的毛囊坐标系中重新梳理，写回原毛束。
- 当前 R3 保留原生底层，调整过渡层和外层毛束：脸颊向侧下展开，胸口向下，体侧和背毛向后下，尾毛由根到尖逐渐收短；各区设置长度上限，避免少数原本较长的毛束放大成刺。眼鼻周围保持短毛。未增加独立曲线罩层，原虎斑贴图、毛发材质与毛囊归属保留。参考 [猫脸毛流](https://xhslink.cn/o/AqdCyZSJp8F)、[毛型科普](https://xhslink.cn/o/9ASIo6rpqFA)、[鼻梁毛流](https://xhslink.cn/o/6CDTS08tXRQ) 与 [挪威森林猫被毛标准](https://cfa.org/wp-content/uploads/2024/03/norwegian-forest-cat-standard.pdf)。

## 资源结构与网页适配

- 用户提供并声明已授权的原始 `JC0L219A2_GreyTabbyCat_Walk_3.1.blend` 与贴图保存在本机 `~/Downloads`，没有加入网页公开资源目录。原件有 44,520 顶点的身体网格、19 个分区粒子毛发系统、1163 根控制与变形骨骼、走路动作、4K UDIM 贴图和少量闭眼／修复形变键。
- 短毛可打开文件：[原始 Walk Blender 模型](</Users/afa/Downloads/JC0L219A2_GreyTabbyCat_Walk_3.1.blend>)。当前长毛可打开文件：[原生长毛 R3](</Users/afa/Downloads/GreyTabbyCat-long-native-r3.blend>)。旧 `GreyTabbyCat-long-coat-study.blend` 是已淘汰的静态叠加层，不再作为当前版本。
- 本地 Blender 渲染能显示真实毛发；直接转换得到的 123 MB GLB 只有静态网格，既无原生毛发，也无骨骼动画和捏脸形变，虎斑贴图也失效。因此不能直接替换 `public/models/creator/norwegian-cat.glb`。
- 要在网页中使用母模，需要先烘焙或重排贴图、简化骨架、把原生毛发梳理数据转换成可实时渲染的分层毛、补足捏脸形变，再验证手机性能。R3 仍是同一虎斑母模的长毛造型，不包含新的长毛品种脸型。
- 当前项目代码、旧母模与设计截图已保存在 [`artifacts/checkpoints/2026-11-05-before-grey-tabby`](../artifacts/checkpoints/2026-11-05-before-grey-tabby/README.md)。本轮仅在本地试用；以后若要把该付费资产放入公开网页或允许用户导出，需核对授权包含的发布范围。

## 本轮验证

`tests/cat-fur-flow.spec.ts` 与 `tests/cat-coat-anatomy.spec.ts` 共 4 项通过；`npm run typecheck`、`npm run build` 通过。现有 `/studio/base` 未被试制模型覆盖，原有版本继续可用。

原生长毛 R3 另已保存后重新加载，在 Cycles 中检查全身、正面、侧面与脸部，并输出 1200 像素、64 采样的全身和脸部图。走路第 0、15 帧各抽查头和身体 64 个毛根，修改版与原母模的毛根最大偏差为 0，随原骨骼运动；[检查结果](../artifacts/grey-tabby-trial/native-long-r3/binding-report.json)。这证明抽查的毛根绑定未移动，不代表已经完成所有动作的毛发穿插检查。
