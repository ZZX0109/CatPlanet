# 喵星本地运行与腾讯云部署

本轮交付的是可本地运行的完整房间、数据接口及部署配置。还没有购买服务器、域名或开通真实邮件/COS；不要把本地 Mailpit 收件成功当成真实投递验收。

## 本地运行

需要 Node.js 22、npm、运行中的 Docker Desktop。

```sh
npm ci
cp .env.example .env.local
openssl rand -hex 32
# 将生成值填入 .env.local 的 AUTH_SECRET，不要提交该文件
docker compose up -d
npm run db:migrate
npm run dev
```

网页 http://localhost:3000；开发收件箱 http://localhost:8025。任意测试邮箱都可收验证码，但邮件不会发送到公网邮箱。使用 `localhost`，不要混用 `127.0.0.1`：Cookie 和 APP_ORIGIN 必须一致。PostgreSQL 与 Mailpit 端口仅绑定本机。照片保存于不对公网开放的 `.data/photos`。

```sh
npm run typecheck
npx playwright install chromium
npm test
npm run cleanup
# 先停止 dev，再构建，避免 .next 被两个进程同时修改
npm run build
```

测试使用真实的本地 PostgreSQL 和 Mailpit，创建 `@example.test` 测试账号。不要对正式数据库运行测试。浏览器测试是 Chromium 手机视口与触摸模拟，不能替代真实 iOS/Android 验收。开发服务无需重启就会读取代码变更；环境变量变更需要重启。

## 资源开通清单（费用另行确认）

| 项目 | 用途 | 需要准备 |
| --- | --- | --- |
| 腾讯云大陆轻量服务器 | Docker 应用、数据库、HTTPS 代理 | 选择地区与预算；Docker CE 镜像；留足数据库与构建内存 |
| 自有域名 | 正式网页与 HTTPS | DNS 管理权限；大陆部署所需备案等事项在购买前向服务商核实 |
| 独立发信子域名 | 验证码邮件 | 例如 `mail.example.com`；按 SES 控制台添加验证记录，避免与企业邮箱域名冲突 |
| SES 邮件推送 | API 发验证码 | 已验证域名、发信地址、审核通过的模板与 TemplateID；模板变量为 `code` |
| 私有 COS 桶 | 纪念照片 | 与应用接近的区域、禁止公读、服务端加密；子账号只获所需桶的 Get/Put/Delete 权限 |
| CAM API 凭据 | SES 与 COS | 最小权限子账号，配置在服务器私有环境文件中；不放到浏览器变量 |
| 备份存储 | 故障恢复 | 加密异机备份位置、保存期限与恢复责任人 |

