# 结构猫头：五轮精修记录

目标：改善用户认为过于粗糙的结构猫头，保持真实捏脸与独立闭眼能力。对象是 `structural-cat-v2`，不是旧程序猫。每轮修改实际资产或实时展示，使用本地网页截图检查，功能测试与美术评审分别记录。

本轮原状态保存在 `artifacts/creator-refinement-5/00-before/`，包括原 GLB、Blender 文件和固定角度截图。原模型存在眼角翻折、厚眼睑、单面三角鼻、耳内噪声和方块下颌，单凭上一次的有限坐标/闭眼采样测试不能证明这些问题合格。

## 1. 眼眶与眼睑

已完成。重新构造较窄的薄眼睑环，保留更多眶骨；重雕平缓的眼周曲面，修正切口环角序与面连接，加入局部眼眶约束。经过一次目视否决后继续调整，消除第一稿的大漏斗与放射状眼袋。

实际检查：中性网格无反向导入法线，最窄头宽张眼的眼睑不再翻转，自然闭眼也通过几何检查。三分之四和闭眼画面比原状态平顺。当时所有滑块同时低值仍有异常阴影，后在第五轮定位并修正组合 NORMAL 语义；没有把相对中性面的朝向变化直接等同于实际翻面。

- [第一轮三分之四](../artifacts/creator-refinement-5/01-eyelids/natural-clay-three.png)
- [第一轮闭眼](../artifacts/creator-refinement-5/01-eyelids/natural-clay-closed.png)
- [几何报告](../artifacts/creator-refinement-5/01-eyelids/geometry-audit.json)

## 2. 口鼻、下颌与耳廓

已完成。鼻镜增加厚度、实际鼻孔与内部鼻腔；重做皮肤人中、浅唇沟和短双弧猫唇，避免人式笑脸。圆顺胡须垫、下巴和颈截面，清理耳内噪声并形成凹面。耳部大小改为耳根缩放、外张改为耳根旋转。

增加耳部和窄头/脸颊组合修正，保留单项可调幅度。本轮 16 个组件、63 个原生目标，中性、自然闭眼和最窄头宽的几何检查通过。所有参数同时低值时的局部异常阴影继续留给第五轮处理，不以有限坐标代替形体合格。

- [第二轮正面](../artifacts/creator-refinement-5/02-anatomy/natural-clay-front.png)
- [第二轮三分之四](../artifacts/creator-refinement-5/02-anatomy/natural-clay-three.png)
- [几何报告](../artifacts/creator-refinement-5/02-anatomy/geometry-audit.json)

## 3. 虹膜、角膜与眼部质感

已完成。增加 1024px 程序径向虹膜纹理、浅凹虹膜环与后置竖瞳腔；透明角膜使用实际透射与折射率，泪阜填补内眼角过渡。高光来自实时光照与环境反射。鼻镜双翼上沿轻凹，并减弱塑料般高光。

实际网页已检查正面、三分之四、细节、灰模和闭眼，结构与材质模式分别归档。当前 20 个组件，保留 63 个原生目标；所有原纹理眼睛已移除，不将旧照片虹膜盖到新眼结构上。

- [第三轮材质正面](../artifacts/creator-refinement-5/03-eyes/natural-material-front.png)
- [第三轮眼部细节](../artifacts/creator-refinement-5/03-eyes/natural-material-detail.png)
- [第三轮三分之四](../artifacts/creator-refinement-5/03-eyes/natural-material-three.png)

## 4. 毛色与短毛表面

已完成。移除原素材中旧眼睛、鼻头和唇线图案后，将许可毛色烘焙到新模型自身 UV；正面色图与侧背三维投射连续混合。排除池与实际清理区域分开，避免抹掉眉纹形成大块眼罩。修复 UV chart 自重叠造成的右额深色色块；新的 601 个三角中心采样未发现重叠，这不证明所有边界或细小区域完全无重叠。

