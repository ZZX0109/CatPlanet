# 五轮基础猫精修记录

日期：2026-11-03。所有对照图均来自本地 `/studio` 实际浏览器渲染；不是生成的效果图。使用默认外观、1280 × 920 视口与系统减少动态效果设置。

## 修改与检查

| 轮次          | 实际修改                                                             | 观察与限制                                   |
| ------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| 1：面部       | 调整头骨、鼻梁、双侧胡须垫和下巴；新建有弧度的鼻部及鼻孔；胡须渐细   | 口鼻体块更细分，整体仍过于规则               |
| 2：眼部       | 缩小并收近眼睛；眼睑外缘贴合脸部曲面；调整虹膜、瞳孔与采样精度       | 减少眼部贴片感，眼眶曲面仍需雕刻             |
| 3：毛色和毛流 | 新建连续花纹采样；条纹按头、躯干、尾巴分区；脸颊短毛更贴肤           | 减少规则全身环纹，当前仍不能替代精细 UV 纹理 |
| 4：趴卧       | 四肢改为连续曲线映射，保留脚掌体积；移除双线段混合与后腿直接压缩     | 原有腕部分叉明显改善，软组织形变仍简化       |
| 5：整体检查   | 自然侧窗光；耳廓细节和细毛；短毛细节层；放松头颈；收拢脚掌、腹底支撑 | 光照能更清楚暴露形体差距，当前仍偏程序模型   |

| 对照    | 面部                                                 | 全身                                                  | 趴卧侧面                                                  |
| ------- | ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| 修改前  | [查看](../artifacts/cat-refinement/round-0/face.png) | [查看](../artifacts/cat-refinement/round-0/stand.png) | [查看](../artifacts/cat-refinement/round-0/rest-side.png) |
| 第 1 轮 | [查看](../artifacts/cat-refinement/round-1/face.png) | [查看](../artifacts/cat-refinement/round-1/stand.png) | [查看](../artifacts/cat-refinement/round-1/rest-side.png) |
| 第 2 轮 | [查看](../artifacts/cat-refinement/round-2/face.png) | [查看](../artifacts/cat-refinement/round-2/stand.png) | [查看](../artifacts/cat-refinement/round-2/rest-side.png) |
| 第 3 轮 | [查看](../artifacts/cat-refinement/round-3/face.png) | [查看](../artifacts/cat-refinement/round-3/stand.png) | [查看](../artifacts/cat-refinement/round-3/rest-side.png) |
| 第 4 轮 | [查看](../artifacts/cat-refinement/round-4/face.png) | [查看](../artifacts/cat-refinement/round-4/stand.png) | [查看](../artifacts/cat-refinement/round-4/rest-side.png) |
| 第 5 轮 | [查看](../artifacts/cat-refinement/round-5/face.png) | [查看](../artifacts/cat-refinement/round-5/stand.png) | [查看](../artifacts/cat-refinement/round-5/rest-side.png) |

每轮 `review.json` 记录加载时间和页面异常。加载数据来自本机开发服务及浏览器软件渲染，不能视为手机性能指标。可运行 `node scripts/review-cat.mjs round-5` 重新检查当前版本。

## 功能验证

- 类型检查与本地 Docker 生产构建通过。
- 纪念房间的 5 项回归通过；工作室的 2 项回归在修正后通过。手机侧面取景调整后，再次通过移动端单项检查。测试分批运行。
- 验证实际画布变化、历史与本机保存、错误导入恢复、GLB 导出并在浏览器重新载入、22 根骨骼、8 个身体变形目标、眼睑闭合和半程动作混合。
- 共享顶点减少重复变形数据；检查样本的导出从约 113 MiB 降到约 40 MiB，并设立 45 MiB 的回归上限。当前文件仍较大，不能据此认定移动端性能达标。
- 手机检查覆盖触摸、布局与最大体型参数。它是浏览器模拟，仍需真实手机验证。

## 结论

本轮完成五个方面的代码精修，仍未达到 C 图或研究论文展示的写实质量。下一阶段应转向高质量母模、稳定 UV 与分区毛流制作，见 [写实猫路线](./CAT-REALISM.md)。不应继续用“功能测试通过”代替美术质量通过。

具体剩余问题：脸部和眼眶仍偏对称、规则；前腕仍偏直立，后脚掌突出，尾根有折点；毛发尚缺底绒层次与自然遮挡。当前姿态更接近伏低蹲卧，尚不是参考图中完全放松的躺卧。