发信域名需要先验证才能使用：[腾讯云域名配置](https://cloud.tencent.com/document/product/1288/55191)。本实现使用 SES API；2026 年 3 月 2 日后新开通的个人认证用户不能通过 SMTP 发信：[官方说明](https://cloud.tencent.com/document/product/1288/65749)。服务器准备参考：[Docker CE 部署说明](https://cloud.tencent.com/document/product/1207/60423)。

## 正式配置与启动

1. 将项目复制到服务器。复制 `deploy/.env.example` 为 `deploy/.env.production`，权限设为 `600`。填写所有变量；数据库 URL 中的密码需与 POSTGRES_PASSWORD 一致，推荐随机十六进制避免 URL 转义错误。
2. APP_DOMAIN 填网页域名；APP_ORIGIN 填精确的 `https://域名`（不带尾斜杠）。MAIL_FROM 使用 SES 已登记的发信地址。设置 `MAIL_DRIVER=tencent`、`STORAGE_DRIVER=cos`。生产模式拒绝模拟邮件和本地照片存储。
3. 域名解析到服务器；仅开放 80/443，以及受限来源的运维 SSH。PostgreSQL、应用端口和 Mailpit 不对公网开放。Caddy 会自动申请和续期 HTTPS。
4. 在项目根目录运行：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env.production -f deploy/compose.yaml ps
docker compose --env-file deploy/.env.production -f deploy/compose.yaml logs --tail=100 app migrate cleanup backup
```

`migrate` 初始化数据库后退出；应用和清理任务等它完成再启动。升级已有部署时先备份，再显式运行迁移：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yaml build
docker compose --env-file deploy/.env.production -f deploy/compose.yaml run --rm migrate
docker compose --env-file deploy/.env.production -f deploy/compose.yaml up -d
```

照片通过 `/api/photos/:id` 由应用核验会话和归属后读取，不返回公共 COS URL。`TRUST_PROXY=1` 只适用于附带的 Caddy 配置：它覆盖 X-Real-IP，且应用端口不能被绕过直接访问。

## 备份与删除语义

- 附带 backup 容器每天生成 PostgreSQL 自定义格式备份，权限仅属主可读写；清理超过 7 天的备份，按日轮转时最多保留约 8 天。上线时应在隐私说明中公开实际保留期限。
- 本地磁盘备份不能抵御整台服务器丢失。邀请用户之前，配置加密异机复制并完成一次恢复演练；不要将备份放公有桶。
- 备份包括邮箱、会话哈希、资料与回忆，属于私人数据。照片在 COS，需单独配置与公开一致的备份策略；不要无限保留对象历史版本。
- 删除照片/宠物会先在事务内删除记录并把文件加入持久化删除队列，随后立即尝试删除文件；失败由每小时清理任务重试。页面无权再访问排队中的文件。
- 上传成功却未被保存使用的照片，24 小时后由清理任务删除。完成清理通常不超过 25 小时。开发环境需运行 `npm run cleanup`。
- 删除回忆后点击保存才提交到数据库。恢复旧备份可能带回已删数据，恢复时须按独立的删除请求记录再次清理；记录只保留内部账号/对象 ID 与时间，不记录回忆正文。

恢复演练应在独立数据库进行，示例（替换真实文件名与测试数据库名）：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yaml exec -T db createdb -U miaoxing miaoxing_restore_test
docker compose --env-file deploy/.env.production -f deploy/compose.yaml exec -T db pg_restore -U miaoxing -d miaoxing_restore_test < deploy/backups/实际备份.dump
```

## 邀请试用前的放行条件

- [ ] 正式域名 HTTPS、数据库与私有 COS 配置完成。
- [ ] QQ、163 等目标邮箱实际收到验证码，错误/过期/重发限制经过真实邮件验证。
- [ ] 真实手机竖屏、横屏和桌面实测两只猫、触摸与键盘操作。
- [ ] 两个真实账号互相访问照片失败，退出后不能访问旧照片地址。
- [ ] 删除照片与整只宠物后，检查 COS 实际对象已删除；模拟 COS 失败后检查队列重试。
- [ ] 备份到异机并完成恢复演练，确认隐私说明中的保存/删除时限。
- [ ] 填写试用联系人与问题反馈方式；邀请少量知情用户。

记录试用问题只收集时间、浏览器/设备、失败操作、状态码和匿名事件编号。不得收集验证码、Cookie、照片内容或完整回忆。应用只输出 `api_failed` / `storage_delete_failed` 等脱敏事件；Caddy 默认未开启请求访问日志。

## 接口与数据约束

| 接口 | 行为 |
| --- | --- |
| POST /api/auth/code | 10 分钟 OTP，60 秒重发间隔，每邮箱 5 次/小时、每来源 30 次/小时 |
| POST /api/auth/verify | 单次验证码最多 5 次尝试，验证入口每邮箱 30 次/小时；成功消费 OTP，签发 30 天 HttpOnly Cookie |
| GET /api/session | 当前用户及其完整宠物快照 |
| POST /api/auth/logout | 撤销当前会话并清 Cookie |
| GET /api/pet | 当前账号唯一宠物及回忆 |
| PUT /api/pet | 原子保存资料与回忆，版本冲突返回 409，不能引用他人照片 |
| DELETE /api/pet | 删除所有关联资料、回忆、照片 |
| POST /api/photos | 原始图片字节，最大 5 MB / 2500 万像素；重编码 WebP，去元数据 |
| GET / DELETE /api/photos/:id | 仅主人读取/删除，响应禁止缓存 |

回忆随完整快照保存，页面提供单条编辑、删除；没有多余的独立回忆写接口，避免部分保存导致草稿不完整。每账号一只宠物由数据库主键保证。服务端从会话确定归属，不接受客户端 userId。所有写操作严格检查 Origin，生产 Cookie 使用 Secure、HttpOnly、SameSite=Lax。

## 本地恢复演练

先在本机验证保存的数据确实能恢复：

```sh
npm run recovery:check
```

此命令只接受现有本地 Compose 数据库地址，创建两个随机命名的独立临时数据库。使用当前表结构与完整外观参数生成测试资料，包含回忆、会话、照片关联、模型版本和生活日记；通过 PostgreSQL 自定义格式备份/恢复后，对比每张业务表的行数和内容摘要，并检查模型引用可解析、照片文件字节及关联一致。结束时清理临时数据库、备份与照片，只保留不含记录正文的 `artifacts/recovery/latest.json`。

测试照片按存储键分别写入源目录、备份目录与恢复目录。它验证本地文件与数据库需要配套恢复，不证明 COS 版本管理或异机加密复制已经配置。命令使用本地 `tsx` 运行，并复用客户端的外观校验器来构建有效数据。

正式环境上线前仍需在独立环境使用实际备份演练，包含访问控制、恢复后会话处理、删除请求重放、COS 对象和异机副本。当前按用户要求暂不执行正式部署。
