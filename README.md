# 基于 MongoDB 的在线问卷系统

课程项目工程。当前实现 FastAPI 健康检查、用户注册/登录/会话认证、问卷草稿管理与发布、登录后的填写与提交、创建者统计 API，以及使用原生 HTML/CSS/JavaScript 的前端。

原始课程说明保留在项目根目录：[`大作业一第一阶段.docx`](./大作业一第一阶段.docx)。提交文档：

- [第一阶段项目报告](./docs/phase1-project-report.md)
- [第一阶段测试用例与结果](./docs/test-cases-phase1.md)
- [API 接口说明](./docs/api.md)
- [真实 AI 使用日志](./docs/ai-usage-log.md)
- [需求基线](./docs/requirements-baseline-v1.1.md)、[系统架构](./docs/architecture.md)与[MongoDB Schema](./docs/mongodb-schema-v1.1.md)

## 环境要求

- Python 3.9 或更高版本
- MongoDB（开发环境示例使用 `mongodb://127.0.0.1:27017`）

MongoDB URI 和数据库名通过 `MONGODB_URI`、`MONGODB_DATABASE` 配置，不在代码中保存凭据。`.env.example` 只是变量示例；应用不自动读取 `.env` 文件。

登录会话使用签名 Cookie。需要配置随机生成且至少 32 个字符的 `SESSION_SECRET_KEY`；HTTPS 部署设置 `SESSION_COOKIE_SECURE=true`。开发时可用 `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'` 生成密钥，再通过环境变量设置。没有会话密钥时，注册及健康检查仍可用，但登录和所有需要认证的问卷/填写/统计接口会返回 503。

API 的 POST/PUT/PATCH/DELETE 请求会校验浏览器 `Origin` 与 Fetch Metadata，拒绝跨站或同站跨源的浏览器变更请求；同时使用 SameSite=Lax Cookie。没有发送这些浏览器头的非浏览器 API 客户端仍可调用。当前没有同步器 CSRF token，因此生产环境还应启用 `SESSION_COOKIE_SECURE=true` 并使用 HTTPS。

## 安装依赖

在项目根目录执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell 激活命令为：

```powershell
.venv\Scripts\Activate.ps1
```

## 配置并启动

```bash
export MONGODB_URI='mongodb://127.0.0.1:27017'
export MONGODB_DATABASE='survey_system'
export SESSION_SECRET_KEY='replace-with-a-random-secret-of-at-least-32-characters'
uvicorn backend.app.main:app --reload
```

Windows PowerShell：

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_DATABASE = 'survey_system'
$env:SESSION_SECRET_KEY = 'replace-with-a-random-secret-of-at-least-32-characters'
uvicorn backend.app.main:app --reload
```

访问 <http://127.0.0.1:8000/health>，正常时返回 `{"status":"ok"}`。该接口只检查应用进程，不代表 MongoDB 已就绪。MongoDB 连接与会话密钥必须分别配置。

## 当前 API

- 账号：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- 问卷（均需登录）：`POST /api/surveys`、`GET /api/surveys`、`GET/PATCH /api/surveys/{survey_id}`、`PUT /api/surveys/{survey_id}/deadline`、`POST /api/surveys/{survey_id}/publish`、`POST /api/surveys/{survey_id}/close`。
- 题目（均需登录且只能编辑本人草稿）：`POST /api/surveys/{survey_id}/questions`、`PATCH/DELETE /api/surveys/{survey_id}/questions/{question_id}`。
- 填写（均需登录；只能访问已发布或已关闭问卷）：`GET /api/fill/{survey_id}`、`POST /api/fill/{survey_id}/responses`、`GET /api/fill/{survey_id}/responses/{response_id}`、`PUT /api/fill/{survey_id}/responses/{response_id}/steps/{question_id}`、`POST /api/fill/{survey_id}/responses/{response_id}/submit`。
- 统计（均需登录且仅问卷创建者可访问）：`GET /api/statistics/surveys/{survey_id}`、`GET /api/statistics/surveys/{survey_id}/questions/{question_id}`。

交互式 API 文档在启动后可通过 <http://127.0.0.1:8000/docs> 查看；完整前端位于 <http://127.0.0.1:8000/>。接口路径、请求体、权限和状态码见[API 接口说明](./docs/api.md)。FastAPI 同源托管 `frontend/` 文件，不需要单独构建步骤。问卷题目顺序由数组创建顺序决定；当前没有重排接口。填写端按题目优先级执行动态跳转，逐题保存并支持恢复；更改历史答案时会重算路径并清理不可达步骤。匿名问卷仍要求登录，创建者不能通过填写接口读取填写者身份或他人答卷。

统计按问卷提交次数展示总量；单选统计各选项人数，多选统计各选项被选择次数，文本题列出已提交文本回答，数字题计算已回答数字的平均值。仅 `submitted` 答卷中的 `answered` 步骤参与统计；跳过步骤和 draft 不计入。

## 运行测试

账号和问卷集成测试需要 MongoDB。测试只读取 `MONGODB_TEST_URI`，每个测试使用随机命名的 `survey_test_*` 数据库，并在结束时仅删除自己创建的测试库；不会读取 `MONGODB_URI` 或 `MONGODB_DATABASE`。

```bash
MONGODB_TEST_URI='mongodb://127.0.0.1:27017' \
pytest
```

未设置 `MONGODB_TEST_URI` 时，MongoDB 集成测试会跳过；健康检查测试仍可运行。完整测试步骤、输入、预期与实测结果见[测试用例文档](./docs/test-cases-phase1.md)。

## 当前目录结构

```text
backend/       FastAPI 应用、配置、MongoDB 连接入口和业务模块包
frontend/      原生 HTML/CSS/JavaScript 单页前端
tests/         pytest 自动化测试
docs/          报告、测试用例、API、需求、架构、Schema 和真实 AI 使用日志
大作业一第一阶段.docx  原始课程作业说明
```

## 第一阶段交付材料

项目报告、测试用例、API 说明、需求/架构/Schema 文档及 AI 使用日志均保存在 `docs/`。AI 使用日志依据可核验的对话任务、代码改动和测试结果整理；模型标识或逐字提示词无法从记录确认时会明确注明，不补写推测内容。

## Git

本项目目录初始时不是 Git 仓库。初始化后可自行查看 `git status`；此次工程初始化不会自动提交或推送。
