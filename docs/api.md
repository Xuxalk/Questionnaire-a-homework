# 第一阶段 API 接口说明

## 1. 通用约定

- 默认地址：`http://127.0.0.1:8000`。所有接口使用 JSON；路径 ID 为字符串形式的 MongoDB `ObjectId`，题目 ID 和选项 ID 是问卷内的字符串。
- 登录成功后由服务端设置 `survey_session` 签名 Cookie。除注册、登录、健康检查外，业务接口均需有效登录会话；统计和问卷管理还要求当前用户是问卷创建者。
- 变更请求（POST、PUT、PATCH、DELETE）会校验浏览器 `Origin` 和 Fetch Metadata。跨站及同站跨源浏览器请求返回 403。
- 成功响应不包含 `password_hash`、`respondent_id` 或内部生命周期标记。匿名问卷填写仍要求登录；匿名主要约束创建者侧数据投影。
- FastAPI 运行时也提供 `/docs`（Swagger UI）和 `/openapi.json`。本文件以当前代码路由及 Pydantic 请求模型为准。

## 2. 账号与会话

| 方法 | 路径 | 登录要求 | 成功结果 | 主要错误 |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | 否 | 201，公开用户对象 | 409 用户名重复；422 输入不合法；503 未配置 MongoDB |
| `POST` | `/api/auth/login` | 否 | 200，公开用户对象并设置 Cookie | 401 凭据错误；503 未配置会话密钥或数据库 |
| `POST` | `/api/auth/logout` | 否 | 204，清除 Cookie | — |
| `GET` | `/api/auth/me` | 是 | 200，当前用户 | 401 未登录 |

注册/登录请求：

```json
{"username":"Alice","password":"Correct horse 42!"}
```

用户名首尾空格会清理，大小写不敏感地检查唯一性；密码长度为 8–128 字符（登录密码最少 1 字符）。注册和登录响应形状：

```json
{"id":"64f000000000000000000001","username":"Alice","created_at":"2026-10-19T03:00:00Z","updated_at":"2026-10-19T03:00:00Z"}
```

密码使用 Argon2id 哈希后保存。登录 Cookie 为 HttpOnly、SameSite=Lax、有效期 7 天；是否设置 Secure 由 `SESSION_COOKIE_SECURE` 决定。

## 3. 问卷管理

除健康检查外，以下管理路由均要求登录，并以当前用户 `owner_id` 限定访问范围。非本人和不存在问卷统一返回 404。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---:|
| `POST` | `/api/surveys` | 创建草稿 | 201 |
| `GET` | `/api/surveys` | 列出自己的问卷，按更新时间倒序 | 200 |
| `GET` | `/api/surveys/{survey_id}` | 查看自己的问卷详情 | 200 |
| `PATCH` | `/api/surveys/{survey_id}` | 编辑标题、说明；草稿时可编辑匿名及重复提交设置 | 200 |
| `PUT` | `/api/surveys/{survey_id}/deadline` | 设置或清除截止时间 | 200 |
| `POST` | `/api/surveys/{survey_id}/publish` | 校验并发布草稿 | 200 |
| `POST` | `/api/surveys/{survey_id}/close` | 关闭已发布问卷 | 200 |
| `POST` | `/api/surveys/{survey_id}/questions` | 在草稿末尾添加题目 | 201 |
| `PATCH` | `/api/surveys/{survey_id}/questions/{question_id}` | 替换一题的定义 | 200 |
| `DELETE` | `/api/surveys/{survey_id}/questions/{question_id}` | 删除草稿中的题目 | 200 |

创建问卷：

```json
{
  "title":"用户体验调查",
  "description":"请按实际体验填写",
  "anonymous":true,
  "allow_multiple_submissions":false
}
```

题目顺序由数组创建顺序决定，目前没有重排接口。所有题型共有 `type`、`prompt`、`required`、`jump_rules` 字段；选项题还需 `options`：

```json
{
  "type":"single_choice",
  "prompt":"你选择哪项？",
  "required":true,
  "options":[{"label":"A"},{"label":"B"}],
  "jump_rules":[
    {"priority":1,"condition":{"operator":"equals","option_id":"option-id"},"target_question_id":"later-question-id"}
  ]
}
```

四类题目的专属请求字段：

