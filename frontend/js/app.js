(() => {
  "use strict";

  const authScreen = document.querySelector("#auth-screen");
  const appScreen = document.querySelector("#app-screen");
  const view = document.querySelector("#app-view");
  const state = {
    user: null,
    surveys: [],
    survey: null,
    response: null,
    editingQuestionId: null,
    authMode: "login",
    currentView: "dashboard",
  };

  class ApiError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const detail = payload && typeof payload === "object" ? payload.detail : payload;
      throw new ApiError(humanizeError(detail, response.status), response.status);
    }
    return payload;
  }

  function humanizeError(detail, statusCode) {
    if (detail && typeof detail === "object" && detail.message === "Response is incomplete") {
      return "还有题目没有完成，请继续填写后再提交。";
    }
    const message = typeof detail === "string" ? detail : "";
    const known = {
      "Username is already registered": "这个用户名已经注册。",
      "Invalid username or password": "用户名或密码不正确。",
      "Survey not found": "没有找到这份问卷，或问卷尚未发布。",
      "Response not found": "找不到这份答卷。",
      "Survey is closed": "这份问卷已关闭。",
      "Survey deadline has passed": "这份问卷已经截止。",
      "Response revision is stale": "答卷已在其他窗口更新，请刷新进度后重试。",
      "A response has already been submitted": "你已经提交过这份问卷。",
      "Response has already been submitted": "这份答卷已经提交，不能再修改。",
      "Submitted responses cannot be changed": "已提交的答卷不能修改。",
    };
    if (known[message]) return known[message];
    if (statusCode === 422) return "提交内容不符合要求，请检查表单和跳转规则。";
    if (statusCode === 401) return "登录状态已失效，请重新登录。";
    return message || "请求未能完成，请稍后重试。";
  }

  function toast(message, isError = false) {
    const node = document.createElement("div");
    node.className = `toast${isError ? " is-error" : ""}`;
    node.textContent = message;
    document.querySelector("#toast-region").append(node);
    window.setTimeout(() => node.remove(), 3600);
  }

  function showAuth(mode = "login", message = "") {
    state.authMode = mode;
    appScreen.hidden = true;
    authScreen.hidden = false;
    const register = mode === "register";
    authScreen.innerHTML = `
      <div class="auth-layout">
        <section class="auth-story">
          <a class="brand" href="/" aria-label="问卷集">
            <span class="brand-mark">问</span><span><strong>问卷集</strong><small>COLLECT INSIGHTS</small></span>
          </a>
          <div class="auth-copy">
            <p class="eyebrow">Ideas become insight</p>
            <h1>把每一个<br>好问题，问清楚。</h1>
            <p>创建问卷、收集回答、看见规律。让每一次提问都更有方向。</p>
          </div>
          <div class="auth-footnote">为好奇心与更好的决策而设计</div>
        </section>
        <section class="auth-form-side">
          <form id="auth-form" class="auth-form">
            <p class="eyebrow">欢迎${register ? "加入" : "回来"}</p>
            <h2>${register ? "创建你的账号" : "登录问卷集"}</h2>
            <p>${register ? "注册后即可创建问卷，也可以参与他人分享的问卷。" : "登录后继续管理问卷，或填写收到的分享问卷。"}</p>
            ${message ? `<div class="notice notice-error">${escapeHtml(message)}</div>` : ""}
            <div class="field">
              <label for="auth-username">用户名</label>
              <input id="auth-username" name="username" type="text" minlength="1" maxlength="64" autocomplete="username" required autofocus>
            </div>
            <div class="field">
              <label for="auth-password">密码</label>
              <input id="auth-password" name="password" type="password" minlength="${register ? "8" : "1"}" maxlength="128" autocomplete="${register ? "new-password" : "current-password"}" required>
              ${register ? '<small class="field-help">至少 8 位字符</small>' : ""}
            </div>
            <button class="button" type="submit">${register ? "创建账号" : "登录"}<span aria-hidden="true">→</span></button>
            <div class="auth-switch">
              ${register ? "已经有账号？" : "还没有账号？"}
              <button type="button" data-action="auth-switch">${register ? "直接登录" : "免费注册"}</button>
            </div>
          </form>
        </section>
      </div>`;
    authScreen.querySelector("input")?.focus();
  }

  function showApp() {
    authScreen.hidden = true;
    appScreen.hidden = false;
    document.querySelector("#user-name").textContent = state.user?.username || "";
  }

  function setActiveNav(name) {
    document.querySelectorAll("[data-nav]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.nav === name);
    });
  }

  function statusLabel(status) {
    return ({ draft: "草稿", published: "进行中", closed: "已关闭" })[status] || status;
  }

  function formatDate(value) {
    if (!value) return "未设置截止时间";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  function renderDashboard(filter = "") {
    state.currentView = "dashboard";
    state.survey = null;
    state.response = null;
    setActiveNav("dashboard");
    const normalized = filter.trim().toLowerCase();
    const surveys = state.surveys.filter((survey) =>
      `${survey.title} ${survey.description || ""}`.toLowerCase().includes(normalized));
    view.innerHTML = `
      <div class="page-heading">
        <div><p class="eyebrow">Your workspace</p><h1>我的问卷</h1><p>整理正在进行的项目，或从一份新的问卷开始。</p></div>
        <div class="heading-actions"><button class="button" type="button" data-action="new-survey">＋ 新建问卷</button></div>
      </div>
      <div class="toolbar">
        <div><strong>${state.surveys.length}</strong><span class="question-summary"> 份问卷</span></div>
        ${state.surveys.length ? '<label class="search-box"><span class="search-mark">⌕</span><input id="survey-search" type="text" placeholder="搜索问卷标题" value="' + escapeHtml(filter) + '"></label>' : ""}
      </div>
      ${surveys.length ? `<div class="survey-grid">${surveys.map(surveyCard).join("")}</div>` : `
        <div class="empty-state"><div><div class="empty-icon">＋</div><h3>${state.surveys.length ? "没有找到匹配的问卷" : "从第一个问题开始"}</h3>
        <p>${state.surveys.length ? "换个关键词试试看。" : "创建一份问卷，配置题目和跳转规则，然后分享给填写者。"}</p>
        ${state.surveys.length ? "" : '<button class="button" type="button" data-action="new-survey">创建第一份问卷</button>'}</div></div>`}`;
    view.querySelector("#survey-search")?.addEventListener("input", (event) => renderDashboard(event.target.value));
  }

  function surveyCard(survey) {
    const questionCount = survey.questions?.length || 0;
    const deadline = survey.deadline ? `截止 ${formatDate(survey.deadline)}` : "未设置截止时间";
    const actions = [];
    if (survey.status === "draft") {
      actions.push(`<button class="button button-secondary button-small" data-action="edit-survey" data-id="${escapeHtml(survey.id)}">继续编辑</button>`);
    }
    if (survey.status === "published" || survey.status === "closed") {
      actions.push(`<button class="button button-secondary button-small" data-action="edit-survey" data-id="${escapeHtml(survey.id)}">问卷设置</button>`);
      actions.push(`<button class="button button-secondary button-small" data-action="copy-share" data-id="${escapeHtml(survey.id)}">分享链接</button>`);
      actions.push(`<button class="button button-quiet button-small" data-action="stats-survey" data-id="${escapeHtml(survey.id)}">看统计</button>`);
    }
    if (survey.status === "published") {
      actions.push(`<button class="button button-danger button-small" data-action="close-survey" data-id="${escapeHtml(survey.id)}">关闭</button>`);
    }
    return `<article class="survey-card">
      <div class="survey-card-top"><span class="status-pill status-${escapeHtml(survey.status)}">${escapeHtml(statusLabel(survey.status))}</span><span class="question-summary">${questionCount} 道题</span></div>
      <h3>${escapeHtml(survey.title)}</h3><p>${escapeHtml(survey.description || "暂无说明")}</p>
      <div class="survey-card-meta"><span>${escapeHtml(deadline)}</span><span>更新于 ${escapeHtml(formatDate(survey.updated_at))}</span></div>
      <div class="survey-card-actions">${actions.join("")}</div>
    </article>`;
  }

  async function loadDashboard() {
    state.surveys = await api("/api/surveys");
    renderDashboard();
  }

  function blankSurvey() {
    return {
      id: "",
      title: "",
      description: "",
      anonymous: null,
      allow_multiple_submissions: null,
      deadline: null,
      status: "draft",
      questions: [],
    };
  }

  async function openEditor(surveyId) {
    state.currentView = "editor";
    state.survey = surveyId ? await api(`/api/surveys/${encodeURIComponent(surveyId)}`) : blankSurvey();
    state.editingQuestionId = null;
    setActiveNav(surveyId ? "dashboard" : "new");
    renderEditor();
  }

  function localDateValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function renderEditor() {
    const survey = state.survey;
    const isNew = !survey.id;
    const isDraft = survey.status === "draft";
    const isClosed = survey.status === "closed";
    const shareUrl = survey.id ? `${location.origin}/?survey=${encodeURIComponent(survey.id)}` : "";
    view.innerHTML = `
      <div class="page-heading">
        <div><p class="eyebrow">${isNew ? "Create a survey" : `Survey · ${escapeHtml(statusLabel(survey.status))}`}</p>
          <h1>${isNew ? "创建问卷" : "问卷设置"}</h1><p>${isNew ? "先确定问卷的基本信息与填写规则，再逐步添加问题。" : "完善问卷信息、管理题目，并在准备好后发布。"}</p></div>
        <div class="heading-actions"><button class="button button-quiet" type="button" data-action="dashboard">← 返回列表</button>
          ${isDraft && !isNew ? '<button class="button" type="button" data-action="publish-survey">发布问卷</button>' : ""}
          ${survey.status === "published" ? `<button class="button button-danger" type="button" data-action="close-survey" data-id="${escapeHtml(survey.id)}">关闭问卷</button>` : ""}</div>
      </div>
      ${isClosed ? '<div class="notice notice-warning">这份问卷已关闭。题目与填写策略已锁定。</div>' : ""}
      <section class="panel">
        <div class="panel-heading"><div><h2>基本信息</h2><p>分享给填写者前，确认问卷标题和填写政策。</p></div></div>
        <form id="survey-form" data-survey-form>
          <div class="form-grid">
            <div class="field field-full"><label for="survey-title">问卷标题</label><input id="survey-title" name="title" type="text" maxlength="200" required value="${escapeHtml(survey.title)}"></div>
            <div class="field field-full"><label for="survey-description">说明</label><textarea id="survey-description" name="description" maxlength="2000" placeholder="告诉填写者这份问卷的目的">${escapeHtml(survey.description || "")}</textarea></div>
            <div class="field"><label for="survey-anonymous">身份展示</label><select id="survey-anonymous" name="anonymous" ${!isDraft ? "disabled" : ""} required>
              <option value="" ${survey.anonymous === null ? "selected" : ""} disabled>请选择</option>
              <option value="true" ${survey.anonymous === true ? "selected" : ""}>匿名：创建者看不到填写者身份</option>
              <option value="false" ${survey.anonymous === false ? "selected" : ""}>非匿名</option>
            </select><small class="field-help">所有填写者都需要登录；匿名设置控制创建者能否看到账号身份。</small></div>
            <div class="field"><label for="survey-repeat">是否允许重复提交</label><select id="survey-repeat" name="allow_multiple_submissions" ${!isDraft ? "disabled" : ""} required>
              <option value="" ${survey.allow_multiple_submissions === null ? "selected" : ""} disabled>请选择</option>
              <option value="false" ${survey.allow_multiple_submissions === false ? "selected" : ""}>不允许，同一账号只能提交一次</option>
              <option value="true" ${survey.allow_multiple_submissions === true ? "selected" : ""}>允许多次提交</option>
            </select></div>
            <div class="field"><label for="survey-deadline">截止时间</label><input id="survey-deadline" name="deadline" type="datetime-local" value="${escapeHtml(localDateValue(survey.deadline))}" ${isClosed ? "disabled" : ""}><small class="field-help">留空表示不设置截止时间；发布后也可调整。</small></div>
          </div>
          <div class="form-actions"><button class="button" type="submit">${isNew ? "创建问卷" : "保存设置"}</button></div>
        </form>
      </section>
      ${survey.id ? `<section class="panel">
        <div class="panel-heading"><div><h2>分享链接</h2><p>填写者登录后即可访问；未发布的草稿不会通过此链接公开。</p></div></div>
        <div class="share-box"><input id="share-link" type="text" readonly value="${escapeHtml(shareUrl)}"><button class="button button-secondary button-small" type="button" data-action="copy-current-share" ${survey.status === "draft" ? "disabled" : ""}>复制链接</button></div>
      </section>` : ""}
      ${survey.id ? `<section class="panel">
        <div class="panel-heading"><div><h2>题目</h2><p>题目按列表顺序展示。跳转目标只能选择当前题之后的题目。</p></div>
          ${isDraft ? '<button class="button button-secondary button-small" type="button" data-action="add-question">＋ 添加题目</button>' : ""}</div>
        ${survey.questions.length || state.editingQuestionId === "new" ? `<div class="question-list">${survey.questions.map((question, index) => renderQuestionCard(question, index, survey.questions, !isDraft)).join("")}${state.editingQuestionId === "new" ? newQuestionCard(survey.questions.length, survey.questions) : ""}</div>` : '<div class="empty-state"><div><div class="empty-icon">?</div><h3>还没有题目</h3><p>至少添加一道题后才能发布问卷。</p></div></div>'}
      </section>` : ""}
      ${survey.status === "published" || survey.status === "closed" ? '<div class="heading-actions"><button class="button button-secondary" type="button" data-action="stats-survey" data-id="' + escapeHtml(survey.id) + '">查看统计结果</button></div>' : ""}`;
  }

  const questionTypeNames = {
    single_choice: "单选题",
    multi_choice: "多选题",
    text: "文本题",
    number: "数字题",
  };

  function renderQuestionCard(question, index, questions, readOnly) {
    const editing = state.editingQuestionId === question.question_id;
    const meta = [questionTypeNames[question.type] || question.type, question.required ? "必答" : "选答"];
    if (question.jump_rules?.length) meta.push(`${question.jump_rules.length} 条跳转规则`);
    const summary = question.options?.length
      ? `选项：${question.options.map((option) => escapeHtml(option.label)).join("、")}`
      : question.type === "multi_choice"
        ? `选择 ${question.validation.min_selected}–${question.validation.max_selected} 项`
        : question.type === "text"
          ? "文本答案"
          : question.type === "number"
            ? "数字答案"
            : "";
    return `<article class="question-card" data-question-card="${escapeHtml(question.question_id)}">
      <div class="question-card-head"><div class="question-title-line"><span class="question-number">${index + 1}</span><h3>${escapeHtml(question.prompt)}</h3></div>
        <div class="question-actions">${readOnly ? "" : `<button class="button button-quiet button-small" type="button" data-action="edit-question" data-id="${escapeHtml(question.question_id)}">${editing ? "收起" : "编辑"}</button><button class="button button-danger button-small" type="button" data-action="delete-question" data-id="${escapeHtml(question.question_id)}">删除</button>`}
        <button class="button button-quiet button-small" type="button" data-action="stats-question" data-survey-id="${escapeHtml(state.survey.id)}" data-id="${escapeHtml(question.question_id)}">统计</button></div></div>
      <div class="question-meta"><span>${escapeHtml(meta.join(" · "))}</span><span class="question-summary">${summary}</span></div>
      ${editing ? questionForm(question, index, questions) : ""}
    </article>`;
  }

  function newQuestionCard(index, questions) {
    const question = { type: "text", prompt: "", required: true, validation: {}, jump_rules: [] };
    return `<article class="question-card" data-question-card="new"><div class="question-card-head"><div class="question-title-line"><span class="question-number">${index + 1}</span><h3>新题目</h3></div></div>${questionForm(question, index, questions)}</article>`;
  }

  function questionForm(question, index, questions) {
    const type = question.type || "text";
    const options = question.options || [];
    const rules = question.jump_rules || [];
    const validation = question.validation || {};
    const qid = question.question_id || "new";
    const choiceType = type === "single_choice" || type === "multi_choice";
    let validationFields = "";
    if (type === "multi_choice") {
      validationFields = `<div class="form-grid"><div class="field"><label>最少选择数</label><input type="number" name="min_selected" min="0" value="${escapeHtml(validation.min_selected ?? 0)}" required></div><div class="field"><label>最多选择数</label><input type="number" name="max_selected" min="1" value="${escapeHtml(validation.max_selected ?? Math.max(1, options.length || 1))}" required></div></div>`;
    } else if (type === "text") {
      validationFields = `<div class="form-grid"><div class="field"><label>最少字符数</label><input type="number" name="min_length" min="0" value="${escapeHtml(validation.min_length ?? "")}" placeholder="不限制"></div><div class="field"><label>最多字符数</label><input type="number" name="max_length" min="0" value="${escapeHtml(validation.max_length ?? "")}" placeholder="不限制"></div></div>`;
    } else if (type === "number") {
      validationFields = `<div class="form-grid"><div class="field"><label>最小值</label><input type="number" name="min_value" step="any" value="${escapeHtml(validation.min_value ?? "")}" placeholder="不限制"></div><div class="field"><label>最大值</label><input type="number" name="max_value" step="any" value="${escapeHtml(validation.max_value ?? "")}" placeholder="不限制"></div><label class="check-control field-full"><input type="checkbox" name="integer_only" ${validation.integer_only ? "checked" : ""}> 只接受整数</label></div>`;
    }
    const laterQuestions = questions.slice(index + 1);
    return `<form class="question-form" data-question-form="${escapeHtml(qid)}" data-rendered-type="${escapeHtml(type)}">
      <div class="form-grid">
        <div class="field"><label>题型</label><select name="type" class="question-type">${Object.entries(questionTypeNames).map(([value, label]) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <label class="check-control" style="align-self:end;padding-bottom:11px"><input type="checkbox" name="required" ${question.required ? "checked" : ""}> 必答题</label>
        <div class="field field-full"><label>题目内容</label><textarea name="prompt" maxlength="1000" required>${escapeHtml(question.prompt || "")}</textarea></div>
        ${choiceType ? `<div class="field field-full"><div class="subform-header"><strong>选项</strong><button class="button button-link" type="button" data-action="add-option">＋ 添加选项</button></div><div class="option-list">${options.map(optionRow).join("")}</div></div>` : ""}
        ${validationFields ? `<div class="field field-full"><div class="subform-header"><strong>答案校验</strong></div>${validationFields}</div>` : ""}
        ${qid !== "new" && type !== "text" ? `<div class="field field-full"><div class="subform-header"><strong>动态跳转规则</strong><button class="button button-link" type="button" data-action="add-rule" ${laterQuestions.length ? "" : "disabled"}>＋ 添加规则</button></div>
          ${laterQuestions.length ? `<div class="rule-list">${rules.map((rule) => ruleRow(rule, question, index, questions)).join("")}</div><small class="field-help">按优先级数字从小到大匹配，第一条命中规则生效；没有命中时进入下一题。</small>` : '<div class="notice">当前题目后面还没有题目，因此暂时不能设置跳转目标。</div>'}</div>` : qid === "new" && type !== "text" ? '<div class="field field-full notice">保存题目后才能为它配置跳转规则；目标只能是后面的题目。</div>' : ""}
      </div>
      <div class="form-actions"><button class="button button-secondary button-small" type="button" data-action="cancel-question">取消</button><button class="button button-small" type="submit">保存题目</button></div>
    </form>`;
  }

  function optionRow(option = {}) {
    return `<div class="option-row"><input type="hidden" name="option_id" value="${escapeHtml(option.option_id || "")}"><input type="text" name="option_label" maxlength="300" value="${escapeHtml(option.label || "")}" placeholder="输入选项内容" required><button class="remove-option" type="button" data-action="remove-option" aria-label="删除选项">×</button></div>`;
  }

  function ruleRow(rule, question, index, questions) {
    const condition = rule.condition || {};
    const targets = questions.slice(index + 1);
    let conditionHtml = "";
    if (question.type === "single_choice") {
      conditionHtml = `<div class="field"><label>答案等于</label><select name="condition_option">${(question.options || []).map((option) => `<option value="${escapeHtml(option.option_id)}" ${condition.option_id === option.option_id ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></div>`;
    } else if (question.type === "multi_choice") {
      const selected = new Set(condition.option_ids || []);
      conditionHtml = `<div class="field"><label>匹配方式</label><select name="condition_match"><option value="ANY" ${condition.match === "ANY" ? "selected" : ""}>任一选中（ANY）</option><option value="ALL" ${condition.match === "ALL" ? "selected" : ""}>全部选中（ALL）</option></select></div><div class="field"><label>条件选项（可多选）</label><select class="multiselect" name="condition_options" multiple>${(question.options || []).map((option) => `<option value="${escapeHtml(option.option_id)}" ${selected.has(option.option_id) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></div>`;
    } else {
      const operators = [["eq", "等于"], ["ne", "不等于"], ["gt", "大于"], ["gte", "大于等于"], ["lt", "小于"], ["lte", "小于等于"]];
      conditionHtml = `<div class="field"><label>数字条件</label><select name="condition_operator">${operators.map(([value, label]) => `<option value="${value}" ${condition.operator === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label>比较值</label><input type="number" name="condition_value" step="any" value="${escapeHtml(condition.value ?? "0")}" required></div>`;
    }
    return `<div class="rule-row" data-rule-row><div class="rule-row-grid">
      <div class="field"><label>优先级</label><input type="number" name="priority" min="1" value="${escapeHtml(rule.priority ?? 1)}" required></div>
      ${conditionHtml}
      <div class="field rule-target"><label>跳转到</label><select name="target_question_id" required><option value="">请选择后续题目</option>${targets.map((target) => `<option value="${escapeHtml(target.question_id)}" ${rule.target_question_id === target.question_id ? "selected" : ""}>${escapeHtml(target.prompt)}</option>`).join("")}</select></div>
      <button class="rule-remove" type="button" data-action="remove-rule" aria-label="删除规则">×</button>
    </div></div>`;
  }

  function collectQuestionDraft(form, questions, typeOverride = null) {
    const type = typeOverride || form.elements.type.value;
    const payload = {
      type,
      prompt: form.elements.prompt.value.trim(),
      required: form.elements.required.checked,
      jump_rules: [],
    };
    if (type === "single_choice" || type === "multi_choice") {
      payload.options = [...form.querySelectorAll(".option-row")].map((row) => {
        const option = { label: row.querySelector('[name="option_label"]').value.trim() };
        const id = row.querySelector('[name="option_id"]').value;
        if (id) option.option_id = id;
        return option;
      });
    }
    if (type === "multi_choice") {
      payload.validation = {
        min_selected: Number(form.elements.min_selected.value),
        max_selected: Number(form.elements.max_selected.value),
      };
    } else if (type === "text") {
      payload.validation = {};
      if (form.elements.min_length.value !== "") payload.validation.min_length = Number(form.elements.min_length.value);
      if (form.elements.max_length.value !== "") payload.validation.max_length = Number(form.elements.max_length.value);
    } else if (type === "number") {
      payload.validation = { integer_only: form.elements.integer_only.checked };
      if (form.elements.min_value.value !== "") payload.validation.min_value = Number(form.elements.min_value.value);
      if (form.elements.max_value.value !== "") payload.validation.max_value = Number(form.elements.max_value.value);
    }
    if (type !== "text" && form.dataset.questionForm !== "new") {
      [...form.querySelectorAll("[data-rule-row]")].forEach((row) => {
        const rule = {
          priority: Number(row.querySelector('[name="priority"]').value),
          target_question_id: row.querySelector('[name="target_question_id"]').value,
          condition: {},
        };
        if (type === "single_choice") {
          rule.condition = { operator: "equals", option_id: row.querySelector('[name="condition_option"]').value };
        } else if (type === "multi_choice") {
          rule.condition = {
            match: row.querySelector('[name="condition_match"]').value,
            option_ids: [...row.querySelector('[name="condition_options"]').selectedOptions].map((option) => option.value),
          };
        } else {
          rule.condition = {
            operator: row.querySelector('[name="condition_operator"]').value,
            value: Number(row.querySelector('[name="condition_value"]').value),
          };
        }
        payload.jump_rules.push(rule);
      });
    }
    return payload;
  }

  function nextRule(question, questions) {
    const index = questions.findIndex((item) => item.question_id === question.question_id);
    const target = questions[index + 1];
    if (!target) return null;
    const priority = Math.max(0, ...(question.jump_rules || []).map((rule) => rule.priority)) + 1;
    let condition;
    if (question.type === "single_choice") {
      condition = { operator: "equals", option_id: question.options?.[0]?.option_id || "" };
    } else if (question.type === "multi_choice") {
      condition = { match: "ANY", option_ids: question.options?.[0] ? [question.options[0].option_id] : [] };
    } else {
      condition = { operator: "gte", value: 0 };
    }
    return { priority, condition, target_question_id: target.question_id };
  }

  async function submitSurveyForm(form) {
    const data = new FormData(form);
    const isNew = !state.survey.id;
    const payload = {
      title: String(data.get("title") || "").trim(),
      description: String(data.get("description") || "").trim(),
    };
    if (state.survey.status === "draft") {
      if (!data.get("anonymous") || !data.get("allow_multiple_submissions")) {
        toast("请选择匿名方式和重复提交规则。", true);
        return;
      }
      payload.anonymous = data.get("anonymous") === "true";
      payload.allow_multiple_submissions = data.get("allow_multiple_submissions") === "true";
    }
    let survey;
    if (isNew) {
      survey = await api("/api/surveys", { method: "POST", body: JSON.stringify(payload) });
    } else {
      survey = await api(`/api/surveys/${encodeURIComponent(state.survey.id)}`, {
        method: "PATCH", body: JSON.stringify(payload),
      });
    }
    const deadlineInput = form.elements.deadline;
    if (deadlineInput && !deadlineInput.disabled) {
      const deadline = deadlineInput.value ? new Date(deadlineInput.value).toISOString() : null;
      survey = await api(`/api/surveys/${encodeURIComponent(survey.id)}/deadline`, {
        method: "PUT", body: JSON.stringify({ deadline }),
      });
    }
    state.survey = await api(`/api/surveys/${encodeURIComponent(survey.id)}`);
    state.editingQuestionId = null;
    if (isNew) toast("问卷已创建。接下来添加题目。 ");
    else toast("问卷设置已保存。");
    renderEditor();
  }

  async function submitQuestionForm(form) {
    const questionId = form.dataset.questionForm;
    const payload = collectQuestionDraft(form, state.survey.questions);
    const path = `/api/surveys/${encodeURIComponent(state.survey.id)}/questions`;
    if (questionId === "new") {
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      toast("题目已添加。可以继续编辑配置校验和跳转规则。");
    } else {
      await api(`${path}/${encodeURIComponent(questionId)}`, {
        method: "PATCH", body: JSON.stringify(payload),
      });
      toast("题目已保存。");
    }
    state.survey = await api(`/api/surveys/${encodeURIComponent(state.survey.id)}`);
    state.editingQuestionId = null;
    renderEditor();
  }

  function rerenderQuestionType(form, type) {
    const questionId = form.dataset.questionForm;
    const previousType = form.dataset.renderedType || form.elements.type.value;
    const old = collectQuestionDraft(form, state.survey.questions, previousType);
    const question = {
      question_id: questionId === "new" ? undefined : questionId,
      type,
      prompt: old.prompt,
      required: old.required,
      options: old.options || [],
      validation: old.validation || {},
      jump_rules: [],
    };
    if ((type === "single_choice" || type === "multi_choice") && !question.options.length) {
      question.options = [
        { option_id: crypto.randomUUID(), label: "选项一" },
        { option_id: crypto.randomUUID(), label: "选项二" },
      ];
    }
    if (type === "multi_choice" && !question.validation.min_selected && !question.validation.max_selected) {
      question.validation = { min_selected: 0, max_selected: question.options.length || 1 };
    }
    if (type === "text" && !question.validation) question.validation = {};
    const index = questionId === "new"
      ? state.survey.questions.length
      : state.survey.questions.findIndex((item) => item.question_id === questionId);
    const holder = form.closest("[data-question-card]");
    const summaryCard = state.survey.questions[index];
    if (summaryCard) {
      holder.innerHTML = renderQuestionCard({ ...summaryCard, ...question }, index, state.survey.questions, false).replace(/^<article[^>]*>|<\/article>$/g, "");
    } else {
      holder.innerHTML = questionForm(question, index, state.survey.questions);
    }
    const replacement = holder.querySelector(".question-form");
    replacement?.querySelector('[name="prompt"]')?.focus();
  }

  async function publishSurvey() {
    if (!state.survey?.id) return;
    if (!window.confirm("发布后题目和填写规则将锁定。确定发布吗？")) return;
    await api(`/api/surveys/${encodeURIComponent(state.survey.id)}/publish`, { method: "POST" });
    state.survey = await api(`/api/surveys/${encodeURIComponent(state.survey.id)}`);
    toast("问卷已发布，可以复制分享链接。");
    renderEditor();
  }

  async function closeSurvey(surveyId) {
    if (!window.confirm("关闭后填写者将不能继续作答。确定关闭吗？")) return;
    await api(`/api/surveys/${encodeURIComponent(surveyId)}/close`, { method: "POST" });
    toast("问卷已关闭。");
    if (state.currentView === "editor" && state.survey?.id === surveyId) {
      state.survey = await api(`/api/surveys/${encodeURIComponent(surveyId)}`);
      renderEditor();
    } else {
      await loadDashboard();
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast("分享链接已复制。");
  }

  function shareUrl(surveyId) {
    return `${location.origin}/?survey=${encodeURIComponent(surveyId)}`;
  }

  function questionAnswerLabel(question, step) {
    if (step.status === "skipped") return "主动跳过";
    const value = step.value || {};
    if (question.type === "single_choice") {
      return question.options?.find((option) => option.option_id === value.option_id)?.label || "已选择";
    }
    if (question.type === "multi_choice") {
      return (value.option_ids || []).map((id) => question.options?.find((option) => option.option_id === id)?.label || "").filter(Boolean).join("、") || "已选择";
    }
    if (question.type === "text") return value.text || "（空白）";
    if (question.type === "number") return String(value.number);
    return "已回答";
  }

  async function openFill(surveyId) {
    state.currentView = "fill";
    state.survey = await api(`/api/fill/${encodeURIComponent(surveyId)}`);
    state.editingQuestionId = null;
    if (!state.survey.accepting_responses) {
      state.response = null;
      renderFillUnavailable();
      return;
    }
    try {
      state.response = await api(`/api/fill/${encodeURIComponent(surveyId)}/responses`, { method: "POST" });
    } catch (error) {
      if (error.statusCode === 409 && error.message === "你已经提交过这份问卷。") {
        view.innerHTML = `<div class="fill-wrap"><div class="page-heading"><div><p class="eyebrow">Shared survey</p><h1>${escapeHtml(state.survey.title)}</h1></div><button class="button button-quiet" data-action="dashboard">返回工作台</button></div><div class="completion"><div class="completion-icon">✓</div><h2>你已经提交过</h2><p>这份问卷不允许同一账号重复提交。感谢参与。</p></div></div>`;
        return;
      }
      throw error;
    }
    setActiveNav("");
    renderFill();
  }

  function renderFillUnavailable() {
    const reason = state.survey.closed_reason === "deadline" ? "这份问卷已经截止" : "这份问卷已关闭";
    view.innerHTML = `<div class="fill-wrap"><div class="page-heading"><div><p class="eyebrow">Shared survey</p><h1>${escapeHtml(state.survey.title)}</h1></div><button class="button button-quiet" data-action="dashboard">返回工作台</button></div><div class="completion"><div class="completion-icon">⌛</div><h2>${reason}</h2><p>当前问卷不再接收新的回答。</p></div></div>`;
  }

  function renderFill() {
    const survey = state.survey;
    const response = state.response;
    const questionId = state.editingQuestionId || response?.next_question_id;
    const question = survey.questions.find((item) => item.question_id === questionId);
    const steps = response?.steps || [];
    const completed = response?.status === "submitted";
    const progress = completed ? 100 : Math.min(96, Math.round((steps.length / Math.max(survey.questions.length, 1)) * 100));
    const step = steps.find((item) => item.question_id === questionId);
    const questionFormHtml = question && !completed ? fillQuestionForm(question, step) : "";
    view.innerHTML = `<div class="fill-wrap">
      <div class="page-heading"><div><p class="eyebrow">Shared survey · ${survey.anonymous ? "匿名填写" : "填写"}</p><h1>${escapeHtml(survey.title)}</h1><p>${escapeHtml(survey.description || "")}</p></div>
        <button class="button button-quiet" type="button" data-action="dashboard">返回工作台</button></div>
      ${survey.deadline ? `<div class="notice">截止时间：${escapeHtml(formatDateTime(survey.deadline))}</div>` : ""}
      <div class="fill-progress-head"><span>${completed ? "填写已完成" : "你的进度"}</span><span>${completed ? "已提交" : `${steps.length} 道已保存`}</span></div>
      <div class="progress-track"><div class="progress-value" style="width:${progress}%"></div></div>
      ${completed ? `<div class="completion"><div class="completion-icon">✓</div><h2>提交成功</h2><p>感谢你的认真填写，回答已经安全保存。</p><button class="button button-secondary" type="button" data-action="dashboard">返回问卷列表</button></div>` : questionFormHtml || `
        <div class="completion"><div class="completion-icon">✓</div><h2>所有题目都已完成</h2><p>提交后将不能再修改这份答卷，请确认后完成提交。</p>
          <button class="button" type="button" data-action="submit-response">确认并提交</button></div>`}
      ${steps.length ? `<section class="history-panel"><div class="history-title"><span>已保存的回答</span><span>${steps.length} 项</span></div>${steps.map((item, index) => {
        const historicalQuestion = survey.questions.find((entry) => entry.question_id === item.question_id);
        if (!historicalQuestion) return "";
        return `<div class="history-row"><span class="history-index">${index + 1}</span><div class="history-text"><strong>${escapeHtml(historicalQuestion.prompt)}</strong><small>${escapeHtml(questionAnswerLabel(historicalQuestion, item))}</small></div>${completed ? "" : `<button class="button button-link" type="button" data-action="edit-answer" data-id="${escapeHtml(item.question_id)}">修改</button>`}</div>`;
      }).join("")}</section>` : ""}
    </div>`;
  }

  function fillQuestionForm(question, step) {
    const value = step?.value || {};
    let answerControl = "";
    if (question.type === "single_choice") {
      answerControl = `<div class="fill-options">${question.options.map((option) => `<label class="fill-choice"><input type="radio" name="single_answer" value="${escapeHtml(option.option_id)}" ${value.option_id === option.option_id ? "checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("")}</div>`;
    } else if (question.type === "multi_choice") {
      const chosen = new Set(value.option_ids || []);
      const validation = question.validation || {};
      answerControl = `<div class="fill-options">${question.options.map((option) => `<label class="fill-choice"><input type="checkbox" name="multi_answer" value="${escapeHtml(option.option_id)}" ${chosen.has(option.option_id) ? "checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("")}</div><small class="field-help">请选择 ${validation.min_selected}–${validation.max_selected} 项。</small>`;
    } else if (question.type === "text") {
      const validation = question.validation || {};
      answerControl = `<textarea name="text_answer" maxlength="${escapeHtml(validation.max_length ?? "")}" placeholder="在这里输入回答">${escapeHtml(value.text || "")}</textarea>`;
      if (validation.min_length != null || validation.max_length != null) answerControl += `<small class="field-help">字符数：${validation.min_length ?? 0}–${validation.max_length ?? "不限"}</small>`;
    } else {
      const validation = question.validation || {};
      answerControl = `<input name="number_answer" type="number" step="${validation.integer_only ? "1" : "any"}" min="${escapeHtml(validation.min_value ?? "")}" max="${escapeHtml(validation.max_value ?? "")}" value="${escapeHtml(value.number ?? "")}" placeholder="输入数字">`;
      if (validation.min_value != null || validation.max_value != null) answerControl += `<small class="field-help">范围：${validation.min_value ?? "不限"} 至 ${validation.max_value ?? "不限"}${validation.integer_only ? "，只接受整数" : ""}</small>`;
    }
    return `<form class="fill-question" data-fill-answer data-question-id="${escapeHtml(question.question_id)}">
      <p class="eyebrow">第 ${state.response.path_question_ids.indexOf(question.question_id) + 1} 题</p>
      <h2>${escapeHtml(question.prompt)}${question.required ? '<span class="required-mark">必答</span>' : ""}</h2>
      ${answerControl}
      <div class="fill-controls"><div>${!question.required ? '<button class="button button-quiet" type="button" data-action="skip-question">跳过此题</button>' : ""}</div>
        <div class="heading-actions">${state.editingQuestionId ? '<button class="button button-quiet" type="button" data-action="cancel-answer-edit">取消修改</button>' : ""}<button class="button" type="submit">保存并继续 →</button></div></div>
    </form>`;
  }

  async function saveCurrentAnswer(form) {
    const questionId = form.dataset.questionId;
    const question = state.survey.questions.find((item) => item.question_id === questionId);
    let answer;
    if (question.type === "single_choice") {
      const selected = form.querySelector('input[name="single_answer"]:checked');
      answer = selected ? { option_id: selected.value } : {};
    } else if (question.type === "multi_choice") {
      answer = { option_ids: [...form.querySelectorAll('input[name="multi_answer"]:checked')].map((input) => input.value) };
    } else if (question.type === "text") {
      answer = { text: form.elements.text_answer.value };
    } else {
      answer = { number: form.elements.number_answer.value === "" ? null : Number(form.elements.number_answer.value) };
    }
    const saved = await api(`/api/fill/${encodeURIComponent(state.survey.id)}/responses/${encodeURIComponent(state.response.id)}/steps/${encodeURIComponent(questionId)}`, {
      method: "PUT",
      body: JSON.stringify({ revision: state.response.revision, answer }),
    });
    state.response = saved;
    state.editingQuestionId = null;
    toast("回答已保存。");
    renderFill();
  }

  async function skipCurrentQuestion() {
    const questionId = state.editingQuestionId || state.response.next_question_id;
    const saved = await api(`/api/fill/${encodeURIComponent(state.survey.id)}/responses/${encodeURIComponent(state.response.id)}/steps/${encodeURIComponent(questionId)}`, {
      method: "PUT",
      body: JSON.stringify({ revision: state.response.revision, skip: true }),
    });
    state.response = saved;
    state.editingQuestionId = null;
    toast("已跳过此题，进度已保存。");
    renderFill();
  }

  async function submitResponse() {
    const submitted = await api(`/api/fill/${encodeURIComponent(state.survey.id)}/responses/${encodeURIComponent(state.response.id)}/submit`, {
      method: "POST", body: JSON.stringify({ revision: state.response.revision }),
    });
    state.response = submitted;
    toast("答卷已提交。 ");
    renderFill();
  }

  function renderStatistics(data, questionOnly = false) {
    state.currentView = "statistics";
    setActiveNav("dashboard");
    const questions = questionOnly ? [data.question] : data.questions;
    const submittedCount = data.submitted_count || 0;
    view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Survey insights</p><h1>${escapeHtml(data.title)}</h1><p>${questionOnly ? "单题统计结果" : "提交次数与每一道题的回答分布。"}</p></div>
      <div class="heading-actions"><button class="button button-quiet" type="button" data-action="dashboard">← 返回列表</button>${questionOnly ? `<button class="button button-secondary" type="button" data-action="stats-survey" data-id="${escapeHtml(data.survey_id)}">整份问卷</button>` : ""}</div></div>
      <div class="stats-overview"><div class="stat-card"><span>整份问卷提交次数</span><strong>${submittedCount}</strong></div><div class="stat-card"><span>统计题目</span><strong>${questions.length}</strong></div><div class="stat-card"><span>数据范围</span><strong class="stat-range">已提交答卷</strong></div></div>
      ${questions.length ? questions.map((question) => statisticsQuestionCard(question, data.survey_id, submittedCount, questionOnly)).join("") : '<div class="empty-state"><div><div class="empty-icon">◌</div><h3>暂无统计数据</h3><p>提交答卷后，题目统计会显示在这里。</p></div></div>'}`;
  }

  function statisticsQuestionCard(question, surveyId, submittedCount, questionOnly) {
    let body = "";
    if (question.type === "single_choice" || question.type === "multi_choice") {
      const denominator = Math.max(question.answered_count || 0, 1);
      body = question.options.length ? question.options.map((option) => {
        const count = option.count || 0;
        const width = Math.min(100, (count / denominator) * 100);
        return `<div class="bar-row"><span class="bar-label" title="${escapeHtml(option.label)}">${escapeHtml(option.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span class="bar-count">${count}</span></div>`;
      }).join("") : '<small class="field-help">没有可统计的选项。</small>';
    } else if (question.type === "text") {
      body = question.answers?.length
        ? `<div class="stat-answer-list">${question.answers.map((answer) => `<div class="stat-answer">${escapeHtml(answer.text)}${answer.submitted_at ? `<time>${escapeHtml(formatDateTime(answer.submitted_at))}</time>` : ""}</div>`).join("")}</div>`
        : '<div class="question-summary">暂无文本回答</div>';
    } else if (question.type === "number") {
      body = `<div class="average-value">${question.average == null ? "—" : Number(question.average).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</div><div class="question-summary">基于 ${question.answered_count} 个已回答数字</div>`;
    }
    return `<article class="stat-question"><div class="stat-question-head"><div><h3>${escapeHtml(question.prompt)}</h3><small>${escapeHtml(questionTypeNames[question.type] || question.type)} · ${question.answered_count} 份已回答</small></div>
      ${questionOnly ? "" : `<button class="button button-link" type="button" data-action="stats-question" data-survey-id="${escapeHtml(surveyId)}" data-id="${escapeHtml(question.question_id)}">查看单题 →</button>`}</div>${body}</article>`;
  }

  async function openStatistics(surveyId, questionId = null) {
    const suffix = questionId ? `/questions/${encodeURIComponent(questionId)}` : "";
    const data = await api(`/api/statistics/surveys/${encodeURIComponent(surveyId)}${suffix}`);
    renderStatistics(data, Boolean(questionId));
  }

  async function handleAuthSubmit(form) {
    const data = new FormData(form);
    const credentials = {
      username: String(data.get("username") || "").trim(),
      password: String(data.get("password") || ""),
    };
    if (state.authMode === "register") {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(credentials) });
      toast("账号创建成功，正在登录…");
    }
    state.user = await api("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    showApp();
    const surveyId = new URLSearchParams(location.search).get("survey");
    if (surveyId) await openFill(surveyId);
    else await loadDashboard();
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action], [data-nav]");
    if (!target) return;
    try {
      if (target.dataset.nav === "dashboard" || target.dataset.action === "dashboard") {
        history.replaceState(null, "", "/");
        await loadDashboard();
      } else if (target.dataset.action === "auth-switch") {
        showAuth(state.authMode === "login" ? "register" : "login");
      } else if (target.id === "logout-button") {
        await api("/api/auth/logout", { method: "POST" });
        state.user = null;
        history.replaceState(null, "", "/");
        showAuth("login", "你已退出登录。");
      } else if (target.dataset.action === "new-survey") {
        await openEditor(null);
      } else if (target.dataset.action === "edit-survey") {
        await openEditor(target.dataset.id);
      } else if (target.dataset.action === "publish-survey") {
        await publishSurvey();
      } else if (target.dataset.action === "close-survey") {
        await closeSurvey(target.dataset.id || state.survey?.id);
      } else if (target.dataset.action === "add-question") {
        state.editingQuestionId = "new";
        renderEditor();
        view.querySelector('[data-question-form="new"] [name="prompt"]')?.focus();
      } else if (target.dataset.action === "edit-question") {
        state.editingQuestionId = state.editingQuestionId === target.dataset.id ? null : target.dataset.id;
        renderEditor();
      } else if (target.dataset.action === "cancel-question") {
        state.editingQuestionId = null;
        renderEditor();
      } else if (target.dataset.action === "delete-question") {
        if (!window.confirm("删除这道题？如果跳转规则引用它，需要先移除规则。")) return;
        await api(`/api/surveys/${encodeURIComponent(state.survey.id)}/questions/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
        state.survey = await api(`/api/surveys/${encodeURIComponent(state.survey.id)}`);
        toast("题目已删除。");
        renderEditor();
      } else if (target.dataset.action === "add-option") {
        target.closest(".field").querySelector(".option-list").insertAdjacentHTML("beforeend", optionRow({ option_id: crypto.randomUUID() }));
      } else if (target.dataset.action === "remove-option") {
        const rows = target.closest(".option-list").querySelectorAll(".option-row");
        if (rows.length <= 1) return toast("单选题和多选题至少需要一个选项。", true);
        target.closest(".option-row").remove();
      } else if (target.dataset.action === "add-rule") {
        const form = target.closest(".question-form");
        const questionId = form.dataset.questionForm;
        const index = state.survey.questions.findIndex((item) => item.question_id === questionId);
        const draft = collectQuestionDraft(form, state.survey.questions);
        const current = { ...state.survey.questions[index], ...draft };
        const rule = nextRule(current, state.survey.questions);
        if (!rule) return toast("请先添加一题作为跳转目标。", true);
        const holder = form.querySelector(".rule-list");
        if (holder) holder.insertAdjacentHTML("beforeend", ruleRow(rule, current, index, state.survey.questions));
      } else if (target.dataset.action === "remove-rule") {
        target.closest("[data-rule-row]").remove();
      } else if (target.dataset.action === "copy-current-share") {
        const input = view.querySelector("#share-link");
        if (input) await copyText(input.value);
      } else if (target.dataset.action === "copy-share") {
        await copyText(shareUrl(target.dataset.id));
      } else if (target.dataset.action === "stats-survey") {
        await openStatistics(target.dataset.id || state.survey?.id);
      } else if (target.dataset.action === "stats-question") {
        await openStatistics(target.dataset.surveyId || state.survey?.id, target.dataset.id);
      } else if (target.dataset.action === "edit-answer") {
        state.editingQuestionId = target.dataset.id;
        renderFill();
      } else if (target.dataset.action === "cancel-answer-edit") {
        state.editingQuestionId = null;
        renderFill();
      } else if (target.dataset.action === "skip-question") {
        await skipCurrentQuestion();
      } else if (target.dataset.action === "submit-response") {
        await submitResponse();
      }
    } catch (error) {
      if (error.statusCode === 401) {
        showAuth("login", error.message);
      } else {
        toast(error.message || "操作未能完成。", true);
        if (state.currentView === "fill" && error.statusCode === 409 && state.response?.id) {
          try {
            state.response = await api(`/api/fill/${encodeURIComponent(state.survey.id)}/responses/${encodeURIComponent(state.response.id)}`);
            state.editingQuestionId = null;
            renderFill();
          } catch (_) { /* the message remains visible */ }
        }
      }
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.matches("#auth-form, [data-survey-form], [data-question-form], [data-fill-answer]")) return;
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      if (form.matches("#auth-form")) await handleAuthSubmit(form);
      else if (form.matches("[data-survey-form]")) await submitSurveyForm(form);
      else if (form.matches("[data-question-form]")) await submitQuestionForm(form);
      else await saveCurrentAnswer(form);
    } catch (error) {
      toast(error.message || "操作未能完成。", true);
      if (error.statusCode === 401) showAuth("login", error.message);
    } finally {
      if (submitButton?.isConnected) submitButton.disabled = false;
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches(".question-type")) {
      const form = event.target.closest(".question-form");
      rerenderQuestionType(form, event.target.value);
    }
  });

  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      history.replaceState(null, "", "/");
      showAuth("login");
    } catch (error) {
      toast(error.message, true);
    }
  });

  async function initialize() {
    const sharedSurveyId = new URLSearchParams(location.search).get("survey");
    try {
      state.user = await api("/api/auth/me");
    } catch (error) {
      showAuth("login", error.statusCode === 401 ? "" : error.message);
      return;
    }
    showApp();
    try {
      if (sharedSurveyId) await openFill(sharedSurveyId);
      else await loadDashboard();
    } catch (error) {
      if (error.statusCode === 401) {
        showAuth("login", error.message);
      } else {
        view.innerHTML = `<div class="empty-state"><div><div class="empty-icon">!</div><h3>暂时无法打开</h3><p>${escapeHtml(error.message)}</p><button class="button" type="button" data-action="dashboard">返回我的问卷</button></div></div>`;
      }
    }
  }

  initialize();
})();