加入 1600 根表面绑定短毛，以及每侧 7 根弯曲、渐细胡须。毛根与形状目标同步，短毛和胡须有实际几何，并非网页相机前的图层。正式资产 23 个组件、11 张嵌入图片，Blender 图像均已打包。网页正面、三分之四、侧面、三头型与闭眼已检查；矩形色块和旧假眼未重现。闭眼眼睑毛色仍偏均匀，稀疏短毛也未达到完整写实毛流质量。

- [第四轮毛色正面](../artifacts/creator-refinement-5/04-coat/natural-material-front.png)
- [第四轮三分之四](../artifacts/creator-refinement-5/04-coat/natural-material-three.png)
- [第四轮闭眼](../artifacts/creator-refinement-5/04-coat/natural-material-closed.png)
- [冻结文件与摘要](../artifacts/creator-refinement-5/04-coat/checkpoint.json)

## 5. 网页光照、构图与最终验证

已完成。改用材质默认预览，缩放以猫头结构为基准而不受长胡须影响；增加实际柔化阴影，调整环境色与 AgX 色调映射。鼻头上沿改为双翼圆弧与中央浅凹，鼻翼增加体积，保留实体鼻孔。

为多项低值叠加修正原生组合 NORMAL，并给头皮增加 20 个只有法线作用的目标（63→83）。重新解码证明 23 个网格的全部原 POSITION 逐值差为 0，新增 POSITION 全零，11 张图和材质保持不变。所有低值时 Skin 的异常阴影诊断从 83 降至 4，与该姿态完整重算法线的 4 相同；并非宣称任意姿态所有法线诊断都为零。

新增 `npm run build:cat`，实际跑通 Blender → 原始 GLB → 法线修正 → 校验 → 发布。网页文件 47.4 MB，原生源为 23 个网格、11 张打包图片，所有形变默认值为 0。构建与原始文件、前版本备份均保留。当前 40 姿态几何诊断全部坐标/法线有限，未发现退化三角；仍有个别极值和鼻孔细小面法线诊断，不把这些采样写成全面无瑕疵保证。

- [最终网页](../artifacts/creator-refinement-5/05-final/desktop.png)
- [最终三分之四](../artifacts/creator-refinement-5/05-final/natural-material-three.png)
- [最终闭眼](../artifacts/creator-refinement-5/05-final/natural-material-closed.png)
- [法线修正及位置/纹理不变校验](../artifacts/creator-refinement-5/05-final/normal-report.json)
- [最终 Blender 源文件复查](../artifacts/structural-refinement/round-05-final/source-audit.json)

最终验证：新版 2 项流程与旧版 2 项回归均通过，类型检查及本地 Docker 生产构建通过。实际下载 GLB 再加载得到 23 个网格、83,008 个三角面；张眼 70 条采样中 68 条看见虹膜，闭眼 70 条全部被眼睑遮挡，双眼球形状保持不变。三种头型、侧面口鼻、鼠标/原生触摸拖动、一次撤销、本机保存、非法导入保留和手机竖横屏操作均已检查。灰模导出仍含毛色、角膜、短毛与胡须。

导出器会将稀疏目标展开，当前完整 GLB 导出约 104 MB。浏览器测试改为本地 HTTP 读取真实下载文件，避免把大文件作为 base64 经测试控制通道复制导致浏览器退出；真实几何、闭眼与纹理检查均保留。实体手机性能、完整毛流、手工动画拓扑和全身动作仍未验收，眼睑毛色仍较均匀，当前结果未达到 C 图或大型游戏的最终美术质量。

## 复查方法

`scripts/capture-creator-refinement.mjs` 从独立浏览器加载当前模型，记录真实灰模、材质、三头型、侧面和闭眼截图，并保存资产 SHA-256。`scripts/audit-creator-geometry.mjs` 读取实际 GLB 数组，检查中性与 40 种姿态的退化面、法线与形变朝向。

```sh
node scripts/capture-creator-refinement.mjs 01-eyelids
node scripts/audit-creator-geometry.mjs public/models/creator/structural-cat.glb artifacts/creator-refinement-5/01-eyelids/geometry-audit.json
```

这些是采样与诊断，不能代替逐图检查，也不能保证未采样的所有参数组合无瑕疵。最终要保留捏脸、闭眼、本机保存、导出、手机操作和现有旧版入口。
