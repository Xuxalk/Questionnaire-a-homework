# 第一阶段测试用例与结果

## 1. 测试说明

自动化用例对应 `tests/` 中的 pytest 测试函数，覆盖真实 MongoDB 集成路径；参数化用例按参数展开计数。每个数据库用例使用随机 `survey_test_*` 数据库，结束后删除本用例数据库。运行完整用例：

```bash
MONGODB_TEST_URI='mongodb://127.0.0.1:27017' pytest -q
```

本次最终验证在全新虚拟环境、Python 3.9.6 和 MongoDB 8.3.11 上执行，结果为 **41 passed in 7.20s**。自动化表中的“实际结果”表示测试断言通过；浏览器用例来自真实 Chrome/Playwright 手工验收，未将 API 测试冒充浏览器测试。

## 2. 自动化测试用例

| 编号 | 测试步骤与输入 | 预期输出 | 实际结果 / 测试依据 |
|---|---|---|---|
| A-01 | 注册 `  Alice  `，密码 `Correct horse 42!`；检查用户文档和响应 | 201；用户名清理为 Alice；响应不含哈希；DB 保存 Argon2id 哈希和规范化值 | 通过；`test_register_creates_user_and_returns_public_fields` |
| A-02 | 连续注册相同用户名 `sora` | 首次 201，第二次 409 | 通过；`test_duplicate_username_returns_conflict` |
| A-03 | 先注册 `  MiXeD  `，再注册 `mixed` | 第二次 409；users 只保留一条 | 通过；`test_username_uniqueness_ignores_case_and_outer_whitespace` |
| A-04 | 分别提交空/全空格用户名、短密码、错误类型及缺少密码 | 请求均为 422 | 通过；`test_invalid_registration_input_returns_unprocessable_entity`（5 个输入） |
| A-05 | 注册并查看 MongoDB 用户文档 | 哈希以 `$argon2id$` 开头，可由 Argon2 验证；明文不存储或回传 | 通过；`test_password_is_stored_as_argon2id_hash_not_plaintext` |
| A-06 | 两个并发客户端使用同一用户名注册 | 一个 201，一个 409；数据库一条用户记录 | 通过；`test_concurrent_same_username_has_one_success_and_one_conflict` |
| A-07 | 登录前请求 `/api/auth/me`；登录后检查 Cookie 和 `/me` | 未登录 401；登录 200；Cookie 有 HttpOnly、SameSite=Lax、7 天 Max-Age | 通过；`test_login_creates_signed_session_and_me_requires_authentication` |
| A-08 | 用不存在/错误密码登录 | 通用错误，不区分用户名是否存在；401 | 通过；`test_invalid_login_has_generic_error` |
| A-09 | 登录后注销，再请求 `/me` | 注销 204，后续请求 401 | 通过；`test_logout_clears_session` |
| A-10 | 登录请求附 `Origin: https://attacker.example`、`Sec-Fetch-Site: cross-site`；再用 cross-site 创建问卷 | 登录/变更请求 403；不创建问卷；同源创建 201 | 通过；`test_cross_origin_authentication_and_mutations_are_rejected` |
| A-11 | 未配置 `SESSION_SECRET_KEY` 时尝试登录 | 503，说明会话认证未配置 | 通过；`test_login_is_disabled_without_a_session_secret` |
| H-01 | 启动 FastAPI，访问 `/health`、首页及静态资源 | `/health` 为 200 和 `{"status":"ok"}`；HTML/CSS/JS 可读取 | 通过；`test_application_starts_and_health_endpoint_returns_ok`、`test_frontend_shell_and_assets_are_served_by_fastapi` |
| Q-01 | 未登录创建问卷；登录后创建草稿、读取列表/详情、修改标题和匿名设置、设置含时区截止时间；切换到另一账号访问 | 未登录 401；本人成功；截止换算为 UTC；非本人读写为 404 | 通过；`test_questionnaire_owner_scope_and_draft_crud` |
| Q-02 | 创建单选、多选、文本、数字和后续题；给单/多/数字题配置跳转；编辑题目后发布 | 题目 ID 稳定；规则保存并按 priority 排序；发布成功 | 通过；`test_four_question_types_rules_publish_and_locked_fields` |
| Q-03 | 发布后尝试编辑题目/填写策略；修改标题、截止；关闭后再次设置截止 | 锁定字段返回 409；允许的描述/截止变更成功；关闭后截止变更 409 | 通过；`test_four_question_types_rules_publish_and_locked_fields` |
| Q-04 | 提交超出选项数的多选题；删除被跳转引用题；提交无效目标 | 多选结构 422；引用题删除 409；无效目标 422；未引用题可删除 | 通过；`test_question_validation_and_referenced_question_cannot_be_deleted` |
| R-01 | 未登录访问分享接口；再登录访问草稿问卷 | 未登录 401；草稿问卷在填写端统一 404 | 通过；`test_share_access_hides_private_surveys_and_requires_login` |
| R-02 | 建立四类题目；跳过必答题、提交外来单选 ID、重复/过多/过少多选值、超短/超长文本、越界/非整数/布尔数字 | 非法操作 422；有效值逐题保存；必答完整后可提交；提交后修改返回 409 | 通过；`test_answer_validation_resume_skip_and_submit` |
| R-03 | 保存第一题后再次开始填写；使用 ANY/ALL 同时命中、数字阈值跳转；修改前序答案 | 恢复同一 draft；较低优先级号命中；路径变化后不可达步骤清除；不可达题写入 409 | 通过；`test_priority_dynamic_jumps_and_history_change_cleans_unreachable_steps` |
| R-04 | 匿名问卷下填写并读取自己的答卷；创建者尝试经填写接口访问该答卷 | 公开问卷/答卷投影不含用户 ID/用户名；创建者读取他人答卷 404 | 通过；`test_anonymous_response_endpoints_do_not_expose_respondent_to_creator` |
| R-05a | 禁止重复问卷提交一份答卷后再次开始 | 再次开始 409；已提交答卷仍有 `lifecycle_guard:"single"` | 通过；`test_repeat_submission_policy_and_no_content_deduplication[False]` |
| R-05b | 允许重复问卷两次提交完全相同的文本 | 两份独立 submitted 文档均保留；成功提交不按内容去重 | 通过；`test_repeat_submission_policy_and_no_content_deduplication[True]` |
| R-06 | 设置过去截止时间；尝试新建、保存和提交；另建问卷手动关闭后尝试填写 | 分享读取显示截止/关闭原因；写入均为 410 | 通过；`test_deadline_and_close_are_reported_on_share_link_and_block_writes` |
| R-07 | 两个登录会话并发开始同一答卷；再用相同 revision 并发写答案 | 开始返回同一 draft；写入一个成功 200、一个冲突 409；revision 变为 1 | 通过；`test_concurrent_start_resumes_one_draft_and_revision_allows_one_writer` |
| R-08 | 两个不同登录账号同时开始、保存并提交同一问卷 | 两次提交均为 200；得到两份不同 response；MongoDB 中有两份 submitted 答卷 | 通过；`test_distinct_respondents_can_submit_same_survey_concurrently` |
| R-09 | 初始化 responses 索引并检查定义 | 存在部分唯一生命周期索引和提交统计查询索引 | 通过；`test_response_indexes_are_present` |
| R-10 | 对数字条件分别测试 eq、ne、gt、gte、lt、lte 以及不命中边界 | 返回对应跳转目标或默认下一题 | 通过；`test_numeric_jump_operators`（7 个输入组合） |
| R-11 | 直接校验 NaN、正 Infinity、负 Infinity 数字答案 | 均抛出 `InvalidAnswer`，API 校验路径拒绝非有限值 | 通过；`test_numeric_answer_rejects_non_finite_values`（3 个输入） |
| S-01 | 提交一份包含四类题答案并跳过末题的答卷；另保存一份 draft；查询全卷和单题统计 | 只计已提交 answered 步骤；全卷提交数 1；单选/多选/文本/数字分别计数；跳过和 draft 不计 | 通过；`test_statistics_aggregate_only_submitted_answered_steps` |

