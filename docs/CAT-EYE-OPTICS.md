# 眼球与眼睑修正

当前制作阶段为 `refinementRound: 8`，本地访问 [猫咪造型室](http://localhost:3000/studio/base)。沿用免费且允许修改的素材，修改同时保存在 Blender 制作源和网页 GLB 中。

本轮处理的是瞳孔白色竖条、虹膜过平、眼角黑缝与泪阜悬空的问题：

- 黑瞳孔改为不反光的凹入表面，竖瞳缩短并收尖；反光由独立透明角膜承载。
- 虹膜增加曲面、放射纹理与细微起伏，眼球位置向前调整，减轻陷入眼眶的感觉。
- 眼裂内侧补实际厚度和细窄湿润睑缘，与真实眼睑共用形状和闭眼修正。
- 泪阜缩小并贴合真实内眼角，跟随眼睛大小、倾角和闭眼变化。
- 网页角膜使用圆形环境光源产生小反光，替换原先的大块矩形倒影；头皮照明保持原设置。没有把白点画进虹膜。

## 查看与复现

刷新页面，切到“材质预览”，分别看正面、三分之四、侧面和闭眼。保留现有外观参数；“自然脸”可用于检查基准形体。

```sh
npm run build:cat
node scripts/capture-cat-eyes.mjs 04-final
npm run typecheck
npm test -- tests/cat-creator.spec.ts tests/cat-fur.spec.ts
```

构建默认生成第 8 阶段。`-- --round 7` 可复现上一阶段资产。眼部截图脚本暂时隐藏几何毛束，方便查看眼睑与眼球；它不是完整外观截图。

- [实际网页近景，包含默认毛发](../artifacts/eye-optics-refinement/06-verified-final/natural-material-detail.png)
- [实际网页三分之四](../artifacts/eye-optics-refinement/06-verified-final/natural-material-three.png)
- [实际网页闭眼](../artifacts/eye-optics-refinement/06-verified-final/natural-material-closed.png)
- [完整网页](../artifacts/eye-optics-refinement/06-verified-final/desktop.png)
- [本轮几何检查](../artifacts/eye-optics-refinement/final-geometry-audit.json)
- [原生眼睑毛发检查](../artifacts/eye-optics-refinement/final-lid-fur-audit.json)

## 验证范围与限制

正式资产有 31 个网格。40 组几何姿态采样没有发现退化三角面，中性姿态没有法线反向的面；形变相对中性的方向变化仍记录在报告中，不能据此宣称所有组合无折叠。眼睑毛发通过 8 组原生姿态采样。毛色加工前后，同次构建中 24 个原结构网格及原生形状坐标保持一致。

浏览器回归检查实际导出再加载的瞳孔、角膜材质，真实眼睑遮挡与眼球形状保持，新增睑缘随闭眼运动，以及鼠标/触摸、保存、毛量/毛长与导出。测试通过只证明这些功能有效。

本轮 3 项浏览器回归、类型检查及本地 Docker 生产构建通过。最终代码再次捕获完整网页，未发现页面异常。

实际截图中瞳孔白条和眼角悬空已减轻，但眼周轮廓仍偏硬、眼神仍偏僵，虹膜层次和毛流仍不足。整体尚未达到之前 C 参考图的写实效果。