| `type` | 请求字段 | 当前校验 |
|---|---|---|
| `single_choice` | `options:[{option_id?,label}]` | 至少 1 个选项；单选跳转条件 `equals + option_id` |
| `multi_choice` | `options`、`validation:{min_selected,max_selected}` | 0 ≤ min ≤ max ≤ 选项数；跳转条件 `{match:"ANY" 或 "ALL",option_ids:[...]}` |
| `text` | `validation:{min_length?,max_length?}` | 非负且 min ≤ max；文本题目前不支持跳转条件 |
| `number` | `validation:{min_value?,max_value?,integer_only}` | 数字边界需有限且 min ≤ max；跳转支持 `eq/ne/gt/gte/lt/lte` |

跳转目标必须存在且位于源题之后；同一题 priority 不重复，按数值升序检查，第一条命中生效；无匹配规则进入下一题。规则随问卷保存，不写死在跳转引擎中。发布后题目、匿名和重复提交策略锁定；标题/说明可改；问卷关闭后截止时间锁定。

截止时间使用带时区的 ISO 8601 日期时间；`null` 清除截止时间。无时区时间返回 422。

## 4. 填写与提交

填写路由均要求登录，包括匿名问卷。只可读取已发布或已关闭问卷；草稿和不存在的问卷均返回 404。分享链接由前端生成 `/?survey={survey_id}`。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---:|
| `GET` | `/api/fill/{survey_id}` | 读取分享问卷、当前截止/关闭状态和题目 | 200 |
| `POST` | `/api/fill/{survey_id}/responses` | 开始或恢复当前账号的唯一 draft | 201 |
| `GET` | `/api/fill/{survey_id}/responses/{response_id}` | 读取当前账号自己的答卷进度 | 200 |
| `PUT` | `/api/fill/{survey_id}/responses/{response_id}/steps/{question_id}` | 保存一题答案或主动跳过 | 200 |
| `POST` | `/api/fill/{survey_id}/responses/{response_id}/submit` | 校验并提交答卷 | 200 |

保存答案示例（当前 question type 决定 `answer` 形状）：

```json
{"revision":0,"answer":{"option_id":"option-id"}}
```

```json
{"revision":1,"answer":{"option_ids":["option-a","option-b"]}}
```

```json
{"revision":2,"answer":{"text":"补充内容"}}
```

```json
{"revision":3,"answer":{"number":27}}
```

主动跳过非必答题：

```json
{"revision":4,"skip":true}
```

`answer` 与 `skip:true` 不可同时使用。每次保存需携带最新 `revision`；成功后 revision 递增。服务端重新计算当前路径并清除不可达步骤和答案。提交请求为 `{"revision":5}`；只有当前路径中所有必答题已回答、非必答题已回答或主动跳过时才能提交。已提交答卷不可再修改。

填写进度响应主要字段：`id`、`survey_id`、`status`、`revision`、`steps`、`path_question_ids`、`next_question_id`、`complete`、时间戳。匿名读取投影不包含答题账号 ID。

主要错误：401 未登录；404 问卷/答卷不存在、不可分享或不属于当前账号；409 重复提交、已提交修改、过期 revision 或不可达题目；410 问卷已关闭/过期；422 答案不合法、跳过必答题或答卷不完整。答卷不完整时 `detail` 为 `{"message":"Response is incomplete","next_question_id":"..."}`。

## 5. 统计

统计 API 仅登录后的问卷创建者可访问；非本人或不存在问卷/题目返回 404。

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/statistics/surveys/{survey_id}` | 问卷提交次数及全部题目统计 |
| `GET` | `/api/statistics/surveys/{survey_id}/questions/{question_id}` | 单题统计 |

返回内容包括 `submitted_count`、题目 ID/题干/类型/`answered_count`；单选选项返回每项人数，多选选项返回选择次数，文本题返回回答列表和提交时间，数字题返回平均值。只统计 `submitted` 答卷中的 `answered` 步骤；draft、skipped 和未经过的题目不计入。统计响应不返回答卷 ID、用户 ID 或用户名。

## 6. 常见错误响应与限制

| HTTP | 含义 |
|---:|---|
| 401 | 缺少或失效的会话；或登录凭据不正确 |
| 403 | 浏览器来源校验拒绝跨源变更请求 |
| 404 | 无权限查看的问卷/答卷按不存在处理 |
| 409 | 唯一性冲突、状态冲突、重复提交或草稿 revision 过期 |
| 410 | 问卷关闭或截止 |
| 422 | JSON 字段/题目/答案/提交路径校验失败 |
| 503 | MongoDB 未配置，或登录会话密钥未配置 |

请求模型默认拒绝未识别字段。MongoDB URI、数据库名、会话密钥及 Cookie Secure 开关通过环境变量配置，详见项目根目录 README 和 `.env.example`。