## 3. 真实浏览器验收用例

以下步骤通过实际浏览器 UI 完成，Playwright 用于浏览器操作；pytest API 集成测试不是这些用例的替代证据。

| 编号 | 步骤与输入 | 预期输出 | 实际结果 |
|---|---|---|---|
| B-01 | 浏览器注册并登录创建者账号；退出后注册/登录第二个账号 | 两账号可独立建立会话；未登录功能跳转到登录页 | 通过 |
| B-02 | 创建四题型问卷；设置文本长度、多选数量、数字范围及条件跳转；发布 | 编辑器可保存规则和题目；发布后题目只读 | 通过 |
| B-03 | 第二账号通过分享链接进入；选择触发跳转的单选项，再选择另一个分支 | 按配置显示后续题，不经过题目不要求填写 | 通过；实测答案分支变化 |
| B-04 | 保存草稿后刷新页面 | 恢复相同答卷和当前路径 | 通过 |
| B-05 | 已保存后修改前序答案 | 重新计算路径，旧分支答案从 draft 清理 | 通过 |
| B-06 | 对文本题输入短于限制的值，对多选题提交不足数量的值 | 页面显示错误提示，不能继续提交非法答案 | 通过 |
| B-07 | 跳过选答题并提交有效答卷 | 成功提交并显示完成状态；已提交后不能修改 | 通过 |
| B-08 | 另一浏览器会话访问创建者统计页面 | 全卷提交数、单选/多选/文本/数字统计与答卷一致；界面不显示填写者用户名 | 通过；单题数字平均值为 77，提交总数为 1 |
| B-09 | 对禁止重复的问卷再次打开分享链接 | 页面提示已提交，不能产生第二份成功提交 | 通过 |
| B-10 | 创建者把截止时间设为过去，填写者重开链接 | 明确显示“这份问卷已经截止”，不允许继续写入 | 通过 |
| B-11 | 在 390×844 移动视口查看登录页、工作台、统计页和截止提示 | 无横向溢出；主要操作控件可见且可用 | 通过；实测 `scrollWidth == innerWidth == 390` |
| B-12 | 已登录浏览器从另一个本地端口提交 HTML 表单 POST 到问卷关闭接口 | 返回 403，问卷没有被关闭 | 通过；实际响应 `Cross-origin request blocked` |

移动视口为 Chrome 设备尺寸模拟，不是实体手机；本次浏览器检查没有保存截图文件。当前项目没有将 Playwright 浏览器脚本加入依赖，手工用例可按上表复跑。

## 4. 测试范围限制

- 未进行高并发吞吐、千万级数据、MongoDB 故障切换或负载性能测试；并发用例只验证同一用户名/草稿/revision 冲突语义。
- 未测试实体手机、屏幕阅读器和多浏览器矩阵。
- 自动化测试默认 MongoDB 可连接；未配置 `MONGODB_TEST_URI` 时集成用例会 skip，因此需按 README 明确设置测试 URI 才能复现 41 项完整结果。并发用例验证冲突处理和两个不同答题者同时提交，不代表吞吐量或高负载基准。
