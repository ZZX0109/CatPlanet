# 免费猫母模：来源、实际预览与制作缺口

更新：2026-11-03。用户已确定：**只用免费、允许修改的模型**。当前程序猫停止作为写实母模继续精修。

## 已能实际查看

打开 [旧版本地虎斑猫捏脸页](http://localhost:3000/studio/base?legacy=1)。这里展示已下载并转换的真实三维文件，可旋转、缩放、看正面/侧面/脸部近景和灰材质。当前保留 CC0 虎斑猫作为形体来源。默认 `/studio/base` 已改为 [Blender 加工后的结构猫头编辑](./CAT-CREATOR.md)，具有独立眼球/眼睑，旧版的无骨架/烘焙贴图描述只指本页记录的原素材。

**当前已接入 8 项局部捏脸、撤销/重做、本机保存、JSON 导入导出与 CC0 GLB 导出。** 每项参数对应一对原生形变目标，导出的 GLB 保留 16 个目标、当前权重及嵌入贴图。它仍是静态模型，没有动作；原程序猫工作室与本页的数据独立。[使用说明](./TABBY-FACE-STUDIO.md)。

## 默认候选：CC0 虎斑猫

- 作者来源：[Grab3D Tabby Cat](https://grab3d.com/models/animals/cat/)。原始许可为 [CC0 1.0](https://grab3d.com/dl/cat/LICENSE.txt)，允许修改；作者披露基础网格和贴图经 Meshy 生成，再在 Blender 清理。
- 已取得 `assets/source/grab-tabby-cat/cat.glb`、`cat.blend`，保存原始许可、清单和 SHA-256。
- 源网格有 765,012 个三角面；网页评估副本减至 59,999 个三角面、2K 贴图，从约 30.5 MB 减到 **3.40 MB**，保留真实轮廓与 PBR 材质。
- 网页文件：`public/models/review/tabby-web.glb`；其来源许可保存在同目录 `LICENSE.txt`，转换信息在 `tabby-web.json`。

实际检查：正面、侧面和脸部比旧程序猫自然。灰材质也暴露出需要修整的眼眶与表面细节。**它不是制作完成的动画猫**：源文件无骨架、无形状目标、无独立眼球/角膜；网页新增局部形变，但虹膜与高光仍烘焙在颜色贴图里，眼睛大小/间距是眼区曲面的变化。表面的毛发表现也不能当作真正独立毛发系统。

目前的局部形变可用于静态外观编辑。下一步应重做独立眼部结构并整理面部/关节拓扑，再做表情、骨架和动作；不能直接套上旧趴卧修正就宣布完成。

## 对照候选：免费绑定橘猫

实际近景检查发现眼部不自然，已移出默认候选。开发时可通过 `/studio/base?compare=1` 查看检查对照，不作为通过美术评审的母模。

- 作者：[Paweł Wałasiewicz — Ginger Cat (rigged with IK)](https://www.blendkit.com/asset-gallery-detail/6d772d59-15f2-4a57-a593-e664765448f1/)。官方匿名免费流程已成功下载 `.blend`，没有登录或购买。
- 源文件有身体、眼睛材质分区、IK 骨架和作者梳理的毛发；没有捏脸形状键，动作数据只有姿势库，不能按现成走路/趴卧动画验收。
- 转换了静态身体、眼部纹理与 11,319 条作者毛发引导线，得到 **11.96 MB** 的本地预览。没有随机生成新毛流，原文件没有修改。

许可是 Royalty Free，允许修改与列举的成品用途，独立模型分发有范围限制，详见[平台许可](https://www.blendkit.com/docs/licenses/)。因此源文件和评估副本保留在非公开目录；预览接口只在开发环境开放，生产构建不包含该文件，也不提供用户导出。

## 本轮验证

- 实际浏览器加载两份 GLB、切换模型；检查嵌入贴图和有限包围盒。
- 灰材质、键盘旋转与鼠标拖拽改变实际画布像素。
- 故意中断一次模型加载，再验证重新加载恢复同一候选。
- 手机触摸按钮、竖屏/横屏布局；近景按每只猫实际头部范围构图，避免尾巴影响焦点。
- 截图与记录位于 `artifacts/cat-base-review/`。手机为浏览器模拟，尚不代表真实设备性能验收。

## 本地工具与复查

本轮使用项目内 Blender 4.5.15 LTS，安装映像的 SHA-256 与官方校验一致。后台读取文件时关闭嵌入脚本，原素材保留。`.tools/` 和原始素材不进入 Docker 构建。

```sh
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-tabby-preview.py
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-ginger-preview.py
node scripts/review-cat-base.mjs
```

接下来的制作顺序：**确定中性形体 → 独立眼睛与眼睑 → 重拓扑和形状目标 → 骨架、趴卧与步态 → 网页毛发与性能**。评估页通过不等于这些制作工作已经完成。
