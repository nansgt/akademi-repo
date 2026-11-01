(() => {
  "use strict";
  document.documentElement.classList.add("auth-loading");

  const TYPE_LABELS = {
    lesson: "Lesson plan",
    assessment: "Assessment",
    scheme: "Scheme of work",
    slides: "Presentation outline"
  };
  const LIVE_PRESENTATION_STORAGE_KEY = "akademi-active-live-presentation";
  function currentStudentPresentationUrl(value) {
    let token;
    try {
      token = new URL(value, window.location.href).searchParams.get("token");
    } catch (error) {
      throw new Error("The student presentation link is invalid. Resume the live presentation to refresh it.");
    }
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
      throw new Error("The student presentation link is invalid. Resume the live presentation to refresh it.");
    }
    const basePath = document.querySelector('meta[name="app-base-path"]')?.content || "";
    const link = new URL(`${basePath}/presentation/follow`, window.location.origin);
    link.searchParams.set("token", token);
    return link.href;
  }
  function saveActiveLivePresentation(session) {
    try {
      sessionStorage.setItem(LIVE_PRESENTATION_STORAGE_KEY, JSON.stringify(session));
    } catch (error) {
      console.error("The active presentation could not be saved for reload recovery.", error);
      showToast("This browser could not save the live session for recovery. Keep this tab open to preserve the student link.", "error");
    }
  }
  function loadActiveLivePresentation() {
    try {
      const saved = sessionStorage.getItem(LIVE_PRESENTATION_STORAGE_KEY);
      if (!saved) return null;
      const session = JSON.parse(saved);
      if (!session || !Number.isInteger(session.id) || session.id < 1
        || typeof session.url !== "string"
        || typeof session.title !== "string" || !session.presentation
        || !Array.isArray(session.presentation.slides) || !session.presentation.slides.length) {
        throw new Error("The saved live presentation data is invalid.");
      }
      return session;
    } catch (error) {
      console.warn("The saved live presentation could not be restored.", error);
      try {
        sessionStorage.removeItem(LIVE_PRESENTATION_STORAGE_KEY);
      } catch (removeError) {
        console.error("Invalid live presentation recovery data could not be cleared.", removeError);
      }
      return null;
    }
  }
  function clearActiveLivePresentation() {
    try {
      sessionStorage.removeItem(LIVE_PRESENTATION_STORAGE_KEY);
    } catch (error) {
      console.error("The ended live presentation recovery data could not be cleared.", error);
    }
  }
  const TYPE_ICONS = { lesson: ["book-open", "sage"], assessment: ["clipboard-check", "blue"], scheme: ["file-lines", "gold"], slides: ["file-lines", "lavender"] };
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const schoolDays = weekdays.slice(0, 5);
  const schedulePreferences = { mode: "week", date: new Date(), dayStart: 7, dayEnd: 17, slotMinutes: 30, weekStart: "Monday" };
  const scheduleWeekOrder = () => schedulePreferences.weekStart === "Sunday"
    ? ["Sunday", ...weekdays.slice(0, 6)]
    : weekdays;
  try {
    const savedPreferences = JSON.parse(localStorage.getItem("akademi-schedule-view") || "{}");
    if (["day", "week", "month"].includes(savedPreferences.mode)) schedulePreferences.mode = savedPreferences.mode;
    if (typeof savedPreferences.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(savedPreferences.date)) {
      const parsedDate = new Date(`${savedPreferences.date}T12:00:00`);
      if (!Number.isNaN(parsedDate.getTime())) schedulePreferences.date = parsedDate;
    }
    if (Number.isInteger(savedPreferences.dayStart) && savedPreferences.dayStart >= 5 && savedPreferences.dayStart < 20) schedulePreferences.dayStart = savedPreferences.dayStart;
    if (Number.isInteger(savedPreferences.dayEnd) && savedPreferences.dayEnd > schedulePreferences.dayStart && savedPreferences.dayEnd <= 23) schedulePreferences.dayEnd = savedPreferences.dayEnd;
    if ([15, 30, 60].includes(savedPreferences.slotMinutes)) schedulePreferences.slotMinutes = savedPreferences.slotMinutes;
    if (["Monday", "Sunday"].includes(savedPreferences.weekStart)) schedulePreferences.weekStart = savedPreferences.weekStart;
  } catch (error) {
    console.warn("Schedule view preferences could not be loaded.", error);
  }
  let documents = [];
  const activeDocuments = () => documents.filter((doc) => doc.status !== "archived");
  let schedule = [];
  let profile = {};
  let workspaceUserEmail = "";
  let activeSlideEditDoc = null;
  let credits = null;
  let aiProviderConfigured = false;
  let latestAssessment = null;
  let generatedAssessmentVariants = [];
  const assessmentSelections = {
    year: new Set(["SHS1"]),
    assessmentType: new Set(["class_exercise"]),
    questionFormat: new Set(["mixed"]),
    duration: new Set(["60"])
  };
  const assessmentTopicCache = new Map();
  const selectedAssessmentTopicsByYear = new Map();
  let teacherAssessmentClasses = [];
  const selectedAssessmentClassIds = new Set();
  let validateAssessmentSelections = () => true;
  let refreshAssessmentCombinationSummary = () => {};
  let refreshAssessmentWeeklySections = () => {};
  const verifiedCurriculumEntries = new Map();
  let lessonWeeklyLessons = [];
  let lessonStructureController = null;
  let currentLessonStep = 0;

  function iconMarkup(name, className = "") {
    const base = document.querySelector('meta[name="app-base-path"]')?.content || "";
    return `<svg class="icon ${className}" aria-hidden="true"><use href="${base}/assets/icons.svg#fa-${name}"></use></svg>`;
  }

  function distributePresentationNotes(notes, slideCount) {
    if (slideCount < 1) return [];
    const grouped = Array.from({ length: slideCount }, () => []);
    notes.forEach((note, index) => {
      const slideIndex = Math.min(slideCount - 1, Math.floor(index * slideCount / Math.max(1, notes.length)));
      grouped[slideIndex].push(note);
    });
    return grouped.map((items) => items.join("\n"));
  }

  function templateLectureCue(template, title, activity) {
    const cues = {
      lesson: "Introduce the focus, explain the key idea with a relevant example, then check understanding.",
      inquiry: "Invite learners to predict, examine evidence, and explain what their observations support.",
      worked: "Model the reasoning step by step, think aloud, and pause for learners to try the next step.",
      discussion: "Invite more than one perspective, ask learners to support ideas with evidence, and connect contributions.",
      project: "Revisit the success criteria, check progress, and prompt learners to explain their choices.",
      revision: "Use retrieval before reteaching, address one misconception, and give immediate practice feedback.",
      flipped: "Check prior preparation, clarify questions, and use class time for supported application."
    };
    return `Lecture notes · ${title}\n${cues[template] || cues.lesson}${activity ? ` ${activity}` : ""}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function assessmentText(value) {
    return window.akademiAssessmentRendering
      ? window.akademiAssessmentRendering.formatText(value)
      : escapeHtml(value);
  }

  function assessmentVisual(visual) {
    const rendered = window.akademiAssessmentRendering?.renderVisual(visual);
    return rendered ? `<div class="assessment-visual-wrap">${rendered.outerHTML}</div>` : "";
  }

  function assessmentPrompt(question) {
    const formatted = window.akademiAssessmentRendering?.formatQuestionPrompt(question.prompt, question.table);
    return formatted ? formatted.html : `<p>${assessmentText(question.prompt)}</p>`;
  }

  function assessmentPreviewCard(markup) {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    const card = parsed.querySelector(".output-card");
    if (!card) throw new Error("The generated assessment preview could not be displayed.");
    return document.importNode(card, true);
  }

  const generatedAssessmentDialog = document.getElementById("generated-assessment-dialog");
  function setGeneratedAssessmentTab(name) {
    const activePanel = generatedAssessmentDialog.querySelector(`[data-generated-panel="${name}"]`);
    if (!activePanel) return;
    generatedAssessmentDialog.querySelectorAll("[data-generated-tab]").forEach((tab) => {
      const selected = tab.dataset.generatedTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    generatedAssessmentDialog.querySelectorAll("[data-generated-panel]").forEach((panel) => {
      const selected = panel === activePanel;
      panel.hidden = !selected;
      panel.setAttribute("aria-hidden", String(!selected));
      panel.inert = !selected;
    });
    generatedAssessmentDialog.scrollTop = 0;
  }
  function openGeneratedAssessmentTab(name) {
    const tab = generatedAssessmentDialog.querySelector(`[data-generated-tab="${name}"]`);
    if (tab) tab.hidden = false;
    setGeneratedAssessmentTab(name);
    if (!generatedAssessmentDialog.open) generatedAssessmentDialog.showModal();
  }
  function ensureGeneratedAssessmentActionButton(selector, label) {
    let actions = document.getElementById("generated-assessment-online-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.id = "generated-assessment-online-actions";
      actions.className = "generated-assessment-online-actions";
      generatedAssessmentDialog.querySelector(".generated-assessment-header").after(actions);
    }
    let button = actions.querySelector(selector);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "small-button";
      button.setAttribute(selector.slice(1, -1), "");
      button.textContent = label;
      actions.append(button);
    }
    return { actions, button };
  }
  function showGeneratedAssessmentOnlineActions(assessmentId, label) {
    const { actions, button: shareButton } = ensureGeneratedAssessmentActionButton("[data-share-saved-assessment]", "Copy student link");
    const { button: manageButton } = ensureGeneratedAssessmentActionButton("[data-manage-saved-assessment]", "Manage class & scores");
    shareButton.dataset.shareSavedAssessment = String(assessmentId);
    manageButton.dataset.manageSavedAssessment = String(assessmentId);
    shareButton.disabled = false;
    manageButton.disabled = false;
    document.getElementById("generated-assessment-online-label").textContent = label;
    actions.hidden = false;
    if (latestAssessment?.savedDocument?.id) showGeneratedAssessmentDeleteAction(latestAssessment.savedDocument.id);
  }
  function resetGeneratedAssessmentOnlineActions() {
    const { actions, button: shareButton } = ensureGeneratedAssessmentActionButton("[data-share-saved-assessment]", "Copy student link");
    const { button: manageButton } = ensureGeneratedAssessmentActionButton("[data-manage-saved-assessment]", "Manage class & scores");
    const { button: deleteButton } = ensureGeneratedAssessmentActionButton("[data-delete-assessment-document]", "Delete saved assessment");
    shareButton.dataset.shareSavedAssessment = "";
    manageButton.dataset.manageSavedAssessment = "";
    deleteButton.dataset.deleteAssessmentDocument = "";
    shareButton.disabled = true;
    manageButton.disabled = true;
    deleteButton.hidden = true;
    document.getElementById("generated-assessment-online-label").textContent = "Publish online to enable these actions.";
    actions.hidden = false;
  }
  function showGeneratedAssessmentDeleteAction(documentId) {
    const { button: deleteButton } = ensureGeneratedAssessmentActionButton("[data-delete-assessment-document]", "Delete saved assessment");
    deleteButton.dataset.deleteAssessmentDocument = String(documentId);
    deleteButton.hidden = false;
  }
  function bindGeneratedAssessmentOpen(region) {
    if (region.dataset.reviewBound) return;
    region.dataset.reviewBound = "true";
    region.addEventListener("click", (event) => {
      if (!event.target.closest("[data-open-generated-assessment]")) return;
      if (!generatedAssessmentDialog.open) generatedAssessmentDialog.showModal();
    });
  }
  generatedAssessmentDialog.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-generated-tab]");
    if (tab && !tab.hidden) setGeneratedAssessmentTab(tab.dataset.generatedTab);
    if (event.target.closest("[data-close-generated-assessment]")) generatedAssessmentDialog.close();
    if (event.target === generatedAssessmentDialog) generatedAssessmentDialog.close();
    const changeButton = event.target.closest("[data-change-assessment-question]");
    if (changeButton) {
      await changeAssessmentQuestion(changeButton, generatedAssessmentVariants[Number(changeButton.dataset.assessmentVariant)]);
    }
  });
  generatedAssessmentDialog.querySelector(".generated-assessment-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(generatedAssessmentDialog.querySelectorAll("[data-generated-tab]:not([hidden])"));
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    if (tabs[next]) setGeneratedAssessmentTab(tabs[next].dataset.generatedTab);
  });

  function assessmentPaperQuestion(question, index, changesUsed, variantIndex) {
    const choices = Array.isArray(question.options)
      ? `<ol class="assessment-options" type="A">${question.options.map((option) => `<li>${assessmentText(option)}</li>`).join("")}</ol>`
      : `<div class="assessment-answer-space" aria-label="Answer space"></div>`;
    const disabled = changesUsed >= 5 || !window.akademiUserId;
    return `<li class="assessment-question" data-assessment-question="${index}"><div class="assessment-question-heading"><strong>Question ${index + 1}</strong><span class="assessment-question-marks">${escapeHtml(question.marks)} marks</span><button type="button" class="small-button assessment-question-change" data-change-assessment-question="${index}" data-assessment-variant="${variantIndex}" aria-label="Change question ${index + 1}; ${5 - changesUsed} changes remaining"${disabled ? " disabled" : ""}>${iconMarkup("arrows-rotate")} Change question · ${changesUsed}/5</button></div>${assessmentPrompt(question)}${assessmentVisual(question.visual)}${choices}</li>`;
  }

  async function changeAssessmentQuestion(button, variant) {
    const index = Number(button.dataset.changeAssessmentQuestion);
    const current = variant?.draft?.questions?.[index];
    if (!current || Number(variant.draft.question_revision_counts?.[index] || 0) >= 5) return;
    button.disabled = true;
    const originalLabel = button.innerHTML;
    button.textContent = "Generating replacement…";
    try {
      const generationInput = { ...variant.input };
      delete generationInput.combinations;
      delete generationInput.class_roster;
      delete generationInput.combination_index;
      delete generationInput.combination_count;
      generationInput.question_count = 1;
      generationInput.total_marks = Number(current.marks);
      generationInput.question_format = current.question_type === "mcq" ? "mcq" : current.question_type;
      generationInput.other_format = current.question_type === "other" ? (variant.input.other_format || "structured question") : "";
      generationInput.teacher_instructions = [
        variant.input.teacher_instructions,
        `Replace question ${index + 1} only. Return exactly one question of type ${current.question_type}, worth exactly ${current.marks} marks. Preserve the same curriculum scope and comparable difficulty; create a distinct question, not a paraphrase.`
      ].filter(Boolean).join("\n\n");
      const response = await fetch(`${appBase}/api/ai/generate`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": window.akademiCsrfToken || ""
        },
        body: JSON.stringify(generationInput)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The replacement question could not be generated.");
      const replacement = result.draft?.questions?.[0];
      if (!replacement) throw new Error("The AI did not return a replacement question.");
      if (variant.onlineAssessmentId) {
        const saved = await workspaceRequest(`/api/teacher/online-assessments/${variant.onlineAssessmentId}/questions/${index}`, "PUT", { question: replacement });
        variant.draft.question_revision_counts[index] = saved.changes_used;
      } else {
        variant.draft.question_revision_counts[index] = Number(variant.draft.question_revision_counts[index] || 0) + 1;
      }
      variant.draft.questions[index] = replacement;
      const guide = result.draft.marking_guide?.[0];
      if (guide) variant.draft.marking_guide[index] = { ...guide, question_number: index + 1, marks: Number(current.marks) };
      const count = variant.draft.question_revision_counts[index];
      const paperBody = variant.paperCard?.querySelector(".output-body");
      const oldQuestion = paperBody?.querySelector(`[data-assessment-question="${index}"]`);
      if (oldQuestion) oldQuestion.outerHTML = assessmentPaperQuestion(replacement, index, count, Number(button.dataset.assessmentVariant));
      const guideBody = variant.guideCard?.querySelector(".output-body");
      const guideQuestion = guideBody?.querySelector(`[data-assessment-guide-question="${index}"]`);
      if (guideQuestion) {
        const expected = variant.draft.marking_guide[index];
        const mcqAnswer = Array.isArray(replacement.options)
          ? `<p><strong>Correct option:</strong> ${String.fromCharCode(65 + Number(replacement.correct_option))}. ${assessmentText(replacement.options[replacement.correct_option])}</p>`
          : "";
        guideQuestion.outerHTML = `<li class="assessment-question" data-assessment-guide-question="${index}"><div class="assessment-question-heading"><strong>Question ${index + 1}</strong><span>${escapeHtml(expected.marks)} marks</span></div><p>${assessmentText(expected.expected_response)}</p>${assessmentVisual(replacement.visual)}${mcqAnswer}</li>`;
      }
      if (variant.combinedBody && paperBody && guideBody) {
        variant.combinedBody.innerHTML = `${paperBody.innerHTML}<div class="assessment-print-page-break"></div>${guideBody.innerHTML}`;
      }
      const html = `<article class="output-card"><div class="output-heading"><div><h2>Assessment</h2><p>Automatically saved question paper and teacher marking guide</p></div></div><div class="output-body">${variant.combinedBody?.innerHTML || ""}</div></article>`;
      const data = { ...(variant.savedDocument?.data || variant.savedData || {}), assessment_draft: variant.draft };
      if (variant.savedDocument) {
        const updated = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(variant.savedDocument.id)}`, "PUT", {
          type: "assessment", title: variant.savedDocument.title, data, html
        });
        variant.savedDocument = updated.document;
        documents = documents.map((document) => document.id === updated.document.id ? updated.document : document);
        renderAll();
      } else {
        variant.savedDocument = await saveDocument("assessment", variant.draft.title, data, html);
      }
      credits = result.credits || credits;
      updateCreditDisplay();
      showToast(`Question ${index + 1} replaced. ${5 - count} changes remaining.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The question could not be changed.", "error");
    } finally {
      const currentCount = Number(variant?.draft?.question_revision_counts?.[index] || 0);
      const exhausted = currentCount >= 5;
      if (button.isConnected) {
        button.disabled = exhausted || !window.akademiUserId;
        button.innerHTML = `${iconMarkup("arrows-rotate")} Change question · ${currentCount}/5`;
        if (exhausted) button.title = "This question has reached its five-change limit.";
      }
      if (!button.isConnected && !variant?.draft?.question_revision_counts?.[index]) button.disabled = false;
      if (!variant?.draft?.question_revision_counts?.[index]) button.innerHTML = originalLabel;
    }
  }

  function lines(value) {
    return String(value || "").split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
  }

  function showToast(message, type = "success") {
    window.akademiAlert.toast(message, type);
  }

  function goTo(pageName) {
    const page = document.getElementById(`page-${pageName}`);
    if (!page) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", pageName);
    window.history.replaceState(window.history.state, "", url);
    document.querySelectorAll(".page").forEach((section) => section.classList.toggle("active", section === page));
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === pageName));
    const title = page.querySelector("h1")?.textContent || "Overview";
    document.getElementById("page-title").textContent = title;
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("mobile-menu").setAttribute("aria-expanded", "false");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", (event) => {
    const adminTarget = event.target.closest("[data-admin-url]");
    if (adminTarget) {
      window.location.assign(`${document.querySelector('meta[name="app-base-path"]')?.content || ""}/${adminTarget.dataset.adminUrl}`);
      return;
    }
    const target = event.target.closest("[data-page]");
    if (target) {
      event.preventDefault();
      goTo(target.dataset.page);
    }
  });

  document.getElementById("mobile-menu").addEventListener("click", (event) => {
    const sidebar = document.getElementById("sidebar");
    const open = sidebar.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  const sidebar = document.getElementById("sidebar");
  const sidebarCollapse = document.getElementById("sidebar-collapse");
  let sidebarCollapsed = false;
  try {
    sidebarCollapsed = localStorage.getItem("akademi-sidebar") === "collapsed";
  } catch (error) {
    console.warn("Sidebar preference could not be read from local storage.", error);
  }
  document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  sidebarCollapse.setAttribute("aria-label", sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  sidebarCollapse.title = sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  sidebarCollapse.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    try {
      localStorage.setItem("akademi-sidebar", collapsed ? "collapsed" : "expanded");
    } catch (error) {
      console.warn("Sidebar preference could not be saved to local storage.", error);
    }
    sidebarCollapse.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    sidebarCollapse.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  });
  document.getElementById("help-button").addEventListener("click", () => {
    showToast("Your drafts, profile and teaching schedule sync to your account. AI needs an enabled provider and reviewed curriculum sources.");
  });
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("en-GH", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date()).toUpperCase();

  const appBase = document.querySelector('meta[name="app-base-path"]')?.content || "";
  document.getElementById("sync-state").textContent = "Syncing your account…";
  async function workspaceRequest(path, method = "GET", payload = null, { silent = false } = {}) {
    const showSyncProgress = !silent && !path.startsWith("/api/teacher/presentation-simulations");
    const options = {
      method,
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    };
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
      options.headers["X-CSRF-Token"] = window.akademiCsrfToken || "";
    }
    if (payload !== null) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(`${appBase}${path}`, options);
    const result = await response.json();
    if (!response.ok) {
      if (showSyncProgress) document.getElementById("sync-state").textContent = "Sync failed";
      const reference = result.request_id ? ` (Reference: ${result.request_id})` : "";
      throw new Error(`${result.error || "The server could not complete this action."}${reference}`);
    }
    if (showSyncProgress) markSynced();
    return result;
  }
  function updateCreditDisplay() {
    if (!credits) return;
    const value = `${credits.remaining} of ${credits.allowance} AI credits left`;
    document.getElementById("credit-balance").textContent = value;
    document.getElementById("dashboard-credit-balance").textContent = value;
    document.getElementById("credit-reset").textContent = `Resets ${new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(credits.next_reset_utc))} (UTC)`;
    document.getElementById("dashboard-credit-hint").textContent = `${credits.used} used this month · resets ${new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(credits.next_reset_utc))} UTC`;
  }
  function markSynced() {
    document.getElementById("sync-state").textContent = "Synced to your account";
  }
  const lessonForm = document.getElementById("lesson-form");
  const lessonDialog = document.getElementById("lesson-wizard-dialog");
  const lessonYearSelect = lessonForm.elements.namedItem("year");
  const lessonSubjectSelect = lessonForm.elements.namedItem("subject");
  const lessonSubjectOptions = document.getElementById("lesson-subject-options");
  const lessonClassOptions = document.getElementById("lesson-class-options");
  const lessonStepPages = Array.from(lessonForm.querySelectorAll("[data-lesson-step]"));
  const lessonWeekSelect = lessonForm.elements.namedItem("week");
  const lessonWeekPicker = document.getElementById("lesson-week-picker");
  const lessonWeekTrigger = document.getElementById("lesson-week-trigger");
  const lessonWeekLabel = document.getElementById("lesson-week-label");
  const lessonWeekOptions = document.getElementById("lesson-week-options");
  const lessonChoiceGroups = {
    focalArea: document.getElementById("lesson-focal-options"),
    indicator: document.getElementById("lesson-indicator-options"),
    resources: document.getElementById("lesson-resource-options")
  };

  function renderLessonChoiceBadges(fieldName) {
    const select = lessonForm.elements.namedItem(fieldName);
    const group = lessonChoiceGroups[fieldName];
    if (!select || !group) return;
    group.tabIndex = -1;
    group.replaceChildren();
    if (!select.options.length) {
      const empty = document.createElement("span");
      empty.className = "lesson-choice-empty";
      empty.textContent = fieldName === "indicator"
        ? "No learning indicators or outcomes are registered for this week."
        : fieldName === "focalArea"
          ? "No focal areas are registered for this week."
          : "No resource options are available.";
      group.append(empty);
      return;
    }
    for (const option of select.options) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "lesson-choice-badge";
      badge.dataset.choiceValue = option.value;
      badge.setAttribute("aria-pressed", String(option.selected));
      badge.textContent = option.textContent;
      badge.addEventListener("click", () => {
        option.selected = !option.selected;
        badge.setAttribute("aria-pressed", String(option.selected));
        group.removeAttribute("aria-invalid");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      group.append(badge);
    }
  }

  Object.keys(lessonChoiceGroups).forEach(renderLessonChoiceBadges);

  function syncLessonWeekPicker() {
    const selectedOption = lessonWeekSelect.selectedOptions[0];
    lessonWeekLabel.textContent = selectedOption?.textContent || "Choose a verified teaching week";
    lessonWeekTrigger.disabled = lessonWeekSelect.disabled;
    lessonWeekOptions.replaceChildren(...Array.from(lessonWeekSelect.options).slice(1).map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-week-option";
      button.dataset.weekValue = option.value;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.selected));
      button.tabIndex = -1;
      button.textContent = option.textContent;
      return button;
    }));
  }

  function closeLessonWeekPicker(returnFocus = false) {
    lessonWeekOptions.hidden = true;
    lessonWeekTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) lessonWeekTrigger.focus();
  }

  function openLessonWeekPicker() {
    if (lessonWeekTrigger.disabled || !lessonWeekOptions.children.length) return;
    lessonWeekOptions.hidden = false;
    lessonWeekTrigger.setAttribute("aria-expanded", "true");
    const selected = lessonWeekOptions.querySelector('[aria-selected="true"]');
    (selected || lessonWeekOptions.firstElementChild)?.focus();
  }

  lessonWeekTrigger.addEventListener("click", () => {
    if (lessonWeekOptions.hidden) openLessonWeekPicker();
    else closeLessonWeekPicker();
  });
  lessonWeekTrigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openLessonWeekPicker();
    }
  });
  lessonWeekOptions.addEventListener("click", (event) => {
    const option = event.target.closest("[data-week-value]");
    if (!option) return;
    lessonWeekSelect.value = option.dataset.weekValue;
    lessonWeekSelect.dispatchEvent(new Event("change", { bubbles: true }));
    closeLessonWeekPicker(true);
  });
  lessonWeekOptions.addEventListener("keydown", (event) => {
    const options = Array.from(lessonWeekOptions.querySelectorAll("[data-week-value]"));
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      closeLessonWeekPicker(true);
      return;
    } else return;
    event.preventDefault();
    options[nextIndex]?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!lessonWeekPicker.contains(event.target)) closeLessonWeekPicker();
  });
  syncLessonWeekPicker();

  const lessonEntryFields = {
    strand: ["strand"],
    substrand: ["sub_strand"],
    focalArea: ["focal_area"],
    standard: ["content_standard"],
    topic: ["topic"],
    indicator: ["learning_indicator", "learning_outcome", "learning_objective"]
  };
  function lessonEntryType(entry) {
    const type = String(entry.section_type || "").toLocaleLowerCase().replace(/[\s-]+/g, "_");
    if (["strand", "sub_strand", "focal_area", "content_standard", "topic", "learning_indicator", "learning_outcome", "learning_objective"].includes(type)) return type;
    const source = `${entry.title || ""}\n${String(entry.body || "").slice(0, 600)}`;
    const labels = [
      [/^\s*(?:sub[\s_-]*strand)\s*(?:[:#-]|\d|\b)/im, "sub_strand"],
      [/^\s*(?:focal[\s_-]*area)\s*(?:[:#-]|\d|\b)/im, "focal_area"],
      [/^\s*(?:content[\s_-]*standard|standard)\s*(?:[:#-]|\d|\b)/im, "content_standard"],
      [/^\s*(?:learning[\s_-]*(?:indicator|outcome)|indicator)\s*(?:[:#-]|\d|\b)/im, "learning_indicator"],
      [/^\s*strand\s*(?:[:#-]|\d|\b)/im, "strand"],
      [/^\s*topic\s*(?:[:#-]|\d|\b)/im, "topic"]
    ];
    return labels.find(([pattern]) => pattern.test(source))?.[1] || type;
  }
  const schemePeriodSelect = document.querySelector('#scheme-form [name="schemePeriod"]');
  const schemeTermSelect = document.querySelector('#scheme-form [name="termNumber"]');
  const schemeSubjectSelect = document.querySelector('#scheme-form [name="subject"]');
  const schemeStepPages = Array.from(document.querySelectorAll("[data-scheme-step]"));
  const assessmentForm = document.getElementById("assessment-form");
  const assessmentStepPages = Array.from(assessmentForm.querySelectorAll("[data-assessment-step]"));
  let currentSchemeStep = 0;
  let currentAssessmentStep = 0;
  let activeAssessmentDraftId = null;
  let continueAssessmentDraft = null;

  function showFormStep(kind, step) {
    const isAssessment = kind === "assessment";
    const pages = isAssessment ? assessmentStepPages : schemeStepPages;
    const current = Math.max(0, Math.min(pages.length - 1, step));
    if (isAssessment) currentAssessmentStep = current;
    else currentSchemeStep = current;
    pages.forEach((page, index) => {
      page.hidden = index !== current;
      page.classList.toggle("is-current", index === current);
    });
    document.querySelectorAll(`[data-${kind}-indicator]`).forEach((indicator, index) => {
      indicator.classList.toggle("is-current", index === current);
      indicator.classList.toggle("is-complete", index < current);
    });
    const prefix = isAssessment ? "assessment" : "scheme";
    document.getElementById(`${prefix}-step-caption`).textContent = `Step ${current + 1} of ${pages.length}`;
    document.getElementById(`${prefix}-step-back`).hidden = current === 0;
    document.getElementById(`${prefix}-step-next`).hidden = current === pages.length - 1;
    const finalActions = document.querySelector(`#${prefix}-form .${prefix === "assessment" ? "assessment-final-actions" : "scheme-final-actions"}`);
    if (finalActions) finalActions.hidden = current !== pages.length - 1;
    if (!isAssessment) document.querySelector("#scheme-form [data-scheme-build]").hidden = current !== pages.length - 1;
  }

  function validateProgressPage(pages, index) {
    const invalid = pages[index].querySelector(":scope [required]:invalid");
    if (!invalid) return true;
    invalid.reportValidity();
    invalid.focus();
    return false;
  }

  document.getElementById("assessment-step-next").addEventListener("click", () => {
    if (validateProgressPage(assessmentStepPages, currentAssessmentStep)) showFormStep("assessment", currentAssessmentStep + 1);
  });
  document.getElementById("assessment-step-back").addEventListener("click", () => showFormStep("assessment", currentAssessmentStep - 1));
  document.getElementById("scheme-step-next").addEventListener("click", () => {
    if (validateProgressPage(schemeStepPages, currentSchemeStep)) showFormStep("scheme", currentSchemeStep + 1);
  });
  document.getElementById("scheme-step-back").addEventListener("click", () => showFormStep("scheme", currentSchemeStep - 1));
  showFormStep("assessment", 0);
  showFormStep("scheme", 0);
  const planningDialogs = {
    assessment: document.getElementById("assessment-dialog"),
    scheme: document.getElementById("scheme-dialog"),
    slides: document.getElementById("slides-dialog")
  };
  for (const [type, dialog] of Object.entries(planningDialogs)) {
    document.getElementById(`${type}-new-button`).addEventListener("click", () => {
      if (type === "scheme" && !dialog.querySelector('[name="academicYear"]').value) {
        const year = new Date().getFullYear();
        dialog.querySelector('[name="academicYear"]').value = `${year}/${year + 1}`;
      }
      if (type === "assessment") {
        activeAssessmentDraftId = null;
        const saveButton = document.getElementById("assessment-save-draft");
        if (saveButton) saveButton.innerHTML = `${iconMarkup("file-lines")} Save draft`;
        showFormStep("assessment", 0);
      }
      if (type === "scheme") showFormStep("scheme", 0);
      dialog.showModal();
      if (type === "assessment") refreshAssessmentWeeklySections();
    });
    dialog.querySelector("[data-close-planning-dialog]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (liveSession) void closeViewer();
      else dialog.close();
    });
  }
  document.querySelector("#scheme-form .scheme-coverage-field").addEventListener("click", (event) => {
    const badge = event.target.closest("[data-scheme-period]");
    if (!badge) return;
    const selection = badge.dataset.schemePeriod;
    const semesterMatch = selection.match(/^semester-([12])$/);
    schemePeriodSelect.value = semesterMatch ? "semester" : "full_year";
    schemeTermSelect.value = semesterMatch?.[1] || "";
    document.querySelectorAll("#scheme-form [data-scheme-period]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button === badge));
    });
    updateSchemeStartFields();
  });
  function updateSchemeStartFields() {
    const semester = schemeTermSelect.value;
    document.querySelectorAll("#scheme-form [data-scheme-start]").forEach((field) => {
      const visible = schemePeriodSelect.value === "full_year" || field.dataset.schemeStart === semester;
      field.hidden = !visible;
      field.querySelector("input").required = visible;
    });
  }
  updateSchemeStartFields();

  function showLessonStep(step) {
    currentLessonStep = Math.max(0, Math.min(lessonStepPages.length - 1, step));
    lessonStepPages.forEach((page, index) => {
      page.hidden = index !== currentLessonStep;
      page.classList.toggle("is-current", index === currentLessonStep);
    });
    document.querySelectorAll("[data-step-indicator]").forEach((indicator, index) => {
      indicator.classList.toggle("is-current", index === currentLessonStep);
      indicator.classList.toggle("is-complete", index < currentLessonStep);
    });
    document.getElementById("lesson-step-caption").textContent = `Step ${currentLessonStep + 1} of ${lessonStepPages.length}`;
    document.getElementById("lesson-step-back").hidden = currentLessonStep === 0;
    document.getElementById("lesson-step-next").hidden = currentLessonStep === lessonStepPages.length - 1;
    document.querySelector(".lesson-wizard-final-actions").hidden = currentLessonStep !== lessonStepPages.length - 1;
  }

  function validateLessonStep(step = currentLessonStep) {
    const page = lessonStepPages[step];
    if (step === 0 && !lessonWeekSelect.value) {
      lessonWeekTrigger.setAttribute("aria-invalid", "true");
      showToast("Choose a verified teaching week before continuing.", "error");
      lessonWeekTrigger.focus();
      return false;
    }
    if (step === 1 && selectedLessonEntries("indicator").length === 0) {
      const group = lessonChoiceGroups.indicator;
      group.setAttribute("aria-invalid", "true");
      showToast("Select at least one learning indicator or outcome from this verified week.", "error");
      group.focus();
      return false;
    }
    const invalid = Array.from(page.querySelectorAll("[required]")).find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return false;
    }
    return true;
  }

  function validateLessonForm(form) {
    if (!lessonWeekSelect.value) {
      showLessonStep(0);
      showToast("Choose a verified teaching week for this subject and SHS year.", "error");
      lessonWeekTrigger.setAttribute("aria-invalid", "true");
      lessonWeekTrigger.focus();
      return false;
    }
    if (selectedLessonEntries("indicator").length === 0) {
      showLessonStep(1);
      const group = lessonChoiceGroups.indicator;
      group.setAttribute("aria-invalid", "true");
      showToast("Select at least one learning indicator or outcome from this verified week.", "error");
      group.focus();
      return false;
    }
    for (let step = 0; step < lessonStepPages.length; step++) {
      const invalid = lessonStepPages[step].querySelector("[required]:invalid");
      if (!invalid) continue;
      showLessonStep(step);
      invalid.reportValidity();
      invalid.focus();
      return false;
    }
    if (!form.elements.namedItem("topic").value || !form.elements.namedItem("indicator").value) {
      showLessonStep(1);
      showToast("Choose verified curriculum content before building this lesson.", "error");
      return false;
    }
    return true;
  }

  function resetLessonSelect(select, label) {
    if (!select) {
      console.warn("Lesson curriculum selector missing. Skipping option reset.");
      return;
    }
    select.replaceChildren(new Option(label, ""));
  }

  function selectEntryText(entry, includeBody = false, fullBody = false) {
    const codedTitle = [entry.code, entry.title].filter(Boolean).join(" · ");
    return includeBody && entry.body
      ? `${codedTitle}\n${fullBody ? String(entry.body).trim() : String(entry.body).slice(0, 500)}`
      : codedTitle;
  }

  const lessonStandardSelect = lessonForm.elements.namedItem("standard");
  const lessonStandardPreview = document.getElementById("lesson-standard-preview");
  function selectedStandardEntries(entries = Array.from(verifiedCurriculumEntries.values())) {
    const selectedFocalAreas = selectedLessonEntries("focalArea");
    const focalIds = new Set(selectedFocalAreas.map((entry) => String(entry.id)));
    const focalNames = selectedFocalAreas.map((entry) => String(entry.title || "").trim().toLocaleLowerCase()).filter(Boolean);
    const entriesById = new Map(entries.map((entry) => [String(entry.id), entry]));
    const standards = entries.filter((entry) => lessonEntryType(entry) === "content_standard");
    if (!focalNames.length) return [];
    const ignoredFocalTerms = new Set(["about", "after", "among", "application", "applications", "based", "being", "from", "using", "where", "which", "with"]);
    const focalTerms = new Set(focalNames.flatMap((name) =>
      name.replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((term) => term.length >= 5 && !ignoredFocalTerms.has(term))
    ));
    const ancestorIds = (entry) => {
      const ids = new Set([String(entry.id)]);
      let parentId = String(entry.parent_id || "");
      while (parentId && !ids.has(parentId)) {
        ids.add(parentId);
        parentId = String(entriesById.get(parentId)?.parent_id || "");
      }
      return ids;
    };
    const selectedFocalLineages = selectedFocalAreas.map(ancestorIds);
    const related = standards.filter((standard) => {
      const standardLineage = ancestorIds(standard);
      if (focalIds.has(String(standard.id))
        || selectedFocalLineages.some((lineage) => Array.from(standardLineage).some((id) => lineage.has(id)))) return true;
      const ancestry = Array.from(standardLineage)
        .map((id) => entriesById.get(id)?.title || "")
        .filter(Boolean);
      const standardContext = `${standard.title || ""} ${standard.body || ""} ${ancestry.join(" ")}`.toLocaleLowerCase();
      if (focalNames.some((name) => standardContext.includes(name) || name.includes(standardContext.trim()))) return true;
      const standardTerms = new Set(standardContext.replace(/[^a-z0-9]+/g, " ").split(/\s+/));
      return Array.from(focalTerms).some((term) => standardTerms.has(term));
    });
    return related.length ? related : standards;
  }
  function lessonStandardAssignments(entries) {
    const lessonCount = Math.max(1, Number(lessonForm.elements.namedItem("lessonCount").value) || 1);
    if (entries.length > 0 && entries.length < lessonCount) {
      return Array.from({ length: lessonCount }, (_, index) =>
        `Lesson ${index + 1}: ${selectEntryText(entries[index % entries.length], true)}`
      );
    }
    return entries.map((entry, index) =>
      `Lesson ${index % lessonCount + 1}: ${selectEntryText(entry, true)}`
    );
  }
  function updateLessonStandardPreview() {
    const selectedEntries = selectedLessonEntries("standard");
    const assignments = lessonStandardAssignments(selectedEntries);
    lessonStandardPreview.textContent = assignments.length
      ? assignments.join(" · ")
      : "No standards match the selected focal areas in this week’s verified source.";
  }
  lessonStandardSelect.addEventListener("change", updateLessonStandardPreview);
  lessonForm.elements.namedItem("lessonCount").addEventListener("input", updateLessonStandardPreview);

  function populateLessonEntrySelects(entries, preserveSelection = false) {
    const previousValues = {};
    if (preserveSelection) {
      for (const name of Object.keys(lessonEntryFields)) {
        const select = lessonForm.elements.namedItem(name);
        previousValues[name] = select.multiple
          ? Array.from(select.selectedOptions, (option) => option.value)
          : [select.value];
      }
    }
    verifiedCurriculumEntries.clear();
    entries.forEach((entry) => verifiedCurriculumEntries.set(String(entry.id), entry));
    for (const [fieldName, acceptedTypes] of Object.entries(lessonEntryFields)) {
      const select = lessonForm.elements.namedItem(fieldName);
      if (!select) continue;
      if (!select.multiple) {
        const label = fieldName === "topic" ? "Choose a verified topic" : fieldName === "indicator" ? "Choose a verified indicator or outcome" : `Choose ${fieldName.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} (optional)`;
        resetLessonSelect(select, label);
      } else {
        select.replaceChildren();
      }
      const matching = entries.filter((entry) => acceptedTypes.includes(lessonEntryType(entry)));
      matching.forEach((entry) => {
        const entryType = lessonEntryType(entry);
        const optionText = fieldName === "standard"
          ? selectEntryText(entry, true, true)
          : `${entryType.replaceAll("_", " ")} · ${[entry.code, entry.title].filter(Boolean).join(" · ")}${entry.page_number ? ` · p. ${entry.page_number}` : ""}`;
        const option = new Option(optionText, String(entry.id));
        option.title = optionText;
        select.add(option);
      });
      select.disabled = matching.length === 0;
      if (preserveSelection && previousValues[fieldName]?.length) {
        const validValues = previousValues[fieldName].filter((value) => Array.from(select.options).some((option) => option.value === value));
        if (select.multiple) {
          for (const option of select.options) option.selected = validValues.includes(option.value);
        } else if (validValues[0]) {
          select.value = validValues[0];
        }
      } else if (select.multiple) {
        for (const option of select.options) option.selected = fieldName === "focalArea" || fieldName === "indicator";
      } else if (fieldName === "topic") {
        const weeklyTopic = matching.find((entry) => entry.id === lessonForm.elements.namedItem("week").selectedOptions[0]?.dataset.topicEntryId);
        select.value = String(weeklyTopic?.id || matching[0]?.id || "");
      } else if (matching.length) {
        select.value = String(matching[0].id);
      }
      if (fieldName === "focalArea" || fieldName === "indicator") {
        renderLessonChoiceBadges(fieldName);
      }
    }
    if (!preserveSelection) {
      const matchingStandards = new Set(selectedStandardEntries(entries).map((entry) => String(entry.id)));
      for (const option of lessonStandardSelect.options) option.selected = matchingStandards.has(option.value);
    }
    updateLessonStandardPreview();
  }

  const selectedLessonClasses = new Set();
  let renderedLessonClassYear = "";
  let managedClassesLoaded = false;
  let managedClassesLoadError = "";

  function updateClassOptions() {
    if (!lessonClassOptions || !lessonYearSelect) {
      console.error("Lesson class picker markup is missing; class options were not rendered.");
      return;
    }
    const yearMatch = String(lessonYearSelect.value || "").match(/([123])$/);
    const year = yearMatch?.[1] || "";
    if (year !== renderedLessonClassYear) {
      selectedLessonClasses.clear();
      renderedLessonClassYear = year;
    }
    const savedClasses = teacherAssessmentClasses.filter((item) =>
      !item.archived_at && String(item.year_group).replace(/\D/g, "") === year
    );
    if (!managedClassesLoaded) {
      const loading = document.createElement("span");
      loading.className = "lesson-choice-empty";
      loading.textContent = "Loading your saved classes…";
      lessonClassOptions.replaceChildren(loading);
      return;
    }
    if (managedClassesLoadError) {
      const error = document.createElement("span");
      error.className = "lesson-choice-empty";
      error.textContent = managedClassesLoadError;
      lessonClassOptions.replaceChildren(error);
      return;
    }
    if (!year || savedClasses.length === 0) {
      const empty = document.createElement("span");
      empty.className = "lesson-choice-empty";
      empty.textContent = year
        ? `No saved classes are available for SHS Year ${year}. Create a class in Class Management first.`
        : "Choose an SHS year to see your saved classes.";
      lessonClassOptions.replaceChildren(empty);
      return;
    }
    const renderClass = (classItem) => {
      const card = document.createElement("div");
      card.className = "lesson-class-card";
      const option = document.createElement("button");
      option.type = "button";
      option.className = "lesson-class-option";
      option.setAttribute("aria-pressed", String(selectedLessonClasses.has(String(classItem.id))));
      option.dataset.lessonClass = String(classItem.id);
      const name = document.createElement("span");
      name.textContent = classItem.name;
      const state = document.createElement("span");
      state.className = "lesson-class-state";
      state.textContent = selectedLessonClasses.has(String(classItem.id)) ? "Selected" : "Add";
      option.append(name, state);
      card.append(option);
      return card;
    };
    lessonClassOptions.replaceChildren(...savedClasses.map(renderClass));
  }
  if (lessonClassOptions) {
    lessonClassOptions.addEventListener("click", (event) => {
      const option = event.target.closest("[data-lesson-class]");
      if (!option) return;
      const value = option.dataset.lessonClass;
      if (selectedLessonClasses.has(value)) selectedLessonClasses.delete(value);
      else selectedLessonClasses.add(value);
      updateClassOptions();
    });
  } else {
    console.error("Lesson class picker markup is missing.");
  }

  function selectedLessonWeek() {
    return lessonWeeklyLessons.find((lesson) =>
      `${lesson.semester_number}:${lesson.week_number}` === lessonForm.elements.namedItem("week").value
    ) || null;
  }

  function lessonEntriesForWeek(lesson) {
    if (!lesson) return [];
    const weeklyFocalNames = new Set((lesson.focal_areas || []).map((area) => String(area).trim().toLocaleLowerCase()));
    const entries = Array.isArray(lesson.curriculum_entries)
      ? lesson.curriculum_entries.filter((entry) =>
        (lessonEntryType(entry) !== "focal_area" || weeklyFocalNames.has(String(entry.title || "").trim().toLocaleLowerCase()))
        && !(lessonEntryType(entry) === "topic" && String(entry.title || "").trim().toLocaleLowerCase() === String(lesson.topic || "").trim().toLocaleLowerCase())
      )
      : [];
    const sourceDetails = {
      document_title: lesson.source_title || "",
      source_reference: lesson.source_reference || "",
      source_url: lesson.source_url || "",
      page_number: lesson.source_page || ""
    };
    entries.push({
      ...sourceDetails,
      id: `weekly-topic-${lesson.id}`,
      section_type: "topic",
      title: lesson.topic,
      body: "",
      weekly_topic: true
    });
    const seenFocalAreas = new Set(entries
      .filter((entry) => lessonEntryType(entry) === "focal_area")
      .map((entry) => String(entry.title || "").trim().toLocaleLowerCase()));
    (lesson.focal_areas || []).forEach((focalArea, index) => {
      const focalKey = String(focalArea).trim().toLocaleLowerCase();
      if (!focalKey || seenFocalAreas.has(focalKey)) return;
      seenFocalAreas.add(focalKey);
      entries.push({
        ...sourceDetails,
        id: `weekly-focal-${lesson.id}-${index}`,
        section_type: "focal_area",
        title: focalArea,
        body: ""
      });
    });
    return entries;
  }

  function applySelectedLessonWeek() {
    const weekSelect = lessonForm.elements.namedItem("week");
    const lesson = selectedLessonWeek();
    if (!lesson) {
      populateLessonEntrySelects([]);
      return;
    }
    const entries = lessonEntriesForWeek(lesson);
    populateLessonEntrySelects(entries);
    const topicEntry = entries.find((entry) => entry.weekly_topic);
    if (topicEntry) {
      const weekOption = weekSelect.selectedOptions[0];
      if (weekOption) weekOption.dataset.topicEntryId = String(topicEntry.id);
      lessonForm.elements.namedItem("topic").value = String(topicEntry.id);
    }
    const matchedTypes = new Set(entries.map(lessonEntryType));
    const missing = [
      !matchedTypes.has("strand") && "strand",
      !matchedTypes.has("sub_strand") && "sub-strand",
      !(lesson.focal_areas || []).length && "focal area",
      !matchedTypes.has("content_standard") && "content standard",
      !["learning_indicator", "learning_outcome", "learning_objective"].some((type) => matchedTypes.has(type))
        && "learning indicator or outcome"
    ].filter(Boolean);
    const semesterLabel = `Semester ${lesson.semester_number} · Week ${lesson.week_number}`;
    const status = document.getElementById("lesson-curriculum-status");
    status.textContent = missing.length
      ? `${semesterLabel} selected. The verified source does not yet contain a linked ${missing.join(", ")}. No unrelated subject-wide entries were substituted.`
      : `${semesterLabel} selected. Strand, sub-strand, focal areas, content standard and learning indicators/outcomes are filtered to this week's verified source.`;
    lessonForm.elements.namedItem("curriculumReference").value = lesson.source_reference || lesson.source_title || "";
    lessonForm.elements.namedItem("curriculumUrl").value = lesson.source_url || "";
    lessonForm.elements.namedItem("curriculumConfirmed").value = "administrator_verified";
  }

  async function loadLessonCurriculum() {
    const yearMatch = String(lessonYearSelect.value || "").match(/([123])$/);
    const subject = lessonSubjectSelect.value.trim();
    const status = document.getElementById("lesson-curriculum-status");
    const weekSelect = lessonForm.elements.namedItem("week");
    lessonStructureController?.abort();
    lessonWeeklyLessons = [];
    weekSelect.replaceChildren(new Option("Choose a verified teaching week", ""));
    weekSelect.disabled = true;
    closeLessonWeekPicker();
    syncLessonWeekPicker();
    populateLessonEntrySelects([]);
    if (!yearMatch || subject.length < 2) {
      status.textContent = "Choose an SHS year and subject to load curriculum content.";
      status.removeAttribute("aria-busy");
      return;
    }
    const yearGroup = `SHS${yearMatch[1]}`;
    lessonStructureController = new AbortController();
    const controller = lessonStructureController;
    status.textContent = `Loading verified weekly ${subject} allocations for ${yearGroup}…`;
    status.setAttribute("aria-busy", "true");
    for (const name of Object.keys(lessonEntryFields)) lessonForm.elements.namedItem(name).disabled = true;
    try {
      const query = new URLSearchParams({ year_group: yearGroup, subject, include_structure: "1" });
      const response = await fetch(`${appBase}/api/curriculum/weekly-lessons?${query}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Verified weekly curriculum allocations could not be loaded.");
      if (!Array.isArray(result.lessons)) throw new Error("Verified weekly curriculum allocations returned an invalid response.");
      if (controller.signal.aborted) return;
      lessonWeeklyLessons = result.lessons;
    } catch (error) {
      if (error?.name === "AbortError") return;
      status.textContent = error instanceof Error ? error.message : "Verified weekly curriculum allocations could not be loaded.";
      status.removeAttribute("aria-busy");
      showToast(status.textContent, "error");
      for (const name of Object.keys(lessonEntryFields)) lessonForm.elements.namedItem(name).disabled = false;
      return;
    } finally {
      if (lessonStructureController === controller) lessonStructureController = null;
    }
    for (const name of Object.keys(lessonEntryFields)) lessonForm.elements.namedItem(name).disabled = false;
    for (const lesson of lessonWeeklyLessons) {
      const value = `${lesson.semester_number}:${lesson.week_number}`;
      const option = new Option(
        `Semester ${lesson.semester_number} · Week ${lesson.week_number} — ${lesson.topic}`,
        value
      );
      option.dataset.weeklyLessonId = String(lesson.id);
      weekSelect.add(option);
    }
    weekSelect.disabled = lessonWeeklyLessons.length === 0;
    syncLessonWeekPicker();
    status.removeAttribute("aria-busy");
    status.textContent = lessonWeeklyLessons.length
      ? `${lessonWeeklyLessons.length} verified weekly allocations loaded for ${subject} · ${yearGroup}. Choose a week to populate only its associated curriculum content.`
      : `No verified weekly allocations were found for ${subject} in ${yearGroup}. Verify that the matching resource has weekly lessons and is enabled in the admin resource library.`;
  }
  function selectedLessonEntry(fieldName) {
    const select = lessonForm.elements.namedItem(fieldName);
    const value = select.multiple ? select.selectedOptions[0]?.value : select.value;
    return verifiedCurriculumEntries.get(value) || null;
  }

  function selectedLessonEntries(fieldName) {
    const select = lessonForm.elements.namedItem(fieldName);
    const values = select.multiple
      ? Array.from(select.selectedOptions, (option) => option.value)
      : [select.value];
    return values.map((value) => verifiedCurriculumEntries.get(value)).filter(Boolean);
  }

  function lessonFormValues() {
    const values = formData(lessonForm);
    values.resources = Array.from(lessonForm.elements.namedItem("resources").selectedOptions, (option) => option.textContent.trim())
      .filter(Boolean)
      .join("; ");
    values.classNames = Array.from(selectedLessonClasses, (id) =>
      teacherAssessmentClasses.find((item) => String(item.id) === id)?.name
    ).filter(Boolean);
    values.className = values.classNames.join(", ");
    for (const fieldName of Object.keys(lessonEntryFields)) {
      const entries = selectedLessonEntries(fieldName);
      const selectedText = fieldName === "standard"
        ? lessonStandardAssignments(entries)
        : entries.map((entry) => selectEntryText(entry, fieldName === "indicator"));
      values[fieldName] = selectedText.join(fieldName === "indicator" ? "\n" : "; ");
      values.curriculumEntryIds ||= {};
      values.curriculumEntryIds[fieldName] = entries.map((entry) => String(entry.id));
      if (fieldName === "indicator") {
        values.indicators = entries
          .filter((entry) => ["learning_indicator", "learning_objective"].includes(lessonEntryType(entry)))
          .map((entry) => selectEntryText(entry, true));
        values.learningOutcomes = entries
          .filter((entry) => lessonEntryType(entry) === "learning_outcome")
          .map((entry) => selectEntryText(entry, true));
      }
      if (fieldName === "focalArea") values.focalAreas = selectedText;
    }
    const week = selectedLessonWeek();
    values.week = week ? `Semester ${week.semester_number} · Week ${week.week_number}` : "";
    values.semesterNumber = week?.semester_number || null;
    values.weekNumber = week?.week_number || null;
    values.week_label = values.week;
    values.semester_number = values.semesterNumber;
    values.week_number = values.weekNumber;
    values.lessonCount = Number(values.lessonCount) || 1;
    values.number_of_lessons = values.lessonCount;
    values.focal_areas = values.focalAreas || [];
    values.learning_indicators = values.indicators || [];
    values.learning_outcomes = values.learningOutcomes || [];
    const reference = week || selectedLessonEntry("indicator") || selectedLessonEntry("topic");
    values.curriculumReference = reference?.source_reference || reference?.document_title || "";
    values.curriculumUrl = reference?.source_url || "";
    values.curriculumConfirmed = reference ? "administrator_verified" : "";
    return values;
  }

  lessonYearSelect.addEventListener("change", () => {
    updateClassOptions();
    loadLessonCurriculum();
  });
  lessonSubjectSelect.addEventListener("input", () => {
    const query = lessonSubjectSelect.value.trim().toLocaleLowerCase();
    const isKnownSubject = Array.from(lessonSubjectOptions.options)
      .some((option) => option.value.toLocaleLowerCase() === query);
    lessonSubjectSelect.setCustomValidity(query && !isKnownSubject ? "Choose a subject from the suggestions." : "");
  });
  lessonSubjectSelect.addEventListener("change", () => {
    const selected = Array.from(lessonSubjectOptions.options).find(
      (option) => option.value.toLocaleLowerCase() === lessonSubjectSelect.value.trim().toLocaleLowerCase()
    );
    if (!selected) {
      lessonSubjectSelect.setCustomValidity("Choose a subject from the suggestions.");
      return;
    }
    lessonSubjectSelect.value = selected.value;
    lessonSubjectSelect.setCustomValidity("");
    loadLessonCurriculum();
  });
  lessonWeekSelect.addEventListener("change", () => {
    lessonWeekTrigger.removeAttribute("aria-invalid");
    syncLessonWeekPicker();
    applySelectedLessonWeek();
  });
  lessonForm.elements.namedItem("topic").addEventListener("change", () => {
    const entry = selectedLessonEntry("topic");
    if (entry) {
      lessonForm.elements.namedItem("curriculumReference").value = entry.source_reference || entry.document_title || "";
      lessonForm.elements.namedItem("curriculumUrl").value = entry.source_url || "";
    }
  });
  lessonForm.elements.namedItem("indicator").addEventListener("change", () => {
    const entry = selectedLessonEntry("indicator");
    if (entry) {
      lessonForm.elements.namedItem("curriculumReference").value = entry.source_reference || entry.document_title || "";
      lessonForm.elements.namedItem("curriculumUrl").value = entry.source_url || "";
      lessonForm.elements.namedItem("curriculumConfirmed").value = "administrator_verified";
    }
  });
  lessonForm.elements.namedItem("focalArea").addEventListener("change", () => {
    const entries = Array.from(verifiedCurriculumEntries.values());
    const relevantStandards = new Set(selectedStandardEntries(entries).map((entry) => String(entry.id)));
    for (const option of lessonStandardSelect.options) option.selected = relevantStandards.has(option.value);
    updateLessonStandardPreview();
  });
  document.getElementById("lesson-new-button").addEventListener("click", () => {
    if (!lessonSubjectOptions.options.length) {
      showToast("The Ghana SHS subject list is still loading. Please try again shortly.", "error");
      return;
    }
    lessonForm.reset();
    lessonSubjectSelect.setCustomValidity("");
    renderLessonChoiceBadges("resources");
    lessonWeeklyLessons = [];
    const lessonWeekSelect = lessonForm.elements.namedItem("week");
    lessonWeekSelect.replaceChildren(new Option("Choose a verified teaching week", ""));
    lessonWeekSelect.disabled = true;
    closeLessonWeekPicker();
    syncLessonWeekPicker();
    selectedLessonClasses.clear();
    renderedLessonClassYear = "";
    lessonForm.elements.namedItem("duration").value = "60";
    lessonForm.elements.namedItem("school").value = profile.school || "";
    if (profile.primary_subject && Array.from(lessonSubjectOptions.options).some((option) => option.value === profile.primary_subject)) {
      lessonSubjectSelect.value = profile.primary_subject;
    }
    updateClassOptions();
    const currentYear = new Date().getFullYear();
    const academicYear = lessonForm.elements.namedItem("academicYear");
    academicYear.value = `${currentYear}/${currentYear + 1}`;
    populateLessonEntrySelects([]);
    if (lessonYearSelect.value && lessonSubjectSelect.value) loadLessonCurriculum();
    else document.getElementById("lesson-curriculum-status").textContent = "Choose an SHS year and subject to load curriculum content.";
    showLessonStep(0);
    lessonDialog.showModal();
  });
  document.getElementById("lesson-step-next").addEventListener("click", () => {
    if (validateLessonStep(currentLessonStep)) showLessonStep(currentLessonStep + 1);
  });
  document.getElementById("lesson-step-back").addEventListener("click", () => showLessonStep(currentLessonStep - 1));
  document.querySelector("[data-close-lesson-wizard]").addEventListener("click", () => lessonDialog.close());
  lessonDialog.addEventListener("click", (event) => {
    if (event.target === lessonDialog) lessonDialog.close();
  });
  fetch(`${appBase}/api/workspace`, { credentials: "same-origin", headers: { "Accept": "application/json" } })
    .then(async (response) => {
      if (response.status === 401) {
        window.location.replace(`${appBase}/login`);
        return null;
      }
      const result = await response.json();
      if (!response.ok) {
        const reference = result.request_id ? ` (Reference: ${result.request_id})` : "";
        throw new Error(`${result.error || "Your workspace could not be loaded."}${reference}`);
      }
      return result;
    })
    .then((result) => {
      if (!result?.user?.id) throw new Error("The signed-in workspace could not be loaded.");
      documents = result.documents || [];
      schedule = result.schedule || [];
      profile = result.profile || {};
      workspaceUserEmail = result.user.email || "";
      credits = result.credits || null;
      aiProviderConfigured = Boolean(result.ai_provider?.configured && result.ai_provider?.api_key_usable);
      window.akademiCsrfToken = result.csrf_token || "";
      const userRoles = result.user?.roles || [];
      window.akademiUserRoles = userRoles;
      window.akademiUserId = Number(result.user.id);
      if (userRoles.includes("admin") || userRoles.includes("superadmin")) {
        document.querySelectorAll(".admin-only").forEach((item) => item.classList.remove("hidden"));
      }
      if (userRoles.includes("superadmin")) {
        document.querySelectorAll(".superadmin-only").forEach((item) => item.classList.remove("hidden"));
      }
      document.documentElement.classList.remove("auth-loading");
      document.getElementById("auth-loading-message")?.remove();
      renderAll();
      updateCreditDisplay();
      const aiNotice = document.getElementById("ai-provider-notice");
      const aiNoticeDismissedKey = `akademi-ai-notice-dismissed:${result.user.id}`;
      if (aiProviderConfigured) {
        try {
          localStorage.removeItem(aiNoticeDismissedKey);
        } catch (error) {
          console.warn("AI notice preference could not be cleared from local storage.", error);
        }
        aiNotice.hidden = true;
      } else {
        try {
          aiNotice.hidden = localStorage.getItem(aiNoticeDismissedKey) === "1";
        } catch (error) {
          console.warn("AI notice preference could not be read from local storage.", error);
          aiNotice.hidden = false;
        }
      }
      markSynced();
    })
    .catch((error) => {
      console.error("Could not load authenticated workspace", error);
      document.documentElement.classList.remove("auth-loading");
      document.getElementById("auth-loading-message")?.remove();
      document.getElementById("sync-state").textContent = "Sync unavailable";
      showToast(error instanceof Error ? error.message : "Your workspace could not be synchronized. Try refreshing.", "error");
    });

  async function buildSchemeTemplate(values, button) {
    const subject = String(values.subject || "").trim();
    const yearMatch = String(values.year || "").match(/([123])$/);
    const yearGroup = yearMatch ? `SHS${yearMatch[1]}` : "";
    const academicYear = String(values.academicYear || "").trim();
    const semesterNumber = values.schemePeriod === "semester" ? Number(values.termNumber) : null;
    const requiredStartSemesters = semesterNumber ? [semesterNumber] : [1, 2];
    const missingStartSemester = requiredStartSemesters.find((semester) =>
      !String(semester === 1 ? values.semester1Start || "" : values.semester2Start || "")
    );
    if (!subject || !academicYear || !yearGroup) {
      showFormStep("scheme", 0);
      const invalidField = !subject
        ? schemeSubjectSelect
        : document.querySelector('#scheme-form [name="academicYear"]');
      invalidField.reportValidity();
      invalidField.focus();
      showToast("Choose a subject and enter an academic year before creating the scheme.", "error");
      return;
    }
    if (!String(values.hodName || "").trim()) {
      showFormStep("scheme", 1);
      const hodField = document.querySelector('#scheme-form [name="hodName"]');
      hodField.reportValidity();
      hodField.focus();
      showToast("Enter the Head of Department’s name before creating the scheme.", "error");
      return;
    }
    if (missingStartSemester) {
      showFormStep("scheme", 1);
      const startField = document.querySelector(`#scheme-form [name="semester${missingStartSemester}Start"]`);
      startField.reportValidity();
      startField.focus();
      showToast(`Choose the first teaching day for Semester ${missingStartSemester}.`, "error");
      return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Scanning verified curriculum…";
    try {
      const weeklyParams = new URLSearchParams({ subject, year_group: yearGroup });
      if (semesterNumber) weeklyParams.set("semester", String(semesterNumber));
      weeklyParams.set("include_structure", "1");
      const warnings = [];
      let weeklyLessons = [];
      try {
        const weeklyResult = await workspaceRequest(`/api/curriculum/weekly-lessons?${weeklyParams}`);
        weeklyLessons = Array.isArray(weeklyResult.lessons) ? weeklyResult.lessons : [];
      } catch (error) {
        warnings.push(`Verified weekly lesson autofill is unavailable: ${error instanceof Error ? error.message : "curriculum lessons could not be loaded."}`);
      }

      const unique = (items) => [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
      const topicOptions = unique(weeklyLessons.map((lesson) => lesson.topic));
      if (!topicOptions.length && !warnings.length) {
        warnings.push("No explicit week-by-week topics were found in verified resources for this subject and SHS year. General curriculum text, strands and focal areas are intentionally excluded. Ask an administrator to verify a matching teacher manual, or enter topics using “Other…”.");
      }

      const formativeAssessment = (topic) =>
        `Suggested formative check: class exercise and learner explanation on ${topic}.`;
      const sourceCurriculumScope = (lesson) => {
        const entries = Array.isArray(lesson?.curriculum_entries) ? lesson.curriculum_entries : [];
        return ["strand", "sub_strand", "content_standard"].flatMap((type) =>
          [...new Set(entries
            .filter((entry) => String(entry.section_type || "").toLowerCase() === type)
            .map((entry) => String(entry.title || "").trim())
            .filter(Boolean))]
            .map((title) => `${type === "sub_strand" ? "Sub-strand" : type === "content_standard" ? "Content standard" : "Strand"}: ${title}`)
        );
      };
      const weekStartDate = (semester) => semester === 1
        ? String(values.semester1Start || "")
        : String(values.semester2Start || "");
      const formatDate = (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
      const semesterWeeks = (semester, overallWeekOffset) => {
        const semesterLessons = weeklyLessons.filter((lesson) =>
          Number(lesson.semester_number) === semester
        );
        const sourceWeekNumbers = semesterLessons
          .map((lesson) => Number(lesson.week_number))
          .filter((week) => Number.isInteger(week) && week > 0 && week <= 52);
        const teachingWeeksPerSemester = sourceWeekNumbers.length
          ? Math.max(...sourceWeekNumbers)
          : 12;
        if (!sourceWeekNumbers.length) {
          warnings.push(`No verified weekly allocations were found for Semester ${semester}; 12 editable teaching weeks are shown as a provisional starting point.`);
        }
        const start = new Date(`${weekStartDate(semester)}T00:00:00`);
        const weeks = [];
        let scheduledWeek = 0;
        const pushWeek = (kind, topic, assessmentSchedule, match = null) => {
          scheduledWeek += 1;
          const weekDate = new Date(start);
          weekDate.setDate(weekDate.getDate() + 6 + ((scheduledWeek - 1) * 7));
          const ending = weekStartDate(semester) ? formatDate(weekDate) : "";
          weeks.push({
            semester: `Semester ${semester}`,
            semester_number: semester,
            week: overallWeekOffset + scheduledWeek,
            week_in_semester: scheduledWeek,
            week_kind: kind,
            week_ending: ending,
            topic,
            focal_areas: Array.isArray(match?.focal_areas) ? match.focal_areas : [],
            curriculum_scope: sourceCurriculumScope(match),
            learning_indicators: Array.isArray(match?.learning_indicators) ? match.learning_indicators : [],
            learning_outcomes: Array.isArray(match?.learning_outcomes) ? match.learning_outcomes : [],
            assessment_schedule: assessmentSchedule,
            resources: [],
            activities: "",
            assessment: assessmentSchedule
          });
        };
        const midSemesterAfter = Math.ceil(teachingWeeksPerSemester / 2);
        for (let weekNumber = 1; weekNumber <= teachingWeeksPerSemester; weekNumber += 1) {
          const match = semesterLessons.find((lesson) =>
            Number(lesson.week_number) === weekNumber
          );
          const topic = match?.topic || "";
          const assessmentSchedule = match?.assessment_mode
            || (topic ? formativeAssessment(topic) : "Suggested formative check: short written or oral review of the selected topic.");
          pushWeek("teaching", topic, assessmentSchedule, match);
          if (weekNumber === midSemesterAfter) {
            pushWeek("mid_semester", "Mid-Semester Examination", "Mid-semester examination.");
          }
        }
        pushWeek("revision", "Revision Week", "Revision exercises and review of semester topics.");
        pushWeek("end_semester", "End of Semester Examination", "End-of-semester examination.");
        return weeks;
      };
      const weeks = semesterNumber
        ? semesterWeeks(semesterNumber, 0)
        : (() => {
            const firstSemester = semesterWeeks(1, 0);
            return [...firstSemester, ...semesterWeeks(2, firstSemester.length)];
          })();
      const weekCount = weeks.length;
      const semesterTeachingCounts = semesterNumber
        ? [weeks.filter((week) => week.week_kind === "teaching").length]
        : [1, 2].map((semester) => weeks.filter((week) =>
            week.semester_number === semester && week.week_kind === "teaching"
          ).length);
      const sourceMap = new Map();
      weeklyLessons.filter((lesson) => lesson.source_title).forEach((lesson) => {
        const key = `${lesson.document_id}:${lesson.source_title}`;
        if (!sourceMap.has(key)) {
          sourceMap.set(key, {
            document_id: Number(lesson.document_id),
            title: lesson.source_title,
            source_reference: lesson.source_reference || "",
            source_url: lesson.source_url || "",
            pages: [],
            ai_extracted: false
          });
        }
        const source = sourceMap.get(key);
        if (lesson.source_page && !source.pages.includes(Number(lesson.source_page))) {
          source.pages.push(Number(lesson.source_page));
        }
        source.ai_extracted = source.ai_extracted || Boolean(lesson.ai_generated);
      });
      const sources = [...sourceMap.values()];
      const coverage = semesterNumber
        ? `Semester ${semesterNumber} · ${weekCount} scheduled weeks`
        : `Full year · ${weekCount} scheduled weeks`;
      const title = `${subject} · ${coverage} · ${academicYear}`;
      const draft = {
        title,
        scheme_period: semesterNumber ? "semester" : "full_year",
        semester_number: semesterNumber,
        hod_name: String(values.hodName || "").trim(),
        created_by: String(profile.name || "").trim(),
        teaching_week_counts: semesterNumber
          ? { [semesterNumber]: semesterTeachingCounts[0] }
          : { 1: semesterTeachingCounts[0], 2: semesterTeachingCounts[1] },
        weeks,
        topic_options: topicOptions,
        weekly_lessons: weeklyLessons,
        curriculum_sources: sources,
        source_warnings: warnings
      };
      const metadata = [
        ["Subject", subject],
        ["SHS year", values.year],
        ["Academic year", academicYear],
        ["Coverage", coverage],
        ["Teaching weeks per semester", semesterTeachingCounts.map((count, index) => `S${semesterNumber || index + 1}: ${count || 12}${count ? "" : " provisional"}`).join(" · ")],
        ["Matched curriculum sources", String(sources.length)]
      ];
      const sourceReferences = sources.length ? ` (${sources.map((source) => [
        source.title,
        source.source_reference,
        source.pages.length ? `p. ${source.pages.sort((left, right) => left - right).join(", ")}` : ""
      ].filter(Boolean).join(" · ")).map(escapeHtml).join("; ")})` : "";
      const sourceDescription = sources.length
        ? `Topics, curriculum links, focal areas, learning targets and any available assessment modes are matched to verified curriculum resources${sourceReferences}. Confirm extracted information against the cited source.`
        : "No verified week-by-week allocations were available for autofill. Enter and verify topics manually.";
      const sourceNote = `<p class="scheme-template-source-note">${sourceDescription} Week-ending dates are calculated from the semester start date you entered; you can edit any date in the table.</p>`;
      const notices = warnings.length
        ? `<div class="notice notice-amber scheme-template-notice"><strong>Curriculum autofill needs attention</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>`
        : "";
      const body = `${notices}${sourceNote}${renderAiContent("scheme", draft, true)}`;
      const html = documentFrame(
        title,
        "SCHEME OF WORK · EDITABLE WEEKLY TEMPLATE",
        metadata,
        body,
        ""
      );
      const region = document.getElementById("scheme-output");
      region.innerHTML = html;
      const fitSchemeTextareas = () => {
        region.querySelectorAll(".scheme-fill-table textarea").forEach((textarea) => {
          textarea.style.height = "auto";
          textarea.style.height = `${Math.max(textarea.scrollHeight + 4, 68)}px`;
        });
      };
      fitSchemeTextareas();
      region.addEventListener("change", (event) => {
        if (event.target.matches("[data-scheme-topic-picker]")) requestAnimationFrame(fitSchemeTextareas);
      });
      region.scrollIntoView({ behavior: "smooth", block: "start" });
      planningDialogs.scheme.close();
      const saveButton = region.querySelector('[data-action="save"]');
      const printButton = region.querySelector('[data-action="print"]');
      const makeSchemeData = () => {
        const tableRows = Array.from(region.querySelectorAll("[data-scheme-week]"));
        const savedWeeks = tableRows.map((row) => {
          const value = (field) => row.querySelector(`[data-scheme-field="${field}"]`)?.value.trim() || "";
          const topicSelect = row.querySelector("[data-scheme-topic-picker]")?.value || "";
          const topic = topicSelect === "__mid_semester__"
              ? "Mid-Semester Examination"
              : topicSelect === "__revision__"
                ? "Revision Week"
                : topicSelect === "__end_semester__"
                  ? "End of Semester Examination"
                  : value("topic");
          const weekKind = topicSelect === "__mid_semester__" ? "mid_semester"
            : topicSelect === "__revision__" ? "revision"
              : topicSelect === "__end_semester__" ? "end_semester"
                : "teaching";
          return {
            term: row.dataset.semester,
            semester_number: Number(row.dataset.semesterNumber),
            week: Number(row.dataset.overallWeekNumber),
            week_in_semester: Number(row.dataset.weekNumber),
            week_kind: weekKind,
            week_ending: value("week_ending"),
            topic,
            focal_areas: value("focal_areas").split(/\r?\n/)
              .map((item) => item.replace(/^\s*\d+[.)]\s*/, "").trim())
              .filter(Boolean),
            curriculum_scope: Array.isArray(draft.weeks[Number(row.dataset.schemeWeek)]?.curriculum_scope)
              ? draft.weeks[Number(row.dataset.schemeWeek)].curriculum_scope
              : [],
            learning_indicators: value("learning_indicators").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            learning_outcomes: value("learning_outcomes").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            assessment_schedule: value("assessment_schedule"),
            assessment: value("assessment_schedule"),
            activities: "",
            resources: []
          };
        });
        return {
          subject,
          school: profile.school || "",
          year: values.year,
          year_group: yearGroup,
          academic_year: academicYear,
          scheme_period: semesterNumber ? "semester" : "full_year",
          semester_number: semesterNumber,
          weeks: savedWeeks,
          hod_name: String(values.hodName || "").trim(),
          created_by: String(profile.name || "").trim(),
          curriculum_sources: sources,
          source_warnings: warnings
        };
      };
      printButton.textContent = "Preview completed scheme";
      printButton.dataset.action = "scheme-preview";
      const previewDialog = document.createElement("dialog");
      previewDialog.className = "scheme-preview-dialog";
      region.append(previewDialog);
      const schemeExportPayload = (schemeData) => {
        const headers = ["Week", "Week Ending", "Topic", "Focal Areas", "Learning Indicators", "Learning Outcomes", "Assessment Schedule"];
        const tableRows = [headers];
        const weekKinds = [null];
        const semesterNumbers = [null];
        let previousSemester = null;
        schemeData.weeks.forEach((week) => {
          if (schemeData.scheme_period === "full_year" && week.semester_number !== previousSemester) {
            tableRows.push([`Semester ${week.semester_number}`, "", "", "", "", "", ""]);
            weekKinds.push("semester");
            semesterNumbers.push(week.semester_number);
          }
          previousSemester = week.semester_number;
          tableRows.push([
            `Semester ${week.semester_number} · Week ${week.week_in_semester}`,
            week.week_ending,
            week.topic,
            week.focal_areas.join("\n"),
            week.learning_indicators.join("\n"),
            week.learning_outcomes.join("\n"),
            week.assessment_schedule
          ]);
          weekKinds.push(week.week_kind || "teaching");
          semesterNumbers.push(week.semester_number);
        });
        return {
          title,
          subject,
          school: profile.school || "",
          year: values.year,
          academic_year: academicYear,
          teacherName: schemeData.created_by || "Teacher",
          hodName: schemeData.hod_name,
          schemeExport: true,
          scheduleTable: true,
          tableRows,
          weekKinds,
          semesterNumbers,
          blocks: [
            { text: [profile.school, subject, values.year, academicYear].filter(Boolean).join("  |  ") },
            { type: "table", rows: tableRows, rowKinds: weekKinds },
            { text: "Sign-off", style: "Heading1" },
            { type: "table", rows: [
              ["Role", "Name", "Signature", "Date"],
              ["Prepared by", schemeData.created_by || "Teacher", "________________________", "________________"],
              ["Reviewed by · HOD", schemeData.hod_name, "________________________", "________________"]
            ], rowKinds: [null, null, null] }
          ]
        };
      };
      printButton.addEventListener("click", () => {
        const invalid = region.querySelector(".scheme-fill-table :invalid");
        if (invalid) {
          invalid.reportValidity();
          invalid.focus();
          return;
        }
        const schemeData = makeSchemeData();
        if (schemeData.weeks.some((week) => !week.topic)) {
          showToast("Choose a topic or enter an Other topic for every teaching week before previewing.", "error");
          return;
        }
        previewDialog.innerHTML = `<div class="scheme-preview-heading"><div><span class="auth-kicker">COMPLETED SCHEME PREVIEW</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(profile.school || "Teacher workspace")}</p></div><button type="button" class="resource-preview-close" data-close-scheme-preview aria-label="Close scheme preview">&times;</button></div><div class="scheme-preview-body"><div class="document-meta">${metadata.map(([label, value]) => `<div class="meta-box"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "—")}</strong></div>`).join("")}</div>${renderAiContent("scheme", { ...draft, weeks: schemeData.weeks, hod_name: schemeData.hod_name, created_by: schemeData.created_by }, false)}<p class="scheme-template-source-note">Verify all entries against the official source and school calendar before use.</p></div><div class="scheme-preview-actions"><button type="button" class="small-button" data-scheme-export="pdf">Export PDF</button><button type="button" class="small-button" data-scheme-export="docx">Export DOCX</button><button type="button" class="auth-secondary compact-button" data-scheme-save>Save completed scheme</button></div>`;
        previewDialog.showModal();
      });
      previewDialog.addEventListener("click", (event) => {
        if (event.target.closest("[data-close-scheme-preview]")) {
          previewDialog.close();
          return;
        }
        const exportButton = event.target.closest("[data-scheme-export]");
        if (exportButton) {
          try {
            if (!window.akademiAssessmentExport) throw new Error("The export tools are unavailable. Refresh and try again.");
            window.akademiAssessmentExport.download(schemeExportPayload(makeSchemeData()), exportButton.dataset.schemeExport);
            showToast(`${exportButton.dataset.schemeExport.toUpperCase()} download started.`);
          } catch (error) {
            showToast(error instanceof Error ? error.message : "The scheme could not be exported.", "error");
          }
          return;
        }
        if (event.target.closest("[data-scheme-save]")) {
          previewDialog.close();
          saveButton.click();
        }
      });
      region.onclick = (event) => {
        const option = event.target.closest("[data-scheme-topic-option]");
        if (!option) return;
        const row = option.closest("[data-scheme-week]");
        const topicSelect = row?.querySelector("[data-scheme-topic-picker]");
        if (!row || !topicSelect) return;
        topicSelect.value = option.dataset.schemeTopicOption;
        option.closest(".scheme-topic-picker").open = false;
        option.closest(".scheme-topic-picker").querySelectorAll("[data-scheme-topic-option]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === option));
        });
        option.closest(".scheme-topic-picker").querySelector("summary").textContent = option.textContent.trim();
        topicSelect.dispatchEvent(new Event("change", { bubbles: true }));
      };
      region.onchange = (event) => {
        const topicSelect = event.target.closest("[data-scheme-topic-picker]");
        if (!topicSelect) return;
        const row = topicSelect.closest("[data-scheme-week]");
        const topic = row.querySelector('[data-scheme-field="topic"]');
        const focalAreas = row.querySelector('[data-scheme-field="focal_areas"]');
        const assessment = row.querySelector('[data-scheme-field="assessment_schedule"]');
        const weekKind = topicSelect.value === "__mid_semester__" ? "mid_semester"
          : topicSelect.value === "__revision__" ? "revision"
            : topicSelect.value === "__end_semester__" ? "end_semester"
              : "teaching";
        row.dataset.weekKind = weekKind;
        row.className = `scheme-week-row scheme-week-${weekKind}`;
        const isOther = topicSelect.value === "__other__";
        if (isOther) {
          topic.value = "";
          focalAreas.value = "";
          assessment.value = "";
          topic.focus();
          return;
        }
        if (topicSelect.value === "__mid_semester__") {
          topic.value = "Mid-Semester Examination";
          focalAreas.value = "";
          assessment.value = "Mid-Semester Examination";
          return;
        }
        if (topicSelect.value === "__revision__") {
          topic.value = "Revision Week";
          focalAreas.value = "";
          assessment.value = "Revision exercises and review of semester topics.";
          return;
        }
        if (topicSelect.value === "__end_semester__") {
          topic.value = "End of Semester Examination";
          focalAreas.value = "";
          assessment.value = "End of Semester Examination";
          return;
        }
        topic.value = topicSelect.value;
        const semester = Number(row.dataset.semesterNumber);
        const week = Number(row.dataset.weekNumber);
        const lesson = weeklyLessons.find((item) =>
          item.topic === topicSelect.value
          && Number(item.semester_number) === semester
          && Number(item.week_number) === week
        ) || weeklyLessons.find((item) =>
          item.topic === topicSelect.value && Number(item.semester_number) === semester
        ) || (semesterNumber ? weeklyLessons.find((item) =>
          item.topic === topicSelect.value && item.semester_number == null
        ) : null);
        focalAreas.value = Array.isArray(lesson?.focal_areas)
          ? lesson.focal_areas.map((area, index) => `${index + 1}. ${area}`).join("\n")
          : "";
        assessment.value = lesson?.assessment_mode || formativeAssessment(topicSelect.value);
      };
      region.addEventListener("input", (event) => {
        if (event.target.matches(".scheme-fill-table textarea")) {
          event.target.style.height = "auto";
          event.target.style.height = `${Math.max(event.target.scrollHeight + 4, 68)}px`;
        }
        const topic = event.target.closest('[data-scheme-field="topic"]');
        if (!topic || !topic.value.trim()) return;
        const row = topic.closest("[data-scheme-week]");
        const assessment = row.querySelector('[data-scheme-field="assessment_schedule"]');
        if (!assessment.value || assessment.value.startsWith("Suggested formative check:")) {
          assessment.value = formativeAssessment(topic.value.trim());
        }
      });
      saveButton.textContent = "Save completed scheme";
      saveButton.addEventListener("click", async () => {
        const invalid = region.querySelector(".scheme-fill-table :invalid");
        if (invalid) {
          invalid.reportValidity();
          invalid.focus();
          return;
        }
        const schemeData = makeSchemeData();
        if (schemeData.weeks.some((week) => !week.topic)) {
          showToast("Choose a topic or enter an Other topic for every teaching week before saving.", "error");
          return;
        }
        saveButton.disabled = true;
        saveButton.textContent = "Saving scheme…";
        try {
          const savedHtml = documentFrame(
            title,
            "SCHEME OF WORK · TEACHER-REVIEW TEMPLATE",
            metadata,
            renderAiContent("scheme", { ...draft, weeks: schemeData.weeks }, false),
            ""
          );
          const saved = await saveDocument("scheme", title, schemeData, savedHtml);
          region.innerHTML = saved.html;
          bindOutputActions(region, {
            type: "scheme",
            title,
            data: saved.data,
            html: saved.html,
            alreadySaved: true,
            documentId: saved.id
          });
          showToast("Scheme saved to your workspace.");
        } catch (error) {
          saveButton.disabled = false;
          saveButton.textContent = "Save completed scheme";
          showToast(error instanceof Error ? error.message : "The scheme could not be saved.", "error");
        }
      });
      if (warnings.length) showToast(warnings[0], "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-ai-generate], [data-scheme-build]");
    if (!button) return;
    const type = button.dataset.aiGenerate || (button.matches("[data-scheme-build]") ? "scheme" : "");
    if (type === "scheme") {
      const form = document.getElementById("scheme-form");
      if (!form) return;
      try {
        await buildSchemeTemplate(formData(form), button);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The scheme template could not be created.", "error");
      }
      return;
    }
    const form = document.getElementById(`${type}-form`);
    if (!form || (type !== "lesson" && !form.reportValidity())) return;
    if (type === "lesson" && !validateLessonForm(form)) return;
    if (type === "assessment" && !validateAssessmentSelections()) return;
    let aiStatus = null;
    try {
      aiStatus = await workspaceRequest("/api/ai/status");
      const providerStatus = aiStatus.ai_provider;
      aiProviderConfigured = Boolean(providerStatus?.configured && providerStatus?.api_key_usable);
      credits = aiStatus.credits || null;
      updateCreditDisplay();
      if (!aiProviderConfigured) {
        const message = providerStatus?.api_key_configured
          ? "The saved AI provider key cannot be decrypted with this server’s current APP_KEY. A Super Admin can replace it with a new provider key in Platform settings; restoring the previous APP_KEY is not required."
          : "AI drafting is not configured. Ask your Super Admin to add and test a provider key in Platform settings.";
        showToast(message, "error");
        return;
      }
    } catch (error) {
      showToast(error instanceof Error ? `AI provider status could not be checked: ${error.message}` : "AI provider status could not be checked.", "error");
      return;
    }
    const values = type === "lesson" ? lessonFormValues() : formData(form);
    const yearMatch = String(values.year || "").match(/([123])$/);
    const input = {
      type,
      year_group: yearMatch ? `SHS${yearMatch[1]}` : "",
      subject: values.subject || "",
      class_name: values.className || "",
      teacher_instructions: values.instructions || ""
    };
    if (type === "lesson") {
      Object.assign(input, {
        topic: values.topic,
        strand: values.strand,
        sub_strand: values.substrand,
        focal_area: values.focalArea,
        focal_areas: values.focalAreas || [],
        content_standard: values.standard,
        learning_indicators: values.indicators || [],
        learning_outcomes: values.learningOutcomes || [],
        learners: String(values.learners || "").trim(),
        number_of_learners: String(values.learners || "").trim(),
        week_label: values.week,
        semester_number: values.semesterNumber,
        week_number: values.weekNumber,
        curriculum_reference: values.curriculumReference,
        curriculum_entry_ids: values.curriculumEntryIds,
        duration_minutes: Number(values.duration),
        number_of_lessons: Number(values.lessonCount),
        academic_year: values.academicYear,
        teacher_instructions: [
          values.week && `Teaching week: ${values.week}`,
          `Create exactly ${values.lessonCount} distinct lesson plans for this teaching week. All lessons share the selected verified focal areas and curriculum targets, but each lesson must have its own objective-aligned sequence, formative checks and assessment.`,
          values.learners && `Class size: ${values.learners} learners`,
          values.readiness && `Class readiness: ${values.readiness}`,
          values.prior && `Prior knowledge: ${values.prior}`,
          values.resources && `Available resources: ${values.resources}`,
          values.instructions
        ].filter(Boolean).join("\n")
      });
    } else if (type === "assessment") {
      input.delivery_mode = values.deliveryMode === "online" ? "online" : "printed";
      input.security_level = values.securityLevel === "advanced" ? "advanced" : "medium";
      input.question_count = Number(values.questionCount);
      input.duration_minutes = Number(Array.from(assessmentSelections.duration)[0] || 60);
      const selectedWeeklySections = Array.from(document.querySelectorAll('#assessment-week-list input[name="selectedAssessmentWeek"]:checked'))
        .map((checkbox) => JSON.parse(checkbox.dataset.weekSection || "{}"));
      const selectedYears = Array.from(assessmentSelections.year);
      const selectedClasses = teacherAssessmentClasses.filter((item) => selectedAssessmentClassIds.has(Number(item.id)));
      input.curriculum_fallback = true;
      const choices = [
        Array.from(assessmentSelections.assessmentType),
        Array.from(assessmentSelections.questionFormat),
        Array.from(assessmentSelections.duration)
      ];
      const combinations = choices.reduce(
        (items, valuesForDimension) => items.flatMap((item) =>
          valuesForDimension.map((value) => [...item, value])
        ),
        [[]]
      ).map(([assessmentType, questionFormat, duration], index) => ({
        ...input,
        year_group: selectedYears[0],
        year_groups: selectedYears,
        class_name: selectedClasses.map((item) => item.name).join(", "),
        class_ids: selectedClasses.map((item) => Number(item.id)),
        assessment_title: values.title,
        assessment_type: assessmentType,
        question_format: questionFormat,
        other_format: values.otherFormat,
        selected_topic_ids: Array.from(document.querySelectorAll('#assessment-topics-list input[name="selectedTopic"]:checked'), (checkbox) => Number(checkbox.value)),
        selected_week_sections: selectedWeeklySections,
        duration_minutes: Number(duration),
        total_marks: Number(values.marks),
        question_count: Number(values.questionCount),
        topic: values.scope,
        learning_indicators: values.scope,
        teacher_instructions: [
          values.questions && `Teacher prompt: ${values.questions}`,
          values.marking && `Teacher marking notes: ${values.marking}`,
          selectedYears.length && `Use verified curriculum resources from these selected SHS years: ${selectedYears.join(", ")}.`,
          selectedWeeklySections.length && `Use only these selected weekly sections as the assessment scope: ${selectedWeeklySections.map((week) => `${week.year_group}, Term ${week.term || "unspecified"}, Week ${week.week}: ${week.topic || week.learning_focus || "teacher-selected weekly scope"}`).join("; ")}`
        ].filter(Boolean).join("\n"),
        combination_index: index,
        combination_count: choices.reduce((total, choice) => total * choice.length, 1)
      }));
      input.combinations = combinations;
    } else if (type === "scheme") {
      const semesterNumber = Number(values.termNumber) || null;
      Object.assign(input, {
        academic_year: values.academicYear.trim(),
        scheme_period: values.schemePeriod || "full_year",
        semester_number: values.schemePeriod === "semester" ? semesterNumber : null,
        teacher_instructions: values.schemePeriod === "semester"
          ? `Create a scheme for Semester ${semesterNumber} using the number and sequence of verified weekly subject allocations supplied. Add a mid-semester examination after the first half, then revision and end-of-semester examination weeks after teaching. Include source-supported focal areas, indicators, activities, resources and assessment for teaching weeks. Do not invent calendar dates; flag school-calendar details for teacher confirmation.`
          : "Create the full-year scheme from verified curriculum excerpts. Determine each semester's teaching-week span independently from its verified subject allocations, then add a mid-semester examination after the first half, revision and end-of-semester examination after teaching. Include source-supported focal areas, indicators, activities, resources and assessment for teaching weeks. If sources do not specify calendar dates, do not invent them; use week numbers and flag school-calendar details for teacher confirmation."
      });
    } else if (type === "slides") {
      const selectedWeeks = selectedSlideWeeks();
      const manualLines = (name) => lines(values[name]).filter((line) => !slidesGeneratedFields[name].includes(line));
      const templateNames = {
        lesson: "clear lesson sequence",
        inquiry: "inquiry and discovery",
        worked: "worked examples",
        discussion: "discussion and collaboration",
        project: "project-based learning",
        revision: "revision and retrieval practice",
        flipped: "flipped classroom"
      };
      Object.assign(input, {
        topic: values.title,
        selected_week_sections: selectedWeeks.map((week) => ({
          semester_number: week.semester_number,
          week_number: week.week_number,
          topic: week.topic,
          strand: week.strand || slideWeekEntryTitles(week, "strand").join("; "),
          sub_strand: week.sub_strand || slideWeekEntryTitles(week, "sub_strand").join("; "),
          content_standard: week.content_standard || slideWeekEntryTitles(week, "content_standard").join("; "),
          focal_areas: week.focal_areas || [],
          learning_indicators: week.learning_indicators || [],
          learning_outcomes: week.learning_outcomes || [],
          source_title: week.source_title || "",
          source_reference: week.source_reference || "",
          source_page: week.source_page || null
        })),
        presentation_template: values.template || "lesson",
        presentation_visual_theme: values.visualTheme || "modern",
        presentation_outcomes: manualLines("outcomes").join("\n"),
        presentation_indicators: manualLines("indicators").join("\n"),
        teaching_points: manualLines("points").join("\n"),
        presentation_visual_data: values.visualData || "",
        presentation_lecture_notes: values.lectureNotes || "",
        number_of_slides: Number(values.slides),
        teacher_instructions: [
          `Use a ${templateNames[values.template] || templateNames.lesson} structure.`,
          selectedWeeks.length && "Cover every selected weekly section across the presentation; use the selected_week_sections data as the source of the week-by-week scope.",
          values.lectureNotes && "Place the teacher's supplied lecture notes in the private presenter_notes field across the slides. Do not copy presenter notes into student-facing slide content.",
          "Keep the outline editable, age-appropriate, classroom-ready, and grounded in the supplied topics and teacher-editable outcomes, indicators and teaching points. Do not invent official curriculum wording.",
          "Include concise lecture notes in each slide's private presenter_notes field. Incorporate supplied teacher notes, and never place presenter notes in student-facing slide content."
        ].filter(Boolean).join("\n")
      });
    }
    button.disabled = true;
    const originalLabel = button.textContent;
    let generatedSlides = null;
    let generationStage = "preparing the AI request";
    try {
      let generationInputs = [input];
      if (type === "assessment") {
        const combinations = input.combinations;
        generationInputs = combinations;
      }
      const creditCost = Number(aiStatus?.credits?.costs?.[type]);
      if (!Number.isInteger(creditCost) || creditCost < 1 || !Number.isInteger(aiStatus?.credits?.remaining)) {
        showToast("Your AI credit balance could not be verified. Refresh the workspace and try again.", "error");
        return;
      }
      const requiredCredits = creditCost * generationInputs.length;
      if (!aiStatus.quota_exempt && aiStatus.credits.remaining < requiredCredits) {
        showToast(`This request needs ${requiredCredits} AI credits, but you have ${aiStatus.credits.remaining} remaining this month.`, "error");
        return;
      }
      if (type === "assessment") {
        const combinations = generationInputs;
        if (combinations.length > 1 && !(await window.akademiAlert.confirm(
          `Generate ${combinations.length} separate assessment drafts? Each combination uses ${creditCost} AI credits (${requiredCredits} total).`,
          { title: "Generate assessment combinations", confirmText: `Generate ${combinations.length}` }
        ))) return;
      }
      planningDialogs[type]?.close();
      for (const [index, generationInput] of generationInputs.entries()) {
        button.textContent = generationInputs.length > 1
          ? `Generating ${index + 1} of ${generationInputs.length}…`
          : "Generating…";
        const { combination_index: combinationIndex, combination_count: combinationCount, ...requestInput } = generationInput;
        generationStage = "sending the request to the AI provider";
        const response = await fetch(`${appBase}/api/ai/generate`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": window.akademiCsrfToken || ""
          },
          body: JSON.stringify(requestInput)
        });
        generationStage = "reading the AI response";
        const result = await response.json();
        if (!response.ok) {
          const completed = type === "assessment" ? generatedAssessmentVariants.length : 0;
          const prefix = completed ? `${completed} of ${generationInputs.length} combinations were generated. ` : "";
          throw new Error(prefix + (result.error || "AI generation failed."));
        }
        if (type === "slides" && Array.isArray(result.draft?.slides)) {
          generatedSlides = { input: requestInput, draft: result.draft };
        }
        generationStage = "processing the generated response";
        credits = result.credits || credits;
        updateCreditDisplay();
        markSynced();
        if (type === "slides") {
          generationStage = "searching for slide images";
          button.textContent = "Finding relevant images…";
          const imageResult = await enrichPresentationImages(result.draft.slides || [], requestInput.subject || "");
          const imageNotices = [];
          if (imageResult.failed) {
            imageNotices.push(`${imageResult.failed} image search${imageResult.failed === 1 ? "" : "es"} could not reach Wikimedia Commons.`);
          }
          if (imageResult.unavailable) {
            imageNotices.push(`${imageResult.unavailable} slide${imageResult.unavailable === 1 ? "" : "s"} had no suitable openly licensed image match.`);
          }
          result.draft.presentation_image_warning = imageNotices.join(" ");
        }
        generationStage = "rendering the generated content";
        await renderAiDraft(type, requestInput, result.draft, {
          append: type === "assessment" && index > 0,
          combinationIndex,
          combinationCount
        });
      }
      planningDialogs[type]?.close();
      if (type === "lesson") {
        lessonDialog.close();
        document.getElementById("lesson-output").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      console.error(`AI ${type} generation failed while ${generationStage}.`, error);
      if (type === "slides" && generatedSlides) {
        try {
          renderPresentationTextFallback(generatedSlides.input, generatedSlides.draft);
          planningDialogs.slides?.close();
          showToast("Your slides were generated. This browser could not render the full preview, so a text version is shown instead.", "info");
        } catch (fallbackError) {
          console.error("The generated slides could not be displayed in fallback mode.", fallbackError);
          showToast(`Slides were generated but could not be displayed: ${fallbackError instanceof Error ? fallbackError.message : "unknown display error"}`, "error");
        }
      } else {
        const detail = error instanceof Error ? error.message : "Unknown error.";
        showToast(type === "slides"
          ? `Slide generation failed while ${generationStage}: ${detail}`
          : detail, "error");
      }
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

  function renderPresentationTextFallback(input, draft) {
    const region = document.getElementById("slides-output");
    const title = String(draft.title || input.topic || input.subject || "Presentation").trim();
    const slides = draft.slides;
    if (!Array.isArray(slides) || !slides.length) {
      throw new Error("The generated response did not contain any slides.");
    }
    const data = {
      ...input,
      title,
      subject: input.subject || "",
      year_group: input.year_group || "",
      template: input.presentation_template || "lesson",
      visual_theme: input.presentation_visual_theme || "modern",
      number_of_slides: slides.length,
      slides
    };
    const card = document.createElement("article");
    card.className = "output-card";
    const heading = document.createElement("div");
    heading.className = "output-heading";
    const headingCopy = document.createElement("div");
    const headingTitle = document.createElement("h2");
    headingTitle.textContent = title;
    const headingNote = document.createElement("p");
    headingNote.textContent = "Generated slide text is available below. Visual preview could not be rendered in this browser.";
    headingCopy.append(headingTitle, headingNote);
    heading.append(headingCopy);
    const actions = document.createElement("div");
    actions.className = "output-actions";
    const addAction = (label, callback) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "small-button";
      action.textContent = label;
      action.addEventListener("click", callback);
      actions.append(action);
      return action;
    };
    addAction("Present", () => {
      try {
        openPresentationViewer(data, title);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The presentation could not be opened.", "error");
      }
    });
    for (const [format, label] of [["pdf", "Download PDF"], ["pptx", "Download PowerPoint"]]) {
      addAction(label, () => {
        try {
          if (!window.akademiAssessmentExport) throw new Error("Presentation export is unavailable. Refresh and try again.");
          window.akademiAssessmentExport.downloadDocument(
            { type: "slides", title, data, html: card.outerHTML },
            format
          );
        } catch (error) {
          showToast(error instanceof Error ? error.message : `The presentation could not be exported as ${format.toUpperCase()}.`, "error");
        }
      });
    }
    const saveButton = addAction("Save presentation", async () => {
      saveButton.disabled = true;
      try {
        await saveDocument("slides", `${title} · presentation outline`, data, card.outerHTML);
        saveButton.textContent = "Saved";
        showToast("Presentation saved to your workspace.");
      } catch (error) {
        saveButton.disabled = false;
        showToast(error instanceof Error ? error.message : "The presentation could not be saved.", "error");
      }
    });
    heading.append(actions);
    const body = document.createElement("div");
    body.className = "output-body";
    const warning = document.createElement("p");
    warning.className = "notice notice-amber";
    warning.textContent = "Your slide content is safe. Refresh the page before editing visuals or presenting the full design.";
    body.append(warning);
    slides.forEach((slide, index) => {
      const section = document.createElement("section");
      section.className = "presentation-text-fallback";
      const slideTitle = document.createElement("h3");
      slideTitle.textContent = `Slide ${index + 1}: ${String(slide?.title || "Untitled slide")}`;
      section.append(slideTitle);
      const points = document.createElement("ul");
      (Array.isArray(slide?.key_points) ? slide.key_points : []).forEach((point) => {
        if (typeof point !== "string" || !point.trim()) return;
        const item = document.createElement("li");
        item.textContent = point;
        points.append(item);
      });
      if (points.childElementCount) section.append(points);
      if (typeof slide?.activity === "string" && slide.activity.trim()) {
        const activity = document.createElement("p");
        activity.textContent = `Classroom activity: ${slide.activity}`;
        section.append(activity);
      }
      body.append(section);
    });
    card.append(heading, body);
    region.replaceChildren(card);
    try {
      region.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      console.warn("The text-only slide preview could not be scrolled into view.", error);
    }
  }

  async function renderAiDraft(type, input, draft, options = {}) {
    const sourceList = (draft.curriculum_sources || []).map((source) => {
      const sourceUrl = safeSourceUrl(source.source_url);
      const link = sourceUrl
        ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>`
        : "";
      return `<li>${escapeHtml(source.title)}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${link}</li>`;
    }).join("");
    const formatSourceList = (draft.format_sources || []).map((source) => {
      const sourceUrl = safeSourceUrl(source.source_url);
      const link = sourceUrl
        ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>`
        : "";
      return `<li>${escapeHtml(source.title)}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${link}</li>`;
    }).join("");
    const inputSubject = input.subject || "";
    const inputYear = input.year_group || "";
    if (type === "assessment") {
      const inputYears = Array.isArray(input.year_groups) && input.year_groups.length
        ? input.year_groups
        : [inputYear].filter(Boolean);
      const inputYearLabel = inputYears.map((year) => year.replace(/^SHS([123])$/, "SHS Year $1")).join(", ");
      const assessmentTypeLabels = {
        class_exercise: "Class exercise",
        mid_semester: "Mid-semester assessment",
        end_of_semester: "End-of-semester assessment",
        mock: "Mock examination"
      };
      const formatLabels = {
        mixed: "Mixed format",
        mcq: "Multiple choice",
        worked: "Worked / structured problems",
        extended: "Extended answers",
        brief: "Brief answers",
        other: input.other_format || "Other format"
      };
      const combinationLabel = [
        inputYearLabel,
        assessmentTypeLabels[input.assessment_type] || "Assessment",
        formatLabels[input.question_format] || "Teacher-selected format",
        `${input.duration_minutes} min`,
        input.class_name
      ].filter(Boolean).join(" · ");
      const outputTitle = options.combinationCount > 1 ? `${draft.title} · ${combinationLabel}` : draft.title;
      draft.question_revision_counts = Array.isArray(draft.question_revision_counts)
        ? draft.question_revision_counts
        : (draft.questions || []).map(() => 0);
      latestAssessment = {
        input,
        draft,
        combinationLabel,
        ...(options.restoreSavedDocument?.data?.online_assessment_id
          ? { onlineAssessmentId: Number(options.restoreSavedDocument.data.online_assessment_id) }
          : {}),
        ...(options.restoreSavedDocument ? { savedDocument: options.restoreSavedDocument } : {})
      };
      if (!options.append) {
        generatedAssessmentVariants = [];
        resetGeneratedAssessmentOnlineActions();
        onlineAssessmentForm.hidden = false;
        document.getElementById("assessment-publish-title").textContent = "Publish as an online assessment";
        document.getElementById("assessment-output").replaceChildren();
        document.getElementById("generated-assessment-paper-content").replaceChildren();
        document.getElementById("generated-assessment-guide-content").replaceChildren();
        document.getElementById("generated-assessment-details-content").replaceChildren();
      }
      const variantIndex = generatedAssessmentVariants.length;
      generatedAssessmentVariants.push(latestAssessment);
      const averageQuestionSeconds = Math.round(Number(input.duration_minutes) * 60 / Math.max(1, Number(input.question_count) || 1));
      latestAssessment.averageQuestionSeconds = averageQuestionSeconds;
      const formatLabel = input.question_format === "other"
        ? input.other_format
        : ({ mixed: "Mixed format", mcq: "Multiple choice", worked: "Worked / structured problems", extended: "Extended answers", brief: "Brief answers" })[input.question_format] || "Teacher-selected";
      const selectedWeekNames = (input.selected_week_sections || []).map((week) => `${week.term ? `${week.term} · ` : ""}Week ${week.week}${week.topic ? `: ${week.topic}` : week.learning_focus ? `: ${week.learning_focus}` : ""}`);
      const coverage = [...selectedWeekNames, input.scope].filter(Boolean).join("; ") || "Teacher-selected curriculum scope";
      const curriculumOutline = Array.isArray(draft.curriculum_outline) ? draft.curriculum_outline : [];
      const paperQuestions = (draft.questions || []).map((item, index) => {
        return assessmentPaperQuestion(item, index, Number(draft.question_revision_counts[index] || 0), variantIndex);
      }).join("");
      const guideQuestions = (draft.marking_guide || []).map((item, index) => {
        const question = draft.questions[index];
        const mcqAnswer = Array.isArray(question?.options)
          ? `<p><strong>Correct option:</strong> ${String.fromCharCode(65 + Number(question.correct_option))}. ${escapeHtml(question.options[question.correct_option])}</p>`
          : "";
        return `<li class="assessment-question" data-assessment-guide-question="${index}"><div class="assessment-question-heading"><strong>Question ${escapeHtml(item.question_number)}</strong><span>${escapeHtml(item.marks)} marks</span></div><p>${assessmentText(item.expected_response)}</p>${assessmentVisual(question?.visual)}${mcqAnswer}</li>`;
      }).join("");
      const metadata = [
        ["Assessment", assessmentTypeLabels[input.assessment_type] || "Assessment"],
        ["Subject / year", `${inputSubject} · ${inputYearLabel}`],
        ["Class", input.class_name || "Not specified"],
        ["Questions", String(input.question_count)],
        ["Duration", `${input.duration_minutes} minutes`],
        ["Question format", formatLabel],
        ["Average time per question", `${Math.floor(averageQuestionSeconds / 60)} min ${averageQuestionSeconds % 60} sec`],
        ["Total marks", String(draft.total_marks)]
      ];
      const sourceSection = sourceList
        ? `<div class="document-section"><h3>Curriculum sources checked</h3><ul class="ai-citations">${sourceList}</ul></div>`
        : "";
      const formatSourceSection = formatSourceList
        ? `<div class="document-section"><h3>Assessment-format references</h3><ul class="ai-citations">${formatSourceList}</ul></div>`
        : "";
      const detailsHtml = `<section class="assessment-admin-details-section"><h3>Teacher-only assessment details</h3><table class="assessment-admin-details"><tbody>${metadata.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}<tr><th scope="row">Curriculum coverage</th><td>${escapeHtml(coverage)}</td></tr><tr><th scope="row">Instructions</th><td>${escapeHtml(draft.instructions || "")}</td></tr></tbody></table>${curriculumOutline.length ? `<h3>Curriculum outline</h3><ul>${curriculumOutline.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}${sourceSection}${formatSourceSection}</section>`;
      const paperHtml = documentFrame(
        draft.title,
        `${(assessmentTypeLabels[input.assessment_type] || "ASSESSMENT").toUpperCase()} · ORIGINAL AI-GENERATED REVIEW DRAFT`,
        metadata,
        `<div class="assessment-origin-notice"><strong>Original AI practice questions</strong><p>Not copied from a NaCCA or WAEC past-paper bank. Check the official curriculum and examination requirements before use.</p></div><div class="document-section"><h3>Instructions</h3><p>${escapeHtml(draft.instructions)}</p></div><div class="document-section"><h3>Questions</h3><p class="assessment-question-edit-note">Each question can be changed up to five times. For a published online assessment, changes are available only before a learner starts.</p><ol class="assessment-question-list">${paperQuestions}</ol></div>`,
        "Teacher review required. Confirm every question, answer, accessibility and mark total. Do not treat AI-generated items as official examination questions.",
        false,
        true
      );
      const guideHtml = documentFrame(
        `${draft.title} · marking guide`,
        "TEACHER MARKING GUIDE · CONFIDENTIAL REVIEW DRAFT",
        metadata,
        `<div class="document-section"><h3>Question-by-question marking guide</h3><ol class="assessment-question-list">${guideQuestions}</ol></div>${input.teacher_instructions ? `<div class="document-section"><h3>Additional teacher marking notes</h3><p>${escapeHtml(input.teacher_instructions)}</p></div>` : ""}`,
        "Keep this marking guide separate from the student paper. Check answers, method marks and accepted alternatives before use.",
        false,
        true
      );
      const cards = [assessmentPreviewCard(paperHtml), assessmentPreviewCard(guideHtml)];
      const region = document.getElementById("assessment-output");
      if (options.append) region.insertAdjacentHTML("beforeend", `${paperHtml}${guideHtml}`);
      else region.innerHTML = `${paperHtml}${guideHtml}`;
      bindGeneratedAssessmentOpen(region);
      const publishPanel = document.getElementById("assessment-publish-panel");
      const onlineMode = input.delivery_mode === "online";
      const classTab = document.getElementById("generated-tab-class");
      classTab.hidden = false;
      publishPanel.classList.remove("hidden");
      publishPanel.hidden = false;
      if (options.restoreSavedDocument) {
        const alreadyPublished = Boolean(options.restoreSavedDocument.data?.online_assessment_id);
        onlineAssessmentForm.hidden = alreadyPublished;
        if (alreadyPublished) {
          document.getElementById("assessment-publish-title").textContent = "Online assessment published";
          document.getElementById("assessment-publish-result").innerHTML =
            "<p>This assessment is already published. Use Manage class &amp; scores to view its roster and results.</p>";
        } else {
          document.getElementById("assessment-publish-title").textContent = "Publish as an online assessment";
          document.getElementById("assessment-publish-result").replaceChildren();
        }
      } else {
        onlineAssessmentForm.hidden = false;
      }
      const variantField = document.querySelector('#online-assessment-form [name="assessmentVariant"]');
      variantField.replaceChildren(...generatedAssessmentVariants.map((variant, index) =>
        new Option(variant.combinationLabel || `${(variant.input.year_groups || [variant.input.year_group]).join(", ")}`, String(index))
      ));
      variantField.value = String(generatedAssessmentVariants.length - 1);
      renderAssessmentPublishClasses(true);
      syncAssessmentPublishVariant();
      if (!options.append) document.getElementById("assessment-publish-result").replaceChildren();
      document.getElementById("assessment-results").hidden = true;
      latestAssessment.paperCard = cards[0];
      latestAssessment.guideCard = cards[1];
      document.getElementById("generated-assessment-paper-content").append(cards[0]);
      document.getElementById("generated-assessment-guide-content").append(cards[1]);
      document.getElementById("generated-assessment-details-content").insertAdjacentHTML("beforeend", detailsHtml);
      region.innerHTML = `<div class="generated-assessment-notice"><div><strong>${escapeHtml(draft.title)}</strong><p>${generatedAssessmentVariants.length} assessment combination${generatedAssessmentVariants.length === 1 ? "" : "s"} ready to review.</p></div><button type="button" class="small-button" data-open-generated-assessment>Open generated assessment</button></div>`;
      const combinedActions = document.createElement("div");
      combinedActions.className = "assessment-export-actions";
      combinedActions.setAttribute("aria-label", "Export question paper and marking scheme together");
      combinedActions.innerHTML = '<strong>Full assessment</strong><button type="button" class="small-button" data-combined-export="docx">Download DOCX</button><button type="button" class="small-button" data-combined-export="pdf">Download PDF</button><button type="button" class="small-button" data-combined-print>Print full assessment</button>';
      document.getElementById("generated-assessment-paper-content").append(combinedActions);
      const combinedPrintCard = document.createElement("article");
      combinedPrintCard.className = "output-card";
      const combinedBody = document.createElement("div");
      combinedBody.className = "output-body";
      const combinedDom = new DOMParser().parseFromString(`${paperHtml}${guideHtml}`, "text/html");
      combinedBody.innerHTML = Array.from(combinedDom.querySelectorAll(".output-body")).map((node) => node.innerHTML).join('<div class="assessment-print-page-break"></div>');
      latestAssessment.combinedBody = combinedBody;
      combinedPrintCard.append(combinedBody);
      combinedActions.querySelectorAll("[data-combined-export]").forEach((button) => button.addEventListener("click", async () => {
        const combined = { ...exportBase, mode: "combined" };
        button.disabled = true;
        try {
          await window.akademiAssessmentExport.downloadWithLogo(combined, button.dataset.combinedExport);
          showToast(`${button.dataset.combinedExport.toUpperCase()} download started.`);
        } catch (error) {
          showToast(error instanceof Error ? error.message : "The assessment could not be exported.", "error");
        } finally {
          button.disabled = false;
        }
      }));
      combinedActions.querySelector("[data-combined-print]").addEventListener("click", () => printDocument(`${outputTitle} · full assessment`, combinedPrintCard));
      const exportBase = {
        title: draft.title,
        instructions: draft.instructions,
        questions: draft.questions,
        markingGuide: draft.marking_guide,
        additionalNotes: input.teacher_instructions,
        administrator: assessmentAdministratorDetails(),
        _export: {
          subject: input.subject || "",
          yearGroup: input.year_group || "",
          className: input.class_name || "",
          assessmentType: assessmentTypeLabels[input.assessment_type] || "Assessment",
          duration: input.duration_minutes || "",
          totalMarks: draft.total_marks
        }
      };
      const paperActions = {
        type, title: `${draft.title} · question paper`, data: input, html: paperHtml,
        exportContent: { ...exportBase, mode: "paper" }
      };
      bindOutputActions(cards[0], paperActions);
      const guideActions = {
        type, title: `${draft.title} · marking guide`, data: input, html: guideHtml,
        exportContent: { ...exportBase, mode: "guide" }
      };
      bindOutputActions(cards[1], guideActions);
      document.getElementById("generated-assessment-title").textContent = draft.title;
      setGeneratedAssessmentTab("paper");
      if (!generatedAssessmentDialog.open) generatedAssessmentDialog.showModal();
      const combinedContent = Array.from(new DOMParser().parseFromString(`${paperHtml}${guideHtml}`, "text/html").querySelectorAll(".output-body"))
        .map((node) => node.innerHTML).join('<div class="assessment-print-page-break"></div>');
      const savedHtml = `<article class="output-card"><div class="output-heading"><div><h2>Assessment</h2><p>Automatically saved question paper and teacher marking guide</p></div></div><div class="output-body">${combinedContent}</div></article>`;
      const savedData = {
        subject: input.subject,
        year_group: input.year_group,
        year_groups: input.year_groups || [input.year_group],
        class_name: input.class_name || "",
        administrator: assessmentAdministratorDetails(),
        assessment_builder_generated: true,
        assessment_input: {
          delivery_mode: input.delivery_mode,
          assessment_type: input.assessment_type,
          question_format: input.question_format,
          security_level: input.security_level,
          year_groups: input.year_groups || [input.year_group],
          duration_minutes: input.duration_minutes,
          class_ids: input.class_ids || [],
          selected_week_sections: input.selected_week_sections || [],
          total_marks: draft.total_marks,
          instructions: draft.instructions,
          coverage: input.topic || "",
          teacher_instructions: input.teacher_instructions || ""
        },
        assessment_draft: draft,
      };
      latestAssessment.savedData = savedData;
      cards.forEach((card) => {
        const saveButton = card.querySelector('[data-action="save"]');
        if (saveButton) {
          saveButton.disabled = true;
          saveButton.textContent = "Saving assessment…";
        }
      });
      let savedAssessment = null;
      if (options.restoreSavedDocument) {
        savedAssessment = options.restoreSavedDocument;
        latestAssessment.savedDocument = savedAssessment;
        showGeneratedAssessmentDeleteAction(savedAssessment.id);
        const savedActionData = {
          documentId: savedAssessment.id,
          title: savedAssessment.title,
          data: savedAssessment.data,
          html: savedAssessment.html
        };
        Object.assign(paperActions, savedActionData);
        Object.assign(guideActions, savedActionData);
        cards.forEach((card) => {
          const saveButton = card.querySelector('[data-action="save"]');
          if (saveButton) {
            saveButton.textContent = "Saved automatically";
          }
        });
        const onlineAssessmentId = savedAssessment.data?.online_assessment_id;
        if (onlineAssessmentId) {
          showGeneratedAssessmentOnlineActions(
            onlineAssessmentId,
            `${input.subject || outputTitle} · ${friendlyDate(savedAssessment.createdAt)}`
          );
        }
      } else {
        try {
          savedAssessment = await saveDocument("assessment", outputTitle, savedData, savedHtml);
          latestAssessment.savedDocument = savedAssessment;
          showGeneratedAssessmentDeleteAction(savedAssessment.id);
          const savedActionData = {
            documentId: savedAssessment.id,
            title: savedAssessment.title,
            data: savedAssessment.data,
            html: savedAssessment.html
          };
          Object.assign(paperActions, savedActionData);
          Object.assign(guideActions, savedActionData);
          cards.forEach((card) => {
            const saveButton = card.querySelector('[data-action="save"]');
            if (saveButton) {
              saveButton.disabled = false;
              saveButton.textContent = "Saved automatically";
            }
          });
          showToast("Assessment generated and saved to your account.");
        } catch (error) {
          cards.forEach((card) => {
            const saveButton = card.querySelector('[data-action="save"]');
            if (saveButton) {
              saveButton.disabled = false;
              saveButton.textContent = "Save draft";
            }
          });
          showToast(error instanceof Error ? `Assessment generated, but automatic saving failed: ${error.message}` : "Assessment generated, but automatic saving failed.", "error");
        }
      }
      if (onlineMode && !options.restoreSavedDocument) {
        document.getElementById("assessment-publish-title").textContent = "Review and publish online";
        assessmentPublishResult.textContent = "Choose how students will enter, confirm the selected classes, then publish when you are ready.";
      }
      return;
    }
    if (type === "scheme") {
      draft.scheme_period = input.scheme_period || "full_year";
      draft.semester_number = input.semester_number || input.term_number || null;
      draft.hod_name = String(values.hodName || "").trim();
      draft.created_by = String(profile.name || "").trim();
    }
    if (type === "slides") {
      draft.template = input.presentation_template || "lesson";
      draft.visual_theme = input.presentation_visual_theme || "modern";
      draft.subject = input.subject || "";
      draft.year_group = input.year_group || "";
      applyPresentationVisualData(draft.slides || [], input.presentation_visual_data || "");
      draft.slides = ensurePresentationVisuals(draft.slides || []);
      const lectureNotes = lines(input.presentation_lecture_notes);
      if (lectureNotes.length) {
        draft.lecture_notes = lectureNotes;
        const slideNotes = distributePresentationNotes(lectureNotes, draft.slides.length);
        draft.slides.forEach((slide, index) => {
          slide.presenter_notes = [slide.presenter_notes, slideNotes[index]].filter(Boolean).join("\n");
        });
      }
    }
    const schemeSemesterRows = type === "scheme"
      ? (draft.weeks || []).reduce((counts, week) => {
          const semester = Number(week.semester_number) || Number(String(week.term || "").match(/[12]/)?.[0]);
          if (semester) counts[semester] = (counts[semester] || 0) + 1;
          return counts;
        }, {})
      : {};
    const metadata = [
      ["Subject", inputSubject],
      ["SHS year", inputYear.replace(/^SHS([123])$/, "SHS Year $1")],
      ...(type === "lesson" ? [
        ["Class / group", input.class_name || "Not specified"],
        ["Academic year", input.academic_year || "Not specified"],
        ["Teaching week", input.week_label || "Not specified"],
        ["Lessons this week", String(input.number_of_lessons || draft.lessons?.length || 1)],
        ["Duration per lesson", `${input.duration_minutes} minutes`]
      ] : []),
      ...(type === "slides" ? [
        ["Slide design", ({
          modern: "Modern classroom",
          editorial: "Editorial",
          vibrant: "Vibrant workshop",
          data: "Data studio",
          minimal: "Minimal"
        })[input.presentation_visual_theme] || "Modern classroom"]
      ] : []),
      ...(type === "scheme" ? [
        ["Academic year", input.academic_year || "Not specified"],
        ["Coverage", input.scheme_period === "semester"
          ? `Semester ${input.semester_number || input.term_number} · ${schemeSemesterRows[input.semester_number || input.term_number] || draft.weeks?.length || 0} scheduled weeks`
          : `Full year · ${schemeSemesterRows[1] || 0} weeks in Semester 1, ${schemeSemesterRows[2] || 0} weeks in Semester 2`]
      ] : []),
      ["Verified source excerpts", String((draft.curriculum_sources || []).length)]
    ];
    const formatSection = formatSourceList
      ? `<div class="document-section"><h3>Verified planning template checked</h3><ul class="ai-citations">${formatSourceList}</ul></div>`
      : `<div class="document-section"><h3>Planning format</h3><p>No administrator-verified template was found. This is an editable AI draft and is not represented as an officially approved format.</p></div>`;
    const region = document.getElementById(`${type}-output`);
    let html;
    try {
      const contentHtml = type === "lesson"
        ? renderLessonTemplate(input, draft, formatSection, sourceList)
        : renderAiContent(type, draft, type === "scheme");
      const documentBody = type === "lesson"
        ? contentHtml
        : `${contentHtml}${formatSection}<div class="document-section"><h3>Curriculum sources checked</h3>${sourceList ? `<ul class="ai-citations">${sourceList}</ul>` : "<p>No citations were returned.</p>"}</div>`;
      html = documentFrame(
        draft.title,
        `${TYPE_LABELS[type].toUpperCase()} · AI TEACHER-REVIEW DRAFT`,
        metadata,
        documentBody,
        type === "lesson" || type === "scheme" ? "" : "AI output is a draft, not an official NaCCA resource. Check every claim, activity, answer and curriculum reference against the cited source before classroom use.",
        type === "lesson"
      );
      region.innerHTML = html;
    } catch (error) {
      if (type !== "slides" || !Array.isArray(draft.slides)) throw error;
      console.error("Generated slide visuals could not be rendered; displaying the slide text instead.", error);
      const slidesText = draft.slides.map((slide, index) => {
        const points = (Array.isArray(slide.key_points) ? slide.key_points : [])
          .filter((point) => typeof point === "string" && point.trim())
          .map((point) => `<li>${escapeHtml(point)}</li>`).join("");
        return `<section class="presentation-text-fallback"><h4>Slide ${index + 1}: ${escapeHtml(slide.title || "Untitled slide")}</h4>${points ? `<ul>${points}</ul>` : ""}${slide.activity ? `<p><strong>Classroom activity:</strong> ${escapeHtml(slide.activity)}</p>` : ""}</section>`;
      }).join("");
      const fallbackBody = `<div class="document-section"><h3>Presentation outline</h3>${slidesText}</div>${formatSection}<div class="document-section"><h3>Curriculum sources checked</h3>${sourceList ? `<ul class="ai-citations">${sourceList}</ul>` : "<p>No citations were returned.</p>"}</div>`;
      html = documentFrame(
        draft.title,
        `${TYPE_LABELS.slides.toUpperCase()} · AI TEACHER-REVIEW DRAFT`,
        metadata,
        fallbackBody,
        "The slide content was generated, but this browser could not render one or more visuals. The text outline is available; review the visual JSON in Edit before presenting.",
        false
      );
      region.innerHTML = html;
    }
    try {
      region.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (type !== "slides") throw error;
      console.warn("The generated slides could not be scrolled into view in this browser.", error);
    }
    const outputData = {
      type,
      title: draft.title,
      data: {
        ...input,
        subject: inputSubject,
        year: inputYear,
        ...(type === "lesson" ? { lesson_draft: draft } : {}),
        ...(type === "slides" ? {
          title: draft.title,
          template: input.presentation_template || "lesson",
          visual_theme: input.presentation_visual_theme || "modern",
          number_of_slides: Number(input.number_of_slides) || draft.slides?.length || 8,
          selected_weeks: (input.selected_week_sections || []).map((week) => ({
            ...week,
            week_number: week.week_number,
            topic: week.topic,
            focal_areas: week.focal_areas || []
          })),
          learning_outcomes: lines(input.presentation_outcomes),
          learning_indicators: lines(input.presentation_indicators),
          teaching_points: lines(input.teaching_points),
          visual_data: input.presentation_visual_data || "",
          slides: draft.slides || []
        } : {})
      },
      html
    };
    if (type === "scheme") {
      const saveButton = region.querySelector('[data-action="save"]');
      saveButton.dataset.action = "finalize-scheme";
      saveButton.textContent = "Finalize & save scheme";
      bindOutputActions(region, { ...outputData, alreadySaved: true });
      saveButton.disabled = false;
      saveButton.addEventListener("click", async () => {
        const invalid = region.querySelector(".scheme-editor :invalid");
        if (invalid) {
          invalid.reportValidity();
          invalid.focus();
          return;
        }
        const editorWeeks = Array.from(region.querySelectorAll("[data-scheme-week]"));
        if (editorWeeks.length !== draft.weeks.length) {
          showToast("The scheme editor no longer matches the generated weeks. Generate the scheme again.", "error");
          return;
        }
        editorWeeks.forEach((weekEditor, index) => {
          const read = (field) => weekEditor.querySelector(`[data-scheme-field="${field}"]`).value.trim();
          draft.weeks[index] = {
            ...draft.weeks[index],
            term: read("term"),
            week: Number(read("week")),
            strand: read("strand"),
            sub_strand: read("sub_strand"),
            topic: read("topic"),
            content_standard: read("content_standard"),
            learning_indicators: read("learning_indicators").split("\n").map((item) => item.trim()).filter(Boolean),
            activities: read("activities"),
            resources: read("resources").split("\n").map((item) => item.trim()).filter(Boolean),
            assessment: read("assessment")
          };
        });
        saveButton.disabled = true;
        saveButton.textContent = "Saving final scheme…";
        try {
          const finalContent = renderAiContent("scheme", draft);
          const finalHtml = documentFrame(
            draft.title,
            `${TYPE_LABELS.scheme.toUpperCase()} · TEACHER-REVIEW SCHEME`,
            metadata,
            `${finalContent}${formatSection}<div class="document-section"><h3>Curriculum sources checked</h3>${sourceList ? `<ul class="ai-citations">${sourceList}</ul>` : "<p>No citations were returned.</p>"}</div>`,
            ""
          );
          const finalData = { ...input, subject: inputSubject, year: inputYear, weeks: draft.weeks };
          await saveDocument("scheme", draft.title, finalData, finalHtml);
          region.innerHTML = finalHtml;
          bindOutputActions(region, {
            type: "scheme", title: draft.title, data: finalData, html: finalHtml, alreadySaved: true
          });
          showToast("Final scheme saved to your workspace.");
        } catch (error) {
          saveButton.disabled = false;
          saveButton.textContent = "Finalize & save scheme";
          showToast(error instanceof Error ? error.message : "The final scheme could not be saved.", "error");
        }
      });
    } else {
      bindOutputActions(region, outputData);
    }
    if (type === "lesson") {
      const saveButton = region.querySelector('[data-action="save"]');
      const editButton = region.querySelector('[data-action="edit-lesson"]');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Saving lesson plan…";
      }
      if (editButton) editButton.disabled = true;
      saveDocument("lesson", draft.title, outputData.data, html)
        .then((savedDocument) => {
          outputData.documentId = savedDocument.id;
          outputData.data = savedDocument.data;
          outputData.html = savedDocument.html;
          outputData.alreadySaved = true;
          if (saveButton) {
            saveButton.textContent = "Saved to lesson plans";
            saveButton.disabled = true;
          }
          if (editButton) editButton.disabled = false;
          showToast("AI lesson plan generated and saved to your lesson library.");
        })
        .catch((error) => {
          if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = "Save draft";
          }
          if (editButton) editButton.disabled = false;
          showToast(error instanceof Error ? error.message : "The generated lesson plan could not be saved.", "error");
        });
    }
  }

  function lessonCurriculumHtml(data) {
    const lines = (value) => (Array.isArray(value) ? value : value ? [value] : [])
      .map((item) => String(item).trim()).filter(Boolean);
    const list = (items, missingMessage) => items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p>${escapeHtml(missingMessage)}</p>`;
    return `<div class="document-section"><h3>Week-aligned curriculum reference</h3>
      <p><strong>Teaching week:</strong> ${escapeHtml(data.week_label || "Not specified")}
      ${data.curriculum_reference ? ` · <strong>Source:</strong> ${escapeHtml(data.curriculum_reference)}` : ""}</p>
      <p><strong>Strand:</strong> ${escapeHtml(data.strand || "Not available in the linked weekly source")}
      &nbsp; <strong>Sub-strand:</strong> ${escapeHtml(data.sub_strand || "Not available in the linked weekly source")}</p>
      <p><strong>Content standard:</strong> ${escapeHtml(data.content_standard || "Not available in the linked weekly source")}</p>
      <strong>Focal area(s)</strong>${list(lines(data.focal_areas || data.focal_area), "Not available in the linked verified weekly source; teacher confirmation is needed.")}
      <strong>Learning indicator(s)</strong>${list(lines(data.learning_indicators), "No formal learning indicators were linked to this week; see any verified learning outcomes below.")}
      <strong>Learning outcome(s)</strong>${list(lines(data.learning_outcomes), "No separate learning outcomes were recorded in the verified weekly source.")}</div>`;
  }

  function lessonTemplateItems(value) {
    if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    if (typeof value !== "string") return [];
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  function lessonTemplateText(value, fallback = "Teacher to complete or confirm.") {
    const items = lessonTemplateItems(value);
    if (!items.length) return `<span class="lesson-template-placeholder">${escapeHtml(fallback)}</span>`;
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function lessonTemplateTextBlock(value, fallback = "Teacher to complete or confirm.") {
    const text = String(value ?? "").trim();
    if (!text) return `<span class="lesson-template-placeholder">${escapeHtml(fallback)}</span>`;
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }

  function renderLessonTemplate(data, draft, formatSection = "", sourceList = "") {
    const read = (...keys) => {
      for (const key of keys) {
        const value = data?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
      }
      return "";
    };
    const duration = Number.parseInt(String(read("duration_minutes", "duration")), 10) || 60;
    const fallbackStages = Array.isArray(draft.lesson_stages) ? draft.lesson_stages : [];
    const lessons = Array.isArray(draft.lessons) && draft.lessons.length
      ? draft.lessons
      : [{
        title: draft.title || read("topic") || "Lesson 1",
        lesson_stages: fallbackStages,
        key_assessment: draft.key_assessment,
        rubric_mark_scheme: draft.rubric_mark_scheme,
        reflection_remarks: draft.reflection_remarks
      }];
    const outcomes = lessonTemplateItems(draft.learning_outcomes).length
      ? draft.learning_outcomes
      : read("learning_outcomes", "learningOutcomes");
    const indicators = read("learning_indicators", "learningIndicators", "indicators", "indicator");
    const focalAreas = read("focal_areas", "focalAreas", "focalArea", "focal_area");
    const assessmentChecks = lessons.flatMap((lesson) => (lesson.lesson_stages || [])
      .map((stage) => String(stage.assessment_check || "").trim()).filter(Boolean));
    const differentiation = draft.differentiation && typeof draft.differentiation === "object"
      ? [
        ["Support", draft.differentiation.support],
        ["Core", draft.differentiation.core],
        ["Extension", draft.differentiation.extension]
      ].filter(([, detail]) => String(detail || "").trim())
        .map(([label, detail]) => `${label}: ${detail}`)
      : [];
    const columns = [20.53, 23.06, 11.87, 8.33, 12.31, 8.31, 8.42, 7.17];
    const colgroup = `<colgroup>${columns.map((width) => `<col style="width:${width}%">`).join("")}</colgroup>`;
    const fullRow = (content, className = "", field = "") => `<tr${className ? ` class="${className}"` : ""}${field ? ` data-template-field="${escapeHtml(field)}"` : ""}><td colspan="8">${content}</td></tr>`;
    const fieldRow = (label, content, field = "") => `<tr class="lesson-template-field"${field ? ` data-template-field="${escapeHtml(field)}"` : ""}><th scope="row">${escapeHtml(label)}</th><td colspan="7">${content}</td></tr>`;
    const stageRows = (stages, lessonIndex) => stages.length
      ? stages.map((stage, index) => fullRow(`<section class="lesson-template-stage" data-template-stage="${lessonIndex}-${index}">
          <h4>${index + 1}. ${escapeHtml(stage.name || "Lesson activity")} <span>Duration: ${escapeHtml(stage.minutes ?? "—")} minutes</span></h4>
          <div class="lesson-template-stage-field"><strong>Teacher Activities:</strong><div>${lessonTemplateTextBlock(stage.teacher_activity, "Teacher activity to be completed.")}</div></div>
          <div class="lesson-template-stage-field"><strong>Learner Activities:</strong><div>${lessonTemplateTextBlock(stage.learner_activity, "Learner activity to be completed.")}</div></div>
          <div class="lesson-template-stage-field"><strong>Assessment / Check:</strong><div>${lessonTemplateTextBlock(stage.assessment_check, "Check for understanding.")}</div></div>
        </section>`, "lesson-template-stage-row")).join("")
      : fullRow(`<section class="lesson-template-stage">${lessonTemplateTextBlock("", "Teacher to complete the lesson sequence.")}</section>`, "lesson-template-stage-row");
    const title = String(draft.title || read("topic") || "Lesson plan").trim();
    const subject = read("subject") || "Not specified";
    const year = String(read("year", "year_group") || "SHS Year").replace(/^SHS([123])$/i, "SHS Year $1");
    const form = read("class_name", "className") || year.replace(/^SHS Year\s*/i, "");
    const week = read("week_label", "week_number", "week") || "—";
    const learners = read("learners", "number_of_learners") || "—";
    const resources = lessonTemplateItems(draft.resources).length ? draft.resources
      : lessonTemplateItems(read("available_resources", "resources"));
    const questions = draft.essential_questions;
    const strategies = draft.pedagogical_strategies;
    const purpose = lessonTemplateItems(outcomes).length ? outcomes : indicators;
    const classLabel = read("class_name", "className") || `Form ${form}`;
    const lessonBlocks = lessons.map((lesson, lessonIndex) => {
      const stages = Array.isArray(lesson.lesson_stages) ? lesson.lesson_stages : [];
      const lessonAssessmentChecks = stages.map((stage) => String(stage.assessment_check || "").trim()).filter(Boolean);
      const lessonKeyAssessment = lesson.key_assessment || "";
      const lessonRubric = lesson.rubric_mark_scheme || draft.rubric_mark_scheme || "";
      const lessonVisual = assessmentVisual(lesson.visual);
      return [
        fullRow(`<strong>LESSON ${lessonIndex + 1}: ${escapeHtml(lesson.title || title)}</strong>`, "lesson-template-lesson-title"),
        lessonVisual ? fullRow(lessonVisual, "lesson-template-visual") : "",
        fullRow(`<strong>INTRODUCTION</strong><p><strong>Duration:</strong> ${escapeHtml(stages[0]?.minutes ?? Math.max(1, Math.round(duration * 0.14)))} minutes</p><strong>Purpose of Learning:</strong>${lessonTemplateText(purpose, "By the end of the lesson, learners should demonstrate the selected learning targets.")}`, "lesson-template-intro"),
        stageRows(stages, lessonIndex),
        fullRow("<strong>Key Assessment</strong>", "lesson-template-section-heading"),
        fullRow(lessonTemplateTextBlock(lessonKeyAssessment, "Use evidence directly linked to the selected learning indicators."), "lesson-template-content", "key_assessment"),
        fullRow("<strong>Formative Assessment:</strong>", "lesson-template-subheading"),
        fullRow(lessonTemplateText(lessonAssessmentChecks, "Monitor learner responses, participation and task evidence throughout the lesson."), "lesson-template-content"),
        fullRow("<strong>Rubric/Mark Scheme:</strong>", "lesson-template-subheading"),
        fullRow(lessonTemplateTextBlock(lessonRubric, "Teacher to complete or confirm the success criteria and marks for the lesson task."), "lesson-template-content", "rubric_mark_scheme"),
        fullRow("<strong>Reflection & Remarks</strong>", "lesson-template-section-heading"),
        fullRow(`<strong>Key Observations:</strong><br>${lessonTemplateTextBlock(lesson.reflection_remarks || "", "Strengths: ________________________________\nAreas for Development: ________________________________")}`, "lesson-template-reflection", "reflection_remarks")
      ].join("");
    }).join("");
    return `<div class="lesson-template-scroll"><table class="lesson-plan-table" aria-label="GES-aligned lesson planner template">
      ${colgroup}
      <tbody>
        ${fullRow(`<strong>Name of Subject:</strong> ${escapeHtml(subject)}`, "lesson-template-subject")}
        ${fullRow(`<strong>Learning Planner Template ${escapeHtml(year.replace(/^SHS Year\s*/i, "Year "))}</strong>`, "lesson-template-title")}
        <tr class="lesson-template-meta">
          <th scope="row">Number of Learners in Class</th><td>${escapeHtml(learners)}</td>
          <th scope="row">Week</th><td>${escapeHtml(week)}</td>
          <th scope="row">Duration</th><td>${escapeHtml(`${duration} minutes`)}</td>
          <th scope="row">Form</th><td>${escapeHtml(classLabel)}</td>
        </tr>
        ${fieldRow("Number of Lessons in Week", String(lessons.length), "number_of_lessons")}
        ${fieldRow("Strand", lessonTemplateText(read("strand"), "Not available in the selected verified weekly source."), "strand")}
        ${fieldRow("Sub-Strand", lessonTemplateText(read("sub_strand", "substrand"), "Not available in the selected verified weekly source."), "sub_strand")}
        ${fieldRow("Focal Area(s)", lessonTemplateText(focalAreas, "Not available in the selected verified weekly source."), "focal_areas")}
        ${fieldRow("Content Standard", lessonTemplateText(read("content_standard", "standard"), "Not available in the selected verified weekly source."), "content_standard")}
        ${fieldRow("Learning Outcome(s)", lessonTemplateText(outcomes, "No learning outcomes were recorded for this week."), "learning_outcomes")}
        ${fieldRow("Learning Indicator(s)", lessonTemplateText(indicators, "No formal learning indicators were linked to this week."), "learning_indicators")}
        ${fieldRow("Essential Question(s)", lessonTemplateText(questions, "Teacher to confirm an essential question for this lesson."), "essential_questions")}
        ${fieldRow("Pedagogical Strategies", lessonTemplateText(strategies, "Select strategies that suit the class and lesson activities."), "pedagogical_strategies")}
        ${fieldRow("Teaching & Learning Resources", lessonTemplateText(resources, "Teacher to confirm and prepare accessible learning materials."), "resources")}
        ${fullRow("<strong>Key Notes on Differentiation</strong> — Identify the different learner needs in your class and make notes on how to cater for them during the lesson.", "lesson-template-section-heading")}
        ${fieldRow("Learner Needs Identified", lessonTemplateText(differentiation, "Teacher to identify learner needs and provide appropriate support and extension."), "differentiation")}
        ${fullRow("<strong>Lesson</strong> (complete per number of lessons for the week)", "lesson-template-section-heading")}
        ${fullRow("Refer to the Teacher Manual and Learner Material to complete this section.", "lesson-template-instruction")}
        ${lessonBlocks}
        ${formatSection ? fullRow(`<div class="lesson-template-reference"><strong>Planning format guidance</strong>${formatSection}</div>`, "lesson-template-reference-row") : ""}
        ${sourceList ? fullRow(`<strong>Curriculum sources checked</strong><ul class="ai-citations">${sourceList}</ul>`, "lesson-template-reference-row") : ""}
      </tbody>
    </table></div>`;
  }

  function renderAiContent(type, draft, editable = false) {
    if (type === "lesson") {
      const outcomes = Array.isArray(draft.learning_outcomes)
        ? `<ul>${draft.learning_outcomes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : "";
      const stages = (draft.lesson_stages || []).map((stage) =>
        `<div class="lesson-phase"><span class="phase-time">${escapeHtml(stage.minutes)} min</span><div><strong>${escapeHtml(stage.name)}</strong><p><b>Teacher:</b> ${escapeHtml(stage.teacher_activity)}<br><b>Learners:</b> ${escapeHtml(stage.learner_activity)}<br><b>Check:</b> ${escapeHtml(stage.assessment_check)}</p></div></div>`
      ).join("");
      const assessmentChecks = (draft.lesson_stages || []).map((stage) => String(stage.assessment_check || "").trim()).filter(Boolean);
      const differentiation = draft.differentiation && typeof draft.differentiation === "object"
        ? [["Support", draft.differentiation.support], ["Core", draft.differentiation.core], ["Extension", draft.differentiation.extension]]
          .filter(([, detail]) => detail)
          .map(([label, detail]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(detail)}</li>`).join("")
        : "";
      return `<div class="document-section"><h3>Learning outcomes</h3>${outcomes}</div><div class="document-section"><h3>Prior knowledge and teaching / learning resources</h3><p>${escapeHtml(draft.prior_knowledge)}</p><ul>${(draft.resources || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div class="document-section"><h3>Teaching and learning sequence</h3>${stages}</div><div class="document-section"><h3>Assessment for learning and evidence</h3>${assessmentChecks.length ? `<ul>${assessmentChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>Confirm an assessment check for each selected indicator.</p>"}</div>${differentiation ? `<div class="document-section"><h3>Differentiation and inclusion</h3><ul>${differentiation}</ul></div>` : ""}<div class="document-section"><h3>Teacher reflection after teaching</h3><p>What evidence showed that learners met the selected indicators? What should be retaught, extended or adjusted next lesson?</p></div>`;
    }
    if (type === "scheme") {
      if (editable) {
        const topicOptions = draft.topic_options || [];
        const topicLessons = draft.weekly_lessons || [];
        let previousSemester = null;
        const weeks = (draft.weeks || []).map((week, index) => {
          const semesterNumber = Number(week.semester_number) || Number(String(week.term || "").match(/[12]/)?.[0]) || 1;
          const selectedTopic = week.week_kind === "mid_semester" || /mid-semester exam/i.test(week.topic || "") ? "__mid_semester__"
            : week.week_kind === "revision" || /^revision week$/i.test(week.topic || "") ? "__revision__"
              : week.week_kind === "end_semester" || /end.of.semester exam/i.test(week.topic || "") ? "__end_semester__"
              : topicOptions.includes(week.topic) ? week.topic
                : week.topic ? "__other__" : "";
          const topicChoiceOptions = topicOptions.map((topic) => {
            const hasAiSuggestion = topicLessons.some((lesson) => lesson.topic === topic && lesson.ai_extracted);
            const hasReviewedLesson = topicLessons.some((lesson) => lesson.topic === topic && !lesson.ai_extracted);
            return {
              value: topic,
              label: `${hasAiSuggestion && !hasReviewedLesson ? "AI suggestion · " : ""}${topic}`
            };
          });
          const pickerOptions = [
            { value: "", label: "Choose a topic suggestion" },
            ...topicChoiceOptions,
            { value: "__mid_semester__", label: "Mid-Semester Examination" },
            { value: "__revision__", label: "Revision Week" },
            { value: "__end_semester__", label: "End of Semester Examination" },
            { value: "__other__", label: "Enter a different topic…" }
          ];
          const topicChoices = pickerOptions.map(({ value, label }) =>
            `<option value="${escapeHtml(value)}"${value === selectedTopic ? " selected" : ""}>${escapeHtml(label)}</option>`
          ).join("");
          const topicOptionButtons = pickerOptions.map(({ value, label }) =>
            `<button type="button" data-scheme-topic-option="${escapeHtml(value)}" aria-pressed="${value === selectedTopic}">${escapeHtml(label)}</button>`
          ).join("");
          const selectedTopicLabel = pickerOptions.find((option) => option.value === selectedTopic)?.label
            || pickerOptions[0].label;
          const focalAreaText = (week.focal_areas || []).map((area, areaIndex) => `${areaIndex + 1}. ${area}`).join("\n");
          const learningIndicatorText = (week.learning_indicators || []).join("\n");
          const learningOutcomeText = (week.learning_outcomes || []).join("\n");
          const focalRequired = (week.week_kind || "teaching") === "teaching" ? " required" : "";
          const semesterHeading = draft.scheme_period === "full_year" && semesterNumber !== previousSemester
            ? `<tr class="scheme-semester-divider" aria-label="Semester ${semesterNumber}"><th colspan="7"><span>Semester ${semesterNumber}</span><small>${draft.teaching_week_counts?.[semesterNumber] || 12} teaching weeks</small></th></tr>`
            : "";
          previousSemester = semesterNumber;
          return `${semesterHeading}<tr class="scheme-week-row scheme-week-${escapeHtml(week.week_kind || "teaching")}" data-scheme-week="${index}" data-semester="Semester ${semesterNumber}" data-semester-number="${semesterNumber}" data-week-number="${week.week_in_semester || week.week}" data-week-kind="${escapeHtml(week.week_kind || "teaching")}" data-overall-week-number="${week.week}"><td><span class="scheme-week-badge">S${semesterNumber} · W${week.week_in_semester || week.week}</span></td><td><input type="date" data-scheme-field="week_ending" value="${escapeHtml(week.week_ending || "")}" aria-label="Week ${week.week_in_semester || week.week} ending date"></td><td><details class="scheme-topic-picker"><summary>${escapeHtml(selectedTopicLabel)}</summary><div class="scheme-topic-options">${topicOptionButtons}</div></details><select data-scheme-topic-picker hidden aria-hidden="true" tabindex="-1" aria-label="Choose a suggested topic">${topicChoices}</select><textarea data-scheme-field="topic" rows="2" required placeholder="Enter or edit the full topic" aria-label="Topic for Semester ${semesterNumber}, week ${week.week_in_semester || week.week}">${escapeHtml(week.topic || "")}</textarea></td><td><textarea data-scheme-field="focal_areas" rows="2" aria-label="Focal areas for week ${week.week_in_semester || week.week}"${focalRequired}>${escapeHtml(focalAreaText)}</textarea></td><td><textarea data-scheme-field="learning_indicators" rows="2" aria-label="Learning indicators for week ${week.week_in_semester || week.week}">${escapeHtml(learningIndicatorText)}</textarea></td><td><textarea data-scheme-field="learning_outcomes" rows="2" aria-label="Learning outcomes for week ${week.week_in_semester || week.week}">${escapeHtml(learningOutcomeText)}</textarea></td><td><textarea data-scheme-field="assessment_schedule" rows="2" placeholder="Suggested when source schedule unavailable" aria-label="Assessment schedule for week ${week.week_in_semester || week.week}">${escapeHtml(week.assessment_schedule || week.assessment || "")}</textarea></td></tr>`;
        }).join("");
        return `<div class="document-section scheme-editor"><h3>${draft.scheme_period === "semester" ? `Semester ${escapeHtml(draft.semester_number)}` : "Full-year"} weekly template</h3><p>Teaching-week counts are inferred independently from verified subject allocations; each semester adds a mid-semester examination, revision and end-of-semester examination. When no verified week numbers are available, the provisional 12-week schedule is clearly flagged. Choose a suggestion or edit the full wrapped topic text. Focal areas, learning indicators, outcomes and assessment modes are filled from matched sources when available; suggestions are clearly labeled. Week-ending dates are calculated from your semester start dates and remain editable.</p>${schemeEventLegendMarkup()}<div class="table-wrap"><table class="scheme-table scheme-fill-table"><thead><tr><th>Semester · Week</th><th>Week Ending</th><th>Topic</th><th>Focal Areas</th><th>Learning Indicators</th><th>Learning Outcomes</th><th>Assessment Schedule</th></tr></thead><tbody>${weeks}</tbody></table></div>${schemeSignatureMarkup(draft)}</div>`;
      }
      const displaySchemeText = (value) => escapeHtml(value || "").replace(/\r?\n/g, "<br>");
      let previousSemester = null;
      const weeks = (draft.weeks || []).map((week) => {
        const semesterNumber = Number(week.semester_number) || Number(String(week.term || "").match(/[12]/)?.[0]) || 1;
        const semesterHeading = draft.scheme_period === "full_year" && semesterNumber !== previousSemester
          ? `<tr class="scheme-semester-divider"><th colspan="7"><span>Semester ${semesterNumber}</span><small>Weekly teaching plan</small></th></tr>`
          : "";
        previousSemester = semesterNumber;
        return `${semesterHeading}<tr class="scheme-week-row scheme-week-${escapeHtml(week.week_kind || "teaching")}"><td><span class="scheme-week-badge">S${semesterNumber} · W${escapeHtml(week.week_in_semester || week.week)}</span></td><td>${escapeHtml(week.week_ending || "")}</td><td>${displaySchemeText(week.topic)}</td><td>${(week.focal_areas || []).map((area, index) => `${index + 1}. ${displaySchemeText(area)}`).join("<br>")}</td><td>${(week.learning_indicators || []).map((item) => displaySchemeText(item)).join("<br>")}</td><td>${(week.learning_outcomes || []).map((item) => displaySchemeText(item)).join("<br>")}</td><td>${displaySchemeText(week.assessment_schedule || week.assessment)}</td></tr>`;
      }).join("");
      return `<div class="document-section"><h3>${draft.scheme_period === "semester" ? `Semester ${escapeHtml(draft.semester_number || draft.term_number)} teaching outline` : "Full-year teaching outline"}</h3>${schemeEventLegendMarkup()}<div class="table-wrap"><table class="scheme-table"><thead><tr><th>Semester · Week</th><th>Week Ending</th><th>Topic</th><th>Focal Areas</th><th>Learning Indicators</th><th>Learning Outcomes</th><th>Assessment Schedule</th></tr></thead><tbody>${weeks}</tbody></table></div>${schemeSignatureMarkup(draft)}</div>`;
    }
    const presentation = normalizePresentationData(draft);
    const slides = ensurePresentationVisuals(draft.slides || [])
      .map((slide, index) => presentationSlideMarkup(slide, index, presentation)).join("");
    const templateLabels = {
      lesson: "Clear lesson sequence", inquiry: "Inquiry & discovery", worked: "Worked examples",
      discussion: "Discussion & collaboration", project: "Project-based learning",
      revision: "Revision & retrieval practice", flipped: "Flipped classroom"
    };
    return `<div class="document-section"><h3>${escapeHtml(templateLabels[presentation.template])} · PowerPoint slide preview</h3><p>Slides use the ${escapeHtml(presentation.visual_theme)} design. Relevant openly licensed images are added to selected slides where a suitable match is available, with creator and license credits; diagrams, charts, tables and graphs are editable PowerPoint elements.</p>${draft.presentation_image_warning ? `<p class="notice notice-amber">${escapeHtml(draft.presentation_image_warning)}</p>` : ""}<div class="presentation-preview-grid">${slides}</div></div>`;
  }

  function ensurePresentationVisuals(slides) {
    return slides.map((slide) => {
      const visual = slide.visual;
      const hasVisualContent = visual && typeof visual === "object" && (
        (["process", "timeline", "cards", "comparison"].includes(visual.type)
          && [visual.steps, visual.items].some((items) => Array.isArray(items) && items.some((item) => typeof item === "string" && item.trim())))
        || (visual.type === "table" && Array.isArray(visual.headers) && visual.headers.length && Array.isArray(visual.rows))
        || (["bar_chart", "chart"].includes(visual.type) && Array.isArray(visual.labels) && visual.labels.length > 0
          && Array.isArray(visual.values) && visual.labels.length === visual.values.length
          && visual.values.every((value) => Number.isFinite(Number(value))))
        || (visual.type === "graph" && Array.isArray(visual.points)
          && visual.points.filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)).length > 1)
        || (visual.type === "geometry" && Array.isArray(visual.shapes) && visual.shapes.length > 0
          && ["x_min", "x_max", "y_min", "y_max"].every((key) => Number.isFinite(Number(visual[key])))
          && Number(visual.x_min) < Number(visual.x_max) && Number(visual.y_min) < Number(visual.y_max))
        || (visual.type === "line_chart" && Array.isArray(visual.series)
          && visual.series.some((series) => Array.isArray(series?.values) && series.values.length > 1))
      );
      if (hasVisualContent) return slide;
      const items = (Array.isArray(slide.key_points) ? slide.key_points : [])
        .filter((point) => typeof point === "string" && point.trim())
        .slice(0, 4);
      return {
        ...slide,
        visual: {
          type: "cards",
          title: "Key ideas",
          items: items.length ? items : [String(slide.activity || slide.title || "Explore the lesson idea.")]
        }
      };
    });
  }

  function presentationVisualMarkup(visual) {
    if (!visual || typeof visual !== "object") return "";
    const title = escapeHtml(visual.title || "Lesson visual");
    const type = String(visual.type || "").toLowerCase();
    if (type === "table") {
      const headers = Array.isArray(visual.headers) ? visual.headers.slice(0, 4) : [];
      const rows = Array.isArray(visual.rows) ? visual.rows.filter(Array.isArray).slice(0, 3) : [];
      return `<div class="presentation-visual presentation-visual-table" role="img" aria-label="${title}"><strong>${title}</strong><div class="presentation-visual-table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.slice(0, headers.length || 4).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    }
    if (type === "bar_chart" || type === "chart") {
      const labels = Array.isArray(visual.labels) ? visual.labels.slice(0, 6) : [];
      const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length).map(Number) : [];
      const max = Math.max(1, ...values.map((value) => Math.abs(Number.isFinite(value) ? value : 0)));
      if (!labels.length || values.length !== labels.length || values.some((value) => !Number.isFinite(value))) return "";
      return `<div class="presentation-visual presentation-visual-chart" role="img" aria-label="${title}"><strong>${title}</strong><div class="presentation-chart-bars">${labels.map((label, index) => `<div class="presentation-chart-column"><span>${escapeHtml(values[index])}</span><i style="--bar-size:${Math.max(8, Math.round(Math.abs(values[index]) / max * 100))}%"></i><small>${escapeHtml(label)}</small></div>`).join("")}</div>${visual.value_label ? `<small class="presentation-chart-unit">${escapeHtml(visual.value_label)}</small>` : ""}</div>`;
    }
    if (["process", "timeline", "cards", "comparison"].includes(type)) {
      const items = (Array.isArray(visual.steps) ? visual.steps : Array.isArray(visual.items) ? visual.items : []).map((item) =>
        typeof item === "string" ? item : String(item?.label || item?.title || item?.details || "")
      ).filter(Boolean).slice(0, 5);
      return `<div class="presentation-visual presentation-visual-cards" role="img" aria-label="${title}"><strong>${title}</strong><div>${items.map((item, index) => `<span><b>${String(index + 1).padStart(2, "0")}</b>${escapeHtml(item)}</span>`).join("")}</div></div>`;
    }
    if (type === "geometry") {
      const bounds = ["x_min", "x_max", "y_min", "y_max"].map((key) => Number(visual[key]));
      const shapes = Array.isArray(visual.shapes) ? visual.shapes.slice(0, 8) : [];
      if (bounds.some((value) => !Number.isFinite(value)) || bounds[0] >= bounds[1] || bounds[2] >= bounds[3] || !shapes.length) return "";
      const [xMin, xMax, yMin, yMax] = bounds;
      const width = 720, height = 380, plot = { left: 58, right: 18, top: 24, bottom: 42 };
      const rangeX = xMax - xMin, rangeY = yMax - yMin;
      const scale = Math.min((width - plot.left - plot.right) / rangeX, (height - plot.top - plot.bottom) / rangeY);
      const plotWidth = rangeX * scale, plotHeight = rangeY * scale;
      const offsetX = plot.left + ((width - plot.left - plot.right) - plotWidth) / 2;
      const offsetY = plot.top + ((height - plot.top - plot.bottom) - plotHeight) / 2;
      const px = (value) => offsetX + (value - xMin) * scale;
      const py = (value) => offsetY + (yMax - value) * scale;
      const n = (value) => Number(value.toFixed(2));
      const clipId = `geometry-clip-${Math.random().toString(36).slice(2)}`;
      const palette = ["#247456", "#d0a64a", "#277da1", "#c85845", "#7256a8", "#4d7c78", "#bf6b40", "#5572a8"];
      const grid = Array.from({ length: 5 }, (_, index) => {
        const x = offsetX + plotWidth * index / 4, y = offsetY + plotHeight * index / 4;
        const xValue = xMin + rangeX * index / 4, yValue = yMax - rangeY * index / 4;
        return `<line x1="${n(x)}" y1="${n(offsetY)}" x2="${n(x)}" y2="${n(offsetY + plotHeight)}" class="presentation-geometry-grid"/><line x1="${n(offsetX)}" y1="${n(y)}" x2="${n(offsetX + plotWidth)}" y2="${n(y)}" class="presentation-geometry-grid"/><text x="${n(x)}" y="${n(offsetY + plotHeight + 16)}" text-anchor="middle" class="presentation-geometry-label">${n(xValue)}</text><text x="${n(offsetX - 8)}" y="${n(y + 4)}" text-anchor="end" class="presentation-geometry-label">${n(yValue)}</text>`;
      }).join("");
      const axisX = xMin <= 0 && xMax >= 0 ? px(0) : offsetX;
      const axisY = yMin <= 0 && yMax >= 0 ? py(0) : offsetY + plotHeight;
      const legend = shapes.map((shape, index) => shape && typeof shape.label === "string" && shape.label.trim()
        ? `<span><i style="--shape-color:${palette[index % palette.length]}"></i>${escapeHtml(shape.label)}</span>`
        : "").filter(Boolean).join("");
      const drawings = shapes.map((shape, index) => {
        if (!shape || typeof shape !== "object") return "";
        const color = palette[index % palette.length];
        if (shape.shape === "circle" || shape.shape === "ellipse") {
          const center = Array.isArray(shape.center) ? shape.center.map(Number) : [];
          const radii = shape.shape === "circle" ? [Number(shape.radius), Number(shape.radius)] : (Array.isArray(shape.radii) ? shape.radii.map(Number) : []);
          if (center.length !== 2 || radii.length !== 2 || ![...center, ...radii].every(Number.isFinite) || radii.some((value) => value <= 0)) return "";
          return `<ellipse cx="${n(px(center[0]))}" cy="${n(py(center[1]))}" rx="${n(radii[0] * scale)}" ry="${n(radii[1] * scale)}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2.5"/>`;
        }
        if (shape.shape === "parabola") {
          const coefficients = Array.isArray(shape.coefficients) ? shape.coefficients.map(Number) : [];
          const from = Number(shape.x_min), to = Number(shape.x_max);
          if (coefficients.length !== 3 || !coefficients.every(Number.isFinite) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return "";
          const [a, b, c] = coefficients;
          const segments = 12;
          let d = `M ${n(px(from))} ${n(py(a * from * from + b * from + c))}`;
          for (let step = 0; step < segments; step++) {
            const x0 = from + (to - from) * step / segments, x1 = from + (to - from) * (step + 1) / segments;
            const y0 = a * x0 * x0 + b * x0 + c, y1 = a * x1 * x1 + b * x1 + c;
            const dx = (x1 - x0) * scale / 3;
            const control1 = { x: px(x0) + dx, y: py(y0) - (2 * a * x0 + b) * (x1 - x0) * scale / 3 };
            const control2 = { x: px(x1) - dx, y: py(y1) + (2 * a * x1 + b) * (x1 - x0) * scale / 3 };
            d += ` C ${n(control1.x)} ${n(control1.y)} ${n(control2.x)} ${n(control2.y)} ${n(px(x1))} ${n(py(y1))}`;
          }
          return `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
        }
        if (shape.shape === "rectangle") {
          const left = Number(shape.x_min), right = Number(shape.x_max), top = Number(shape.y_max), bottom = Number(shape.y_min);
          if (![left, right, top, bottom].every(Number.isFinite) || left >= right || bottom >= top) return "";
          return `<rect x="${n(px(left))}" y="${n(py(top))}" width="${n((right - left) * scale)}" height="${n((top - bottom) * scale)}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2.5"/>`;
        }
        if (shape.shape === "line" || shape.shape === "triangle") {
          const points = Array.isArray(shape.points) ? shape.points.filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value)))) : [];
          const needed = shape.shape === "line" ? 2 : 3;
          if (points.length !== needed) return "";
          const pointString = points.map(([x, y]) => `${n(px(Number(x)))},${n(py(Number(y)))}`).join(" ");
          const element = shape.shape === "line" ? `<polyline points="${pointString}" fill="none" stroke="${color}" stroke-width="2.5"/>` : `<polygon points="${pointString}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2.5"/>`;
          return element;
        }
        return "";
      }).join("");
      const xLabel = visual.x_label ? `<text x="${n(offsetX + plotWidth / 2)}" y="${height - 3}" text-anchor="middle" class="presentation-geometry-label">${escapeHtml(visual.x_label)}</text>` : "";
      const yLabel = visual.y_label ? `<text x="12" y="${n(offsetY + plotHeight / 2)}" text-anchor="middle" class="presentation-geometry-label" transform="rotate(-90 12 ${n(offsetY + plotHeight / 2)})">${escapeHtml(visual.y_label)}</text>` : "";
      return `<div class="presentation-visual presentation-visual-geometry" role="group" aria-label="${title}"><strong>${title}</strong><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><defs><clipPath id="${clipId}"><rect x="${n(offsetX)}" y="${n(offsetY)}" width="${n(plotWidth)}" height="${n(plotHeight)}"/></clipPath></defs>${grid}<line x1="${n(axisX)}" y1="${n(offsetY)}" x2="${n(axisX)}" y2="${n(offsetY + plotHeight)}" class="presentation-geometry-axis"/><line x1="${n(offsetX)}" y1="${n(axisY)}" x2="${n(offsetX + plotWidth)}" y2="${n(axisY)}" class="presentation-geometry-axis"/><g clip-path="url(#${clipId})">${drawings}</g>${xLabel}${yLabel}</svg>${legend ? `<div class="presentation-geometry-legend">${legend}</div>` : ""}</div>`;
    }
    if (type === "graph" || type === "line_chart") {
      const series = type === "graph"
        ? [{ name: "", points: (visual.points || []).filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)).slice(0, 12).map(([x, y]) => [Number(x), Number(y)]) }]
        : (Array.isArray(visual.series) ? visual.series.filter((item) => item && Array.isArray(item.values)).slice(0, 4).map((item) => ({
          name: item.name || "",
          points: item.values.slice(0, 12).map((value, index) => [index, Number(value)]).filter((point) => Number.isFinite(point[1]))
        })) : []);
      const allPoints = series.flatMap((item) => item.points || []);
      if (allPoints.length < 1) return "";
      const xValues = allPoints.map((point) => point[0]), yValues = allPoints.map((point) => point[1]);
      const xLow = Math.min(...xValues), xRange = Math.max(1, Math.max(...xValues) - xLow);
      const yLow = Math.min(...yValues), yRange = Math.max(1, Math.max(...yValues) - yLow);
      const colors = ["var(--presentation-accent)", "var(--presentation-secondary)", "#57a3cb", "#e2795d"];
      const plotted = series.map((item, seriesIndex) => {
        const points = (item.points || []).map(([x, y]) => ({
          x: (x - xLow) / xRange * 100,
          y: 90 - (y - yLow) / yRange * 75
        }));
        const segments = points.slice(1).map((point, index) => {
          const previous = points[index];
          const dx = point.x - previous.x, dy = point.y - previous.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          return `<i class="presentation-graph-line" style="left:${previous.x}%;top:${previous.y}%;width:${length}%;transform:rotate(${angle}deg);background:${colors[seriesIndex % colors.length]}"></i>`;
        }).join("");
        return `${segments}${points.map((point) => `<i class="presentation-graph-point" style="left:${point.x}%;top:${point.y}%;background:${colors[seriesIndex % colors.length]}"></i>`).join("")}`;
      }).join("");
      return `<div class="presentation-visual presentation-visual-graph" role="img" aria-label="${title}"><strong>${title}</strong><div>${plotted}</div><small>${escapeHtml(visual.x_label || "Relationship")}${visual.y_label ? ` · ${escapeHtml(visual.y_label)}` : ""}</small></div>`;
    }
    return `<div class="presentation-visual presentation-visual-cards" role="img" aria-label="${title}"><strong>${title}</strong><div><span>${escapeHtml(String(visual.description || "Explore this lesson idea."))}</span></div></div>`;
  }

  function schemeSignatureMarkup(draft) {
    const teacherName = String(draft.created_by || profile.name || "Teacher").trim();
    const hodName = String(draft.hod_name || "").trim();
    return `<section class="scheme-signoff" aria-label="Scheme of work sign-off"><h3>Review &amp; sign-off</h3><div class="scheme-signoff-grid"><div class="scheme-signoff-card"><span class="scheme-signoff-role">Prepared by · Teacher</span><strong>${escapeHtml(teacherName)}</strong><div class="scheme-signature-line"></div><div class="scheme-signoff-labels"><span>Teacher’s signature</span><span>Date</span></div></div><div class="scheme-signoff-card"><span class="scheme-signoff-role">Reviewed by · HOD</span><strong>${escapeHtml(hodName || "HOD name not provided")}</strong><div class="scheme-signature-line"></div><div class="scheme-signoff-labels"><span>HOD’s signature</span><span>Date</span></div></div></div></section>`;
  }

  function schemeEventLegendMarkup() {
    return `<ul class="scheme-event-legend" aria-label="Scheme week color key"><li><span class="scheme-event-swatch scheme-event-swatch-mid"></span>Mid-semester examination</li><li><span class="scheme-event-swatch scheme-event-swatch-revision"></span>Revision week</li><li><span class="scheme-event-swatch scheme-event-swatch-end"></span>End-of-semester examination</li></ul>`;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function saveDocument(type, title, data, html) {
    return workspaceRequest("/api/workspace/documents", "POST", {
      type,
      title: title.trim() || TYPE_LABELS[type],
      data,
      html
    }).then((result) => {
      documents.unshift(result.document);
      renderAll();
      return result.document;
    });
  }

  function metaBoxes(items) {
    return `<div class="document-meta">${items.map(([label, value]) => `<div class="meta-box"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "—")}</strong></div>`).join("")}</div>`;
  }

  function assessmentAdministratorDetails() {
    return {
      name: String(profile.name || "").trim(),
      school: String(profile.school || "").trim(),
      email: workspaceUserEmail,
      phone: String(profile.phone || "").trim(),
      region: String(profile.region || "").trim(),
      district: String(profile.district || "").trim(),
      logoUrl: profile.logo_url ? new URL(profile.logo_url, window.location.href).href : ""
    };
  }

  function assessmentCoverMarkup(title, subtitle, meta) {
    const administrator = assessmentAdministratorDetails();
    const logoUrl = administrator.logoUrl;
    const highlights = meta.slice(0, 6);
    const contacts = [
      administrator.email && `Email · ${administrator.email}`,
      administrator.phone && `Phone · ${administrator.phone}`,
      [administrator.region, administrator.district].filter(Boolean).join(" · ")
    ].filter(Boolean);
    return `<section class="assessment-cover-page"><div class="assessment-cover-brand">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="assessment-cover-logo">` : `<span class="assessment-cover-monogram" aria-hidden="true">A</span>`}<div><span>AKADEMI · GHANA SHS</span><strong>${escapeHtml(administrator.school || "Teacher workspace")}</strong></div></div><div class="assessment-cover-accent"></div><p class="assessment-cover-kicker">${escapeHtml(subtitle || "ASSESSMENT · TEACHER REVIEW")}</p><h1>${escapeHtml(title)}</h1><div class="assessment-cover-meta">${highlights.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "—")}</strong></div>`).join("")}</div><div class="assessment-cover-prepared"><span>PREPARED BY</span><strong>${escapeHtml(administrator.name || "Teacher / administrator")}</strong>${contacts.map((contact) => `<small>${escapeHtml(contact)}</small>`).join("")}</div><p class="assessment-cover-note">Review the content, mark allocations and curriculum requirements before use.</p></section>`;
  }

  function documentFrame(title, subtitle, meta, body, warning, tableTemplate = false, assessmentFormat = false) {
    const bodyContent = tableTemplate
      ? body
      : `${assessmentFormat ? assessmentCoverMarkup(title, subtitle, meta) : `<div class="document-title-block"><div class="eyebrow">${escapeHtml(subtitle)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(profile.school || "")}</p></div>${metaBoxes(meta)}`}${body}${warning ? `<div class="output-warning">${escapeHtml(warning)}</div>` : ""}`;
    return `<article class="output-card${tableTemplate ? " lesson-plan-output" : ""}"><div class="output-heading"><div><h2>Draft preview</h2><p>Teacher-authored template · verify against the official curriculum</p></div><div class="output-actions"><button class="small-button" data-action="print">Print / save as PDF</button><button class="small-button" data-action="save">Save draft</button></div></div><div class="output-body${tableTemplate ? " lesson-plan-output-body" : ""}">${bodyContent}</div></article>`;
  }

  function bindOutputActions(container, itemData) {
    const outputCard = container.matches(".output-card") ? container : container.querySelector(".output-card");
    const saveButton = container.querySelector('[data-action="save"]');
    const printButton = container.querySelector('[data-action="print"]');
    if (itemData.type === "slides") {
      const presentButton = document.createElement("button");
      presentButton.type = "button";
      presentButton.className = "small-button";
      presentButton.dataset.action = "present";
      presentButton.textContent = "Present";
      presentButton.addEventListener("click", () => openPresentationViewer(itemData.data, itemData.title));
      container.querySelector(".output-actions")?.insertBefore(presentButton, saveButton);
      const exportPresentation = (format) => {
        try {
          if (!window.akademiAssessmentExport) throw new Error("Presentation export is unavailable. Refresh and try again.");
          window.akademiAssessmentExport.downloadDocument({
            type: "slides",
            title: itemData.title,
            data: normalizePresentationData(itemData.data || {}),
            html: itemData.html
          }, format);
          showToast(format === "pptx" ? "Editable PowerPoint presentation download started." : "Presentation PDF download started.");
        } catch (error) {
          showToast(error instanceof Error ? error.message : `The presentation could not be exported as ${format.toUpperCase()}.`, "error");
        }
      };
      if (printButton) {
        printButton.textContent = "Download PDF";
        printButton.addEventListener("click", () => exportPresentation("pdf"));
      }
      if (!container.querySelector('[data-action="pptx"]')) {
        const pptxButton = document.createElement("button");
        pptxButton.type = "button";
        pptxButton.className = "small-button";
        pptxButton.dataset.action = "pptx";
        pptxButton.textContent = "Download PowerPoint";
        pptxButton.addEventListener("click", () => exportPresentation("pptx"));
        container.querySelector(".output-actions")?.insertBefore(pptxButton, saveButton);
      }
    }
    if (itemData.type === "scheme" && printButton) {
      printButton.textContent = "Export PDF";
      printButton.dataset.action = "scheme-pdf";
      const docxButton = document.createElement("button");
      docxButton.type = "button";
      docxButton.className = "small-button";
      docxButton.dataset.action = "scheme-docx";
      docxButton.textContent = "Export DOCX";
      container.querySelector(".output-actions")?.insertBefore(docxButton, saveButton);
      const exportScheme = (format) => {
        try {
          if (!window.akademiAssessmentExport) throw new Error("The export tools are unavailable. Refresh and try again.");
          window.akademiAssessmentExport.downloadDocument({
            type: "scheme",
            title: itemData.title,
            data: itemData.data,
            html: itemData.html
          }, format);
          showToast(`${format.toUpperCase()} download started.`);
        } catch (error) {
          showToast(error instanceof Error ? error.message : `The scheme could not be exported as ${format.toUpperCase()}.`, "error");
        }
      };
      printButton.addEventListener("click", () => exportScheme("pdf"));
      docxButton.addEventListener("click", () => exportScheme("docx"));
    }
    if (itemData.type === "lesson" && outputCard && !container.querySelector('[data-action="edit-lesson"]')) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "small-button";
      editButton.dataset.action = "edit-lesson";
      editButton.textContent = "Edit lesson";
      editButton.addEventListener("click", () => showLessonEditor(container, itemData));
      container.querySelector(".output-actions")?.prepend(editButton);
    }
    if (itemData.type === "lesson" && outputCard) {
      const actions = container.querySelector(".output-actions");
      if (actions && !actions.querySelector('[data-action="lesson-docx"]')) {
        const addExportButton = (format, label) => {
          const exportButton = document.createElement("button");
          exportButton.type = "button";
          exportButton.className = "small-button";
          exportButton.dataset.action = `lesson-${format}`;
          exportButton.textContent = label;
          exportButton.addEventListener("click", () => {
            try {
              if (!window.akademiAssessmentExport) throw new Error("Lesson exports are unavailable. Refresh and try again.");
              window.akademiAssessmentExport.downloadDocument({
                type: "lesson",
                title: itemData.title,
                data: itemData.data,
                html: itemData.html
              }, format);
              showToast(`Lesson ${format.toUpperCase()} download started.`);
            } catch (error) {
              showToast(error instanceof Error ? error.message : `The lesson could not be exported as ${format.toUpperCase()}.`, "error");
            }
          });
          actions.insertBefore(exportButton, actions.querySelector('[data-action="save"]'));
        };
        addExportButton("docx", "Word · DOCX");
        addExportButton("pdf", "Download PDF");
      }
    }
    container.querySelectorAll('[data-action="docx"], [data-action="pdf"]').forEach((button) => {
      button.addEventListener("click", async () => {
        if (!itemData.exportContent || !window.akademiAssessmentExport) {
          showToast("Assessment export is unavailable. Refresh and try again.", "error");
          return;
        }
        button.disabled = true;
        try {
          await window.akademiAssessmentExport.downloadWithLogo(itemData.exportContent, button.dataset.action);
          showToast(`${button.dataset.action.toUpperCase()} download started.`);
        } catch (error) {
          showToast(error instanceof Error ? error.message : "The assessment could not be exported.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });
    if (itemData.alreadySaved && saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = itemData.type === "lesson" ? "Saved to lesson plans" : "Saved";
    } else {
      saveButton?.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveButton.textContent = "Saving draft…";
        showToast("Saving draft to your account…", "info");
        try {
          let savedDocument;
          const payload = { type: itemData.type, title: itemData.title, data: itemData.data, html: itemData.html };
          if (itemData.documentId) {
            const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(itemData.documentId)}`, "PUT", payload);
            savedDocument = result.document;
            documents = documents.map((doc) => doc.id === savedDocument.id ? savedDocument : doc);
            renderAll();
          } else {
            savedDocument = await saveDocument(itemData.type, itemData.title, itemData.data, itemData.html);
          }
          Object.assign(itemData, {
            documentId: savedDocument.id,
            data: savedDocument.data,
            html: savedDocument.html,
            alreadySaved: true
          });
          saveButton.textContent = itemData.type === "lesson" ? "Saved to lesson plans" : "Saved";
          showToast(itemData.type === "lesson" ? "Lesson plan saved to your workspace." : "Draft saved and synced to your account.");
        } catch (error) {
          saveButton.textContent = "Retry saving draft";
          showToast(error instanceof Error ? error.message : "Draft could not be saved.", "error");
          saveButton.disabled = false;
        }
      });
    }
    if (itemData.type !== "scheme" && itemData.type !== "slides") {
      printButton?.addEventListener("click", () => {
        printDocument(itemData.title, outputCard);
      });
    }
  }

  function extractLessonDraft(itemData) {
    if (itemData.data?.lesson_draft && typeof itemData.data.lesson_draft === "object") {
      return JSON.parse(JSON.stringify(itemData.data.lesson_draft));
    }
    const parsed = new DOMParser().parseFromString(itemData.html || "", "text/html");
    const sections = Array.from(parsed.querySelectorAll(".document-section"));
    const section = (prefix) => sections.find((item) => item.querySelector("h3")?.textContent.trim().toLocaleLowerCase().startsWith(prefix));
    const outcomeItems = Array.from(section("learning outcomes")?.querySelectorAll("li") || [], (item) => item.textContent.trim());
    const priorSection = section("prior knowledge and resources") || section("prior learning and resources");
    const phases = Array.from(parsed.querySelectorAll(".lesson-phase"), (phase) => {
      const lines = (phase.querySelector("p")?.innerText || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
      const find = (label) => lines.find((line) => line.toLocaleLowerCase().startsWith(`${label.toLocaleLowerCase()}:`))?.slice(label.length + 1).trim() || "";
      return {
        name: phase.querySelector("strong")?.textContent.trim() || "Teaching activity",
        minutes: Number.parseInt(phase.querySelector(".phase-time")?.textContent || "0", 10) || 10,
        teacher_activity: find("Teacher"),
        learner_activity: find("Learners"),
        assessment_check: find("Check")
      };
    });
    const templateField = (name) => parsed.querySelector(`[data-template-field="${name}"]`);
    const templateValues = (name) => {
      const field = templateField(name);
      const values = Array.from(field?.querySelectorAll("li") || [], (item) => item.textContent.trim()).filter(Boolean);
      if (values.length) return values;
      return Array.from(field?.querySelectorAll("p") || [], (item) => item.textContent.trim()).filter(Boolean);
    };
    const templateStages = Array.from(parsed.querySelectorAll(".lesson-template-stage"), (stage) => {
      const heading = stage.querySelector("h4");
      const fields = Array.from(stage.querySelectorAll(".lesson-template-stage-field"));
      const fieldValue = (prefix) => {
        const field = fields.find((item) => item.querySelector("strong")?.textContent.trim().toLocaleLowerCase().startsWith(prefix));
        return Array.from(field?.querySelectorAll("p") || [], (item) => item.textContent.trim()).filter(Boolean).join("\n")
          || field?.querySelector("div")?.textContent.trim()
          || "";
      };
      return {
        name: heading?.childNodes[0]?.textContent.replace(/^\s*\d+\.\s*/, "").trim() || "Teaching activity",
        minutes: Number.parseInt(heading?.querySelector("span")?.textContent || "0", 10) || 10,
        teacher_activity: fieldValue("teacher"),
        learner_activity: fieldValue("learner"),
        assessment_check: fieldValue("assessment")
      };
    });
    return {
      title: itemData.title,
      learning_outcomes: outcomeItems.length ? outcomeItems : templateValues("learning_outcomes"),
      essential_questions: templateValues("essential_questions"),
      pedagogical_strategies: templateValues("pedagogical_strategies"),
      prior_knowledge: priorSection?.querySelector("p")?.textContent.trim() || "",
      resources: Array.from(priorSection?.querySelectorAll("li") || [], (item) => item.textContent.trim()),
      lesson_stages: phases.length ? phases : templateStages,
      key_assessment: templateField("key_assessment")?.textContent.trim() || "",
      rubric_mark_scheme: templateField("rubric_mark_scheme")?.textContent.trim() || "",
      reflection_remarks: templateField("reflection_remarks")?.textContent.trim() || ""
    };
  }

  function showLessonEditor(container, itemData) {
    const body = container.querySelector(".output-body");
    if (!body) return;
    const draft = extractLessonDraft(itemData);
    const data = itemData.data || {};
    const textValue = (value) => lessonTemplateItems(value).join("\n");
    const indicators = data.learning_indicators || data.indicators || data.indicator || "";
    const outcomes = draft.learning_outcomes?.length ? draft.learning_outcomes : data.learning_outcomes || data.learningOutcomes || "";
    const focalAreas = data.focal_areas || data.focalAreas || data.focal_area || data.focalArea || "";
    const lessonPlans = Array.isArray(draft.lessons) && draft.lessons.length
      ? draft.lessons
      : [{
        title: draft.title || itemData.title,
        lesson_stages: draft.lesson_stages || [],
        key_assessment: draft.key_assessment || "",
        rubric_mark_scheme: draft.rubric_mark_scheme || "",
        reflection_remarks: draft.reflection_remarks || ""
      }];
    const stageRows = (lesson, lessonIndex) => (lesson.lesson_stages || []).map((stage, index) => `
      <fieldset class="lesson-edit-stage"><legend>Stage ${index + 1}</legend>
        <label class="field"><span>Stage name</span><input name="stageName" data-lesson-stage="${lessonIndex}" value="${escapeHtml(stage.name || "")}" required></label>
        <label class="field"><span>Minutes</span><input name="stageMinutes" data-lesson-stage="${lessonIndex}" type="number" min="1" max="240" value="${escapeHtml(stage.minutes ?? 10)}" required></label>
        <label class="field field-wide"><span>Teacher Activities</span><textarea name="teacherActivity" data-lesson-stage="${lessonIndex}" rows="3">${escapeHtml(stage.teacher_activity || "")}</textarea></label>
        <label class="field field-wide"><span>Learner Activities</span><textarea name="learnerActivity" data-lesson-stage="${lessonIndex}" rows="3">${escapeHtml(stage.learner_activity || "")}</textarea></label>
        <label class="field field-wide"><span>Assessment / Check</span><textarea name="assessmentCheck" data-lesson-stage="${lessonIndex}" rows="2">${escapeHtml(stage.assessment_check || "")}</textarea></label>
      </fieldset>`).join("");
    const lessonEditSections = lessonPlans.map((lesson, index) => `
      <section class="lesson-edit-section lesson-edit-plan" data-lesson-plan="${index}">
        <h3>Lesson ${index + 1}</h3>
        <label class="field field-wide"><span>Lesson title</span><input name="lessonTitle" value="${escapeHtml(lesson.title || `Lesson ${index + 1}`)}" required></label>
        ${stageRows(lesson, index) || '<p class="field-help">No teaching stages were found for this lesson.</p>'}
        <div class="form-grid">
          <label class="field field-wide"><span>Key Assessment</span><textarea name="keyAssessment" rows="3">${escapeHtml(lesson.key_assessment || "")}</textarea></label>
          <label class="field field-wide"><span>Rubric / Mark Scheme</span><textarea name="rubric" rows="4">${escapeHtml(lesson.rubric_mark_scheme || draft.rubric_mark_scheme || "")}</textarea></label>
          <label class="field field-wide"><span>Reflection &amp; Remarks</span><textarea name="reflection" rows="3">${escapeHtml(lesson.reflection_remarks || "")}</textarea></label>
        </div>
      </section>`).join("");
    const form = document.createElement("form");
    form.className = "lesson-edit-form";
    form.innerHTML = `
      <section class="lesson-edit-section"><h3>Lesson overview</h3><div class="form-grid">
        <label class="field field-wide"><span>Lesson title</span><input name="title" maxlength="255" required value="${escapeHtml(draft.title || itemData.title)}"></label>
        <label class="field"><span>Number of learners</span><input name="learners" type="number" min="1" value="${escapeHtml(data.learners || data.number_of_learners || "")}"></label>
        <label class="field"><span>Week</span><input name="weekLabel" value="${escapeHtml(data.week_label || data.week || "")}"></label>
        <label class="field"><span>Lessons this week</span><input name="lessonCount" type="number" min="1" max="10" value="${lessonPlans.length}" readonly aria-readonly="true"><small class="field-help">To change the lesson count, generate a new plan with the desired number.</small></label>
        <label class="field"><span>Duration (minutes)</span><input name="duration" type="number" min="1" max="600" value="${escapeHtml(data.duration_minutes || data.duration || "")}"></label>
        <label class="field"><span>Form / class</span><input name="className" value="${escapeHtml(data.class_name || data.className || "")}"></label>
      </div></section>
      <section class="lesson-edit-section"><h3>Verified curriculum</h3><div class="form-grid">
        <label class="field field-wide"><span>Strand</span><textarea name="strand" rows="2">${escapeHtml(data.strand || "")}</textarea></label>
        <label class="field field-wide"><span>Sub-Strand</span><textarea name="subStrand" rows="2">${escapeHtml(data.sub_strand || data.substrand || "")}</textarea></label>
        <label class="field field-wide"><span>Focal Area(s) · one per line</span><textarea name="focalAreas" rows="2">${escapeHtml(textValue(focalAreas))}</textarea></label>
        <label class="field field-wide"><span>Content Standard</span><textarea name="contentStandard" rows="3">${escapeHtml(data.content_standard || data.standard || "")}</textarea></label>
        <label class="field field-wide"><span>Learning Outcome(s) · one per line</span><textarea name="outcomes" rows="3">${escapeHtml(textValue(outcomes))}</textarea></label>
        <label class="field field-wide"><span>Learning Indicator(s) · one per line</span><textarea name="indicators" rows="3">${escapeHtml(textValue(indicators))}</textarea></label>
      </div></section>
      <section class="lesson-edit-section"><h3>Lesson preparation</h3><div class="form-grid">
        <label class="field field-wide"><span>Essential Question(s) · one per line</span><textarea name="essentialQuestions" rows="2">${escapeHtml(textValue(draft.essential_questions || data.essential_questions))}</textarea></label>
        <label class="field field-wide"><span>Pedagogical Strategies · one per line</span><textarea name="strategies" rows="3">${escapeHtml(textValue(draft.pedagogical_strategies || data.pedagogical_strategies))}</textarea></label>
        <label class="field field-wide"><span>Teaching &amp; Learning Resources · one per line</span><textarea name="resources" rows="3">${escapeHtml(textValue(draft.resources || data.resources))}</textarea></label>
        <label class="field field-wide"><span>Prior knowledge</span><textarea name="priorKnowledge" rows="2">${escapeHtml(draft.prior_knowledge || "")}</textarea></label>
      </div></section>
      <section class="lesson-edit-section"><h3>Key Notes on Differentiation</h3><div class="form-grid">
        <label class="field"><span>Support</span><textarea name="differentiationSupport" rows="3">${escapeHtml(draft.differentiation?.support || "")}</textarea></label>
        <label class="field"><span>Core</span><textarea name="differentiationCore" rows="3">${escapeHtml(draft.differentiation?.core || "")}</textarea></label>
        <label class="field field-wide"><span>Extension</span><textarea name="differentiationExtension" rows="3">${escapeHtml(draft.differentiation?.extension || "")}</textarea></label>
      </div></section>
      <section class="lesson-edit-section"><h3>Lesson sequences, assessment and reflection</h3>${lessonEditSections}</section>
      <div class="lesson-edit-actions"><button class="button button-quiet" type="button" data-cancel-lesson-edit>Cancel</button><button class="button button-primary" type="submit">Save lesson changes</button></div>`;
    body.replaceWith(form);
    container.querySelector(".output-actions")?.setAttribute("hidden", "");
    form.querySelector("[data-cancel-lesson-edit]").addEventListener("click", () => {
      if (container === savedDocumentContent) {
        openSavedDocument(activeSavedDocument || itemData);
      } else {
        container.innerHTML = itemData.html;
        bindOutputActions(container, itemData);
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const saveButton = form.querySelector('[type="submit"]');
      saveButton.disabled = true;
      saveButton.textContent = "Saving changes…";
      const values = new FormData(form);
      const lessonEditors = Array.from(form.querySelectorAll(".lesson-edit-plan"));
      const numberOfLessons = lessonEditors.length;
      const lessons = lessonEditors.map((lessonEditor, lessonIndex) => {
        const stages = Array.from(lessonEditor.querySelectorAll(".lesson-edit-stage"));
        return {
          ...lessonPlans[lessonIndex],
          title: lessonEditor.querySelector('[name="lessonTitle"]').value.trim(),
          key_assessment: lessonEditor.querySelector('[name="keyAssessment"]').value.trim(),
          rubric_mark_scheme: lessonEditor.querySelector('[name="rubric"]').value.trim(),
          reflection_remarks: lessonEditor.querySelector('[name="reflection"]').value.trim(),
          lesson_stages: stages.map((stage) => ({
            name: stage.querySelector('[name="stageName"]').value.trim(),
            minutes: Number(stage.querySelector('[name="stageMinutes"]').value),
            teacher_activity: stage.querySelector('[name="teacherActivity"]').value.trim(),
            learner_activity: stage.querySelector('[name="learnerActivity"]').value.trim(),
            assessment_check: stage.querySelector('[name="assessmentCheck"]').value.trim()
          }))
        };
      });
      const updatedDraft = {
        ...draft,
        title: String(values.get("title")).trim(),
        learning_outcomes: String(values.get("outcomes") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        essential_questions: String(values.get("essentialQuestions") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        pedagogical_strategies: String(values.get("strategies") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        prior_knowledge: String(values.get("priorKnowledge") || "").trim(),
        resources: String(values.get("resources") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        key_assessment: String(values.get("keyAssessment") || "").trim(),
        rubric_mark_scheme: String(values.get("rubric") || "").trim(),
        reflection_remarks: String(values.get("reflection") || "").trim(),
        differentiation: {
          support: String(values.get("differentiationSupport") || "").trim(),
          core: String(values.get("differentiationCore") || "").trim(),
          extension: String(values.get("differentiationExtension") || "").trim()
        },
        lessons,
        lesson_stages: lessons[0]?.lesson_stages || [],
        key_assessment: lessons[0]?.key_assessment || "",
        rubric_mark_scheme: lessons[0]?.rubric_mark_scheme || "",
        reflection_remarks: lessons[0]?.reflection_remarks || ""
      };
      const data = {
        ...itemData.data,
        title: updatedDraft.title,
        topic: updatedDraft.title,
        learners: String(values.get("learners") || "").trim(),
        number_of_learners: String(values.get("learners") || "").trim(),
        number_of_lessons: numberOfLessons,
        week: String(values.get("weekLabel") || "").trim(),
        week_label: String(values.get("weekLabel") || "").trim(),
        duration: String(values.get("duration") || "").trim(),
        duration_minutes: String(values.get("duration") || "").trim(),
        class_name: String(values.get("className") || "").trim(),
        strand: String(values.get("strand") || "").trim(),
        sub_strand: String(values.get("subStrand") || "").trim(),
        focal_areas: String(values.get("focalAreas") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        content_standard: String(values.get("contentStandard") || "").trim(),
        learning_outcomes: updatedDraft.learning_outcomes,
        learning_indicators: String(values.get("indicators") || "").split("\n").map((line) => line.trim()).filter(Boolean),
        essential_questions: updatedDraft.essential_questions,
        pedagogical_strategies: updatedDraft.pedagogical_strategies,
        resources: updatedDraft.resources,
        lesson_draft: updatedDraft
      };
      const metadata = [
        ["Subject", data.subject || "Not specified"],
        ["SHS year", String(data.year || data.year_group || "").replace(/^SHS([123])$/, "SHS Year $1")],
        ["Verified source excerpts", String(itemData.data?.lesson_draft?.curriculum_sources?.length || 0)]
      ];
      const sourceList = (updatedDraft.curriculum_sources || []).map((source) => {
        const sourceUrl = safeSourceUrl(source.source_url);
        const link = sourceUrl
          ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>`
          : "";
        return `<li>${escapeHtml(source.title)}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${link}</li>`;
      }).join("");
      const formatSourceList = (updatedDraft.format_sources || []).map((source) => {
        const sourceUrl = safeSourceUrl(source.source_url);
        const link = sourceUrl
          ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>`
          : "";
        return `<li>${escapeHtml(source.title)}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${link}</li>`;
      }).join("");
      const formatSection = formatSourceList
        ? `<div class="document-section"><h3>Verified planning template checked</h3><ul class="ai-citations">${formatSourceList}</ul></div>`
        : `<div class="document-section"><h3>Planning format</h3><p>No administrator-verified template was found. This is an editable AI draft and is not represented as an officially approved format.</p></div>`;
      const html = documentFrame(
        updatedDraft.title,
        "LESSON PLAN · TEACHER-REVIEW DRAFT",
        metadata,
        renderLessonTemplate(data, updatedDraft, formatSection, sourceList),
        "",
        true
      );
      try {
        let savedDocument;
        const payload = { type: "lesson", title: updatedDraft.title, data, html };
        if (itemData.documentId) {
          const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(itemData.documentId)}`, "PUT", payload);
          savedDocument = result.document;
          documents = documents.map((doc) => doc.id === savedDocument.id ? savedDocument : doc);
          renderAll();
        } else {
          savedDocument = await saveDocument("lesson", updatedDraft.title, data, html);
        }
        Object.assign(itemData, {
          title: updatedDraft.title,
          data: savedDocument.data,
          html: savedDocument.html,
          documentId: savedDocument.id,
          alreadySaved: true
        });
        if (container === savedDocumentContent) {
          openSavedDocument(savedDocument);
        } else {
          container.innerHTML = savedDocument.html;
          bindOutputActions(container, itemData);
        }
        showToast("Lesson plan changes saved to your workspace.");
      } catch (error) {
        saveButton.disabled = false;
        saveButton.textContent = "Save lesson changes";
        showToast(error instanceof Error ? error.message : "Lesson plan changes could not be saved.", "error");
      }
    });
  }

  function printDocument(title, outputCard) {
    const content = outputCard?.querySelector(".output-body");
    if (!content) {
      showToast("This document cannot be prepared for printing.", "error");
      return;
    }
    let printWindow;
    try {
      printWindow = window.open("", "_blank");
    } catch (error) {
      showToast(error instanceof Error ? `The print window could not be opened: ${error.message}` : "The print window could not be opened.", "error");
      return;
    }
    if (!printWindow) {
      showToast("Allow pop-ups to prepare a properly formatted PDF.", "error");
      return;
    }
    printWindow.opener = null;
    const assessmentDocument = Boolean(content.querySelector(".assessment-question-list"));
    const lessonTemplate = Boolean(content.querySelector(".lesson-plan-table"));
    const pageLayout = assessmentDocument
      ? "@page { size: A4; margin: 20mm 16mm; }"
      : lessonTemplate
      ? "@page { size: A4 landscape; margin: 9mm; }"
      : "@page { size: A4; margin: 17mm 16mm; }";
    const styles = `
      ${pageLayout}
      * { box-sizing: border-box; }
      body { margin: 0; color: #25362d; font: 11pt/1.55 Arial, sans-serif; }
      ${assessmentDocument ? `
      body { padding: 0; }
      .print-running-header, .print-running-footer { position: fixed; left: 16mm; right: 16mm; display: flex; justify-content: space-between; gap: 12pt; color: #53665a; font: 8pt Arial, sans-serif; }
      .print-running-header { top: 5mm; padding-bottom: 5pt; border-bottom: .7pt solid #cbd6cc; color: #1d4934; font-weight: bold; }
      .print-running-footer { bottom: 5mm; padding-top: 5pt; border-top: .7pt solid #cbd6cc; }
      .assessment-cover-page { display: flex; min-height: 245mm; flex-direction: column; padding: 0 12mm 12mm; border: .7pt solid #d5e0d6; background: #fff; break-after: page; page-break-after: always; }
      .assessment-cover-brand { display: flex; align-items: center; gap: 12pt; margin: 0 -12mm; padding: 12mm; color: #fff; background: #123d30; }
      .assessment-cover-brand > div { display: grid; gap: 3pt; }
      .assessment-cover-brand span { color: #d7e5db; font-size: 8pt; font-weight: bold; letter-spacing: 1.4pt; }
      .assessment-cover-brand strong { color: #fff; font-size: 12pt; }
      .assessment-cover-logo, .assessment-cover-monogram { display: grid; width: 42pt; height: 42pt; place-items: center; border-radius: 8pt; }
      .assessment-cover-logo { padding: 3pt; object-fit: contain; background: #fff; }
      .assessment-cover-monogram { color: #173d30; background: #fff; font-size: 20pt; font-weight: bold; }
      .assessment-cover-accent { height: 3pt; margin: 0 0 24pt; background: #c69b3c; }
      .assessment-cover-kicker { margin: 0; color: #8b6a29; font-size: 8pt; font-weight: bold; letter-spacing: 1.3pt; }
      .assessment-cover-page h1 { max-width: 150mm; margin: 8pt 0 18pt; color: #173a2a; font-size: 27pt; line-height: 1.13; }
      .assessment-cover-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7pt; margin-top: 2pt; }
      .assessment-cover-meta > div { min-height: 39pt; padding: 7pt 9pt; border: .7pt solid #d8e1d9; border-left: 2pt solid #c69b3c; background: #f7f9f7; }
      .assessment-cover-meta small, .assessment-cover-meta strong { display: block; }
      .assessment-cover-meta small { color: #66776c; font-size: 7pt; font-weight: bold; letter-spacing: .5pt; text-transform: uppercase; }
      .assessment-cover-meta strong { margin-top: 4pt; color: #25362d; font-size: 10pt; }
      .assessment-cover-prepared { display: grid; gap: 4pt; margin-top: auto; padding: 11pt 13pt; border: .7pt solid #d8e1d9; border-left: 3pt solid #1d4934; background: #f3f6f3; }
      .assessment-cover-prepared span { color: #607466; font-size: 7pt; font-weight: bold; letter-spacing: .8pt; }
      .assessment-cover-prepared strong { color: #1d4934; font-size: 12pt; }
      .assessment-cover-prepared small { color: #53665a; font-size: 8pt; }
      .assessment-cover-note { margin: 9pt 0 0; color: #718076; font-size: 7pt; }
      ` : ""}
      h2 { margin: 0 0 8pt; color: #1d4934; font-size: 20pt; }
      h3 { margin: 18pt 0 7pt; color: #1d4934; font-size: 13pt; }
      p, li { orphans: 3; widows: 3; }
      .assessment-print-page-break { break-before: page; page-break-before: always; }
      .document-title-block { margin-bottom: 14pt; padding-bottom: 10pt; border-bottom: 1px solid #cdd8cf; text-align: center; }
      .document-title-block .eyebrow { color: #56695c; font-size: 8pt; font-weight: bold; letter-spacing: 1pt; }
      .document-title-block p { margin: 0; color: #647267; font-size: 9pt; }
      .assessment-title-block { margin-bottom: 8pt; }
      .assessment-paper-details { width: 100%; margin: 8pt 0; border-collapse: collapse; font-size: 9pt; }
      .assessment-paper-details th, .assessment-paper-details td { padding: 4pt 6pt; border-bottom: .6pt solid #9da99f; text-align: left; vertical-align: top; }
      .assessment-paper-details th { width: 17%; font-weight: bold; }
      .assessment-paper-details td { width: 33%; }
      .assessment-candidate-fields { display: grid; grid-template-columns: 2fr 1fr; gap: 7pt 14pt; margin: 10pt 0 16pt; font-size: 9pt; }
      .assessment-candidate-fields span { display: flex; gap: 5pt; }
      .assessment-candidate-fields i { min-width: 40pt; flex: 1; border-bottom: .6pt solid #7d887f; }
      .document-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7pt; margin: 12pt 0; }
      .meta-box { padding: 7pt; border: 1px solid #d9e1da; break-inside: avoid; }
      .meta-box small, .meta-box strong { display: block; }
      .meta-box small { color: #67766b; font-size: 7pt; text-transform: uppercase; }
      .meta-box strong { margin-top: 3pt; font-size: 9pt; }
      .document-section { margin-top: 14pt; break-inside: auto; }
      .lesson-phase { display: grid; grid-template-columns: 50pt 1fr; gap: 8pt; padding: 8pt 0; border-top: 1px solid #dfe6df; break-inside: avoid; }
      .phase-time { color: #315c40; font-size: 9pt; font-weight: bold; }
      .scheme-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
      .scheme-table th, .scheme-table td { padding: 5pt; border: 1px solid #cfd8d0; text-align: left; vertical-align: top; }
      .scheme-table th { background: #eff4ef !important; }
      .lesson-plan-output-body { padding: 0; }
      .lesson-template-scroll { width: 100%; overflow: visible; }
      .lesson-plan-table { width: 100%; table-layout: fixed; border-collapse: collapse; color: #25362d; font: 7pt/1.28 Arial,sans-serif; }
      .lesson-plan-table th, .lesson-plan-table td { padding: 3pt 4pt; border: .6pt solid #89968c; overflow-wrap: anywhere; text-align: left; vertical-align: top; }
      .lesson-plan-table th { background: #edf2ed !important; color: #263d2e; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .lesson-plan-table td ul { margin: 0; padding-left: 12pt; }
      .lesson-plan-table td li { margin: 0 0 1pt; }
      .lesson-plan-table p { margin: 0 0 2pt; }
      .lesson-plan-table .lesson-template-subject td { background: #e9efe9 !important; font-size: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .lesson-plan-table .lesson-template-title td, .lesson-plan-table .lesson-template-section-heading td { background: #dce8dd !important; color: #243d2d; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .lesson-plan-table .lesson-template-title td { font-size: 9pt; text-align: center; }
      .lesson-plan-table .lesson-template-meta th { font-size: 6pt; }
      .lesson-plan-table .lesson-template-lesson-title td { background: #edf2ed !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .lesson-template-placeholder { color: #657368; font-style: italic; }
      .lesson-plan-table .lesson-template-stage-row > td { padding: 4pt 6pt; }
      .lesson-template-stage { padding: 3pt 2pt 5pt; border-bottom: .5pt solid #d7dfd8; break-inside: avoid; page-break-inside: avoid; }
      .lesson-template-stage h4 { display: flex; justify-content: space-between; gap: 8pt; margin: 0 0 3pt; color: #284c39; font-size: 7pt; }
      .lesson-template-stage h4 span { font-size: 6.5pt; white-space: nowrap; }
      .lesson-template-stage-field { display: block; margin: 3pt 0; }
      .lesson-template-stage-field > strong { display: block; margin-bottom: 1pt; color: #344f3d; }
      .lesson-template-stage-field > div { display: block; }
      .lesson-template-stage-field p { margin: 0 0 2pt; }
      .lesson-template-warning td { background: #fff8e9 !important; color: #6c5a32; font-size: 6pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .output-warning, .assessment-origin-notice { margin-top: 14pt; padding: 9pt; border: 1px solid #e8dcb9; background: #fffaf0 !important; }
      .assessment-origin-notice { padding: 0 0 8pt; border: 0; border-bottom: .6pt solid #9da99f; background: transparent !important; }
      .assessment-origin-notice p { margin: 3pt 0 0; }
      .assessment-question-list { margin: 8pt 0; padding-left: 0; list-style: none; }
      .assessment-question { margin: 0 0 12pt; padding: 0 0 8pt; border: 0; border-bottom: .5pt solid #c5cec7; break-inside: avoid; page-break-inside: avoid; }
      .assessment-question-heading { display: flex; align-items: baseline; gap: 8pt; font-size: 10pt; font-weight: bold; }
      .assessment-question-heading span { font-size: 9pt; font-weight: normal; }
      .assessment-question-change, .assessment-question-edit-note, .assessment-question-time { display: none !important; }
      .assessment-question > p { margin: 6pt 0; }
      .assessment-table-wrap { width: 100%; margin: 8pt 0 12pt; overflow: visible; }
      .assessment-question-table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 9pt; }
      .assessment-question-table th, .assessment-question-table td { min-width: 0; padding: 5pt 7pt; border: .7pt solid #89968c; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      .assessment-question-table th { background: #edf2ed !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .assessment-options { margin: 6pt 0; padding-left: 24pt; list-style-type: upper-alpha; }
      .assessment-options li { margin: 3pt 0; }
      .assessment-answer-space { min-height: 38pt; margin: 8pt 0 2pt; border: 0; background: repeating-linear-gradient(to bottom, transparent 0, transparent 17pt, #a5aea7 17pt, #a5aea7 17.5pt); }
      .assessment-visual-wrap { max-width: 100%; margin: 8pt 0; overflow: visible; padding: 0; border: 0; background: transparent; }
      .assessment-graph, .assessment-chart, .assessment-geometry { display: block; width: min(100%, 560px); height: auto; margin: 0 auto; font-family: Arial, sans-serif; }
      .assessment-graph .graph-grid { stroke: #e8ede9; stroke-width: 1; }
      .assessment-graph .graph-axis, .assessment-chart .graph-axis { stroke: #61756a; stroke-width: 1.4; }
      .assessment-graph .graph-series { fill: none; stroke: #1672a0; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
      .assessment-graph .graph-point { fill: #1672a0; stroke: white; stroke-width: 1.5; }
      .assessment-graph .graph-title, .assessment-chart .graph-title, .assessment-geometry .graph-title { fill: #263a30; font-size: 13px; font-weight: 700; }
      .assessment-graph .graph-tick, .assessment-chart .graph-tick, .assessment-geometry .geometry-label { fill: #66756d; font-size: 10px; }
      .assessment-graph .graph-label { fill: #42554a; font-size: 11px; font-weight: 600; }
      .assessment-chart .chart-bar { fill: #378c69; }
      .assessment-geometry .geometry-shape { fill: #eaf2ed; stroke: #247456; stroke-width: 2; }
      .assessment-math { font-family: "Cambria Math", "Times New Roman", serif; }
      .assessment-fraction { display: inline-flex; vertical-align: middle; flex-direction: column; align-items: center; }
      .assessment-fraction > span:first-child { padding: 0 2pt 1pt; border-bottom: .6pt solid currentColor; }
      .assessment-fraction > span:last-child { padding-top: 1pt; }
      .assessment-root { display: inline-flex; vertical-align: middle; }
      .assessment-root > span:last-child { border-top: .6pt solid currentColor; }
      a { color: #24543a; text-decoration: none; }
      @media print { .document-section, .lesson-phase, .lesson-plan-table tr, .lesson-template-stage { page-break-inside: avoid; break-inside: avoid; } }
    `;
    try {
      const printContent = content.cloneNode(true);
      printContent.querySelectorAll(".assessment-question-change, .assessment-question-edit-note, .assessment-question-time").forEach((element) => element.remove());
      if (printContent.querySelector(".assessment-question-list")) {
        if (!printContent.querySelector(".assessment-cover-page")) {
          printContent.insertAdjacentHTML("afterbegin", assessmentCoverMarkup(title, "ASSESSMENT · TEACHER REVIEW", []));
          printContent.querySelector(".assessment-title-block")?.remove();
        }
        printContent.querySelectorAll(".document-meta, .assessment-paper-details, .assessment-candidate-fields").forEach((element) => element.remove());
        printContent.querySelectorAll(".assessment-title-block .eyebrow, .assessment-title-block > p").forEach((element) => element.remove());
      }
      const administrator = assessmentAdministratorDetails();
      const runningHeader = assessmentDocument
        ? `<div class="print-running-header"><span>AKADEMI · ${escapeHtml(administrator.school || "GHANA SHS")}</span><span>${escapeHtml(title)}</span></div>`
        : "";
      const runningFooter = assessmentDocument
        ? `<div class="print-running-footer"><span>Prepared by ${escapeHtml(administrator.name || "Teacher / administrator")}${administrator.email ? ` · ${escapeHtml(administrator.email)}` : ""}</span><span>Teacher review copy</span></div>`
        : "";
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${runningHeader}${printContent.innerHTML}${runningFooter}</body></html>`);
      printWindow.document.close();
      setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
          showToast("Print dialog opened. Choose a printer or Save as PDF.");
        } catch (error) {
          showToast(error instanceof Error ? `The print dialog could not be opened: ${error.message}` : "The print dialog could not be opened.", "error");
        }
      }, 250);
    } catch (error) {
      printWindow.close();
      showToast(error instanceof Error ? `The document could not be prepared for printing: ${error.message}` : "The document could not be prepared for printing.", "error");
    }
  }

  function timedPhases(duration) {
    const ratios = [0.14, 0.22, 0.36, 0.2, 0.08];
    const names = ["Introduction & prior learning", "Guided exploration", "Main learning activity", "Practice & assessment", "Reflection & closure"];
    const activities = [
      ["Elicit relevant prior knowledge and share the lesson purpose.", "Share existing ideas and identify questions about the lesson.", "Learners can connect the lesson topic to prior learning."],
      ["Model a worked example and guide learners through the key reasoning.", "Respond to prompts and discuss the worked example with a partner.", "Check explanations and address initial misconceptions."],
      ["Facilitate the main activity and circulate to give targeted support.", "Complete the task individually or collaboratively and explain their reasoning.", "Observe participation and check progress against the indicator."],
      ["Set an independent application task and review learner responses.", "Apply the learning to a new example and show working.", "Collect evidence of individual understanding."],
      ["Summarise key learning and set a follow-up task.", "Share one conclusion and identify any remaining question.", "Use learner reflections to plan follow-up support."]
    ];
    const raw = ratios.map((ratio) => Math.floor(duration * ratio));
    let remainder = duration - raw.reduce((sum, value) => sum + value, 0);
    for (let index = 0; remainder > 0; index = (index + 1) % raw.length, remainder--) raw[index]++;
    return names.map((name, index) => ({
      name,
      minutes: raw[index],
      teacher_activity: activities[index][0],
      learner_activity: activities[index][1],
      assessment_check: activities[index][2]
    }));
  }

  function renderLesson(data) {
    const duration = Number(data.duration);
    const indicatorText = Array.isArray(data.indicators) ? data.indicators.join("\n") : data.indicator;
    const outcomeText = Array.isArray(data.learningOutcomes) ? data.learningOutcomes.join("\n") : "";
    const draft = {
      title: data.topic,
      learning_outcomes: lessonTemplateItems(outcomeText),
      prior_knowledge: data.prior || "",
      resources: lessonTemplateItems(data.resources),
      lessons: Array.from({ length: Number(data.number_of_lessons) || 1 }, (_, index) => ({
        title: `Lesson ${index + 1}: ${data.topic}`,
        lesson_stages: timedPhases(duration),
        key_assessment: "",
        rubric_mark_scheme: "",
        reflection_remarks: ""
      }))
    };
    const documentData = { ...data, lesson_draft: draft };
    const html = documentFrame(
      data.topic,
      "LESSON PLAN · TEACHER REVIEW DRAFT",
      [["Subject", data.subject], ["SHS year / class", `${data.year} · ${data.className || "Class not specified"}`], ["Academic year / week", `${data.academicYear || "Not specified"} · ${data.week || "Not specified"}`], ["Duration", `${duration} minutes`], ["School", data.school || profile.school], ["Learners", data.learners || "Not specified"]],
      renderLessonTemplate(data, draft),
      "",
      true
    );
    const region = document.getElementById("lesson-output");
    region.innerHTML = html;
    region.scrollIntoView({ behavior: "smooth", block: "start" });
    bindOutputActions(region, { type: "lesson", title: `${data.subject}: ${data.topic}`, data: documentData, html });
  }

  document.getElementById("lesson-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateLessonForm(form)) return;
    const data = lessonFormValues();
    renderLesson(data);
    lessonDialog.close();
    document.getElementById("lesson-output").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function safeSourceUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function renderAssessment(data) {
    latestAssessment = null;
    generatedAssessmentVariants = [];
    document.getElementById("generated-assessment-online-actions").hidden = true;
    const publishPanel = document.getElementById("assessment-publish-panel");
    publishPanel.classList.add("hidden");
    publishPanel.hidden = true;
    document.getElementById("generated-tab-class").hidden = true;
    document.getElementById("assessment-results").hidden = true;
    document.getElementById("assessment-publish-result").replaceChildren();
    const variants = data.combinations?.length ? data.combinations : [data];
    const questionCount = Math.max(1, Math.min(100, Number(data.questionCount) || 10));
    const suppliedQuestions = lines(data.questions);
    const questions = Array.from({ length: questionCount }, (_, index) => suppliedQuestions[index] || "");
    const marks = Math.max(1, Number(data.marks) || 1);
    const questionList = `<ol>${questions.map((question) => `<li>${escapeHtml(question) || "<span class=\"assessment-answer-space\" aria-label=\"Question writing space\"></span>"}</li>`).join("")}</ol>`;
    const markingQuestions = `<ol>${questions.map(() => "<li><p><strong>Expected response / marking points:</strong> __________________________________________</p><p><strong>Marks:</strong> ______</p></li>").join("")}</ol>`;
    const typeLabels = { class_exercise: "Class exercise", mid_semester: "Mid-semester", end_of_semester: "End of semester", mock: "Mock examination" };
    const formatLabels = { mixed: "Mixed format", mcq: "MCQ", worked: "Worked / structured", extended: "Extended answer", brief: "Brief answer", other: data.otherFormat || "Other format" };
    const outputCards = variants.map((variant) => {
      const years = variant.year_groups?.length ? variant.year_groups : [variant.year_group || variant.year];
      const year = years.map((value) => value?.replace(/^SHS([123])$/, "SHS Year $1")).filter(Boolean).join(", ") || "Year not set";
      const className = variant.class_name || "Not specified";
      const title = variants.length > 1
        ? `${data.title} · ${[year, className, typeLabels[variant.assessment_type], formatLabels[variant.question_format], `${variant.duration_minutes || variant.duration} min`].filter(Boolean).join(" · ")}`
        : data.title;
      const averageQuestionSeconds = Math.round(Number(variant.duration_minutes || variant.duration || 60) * 60 / questionCount);
      const meta = [
        ["Subject", data.subject],
        ["SHS year / class", `${year} · ${className}`],
        ["Assessment type", typeLabels[variant.assessment_type] || "Teacher selected"],
        ["Question format", formatLabels[variant.question_format] || "Teacher selected"],
        ["Duration", `${variant.duration_minutes || variant.duration || "—"} minutes`],
        ["Average time per question", `${Math.floor(averageQuestionSeconds / 60)} min ${averageQuestionSeconds % 60} sec`],
        ["Questions", String(questionCount)],
        ["Total marks", String(marks)],
        ["Scope", "Teacher-supplied"],
        ["Created", new Date().toLocaleDateString("en-GH")]
      ];
      const studentHtml = documentFrame(data.title, "QUESTION PAPER · TEACHER REVIEW DRAFT", meta, `<div class="document-section"><h3>Instructions</h3><p>Answer all questions. Show your working where appropriate.</p></div><div class="document-section"><h3>Questions</h3>${questionList}</div>`, "Student-paper draft only: question mark values have not been assigned. Confirm the paper totals, content, accessibility and examination requirements before printing.", false, true);
      const markingHtml = documentFrame(`${data.title} · marking guide`, "TEACHER MARKING GUIDE · REVIEW DRAFT", meta, `<div class="document-section"><h3>Question-by-question marking guide</h3>${markingQuestions}</div><div class="document-section"><h3>Additional teacher marking notes</h3><p>${escapeHtml(data.marking || "Add correct responses, acceptable alternatives, method marks and scoring guidance.")}</p></div>`, "This is a teacher-only working guide. Add and reconcile question-level allocations to the total shown before use.", false, true);
      return { variant, title, meta, studentHtml, markingHtml };
    });
    const region = document.getElementById("assessment-output");
    region.innerHTML = outputCards.map(({ studentHtml, markingHtml }) => `${studentHtml}${markingHtml}`).join("");
    const paperContent = document.getElementById("generated-assessment-paper-content");
    const guideContent = document.getElementById("generated-assessment-guide-content");
    const detailsContent = document.getElementById("generated-assessment-details-content");
    paperContent.replaceChildren();
    guideContent.replaceChildren();
    detailsContent.replaceChildren();
    outputCards.forEach(({ variant, title, meta, studentHtml, markingHtml }, index) => {
      const paperCard = assessmentPreviewCard(studentHtml);
      const guideCard = assessmentPreviewCard(markingHtml);
      paperContent.append(paperCard);
      guideContent.append(guideCard);
      detailsContent.insertAdjacentHTML("beforeend", `<section class="assessment-admin-details-section"><h3>${escapeHtml(title)}</h3><table class="assessment-admin-details"><tbody>${meta.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}<tr><th scope="row">Coverage</th><td>${escapeHtml(data.scope || "Teacher-supplied")}</td></tr></tbody></table></section>`);
      bindOutputActions(paperCard, { type: "assessment", title: `${data.title} · question paper`, data: variant, html: studentHtml });
      bindOutputActions(guideCard, { type: "assessment", title: `${data.title} · marking guide`, data: variant, html: markingHtml });
    });
    region.innerHTML = `<div class="generated-assessment-notice"><div><strong>${escapeHtml(data.title)}</strong><p>${variants.length} assessment combination${variants.length === 1 ? "" : "s"} ready to review.</p></div><button type="button" class="small-button" data-open-generated-assessment>Open generated assessment</button></div>`;
    bindGeneratedAssessmentOpen(region);
    document.getElementById("generated-assessment-title").textContent = data.title;
    setGeneratedAssessmentTab("paper");
    if (!generatedAssessmentDialog.open) generatedAssessmentDialog.showModal();
  }
  document.getElementById("assessment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.currentTarget.elements.namedItem("deliveryMode").value === "online") {
      showToast("Online assessments need AI-generated questions. Choose Generate with AI to continue.", "error");
      return;
    }
    if (!event.currentTarget.reportValidity() || !validateAssessmentSelections()) return;
    const data = formData(event.currentTarget);
    const selectedYears = Array.from(assessmentSelections.year);
    const selectedClasses = teacherAssessmentClasses.filter((item) => selectedAssessmentClassIds.has(Number(item.id)));
    data.combinations = Array.from(assessmentSelections.assessmentType).flatMap((assessment_type) =>
      Array.from(assessmentSelections.questionFormat).flatMap((question_format) =>
        Array.from(assessmentSelections.duration).map((duration_minutes) => ({
          year_group: selectedYears[0],
          year_groups: selectedYears,
          class_name: selectedClasses.map((item) => item.name).join(", "),
          class_ids: selectedClasses.map((item) => Number(item.id)),
          assessment_type,
          question_format,
          duration_minutes: Number(duration_minutes)
        }))
      )
    );
    renderAssessment(data);
    planningDialogs.assessment.close();
  });
  const publishedAccessCodes = new Map();
  let activeOnlineAssessmentId = null;
  let onlineResultsPollTimer = 0;
  let onlineResultsPollPending = false;
  let activeOnlineResultsSnapshot = "";
  const onlineAssessmentForm = document.getElementById("online-assessment-form");
  const assessmentPublishClasses = document.getElementById("assessment-publish-classes");
  const assessmentPublishResult = document.getElementById("assessment-publish-result");
  const assessmentResults = document.getElementById("assessment-results");
  const onlineAssessmentLibrary = document.getElementById("online-assessment-library");
  const onlineAssessmentLibraryList = document.getElementById("online-assessment-library-list");
  const onlineAssessmentLibraryStatus = document.getElementById("online-assessment-library-status");
  const savedAssessmentSearch = document.getElementById("saved-assessment-search");
  const savedAssessmentStatusFilter = document.getElementById("saved-assessment-filter-status");
  let savedOnlineAssessments = [];
  document.querySelectorAll("[data-assessment-workspace-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const selected = tab.dataset.assessmentWorkspaceTab;
      document.querySelectorAll("[data-assessment-workspace-tab]").forEach((item) => {
        const active = item === tab;
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll("[data-assessment-workspace-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.assessmentWorkspacePanel !== selected;
      });
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll("[data-assessment-workspace-tab]"));
      const index = tabs.indexOf(tab);
      tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].click();
      document.querySelector('[data-assessment-workspace-tab][aria-selected="true"]').focus();
    });
  });
  document.querySelectorAll("[data-assessment-workspace-tab]").forEach((tab) => {
    tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
  });
  const assessmentVariantField = onlineAssessmentForm.elements.namedItem("assessmentVariant");
  const assessmentAccessModeField = onlineAssessmentForm.elements.namedItem("accessMode");
  const assessmentTeacherCodeField = onlineAssessmentForm.elements.namedItem("teacherAccessCode");
  const assessmentTeacherCodePanel = document.getElementById("assessment-teacher-code-field");
  const assessmentSecurityField = assessmentForm.elements.namedItem("securityLevel");
  const assessmentSecurityGuidance = document.getElementById("assessment-security-guidance");
  let activeOnlineResults = null;
  const securityGuidance = {
    medium: "Medium security: use a supervised setting and keep this assessment in one browser tab. The server controls your timer and single-use code. Tab changes, focus loss, copy/cut/paste, context-menu and some screenshot-shortcut attempts may be recorded; supported browsers block some of these actions. These signals are not proof of misconduct, and no browser can prevent every operating-system screenshot, external app, device or camera.",
    advanced: "Advanced security: use a supervised setting and one device per learner. Keep this browser tab open and fullscreen enabled. Tab changes, focus loss, fullscreen exits, copy/cut/paste, context-menu and some screenshot-shortcut attempts may be recorded; supported browsers block some of these actions. No browser can prevent every operating-system screenshot, external app, second device or camera. If fullscreen is unavailable, tell your teacher before continuing. Follow your teacher’s instructions and ask for help if your connection drops."
  };
  const syncAssessmentSecurityGuidance = () => {
    const message = securityGuidance[assessmentSecurityField.value] || securityGuidance.medium;
    assessmentSecurityGuidance.textContent = message;
    document.getElementById("assessment-publish-security-summary").textContent = `${assessmentSecurityField.value === "advanced" ? "Advanced" : "Medium"} security selected. ${message}`;
  };
  assessmentSecurityField.addEventListener("change", syncAssessmentSecurityGuidance);
  syncAssessmentSecurityGuidance();
  const syncAssessmentAccessFields = () => {
    const needsTeacherCode = assessmentAccessModeField.value === "teacher_code";
    assessmentTeacherCodePanel.hidden = !needsTeacherCode;
    assessmentTeacherCodeField.required = needsTeacherCode;
    if (!needsTeacherCode) assessmentTeacherCodeField.value = "";
  };
  assessmentAccessModeField.addEventListener("change", syncAssessmentAccessFields);
  syncAssessmentAccessFields();
  function selectedPublishClassIds() {
    return Array.from(assessmentPublishClasses.querySelectorAll('input[name="publishClassIds"]:checked'), (input) => Number(input.value));
  }
  function renderAssessmentPublishClasses(useVariantDefaults = false) {
    const variant = generatedAssessmentVariants[Number(assessmentVariantField.value)];
    assessmentPublishClasses.replaceChildren();
    if (!variant) {
      assessmentPublishClasses.textContent = "Generate or open an assessment before selecting classes.";
      return;
    }
    const input = variant.input;
    const years = Array.isArray(input.year_groups) && input.year_groups.length
      ? input.year_groups.map(String)
      : [String(input.year_group || "")].filter(Boolean);
    const subject = String(input.subject || "").trim().toLocaleLowerCase();
    const classes = teacherAssessmentClasses.filter((item) =>
      !item.archived_at
      && Number(item.learner_count) > 0
      && years.includes(String(item.year_group))
      && (item.subjects || [item.subject_name].filter(Boolean))
        .some((name) => String(name).trim().toLocaleLowerCase() === subject)
    );
    const defaults = useVariantDefaults
      ? new Set((Array.isArray(input.class_ids) ? input.class_ids : []).map(Number))
      : new Set(selectedPublishClassIds());
    if (useVariantDefaults && defaults.size === 0) {
      selectedAssessmentClassIds.forEach((id) => defaults.add(Number(id)));
    }
    if (!classes.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "No active classes match this assessment’s subject and SHS year with at least one learner. Create or update a class in Class management.";
      assessmentPublishClasses.append(empty);
      return;
    }
    classes.forEach((item) => {
      const label = document.createElement("label");
      label.className = "assessment-class-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "publishClassIds";
      checkbox.value = String(item.id);
      checkbox.checked = defaults.has(Number(item.id));
      checkbox.addEventListener("change", syncAssessmentPublishVariant);
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const meta = document.createElement("small");
      meta.textContent = `${String(item.year_group).replace("SHS", "SHS Year ")} · ${item.learner_count} learner${Number(item.learner_count) === 1 ? "" : "s"}`;
      details.append(name, meta);
      label.append(checkbox, details);
      assessmentPublishClasses.append(label);
    });
  }
  function syncAssessmentPublishVariant() {
    const variant = generatedAssessmentVariants[Number(assessmentVariantField.value)];
    const publishButton = onlineAssessmentForm.querySelector('[type="submit"]');
    publishButton.disabled = !variant;
  }
  assessmentVariantField.addEventListener("change", () => {
    renderAssessmentPublishClasses(true);
    syncAssessmentPublishVariant();
  });

  function assessmentShareInstructions(assessment, takeUrl) {
    const expiry = assessment.expires_at ? new Date(`${String(assessment.expires_at).replace(" ", "T")}Z`) : null;
    const expiryText = expiry && !Number.isNaN(expiry.valueOf())
      ? new Intl.DateTimeFormat("en-GH", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Accra" }).format(expiry)
      : "the closing time shown on the assessment page";
    const entryInstructions = assessment.access_mode === "none"
      ? "Open the link, select your class and name from the roster, then start the assessment."
      : assessment.access_mode === "teacher_code"
        ? "Open the link, select your class and name, then enter the assessment code provided by your teacher."
        : "Open the link, select your class and name, then enter the private individual code provided by your teacher.";
    return [
      `${assessment.title} · ${assessment.class_name || "Online assessment"}`,
      `${entryInstructions} Keep any code private.`,
      `${assessment.duration_minutes || ""} minutes · Closes ${expiryText} Ghana time. Read the on-page instructions and submit before time runs out.`,
      ...(assessment.status === "paused" ? ["The exam is paused; wait for your teacher to resume it."] : []),
      takeUrl
    ].join("\n");
  }

  function formatAssessmentExpiry(value) {
    const date = new Date(`${String(value || "").replace(" ", "T")}Z`);
    return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("en-GH", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra"
    }).format(date) + " (Ghana time)";
  }

  function updateAssessmentCountdowns() {
    document.querySelectorAll("[data-assessment-countdown]").forEach((element) => {
      const expiry = new Date(`${String(element.dataset.expiresAt || "").replace(" ", "T")}Z`).valueOf();
      if (!Number.isFinite(expiry)) return;
      let remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      if (!remaining) {
        element.textContent = "The link has expired. Refresh to update the results status.";
        return;
      }
      const days = Math.floor(remaining / 86400); remaining %= 86400;
      const hours = Math.floor(remaining / 3600); remaining %= 3600;
      const minutes = Math.floor(remaining / 60); const seconds = remaining % 60;
      element.textContent = `Time remaining: ${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
    });
  }
  window.setInterval(updateAssessmentCountdowns, 1000);

  async function downloadAnswerReview(student, assessment, questions, format) {
    if (!window.akademiAssessmentExport) throw new Error("The assessment export tools are unavailable. Refresh and try again.");
    const blocks = [
      { text: `Learner: ${student.learner_name}  |  Status: ${student.status.replaceAll("_", " ")}`, style: "Heading1" },
      { text: `Assessment: ${assessment.title}  |  Class: ${assessment.class_name || ""}  |  Subject: ${assessment.subject || ""}` },
      { text: "Question-by-question feedback", style: "Heading1" }
    ];
    const exportQuestions = questions.map((question, index) => {
      const answer = (student.answers || {})[String(index)] || "";
      const timedOut = (student.timed_out_questions || []).includes(index) || student.status === "expired";
      const isMcq = Array.isArray(question.options);
      const correctOption = isMcq ? Number(question.correct_option) : -1;
      const selectedAnswer = isMcq && answer !== ""
        ? `${String.fromCharCode(65 + Number(answer))}. ${question.options[Number(answer)] || "Invalid option"}`
        : answer || "No response";
      const correctAnswer = isMcq
        ? `${String.fromCharCode(65 + correctOption)}. ${question.options[correctOption] || "Unavailable"}`
        : "";
      const isCorrect = isMcq && answer !== "" && Number(answer) === correctOption && !timedOut;
      const isIncorrect = isMcq && answer !== "" && !isCorrect && !timedOut;
      const state = timedOut ? "Timed out" : isMcq ? answer === "" ? "No response" : isCorrect ? "Correct" : "Incorrect" : answer ? student.manual_score !== null ? "Written response · reviewed" : "Written response · awaiting marking" : "No response";
      const earned = isMcq && isCorrect ? Number(question.marks) : 0;
      const learnerAnswer = timedOut && answer === "" ? "Timed out before answering" : selectedAnswer;
      const savedReview = student.question_reviews?.[String(index)] || {};
      const parsed = window.akademiAssessmentRendering?.parseQuestionTable(question.prompt, question.table)
        || { text: question.prompt || "", rows: [] };
      const review = {
        state: `${state}${isMcq ? ` · ${earned}/${question.marks} marks` : ""}`,
        learnerAnswer,
        correctAnswer,
        isCorrect,
        isIncorrect,
        expectedResponse: isMcq ? "" : question.expected_answer || "Teacher review required.",
        teacherFeedback: savedReview.comment ? `${savedReview.comment}${savedReview.score !== undefined ? ` · ${savedReview.score}/${question.marks} marks` : ""}` : ""
      };
      blocks.push({ text: `Question ${index + 1}  |  ${question.marks} marks`, style: "Heading1" });
      if (parsed.text) blocks.push({ text: parsed.text });
      if (parsed.rows.length > 1) blocks.push({ type: "table", rows: parsed.rows });
      if (isMcq) question.options.forEach((option, optionIndex) =>
        blocks.push({ text: `${String.fromCharCode(65 + optionIndex)}. ${option}` }));
      blocks.push({ text: `Result: ${review.state}`, color: isCorrect ? "16703B" : isIncorrect ? "B42318" : "526158", bold: true });
      blocks.push({ text: `Learner response: ${review.learnerAnswer}`, color: isCorrect ? "16703B" : isIncorrect ? "B42318" : undefined });
      blocks.push({ text: isMcq ? `Correct answer: ${review.correctAnswer}` : `Expected response: ${review.expectedResponse}`, color: isMcq ? "16703B" : undefined });
      if (review.teacherFeedback) blocks.push({ text: `Teacher feedback: ${review.teacherFeedback}` });
      return { ...question, prompt: parsed.text, table: parsed.rows.length > 1 ? { rows: parsed.rows } : question.table, review };
    });
    const title = `${assessment.title} - ${student.learner_name}`;
    await window.akademiAssessmentExport.downloadWithLogo({
      title,
      mode: "review",
      reviewExport: true,
      instructions: `Review the feedback for ${student.learner_name}.`,
      questions: exportQuestions,
      blocks,
      administrator: assessmentAdministratorDetails(),
      _export: {
        subject: assessment.subject || "",
        yearGroup: assessment.year_group || "",
        className: assessment.class_name || "",
        assessmentType: "Learner answer review",
        learnerName: student.learner_name,
        duration: assessment.duration_minutes || "",
        totalMarks: assessment.total_marks || ""
      }
    }, format);
  }

  function finalizedAssessmentScore(student) {
    if (student.status !== "submitted" || (student.needs_manual_review && (student.manual_score === null || student.manual_score === undefined))) return null;
    return Math.max(0, Number(student.auto_score || 0) + Number(student.manual_score || 0) - Number(student.integrity_marks_deducted || 0));
  }

  function assessmentPerformanceRanks(students) {
    const ranked = students
      .map((student) => ({ student, score: finalizedAssessmentScore(student) }))
      .filter((entry) => entry.score !== null)
      .sort((left, right) => right.score - left.score);
    const ranks = new Map();
    let previousScore = null;
    let currentRank = 0;
    ranked.forEach(({ student, score }, index) => {
      if (score !== previousScore) currentRank = index + 1;
      ranks.set(String(student.attempt_id), currentRank);
      previousScore = score;
    });
    return ranks;
  }

  function assessmentPerformanceRanksByClass(students) {
    const groups = new Map();
    students.forEach((student) => {
      const className = student.class_name || "Unassigned class";
      if (!groups.has(className)) groups.set(className, []);
      groups.get(className).push(student);
    });
    return new Map(Array.from(groups, ([className, classStudents]) => [
      className,
      assessmentPerformanceRanks(classStudents)
    ]));
  }

  function renderOnlineResults(result) {
    const sameAssessment = String(activeOnlineResults?.assessment?.id || "") === String(result.assessment.id);
    const selectedManagementTab = sameAssessment
      ? assessmentResults.querySelector('[data-assessment-tab][aria-selected="true"]')?.dataset.assessmentTab || "class"
      : "class";
    const selectedClassTab = sameAssessment
      ? assessmentResults.querySelector('[data-score-class-tab][aria-selected="true"]')?.dataset.scoreClassTab || "0"
      : "0";
    activeOnlineResults = result;
    const questions = result.questions || [];
    const assessment = result.assessment;
    const roles = window.akademiUserRoles || [];
    const isAdmin = roles.includes("admin") || roles.includes("superadmin");
    const isOwner = Number(assessment.owner_user_id) === Number(window.akademiUserId);
    const studentsByClass = new Map();
    result.students.forEach((student) => {
      const className = student.class_name || "Unassigned class";
      if (!studentsByClass.has(className)) studentsByClass.set(className, []);
      studentsByClass.get(className).push(student);
    });
    const performanceRanksByClass = assessmentPerformanceRanksByClass(result.students || []);
    const scoreRowsByClass = new Map(Array.from(studentsByClass.keys(), (className) => [className, []]));
    const eventLabels = {
      tab_hidden: "Tab hidden",
      window_blur: "Window focus lost",
      fullscreen_exit: "Fullscreen exited",
      copy_attempt: "Copy attempt",
      paste_attempt: "Paste attempt",
      context_menu: "Context menu",
      cut_attempt: "Cut attempt",
      screenshot_attempt: "Screenshot shortcut"
    };
    result.students.forEach((student) => {
      const eventSummary = Object.entries(student.integrity_events || {})
        .map(([type, count]) => `${eventLabels[type] || type}: ${count}`).join(" · ");
      const previousAttempts = (student.previous_attempts || []).map((previous) => {
        const scoreLabel = previous.submitted_at
          ? previous.needs_manual_review && previous.manual_score === null
            ? `${previous.auto_score} objective marks; written responses pending`
            : `${Math.max(0, previous.auto_score + (previous.manual_score || 0) - Number(previous.integrity_marks_deducted || 0))} marks`
          : "No submitted score";
        const previousEvents = Object.entries(previous.integrity_events || {})
          .map(([type, count]) => `${eventLabels[type] || type}: ${count}`).join(" · ") || "No browser events recorded";
        const answers = questions.map((question, index) => {
          const answer = previous.answers?.[String(index)] || "";
          const timedOut = (previous.timed_out_questions || []).includes(index);
          return `<li><strong>Question ${index + 1}</strong>${assessmentPrompt(question)}<p><strong>Response:</strong> ${escapeHtml(answer || (timedOut ? "Timed out before answering" : "No response"))}</p></li>`;
        }).join("");
        const statusLabel = previous.stored_status === "superseded"
          ? `${previous.status.replaceAll("_", " ")} · retaken`
          : previous.status.replaceAll("_", " ");
        return `<details class="assessment-previous-attempt"><summary>Attempt ${previous.attempt_number} · ${escapeHtml(statusLabel)}</summary><p>${escapeHtml(scoreLabel)} · ${escapeHtml(previousEvents)}</p><ol>${answers}</ol></details>`;
      }).join("");
      const canResetAccess = (isOwner || isAdmin) && student.attempt_id
        && ["published", "paused"].includes(assessment.status)
        && !assessment.result_published_at && student.class_status !== "closed"
        && student.status !== "superseded";
      const resetAccess = canResetAccess
        ? `<button type="button" class="small-button" data-reset-learner-access="${assessment.id}" data-roster-id="${student.roster_id}">Reset access for retake</button>`
        : "";
      const hasIntegrityEvents = Object.values(student.integrity_events || {}).some((count) => Number(count) > 0);
      const canReviewIntegrityMarks = (isOwner || isAdmin) && student.attempt_id
        && ["submitted", "expired"].includes(student.status) && hasIntegrityEvents;
      const integrityReview = canReviewIntegrityMarks
        ? (() => {
          const previousReview = student.integrity_review || null;
          const decision = previousReview?.decision || "maintain";
          const deducted = Number(previousReview?.marks_deducted || 0);
          return `<details class="integrity-mark-review"><summary>${previousReview ? "Update integrity marks review" : "Review integrity events"}</summary><form data-integrity-review-attempt="${student.attempt_id}"><p>Browser activity is a signal, not proof of misconduct. Review the attempt and record a reason for your decision.</p><label><span>Decision</span><select name="decision" required><option value="maintain" ${decision === "maintain" ? "selected" : ""}>Maintain marks</option><option value="deduct" ${decision === "deduct" ? "selected" : ""}>Deduct marks</option></select></label><label><span>Marks to deduct</span><input type="number" name="marks_deducted" min="0" max="${Number(assessment.total_marks)}" step="1" value="${deducted}" required ${decision === "maintain" ? "disabled" : ""}></label><label><span>Reason for decision</span><textarea name="reason" minlength="10" maxlength="1000" required placeholder="Explain what was reviewed and why marks are maintained or deducted.">${escapeHtml(previousReview?.reason || "")}</textarea></label><button type="submit" class="small-button">Save integrity review</button></form></details>`;
        })()
        : "";
      const answerReview = student.answers || student.status === "expired" ? `<button type="button" class="small-button online-answer-review-button" data-review-answers="${escapeHtml(student.attempt_id)}" aria-haspopup="dialog" aria-controls="answer-review-dialog-${escapeHtml(student.attempt_id)}">Review answers</button><dialog id="answer-review-dialog-${escapeHtml(student.attempt_id)}" class="answer-review-dialog" aria-labelledby="answer-review-title-${escapeHtml(student.attempt_id)}"><header class="answer-review-dialog-header"><div><span class="eyebrow">LEARNER RESPONSE REVIEW</span><h2 id="answer-review-title-${escapeHtml(student.attempt_id)}">${escapeHtml(student.learner_name)}</h2><p>${escapeHtml(assessment.title)} · ${escapeHtml(student.status.replaceAll("_", " "))}</p></div><button type="button" class="lesson-wizard-close" data-close-answer-review aria-label="Close answer review">&times;</button></header><div class="answer-review-dialog-content"><ol class="answer-review-question-list">${questions.map((question, index) => {
        const answer = (student.answers || {})[String(index)] || "";
        const timedOut = (student.timed_out_questions || []).includes(index) || student.status === "expired";
        const isMcq = Array.isArray(question.options);
        const correctOption = isMcq ? Number(question.correct_option) : -1;
        const correctAnswer = isMcq ? `${String.fromCharCode(65 + correctOption)}. ${question.options[correctOption] || "Unavailable"}` : "";
        const selectedAnswer = isMcq && answer !== ""
          ? `${String.fromCharCode(65 + Number(answer))}. ${question.options[Number(answer)] || "Invalid option"}`
          : answer || "No response";
        const isCorrect = isMcq && answer !== "" && Number(answer) === correctOption && !timedOut;
        const state = timedOut ? "Timed out" : isMcq ? answer === "" ? "No response" : isCorrect ? "Correct" : "Incorrect" : answer ? student.manual_score !== null ? "Written response · reviewed" : "Written response · awaiting marking" : "No response";
        const earned = isMcq && isCorrect ? Number(question.marks) : 0;
        const learnerReview = timedOut && answer === "" ? "Timed out before answering" : selectedAnswer;
        const savedReview = student.question_reviews?.[String(index)] || {};
        const teacherReview = !isMcq
          ? `<div class="online-question-feedback"><label><span>Mark · ${question.marks} possible</span><input type="number" min="0" max="${Number(question.marks)}" step="1" required value="${savedReview.score ?? ""}" data-question-review-score="${index}" aria-label="Mark for question ${index + 1}"></label><label><span>Reason / feedback for learner</span><textarea rows="2" maxlength="1000" required data-question-review-comment="${index}" placeholder="Name the correct method or evidence, then explain one useful next step.">${escapeHtml(savedReview.comment || "")}</textarea></label></div>`
          : "";
        const previousFeedback = savedReview.comment
          ? `<p class="online-saved-feedback"><strong>Teacher feedback:</strong> ${escapeHtml(savedReview.comment)}${savedReview.score !== undefined ? ` · ${savedReview.score}/${question.marks} marks` : ""}</p>`
          : "";
        return `<li class="answer-review-question"><div class="answer-review-question-heading"><strong>Question ${index + 1}</strong><span>${escapeHtml(question.marks)} marks</span></div><div class="answer-review-prompt">${assessmentPrompt(question)}${assessmentVisual(question.visual)}</div><small class="answer-review-state ${timedOut ? "is-timeout" : isCorrect ? "is-correct" : isMcq && answer !== "" ? "is-wrong" : ""}">${escapeHtml(state)}${isMcq ? ` · ${earned}/${question.marks} marks` : ""}</small><p><strong>Learner:</strong> ${escapeHtml(learnerReview)}</p>${isMcq ? `<p><strong>Correct answer:</strong> ${escapeHtml(correctAnswer)}</p>` : `<p><strong>Expected response:</strong> ${assessmentText(question.expected_answer || "Teacher review required.")}</p>${previousFeedback}${student.needs_manual_review ? teacherReview : ""}`}</li>`;
      }).join("")}</ol></div><footer class="answer-review-dialog-footer"><div class="answer-review-export-actions"><button type="button" class="small-button" data-export-answer-review="pdf" data-review-attempt="${escapeHtml(student.attempt_id)}">Download PDF</button><button type="button" class="small-button" data-export-answer-review="docx" data-review-attempt="${escapeHtml(student.attempt_id)}">Download Word · DOCX</button></div><button type="button" class="small-button" data-close-answer-review>Close review</button></footer></dialog>` : "";
      const grading = student.needs_manual_review && (student.manual_score === null || student.manual_score === undefined)
        ? `<button type="button" class="small-button" data-grade-attempt="${student.attempt_id}">Save written review</button>`
        : student.manual_score !== null ? `<small>Written mark: ${student.manual_score}</small>` : "";
      const integrityReviewSummary = student.integrity_review
        ? `<small>Integrity review: ${student.integrity_review.decision === "deduct" ? `${student.integrity_review.marks_deducted} mark(s) deducted` : "marks maintained"} · ${escapeHtml(student.integrity_review.reason)}</small>`
        : "";
      const manualPending = student.needs_manual_review && (student.manual_score === null || student.manual_score === undefined);
      const finalScore = finalizedAssessmentScore(student);
      const performanceRank = performanceRanksByClass.get(student.class_name || "Unassigned class")?.get(String(student.attempt_id));
      const score = student.status !== "submitted"
        ? "—"
        : manualPending
          ? `<strong>${student.auto_score} objective marks</strong><small>Awaiting written-response marking</small>`
          : `<strong>${finalScore} / ${assessment.total_marks}</strong>${Number(student.integrity_marks_deducted || 0) ? `<small>Integrity deduction: ${Number(student.integrity_marks_deducted)} marks</small>` : ""}`;
      const historySummary = previousAttempts ? `<div class="assessment-previous-attempts"><strong>Previous attempts</strong>${previousAttempts}</div>` : "";
      const row = `<article class="online-result-row"><div><strong>${escapeHtml(student.learner_name)}</strong><small>${student.attempt_number ? `Attempt ${student.attempt_number} · ` : ""}${escapeHtml(student.status.replaceAll("_", " "))}</small>${performanceRank ? `<small>Performance rank: #${performanceRank}</small>` : ""}${historySummary}</div><div>${score}${grading}${integrityReviewSummary}${resetAccess}</div><div><small>${eventSummary ? `Integrity events: ${escapeHtml(eventSummary)}` : "No browser events recorded"}</small>${integrityReview}${answerReview}</div></article>`;
      scoreRowsByClass.get(student.class_name || "Unassigned class").push(row);
    });
    const rosterCodes = result.students.filter((student) => student.access_code)
      .map((student) => `<tr><td>${escapeHtml(student.class_name)}</td><td>${escapeHtml(student.learner_name)}</td><td><code>${escapeHtml(student.access_code)}</code></td></tr>`).join("");
    const codeTable = assessment.access_mode === "individual_code"
      ? `<div class="online-codes-table-wrap"><table class="online-codes-table"><thead><tr><th>Class</th><th>Learner</th><th>Private individual code</th></tr></thead><tbody>${rosterCodes}</tbody></table></div>`
      : "";
    const accessGuidance = assessment.access_mode === "none"
      ? "No code is needed. A rostered student starts after selecting their class and name."
      : assessment.access_mode === "teacher_code"
        ? "Students must enter the teacher code set when this assessment was published."
        : "Share each individual code privately. Do not send these codes in a group message.";
    const classControls = (assessment.classes || []).map((classInfo) => {
      const status = classInfo.status || "active";
      const actions = status === "active"
        ? `<button type="button" class="small-button" data-class-availability-action="pause" data-assessment-id="${assessment.id}" data-class-id="${classInfo.id}">Pause class</button><button type="button" class="small-button" data-class-availability-action="end" data-assessment-id="${assessment.id}" data-class-id="${classInfo.id}">End class</button>`
        : status === "paused"
          ? `<button type="button" class="small-button" data-class-availability-action="resume" data-assessment-id="${assessment.id}" data-class-id="${classInfo.id}">Resume class</button><button type="button" class="small-button" data-class-availability-action="end" data-assessment-id="${assessment.id}" data-class-id="${classInfo.id}">End class</button>`
          : "Ended";
      return `<div class="assessment-class-availability-row"><strong>${escapeHtml(classInfo.name)}</strong><span>${escapeHtml(status === "active" ? "Open" : status)}</span>${actions}</div>`;
    }).join("");
    const classAvailabilityManager = (isOwner || isAdmin)
      ? `<section class="assessment-class-availability"><h4>Class-specific availability</h4><p>Pausing a class blocks new attempts; students already taking it can submit. Ending a class blocks new attempts and expires active attempts with their last autosaved answers preserved.</p>${classControls}</section>`
      : "";
    const rosterManager = `<div class="assessment-roster-panel"><p>Classes and student rosters are managed separately in the Assessment builder. Changes to a selected class roster update its active assessments automatically.</p><p>${escapeHtml(accessGuidance)}</p>${classAvailabilityManager}${codeTable}</div>`;
    const takeUrl = new URL(assessment.take_url, window.location.href).href;
    const shareMessage = assessmentShareInstructions(assessment, takeUrl);
    const shareViaWhatsapp = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    const shareActions = ["published", "paused"].includes(assessment.status)
      ? `<div class="assessment-share-actions"><button type="button" class="small-button" data-copy-assessment-link="${escapeHtml(takeUrl)}" data-share-message="${encodeURIComponent(shareMessage)}">Copy instructions and exam link</button><a class="small-button" href="${escapeHtml(shareViaWhatsapp)}" target="_blank" rel="noopener noreferrer">Share instructions via WhatsApp</a><small class="field-help">${escapeHtml(accessGuidance)}</small></div>`
      : "";
    const statusLabel = { published: "Open", paused: "Paused", draft: "Unpublished", closed: "Ended early", expired: "Link expired" }[assessment.status] || assessment.status;
    const expiryLabel = formatAssessmentExpiry(assessment.expires_at);
    const noLearnerHasStarted = result.students.every((student) => !student.attempt_id);
    const canUnpublish = isOwner && ["published", "paused"].includes(assessment.status)
      && !assessment.result_published_at && noLearnerHasStarted;
    const lifecycleControls = isOwner ? `<div class="assessment-availability-controls"><label class="field"><span>Availability (days)</span><input type="number" min="1" max="90" value="${Number(assessment.duration_days || 7)}" data-assessment-duration></label>${assessment.status === "draft" ? `<button type="button" class="small-button" data-availability-action="duration" data-assessment-id="${assessment.id}">Save duration</button><button type="button" class="small-button" data-availability-action="publish" data-assessment-id="${assessment.id}">Publish assessment</button>` : `<button type="button" class="small-button" data-availability-action="duration" data-assessment-id="${assessment.id}">Save duration</button>${assessment.status === "paused" ? `<button type="button" class="small-button" data-availability-action="start" data-assessment-id="${assessment.id}">Start / resume</button>` : assessment.status === "published" ? `<button type="button" class="small-button" data-availability-action="pause" data-assessment-id="${assessment.id}">Pause exam</button><button type="button" class="small-button" data-availability-action="end" data-assessment-id="${assessment.id}">End exam now</button>` : ""}`}${canUnpublish ? `<button type="button" class="small-button" data-availability-action="unpublish" data-assessment-id="${assessment.id}">Unpublish to edit</button>` : ""}</div>` : "";
    const lifecycleDescription = assessment.status === "published"
      ? `<span data-assessment-countdown data-expires-at="${escapeHtml(assessment.expires_at)}">Loading remaining time...</span>`
      : assessment.status === "paused"
        ? "The link is paused. New attempts are blocked; availability countdown resumes when you restart the exam."
        : assessment.status === "draft"
          ? "This assessment is unpublished. Edit questions in the Question paper tab, then publish it when ready."
          : `Closed ${assessment.result_published_at ? `- results published ${escapeHtml(formatAssessmentExpiry(assessment.result_published_at))}` : "- results are being prepared"}.`;
    const lifecycle = `<section class="assessment-availability-panel"><div><strong>${escapeHtml(statusLabel)} assessment</strong><p>${lifecycleDescription}</p><small>Link closes ${escapeHtml(expiryLabel || "after the availability period")}</small></div>${lifecycleControls}</section>`;
    const resultStatus = assessment.status === "draft"
      ? `<div class="assessment-result-publication"><strong>Assessment is unpublished</strong><span>Publish the assessment to reopen learner access and collect results.</span></div>`
      : assessment.result_published_at
      ? `<div class="assessment-result-publication"><strong>Results published</strong><span>Creator email ${assessment.result_email_sent_at ? `sent ${escapeHtml(formatAssessmentExpiry(assessment.result_email_sent_at))}` : "is pending or needs retry"}.</span></div>`
      : `<div class="assessment-result-publication"><strong>Results are not published yet</strong><span>They publish automatically when the availability period ends, or an administrator can publish them sooner.</span>${isAdmin ? `<button type="button" class="small-button" data-admin-publish-results="${assessment.id}">Publish results to creator</button>` : ""}</div>`;
    const classScoreTabs = Array.from(studentsByClass.keys()).map((className, index) =>
      `<button type="button" role="tab" id="assessment-score-class-tab-${assessment.id}-${index}" aria-controls="assessment-score-class-panel-${assessment.id}-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-score-class-tab="${index}">${escapeHtml(className)} <span>${studentsByClass.get(className).length}</span></button>`
    ).join("");
    const classScorePanels = Array.from(studentsByClass, ([className, students], index) =>
      `<section id="assessment-score-class-panel-${assessment.id}-${index}" class="assessment-score-class-panel" role="tabpanel" aria-labelledby="assessment-score-class-tab-${assessment.id}-${index}" data-score-class-panel="${index}"${index === 0 ? "" : " hidden"}><div class="assessment-score-list">${students.length ? scoreRowsByClass.get(className).join("") : "<p>No roster learners.</p>"}</div></section>`
    ).join("");
    assessmentResults.innerHTML = `<div class="assessment-results-heading"><div><span class="eyebrow">ONLINE ASSESSMENT</span><h3>${escapeHtml(assessment.title)}</h3><p>${escapeHtml(assessment.class_name)} · ${result.students.length} learners · ${assessment.security_level === "advanced" ? "Advanced" : "Medium"} security</p><small data-live-results-status role="status" aria-live="polite">Live results refresh every five seconds while this page is visible.</small></div><button type="button" class="small-button" data-refresh-results="${assessment.id}">Refresh</button></div>${lifecycle}<div class="assessment-management-tabs" role="tablist" aria-label="Assessment management"><button type="button" role="tab" id="assessment-tab-class" aria-controls="assessment-panel-class" aria-selected="true" data-assessment-tab="class">Class management</button><button type="button" role="tab" id="assessment-tab-scores" aria-controls="assessment-panel-scores" aria-selected="false" data-assessment-tab="scores">Scores</button></div><section id="assessment-panel-class" class="assessment-management-panel" role="tabpanel" aria-labelledby="assessment-tab-class" data-assessment-panel="class">${shareActions}${rosterManager}</section><section id="assessment-panel-scores" class="assessment-management-panel" role="tabpanel" aria-labelledby="assessment-tab-scores" data-assessment-panel="scores" hidden>${resultStatus}<p class="field-help">Activity events are browser-reported signals, not proof of misconduct. Written marks are teacher-entered; final scores remain pending until written responses are marked. Ranks are calculated within each class; ties share rank.</p><div class="assessment-score-sheet-actions"><button type="button" class="small-button" data-download-score-sheet>Download CSV score sheet</button><button type="button" class="small-button" data-download-score-sheet-format="pdf">Download PDF</button><button type="button" class="small-button" data-download-score-sheet-format="docx">Download Word · DOCX</button><button type="button" class="small-button" data-email-score-sheet="${assessment.id}">Email score sheet to creator</button></div><div class="assessment-score-class-tabs" role="tablist" aria-label="Scores by class">${classScoreTabs || "<p>No classes found.</p>"}</div>${classScorePanels}</section>`;
    assessmentResults.querySelector(`[data-assessment-tab="${selectedManagementTab}"]`)?.click();
    assessmentResults.querySelector(`[data-score-class-tab="${selectedClassTab}"]`)?.click();
    const classScoreTabList = assessmentResults.querySelector(".assessment-score-class-tabs");
    classScoreTabList?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = Array.from(classScoreTabList.querySelectorAll("[data-score-class-tab]"));
      const current = tabs.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    });
    assessmentResults.hidden = false;
    updateAssessmentCountdowns();
  }

  function scoreSheetCsv(result) {
    const assessment = result.assessment;
    const performanceRanksByClass = assessmentPerformanceRanksByClass(result.students || []);
    const escapeCell = (value) => {
      let text = String(value ?? "");
      if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      ["Assessment", assessment.title], ["Classes", assessment.class_name], ["Total marks", assessment.total_marks],
      ["Ranking", "Finalized submitted scores are ranked within each class; tied scores share rank."], [],
      ["Class", "Rank", "Learner", "Status", "Objective score", "Written score", "Integrity deduction", "Integrity review reason", "Final score", "Maximum marks", "Percentage", "Submitted at", "Manual review", "Browser events"]
    ];
    (result.students || []).forEach((student) => {
      const pending = student.needs_manual_review && (student.manual_score === null || student.manual_score === undefined);
      const finalScore = finalizedAssessmentScore(student);
      const eventText = Object.entries(student.integrity_events || {}).map(([name, count]) => `${name}: ${count}`).join("; ");
      rows.push([
        student.class_name || "Unassigned class",
        performanceRanksByClass.get(student.class_name || "Unassigned class")?.get(String(student.attempt_id)) || "",
        student.learner_name,
        student.status.replaceAll("_", " "),
        student.status === "submitted" ? student.auto_score : "",
        student.manual_score ?? "",
        student.integrity_marks_deducted || 0,
        student.integrity_review?.reason || "",
        finalScore ?? "",
        assessment.total_marks,
        finalScore === null ? "" : `${(finalScore / assessment.total_marks * 100).toFixed(1)}%`,
        student.submitted_at || "",
        pending ? "Pending" : "No",
        eventText
      ]);
    });
    return `\uFEFF${rows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}`;
  }

  function downloadScoreSheet(format, result) {
    const assessment = result.assessment;
    const performanceRanksByClass = assessmentPerformanceRanksByClass(result.students || []);
    const headers = ["Class", "Rank", "Learner", "Status", "Objective", "Written", "Integrity deduction", "Integrity review reason", "Final", "Max marks", "Percent", "Submitted"];
    const rows = (result.students || []).map((student) => {
      const manualPending = student.needs_manual_review && (student.manual_score === null || student.manual_score === undefined);
      const finalScore = finalizedAssessmentScore(student);
      return [student.class_name || "Unassigned class", performanceRanksByClass.get(student.class_name || "Unassigned class")?.get(String(student.attempt_id)) || "", student.learner_name, student.status.replaceAll("_", " "), student.status === "submitted" ? student.auto_score : "", student.manual_score ?? "", student.integrity_marks_deducted || 0, student.integrity_review?.reason || "", finalScore ?? (manualPending ? "Pending" : ""), assessment.total_marks, finalScore === null ? "" : `${(finalScore / assessment.total_marks * 100).toFixed(1)}%`, student.submitted_at || ""];
    });
    const title = `${assessment.title} - ${assessment.class_name} score sheet`;
    const blocks = [
      { text: `Classes: ${assessment.class_name} | Subject: ${assessment.subject || ""}`, style: "Heading1" },
      { text: `Status: ${assessment.status} | Total marks: ${assessment.total_marks}` },
      { text: "Ranks use finalized submitted scores within each class; tied scores share rank. Unsubmitted or unmarked attempts are not ranked." },
      { type: "table", rows: [headers, ...rows] }
    ];
    window.akademiAssessmentExport.download({
      title,
      blocks,
      scoreSheet: true,
      tableRows: [headers, ...rows],
      rankingNote: "Ranks use finalized submitted scores within each class; tied scores share rank. Unsubmitted or unmarked attempts are not ranked.",
      assessmentDetails: {
        subject: assessment.subject || "",
        className: assessment.class_name || "",
        status: assessment.status || "",
        totalMarks: assessment.total_marks
      },
      administrator: {
        name: profile.name || "",
        school: profile.school || "",
        phone: profile.phone || "",
        email: workspaceUserEmail || ""
      }
    }, format);
  }

  async function loadOnlineResults(assessmentId) {
    activeOnlineAssessmentId = String(assessmentId);
    const requestedAssessmentId = activeOnlineAssessmentId;
    const result = await workspaceRequest(`/api/teacher/online-assessments/${requestedAssessmentId}`);
    if (activeOnlineAssessmentId !== requestedAssessmentId) return;
    const snapshotData = { ...result, assessment: { ...result.assessment } };
    delete snapshotData.assessment.remaining_seconds;
    const snapshot = JSON.stringify(snapshotData);
    if (snapshot !== activeOnlineResultsSnapshot) {
      activeOnlineResultsSnapshot = snapshot;
      renderOnlineResults(result);
    }
    const liveStatus = assessmentResults.querySelector("[data-live-results-status]");
    if (liveStatus) liveStatus.textContent = "Live results are up to date; refreshing every five seconds.";
    clearInterval(onlineResultsPollTimer);
    onlineResultsPollTimer = window.setInterval(async () => {
      if (onlineResultsPollPending || document.hidden || !assessmentResults.getClientRects().length
          || activeOnlineAssessmentId !== requestedAssessmentId) return;
      onlineResultsPollPending = true;
      try {
        await loadOnlineResults(requestedAssessmentId);
      } catch (error) {
        const status = assessmentResults.querySelector("[data-live-results-status]");
        if (status) status.textContent = `Live refresh failed: ${error instanceof Error ? error.message : "The latest results could not be loaded."}`;
      } finally {
        onlineResultsPollPending = false;
      }
    }, 5000);
  }

  async function restoreSavedAssessmentPreview(doc) {
    const draft = doc?.data?.assessment_draft;
    const savedInput = doc?.data?.assessment_input;
    if (!doc || !draft || !Array.isArray(draft.questions) || !draft.questions.length) {
      return false;
    }
    const input = {
      type: "assessment",
      subject: String(doc.data.subject || doc.subject || ""),
      year_group: String(doc.data.year_group || doc.year_group || ""),
      class_name: String(doc.data.class_name || doc.className || ""),
      year_groups: Array.isArray(savedInput?.year_groups) && savedInput.year_groups.length
        ? savedInput.year_groups.map(String)
        : Array.isArray(doc.data.year_groups) && doc.data.year_groups.length
          ? doc.data.year_groups.map(String)
          : [String(doc.data.year_group || doc.year_group || "")].filter(Boolean),
      class_ids: Array.isArray(savedInput?.class_ids) ? savedInput.class_ids.map(Number) : [],
      assessment_type: String(savedInput?.assessment_type || "class_exercise"),
      question_format: String(savedInput?.question_format || "mixed"),
      other_format: String(savedInput?.other_format || ""),
      security_level: String(savedInput?.security_level || "medium"),
      duration_minutes: Number(savedInput?.duration_minutes) || 60,
      question_count: draft.questions.length,
      delivery_mode: String(savedInput?.delivery_mode || "printed"),
      selected_week_sections: Array.isArray(savedInput?.selected_week_sections) ? savedInput.selected_week_sections : [],
      scope: String(savedInput?.coverage || ""),
      teacher_instructions: String(savedInput?.teacher_instructions || "")
    };
    await renderAiDraft("assessment", input, JSON.parse(JSON.stringify(draft)), {
      restoreSavedDocument: doc,
      roster: String(doc.data.class_roster || "")
    });
    return true;
  }

  async function restoreOnlineAssessmentPreview(assessmentId) {
    const savedDocument = documents.find((doc) =>
      doc.status !== "archived" && doc.type === "assessment"
      && String(doc.data?.online_assessment_id) === String(assessmentId)
    );
    if (savedDocument && await restoreSavedAssessmentPreview(savedDocument)) return true;
    const message = document.createElement("p");
    message.className = "planning-library-empty";
    message.textContent = "The generated question paper, marking guide, and administrator details are unavailable because no linked saved assessment was found.";
    ["paper", "guide", "details"].forEach((name) => {
      const panel = document.getElementById(`generated-assessment-${name}-content`);
      panel.replaceChildren(message.cloneNode(true));
    });
    return false;
  }

  function renderOnlineAssessmentLibrary() {
    const query = savedAssessmentSearch.value.trim().toLocaleLowerCase();
    const status = savedAssessmentStatusFilter.value;
    const assessments = savedOnlineAssessments.filter((item) =>
      (!query || `${item.title} ${item.class_name}`.toLocaleLowerCase().includes(query))
      && (!status || item.status === status)
    );
    onlineAssessmentLibraryList.innerHTML = assessments.map((assessment) =>
      `<article class="online-assessment-library-row"><div><strong>${escapeHtml(assessment.title)}</strong><small>${escapeHtml(assessment.class_name)} · ${assessment.learner_count} learners · ${assessment.security_level === "advanced" ? "Advanced" : "Medium"} security · ${assessment.status === "draft" ? "unpublished" : escapeHtml(assessment.status)}</small><small>${assessment.status === "draft" ? "Edit the question paper and publish when ready." : assessment.status === "paused" ? "Paused" : assessment.status === "published" ? `<span data-assessment-countdown data-expires-at="${escapeHtml(assessment.expires_at)}">Loading remaining time…</span>` : `Results ${assessment.result_published_at ? "published" : "pending"}`}</small></div><div class="assessment-saved-actions">${assessment.status !== "draft" ? `<button type="button" class="small-button" data-share-saved-assessment="${assessment.id}"><svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-file-lines"></use></svg> Copy instructions and link</button>` : ""}<button type="button" class="small-button" data-open-online-assessment="${assessment.id}"><svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-graduation-cap"></use></svg> ${assessment.status === "draft" ? "Edit &amp; publish" : "Manage exam and results"}</button></div></article>`
    ).join("");
    if (!assessments.length) {
      onlineAssessmentLibraryStatus.textContent = savedOnlineAssessments.length
        ? "No saved assessments match those filters."
        : "No online assessments yet. Published assessments will appear here.";
    } else {
      onlineAssessmentLibraryStatus.textContent = `${assessments.length} saved assessment${assessments.length === 1 ? "" : "s"}`;
    }
    updateAssessmentCountdowns();
  }
  async function loadOnlineAssessmentLibrary() {
    onlineAssessmentLibraryStatus.textContent = "Loading saved assessments…";
    try {
      const { assessments } = await workspaceRequest("/api/teacher/online-assessments");
      savedOnlineAssessments = assessments;
      renderOnlineAssessmentLibrary();
    } catch (error) {
      onlineAssessmentLibraryStatus.textContent = error instanceof Error ? error.message : "Saved assessments could not be loaded.";
    }
  }
  document.getElementById("refresh-online-assessments").addEventListener("click", loadOnlineAssessmentLibrary);
  savedAssessmentSearch.addEventListener("input", renderOnlineAssessmentLibrary);
  savedAssessmentStatusFilter.addEventListener("change", renderOnlineAssessmentLibrary);
  onlineAssessmentLibrary.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-online-assessment]");
    if (!button) return;
    activeOnlineAssessmentId = button.dataset.openOnlineAssessment;
    button.disabled = true;
    try {
      await restoreOnlineAssessmentPreview(activeOnlineAssessmentId);
      await loadOnlineResults(activeOnlineAssessmentId);
      openGeneratedAssessmentTab("class");
      assessmentResults.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The selected assessment could not be loaded.", "error");
    } finally {
      button.disabled = false;
    }
  });
  loadOnlineAssessmentLibrary();

  onlineAssessmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedVariant = generatedAssessmentVariants[Number(assessmentVariantField.value)];
    if (!selectedVariant || !onlineAssessmentForm.reportValidity()) {
      if (!selectedVariant) showToast("Generate an AI assessment before publishing it online.", "error");
      return;
    }
    const classIds = selectedPublishClassIds();
    if (!classIds.length) {
      showToast("Select at least one class in the publish form before publishing this assessment.", "error");
      return;
    }
    const button = onlineAssessmentForm.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Publishing securely…";
    try {
      const { input, draft } = selectedVariant;
      const result = await workspaceRequest("/api/teacher/online-assessments", "POST", {
        class_ids: classIds,
        subject: input.subject,
        year_group: input.year_group,
        title: draft.title,
        assessment_type: input.assessment_type,
        question_format: input.question_format,
        security_level: assessmentSecurityField.value,
        access_mode: assessmentAccessModeField.value,
        teacher_access_code: assessmentAccessModeField.value === "teacher_code" ? assessmentTeacherCodeField.value : "",
        duration_minutes: input.duration_minutes,
        availability_days: 7,
        total_marks: draft.total_marks,
        instructions: draft.instructions,
        questions: draft.questions
      });
      activeOnlineAssessmentId = result.assessment_id;
      await loadOnlineAssessmentLibrary();
      if (selectedVariant.savedDocument) {
        const linkedData = {
          ...selectedVariant.savedDocument.data,
          class_name: result.classes.join(", "),
          online_assessment_id: result.assessment_id,
          online_take_url: result.take_url
        };
        try {
          const linked = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(selectedVariant.savedDocument.id)}`, "PUT", {
            type: "assessment",
            title: selectedVariant.savedDocument.title,
            data: linkedData,
            html: selectedVariant.savedDocument.html
          });
          selectedVariant.savedDocument = linked.document;
          selectedVariant.savedData = linked.document.data;
          documents = documents.map((doc) => doc.id === linked.document.id ? linked.document : doc);
          renderAll();
        } catch (error) {
          showToast(error instanceof Error
            ? `Assessment was published, but its saved document could not be linked to the student link: ${error.message}`
            : "Assessment was published, but its saved document could not be linked to the student link.", "error");
        }
      }
      publishedAccessCodes.set(String(result.assessment_id), result.access_codes);
      const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
      const rows = result.access_codes.map((item) => `<tr><td>${escapeHtml(item.class_name)}</td><td>${escapeHtml(item.learner_name)}</td><td><code>${escapeHtml(item.access_code)}</code></td></tr>`).join("");
      const takeUrl = new URL(result.take_url, window.location.href).href;
      showGeneratedAssessmentOnlineActions(result.assessment_id, `${input.subject || result.title} · ${new Intl.DateTimeFormat("en-GH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())}`);
      const shareMessage = assessmentShareInstructions({ title: result.title, class_name: result.classes.join(", "), access_mode: result.access_mode, subject: input.subject, duration_minutes: input.duration_minutes, instructions: draft.instructions, expires_at: result.expires_at }, takeUrl);
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
      const accessInstructions = result.access_mode === "none"
        ? "Students can select their class and name, then start. No code is required."
        : result.access_mode === "teacher_code"
          ? "Share the teacher code you chose with all selected classes. Students must enter it before starting."
          : "Each student has a private system-generated code. Distribute codes privately; the roster manager keeps them available.";
      assessmentPublishResult.innerHTML = `<div class="assessment-published-notice"><strong>Assessment is open for 7 days by default.</strong><p>Assigned to: ${escapeHtml(result.classes.join(", "))}. All selected classes will take this same assessment.</p><p>Availability countdown ends ${escapeHtml(formatAssessmentExpiry(result.expires_at))}. Manage availability and scores from Manage class &amp; scores.</p><p>${escapeHtml(accessInstructions)}</p><p><a href="${escapeHtml(takeUrl)}" target="_blank" rel="noopener noreferrer">Open learner assessment page</a></p><div class="assessment-share-actions"><button type="button" class="small-button" data-copy-assessment-link="${escapeHtml(takeUrl)}" data-share-message="${encodeURIComponent(shareMessage)}"><svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-file-lines"></use></svg> Copy student instructions and link</button><a class="small-button" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">Share instructions via WhatsApp</a></div><button type="button" class="small-button" data-load-results="${result.assessment_id}">Manage class &amp; scores</button>${result.access_mode === "individual_code" ? `<div class="online-codes-table-wrap"><table class="online-codes-table"><thead><tr><th>Class</th><th>Learner</th><th>Individual code</th></tr></thead><tbody>${rows}</tbody></table></div><button type="button" class="small-button" data-download-access-codes>Download roster and access codes (CSV)</button>` : ""}</div>`;
      const downloadCodesButton = assessmentPublishResult.querySelector("[data-download-access-codes]");
      if (downloadCodesButton) downloadCodesButton.addEventListener("click", () => {
        const codesForAssessment = publishedAccessCodes.get(String(result.assessment_id)) || [];
        const csv = [["Class", "Learner", "Assessment access code", "Assessment page"], ...codesForAssessment.map((item) => [item.class_name, item.learner_name, item.access_code, result.take_url])]
          .map((row) => row.map(escapeCsv).join(",")).join("\r\n");
        download(`${safeFilename(result.title)}-learner-codes.csv`, csv, "text/csv;charset=utf-8");
      });
      let resultsLoaded = false;
      try {
        await loadOnlineResults(result.assessment_id);
        resultsLoaded = true;
      } catch (error) {
        showToast(error instanceof Error
          ? `Assessment published, but class results could not be loaded: ${error.message}`
          : "Assessment published, but class results could not be loaded.", "error");
      }
      if (resultsLoaded) showToast("Online assessment published for all selected classes.");
      openGeneratedAssessmentTab("class");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The online assessment could not be published.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-clipboard-check"></use></svg> Publish assessment';
    }
  });

  assessmentPublishResult.addEventListener("click", async (event) => {
    const copyLink = event.target.closest("[data-copy-assessment-link]");
    if (copyLink) {
      try {
        const message = copyLink.dataset.shareMessage ? decodeURIComponent(copyLink.dataset.shareMessage) : copyLink.dataset.copyAssessmentLink;
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message);
        else {
          const field = document.createElement("textarea");
          field.value = message;
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.append(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          if (!copied) throw new Error("Clipboard access is unavailable.");
        }
        showToast("Exam instructions and student link copied. Send each learner their code privately.");
      } catch {
        showToast("Could not copy automatically. Open the student page and copy its address.", "error");
      }
      return;
    }
    const button = event.target.closest("[data-load-results]");
    if (!button) return;
    activeOnlineAssessmentId = button.dataset.loadResults;
    button.disabled = true;
    try {
      await loadOnlineResults(activeOnlineAssessmentId);
      openGeneratedAssessmentTab("class");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Assessment results could not be loaded.", "error");
      button.disabled = false;
    }
  });

  assessmentResults.addEventListener("click", async (event) => {
    const exportReviewButton = event.target.closest("[data-export-answer-review]");
    if (exportReviewButton && activeOnlineResults) {
      const student = activeOnlineResults.students.find((item) => String(item.attempt_id) === exportReviewButton.dataset.reviewAttempt);
      if (!student) {
        showToast("The learner review is no longer available. Refresh the assessment results and try again.", "error");
        return;
      }
      try {
        await downloadAnswerReview(student, activeOnlineResults.assessment, activeOnlineResults.questions || [], exportReviewButton.dataset.exportAnswerReview);
        showToast(`${exportReviewButton.dataset.exportAnswerReview.toUpperCase()} learner review download started.`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The learner review could not be exported.", "error");
      }
      return;
    }
    const reviewButton = event.target.closest("[data-review-answers]");
    if (reviewButton) {
      const reviewDialog = reviewButton.closest(".online-result-row")?.querySelector(".answer-review-dialog");
      if (reviewDialog && !reviewDialog.open) reviewDialog.showModal();
      return;
    }
    if (event.target.closest("[data-close-answer-review]")) {
      event.target.closest(".answer-review-dialog")?.close();
      return;
    }
    if (event.target.matches(".answer-review-dialog")) {
      const bounds = event.target.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        event.target.close();
      }
      return;
    }
    const classAvailabilityButton = event.target.closest("[data-class-availability-action]");
    if (classAvailabilityButton) {
      const action = classAvailabilityButton.dataset.classAvailabilityAction;
      if (action === "end" && !(await window.akademiAlert.confirm(
        "End this assessment for this class? New attempts will be blocked, and active attempts will expire with their last autosaved answers preserved.",
        { title: "End assessment for class", confirmText: "End class assessment" }
      ))) return;
      classAvailabilityButton.disabled = true;
      try {
        await workspaceRequest(
          `/api/teacher/online-assessments/${classAvailabilityButton.dataset.assessmentId}/classes/${classAvailabilityButton.dataset.classId}/availability`,
          "POST",
          { action }
        );
        await loadOnlineResults(classAvailabilityButton.dataset.assessmentId);
        showToast(action === "pause" ? "New assessment attempts are paused for this class."
          : action === "resume" ? "Assessment access resumed for this class."
            : "Assessment ended for this class. Active attempt answers saved before ending are preserved.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Class availability could not be updated.", "error");
        classAvailabilityButton.disabled = false;
      }
      return;
    }
    const resetAccessButton = event.target.closest("[data-reset-learner-access]");
    if (resetAccessButton) {
      if (!(await window.akademiAlert.confirm(
        "Reset this learner’s assessment access? Their previous answers, score and integrity events will remain in the attempt history, and they will receive one new attempt using the same access code.",
        { title: "Allow an assessment retake", confirmText: "Reset access" }
      ))) return;
      resetAccessButton.disabled = true;
      try {
        await workspaceRequest(
          `/api/teacher/online-assessments/${resetAccessButton.dataset.resetLearnerAccess}/learners/${resetAccessButton.dataset.rosterId}/reset-access`,
          "POST",
          {}
        );
        await loadOnlineResults(resetAccessButton.dataset.resetLearnerAccess);
        showToast("Learner access reset. Their previous attempt remains in the history.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Learner access could not be reset.", "error");
        resetAccessButton.disabled = false;
      }
      return;
    }
    const availabilityButton = event.target.closest("[data-availability-action]");
    if (availabilityButton) {
      const action = availabilityButton.dataset.availabilityAction;
      const durationInput = assessmentResults.querySelector("[data-assessment-duration]");
      if (action === "end" && !(await window.akademiAlert.confirm("End this exam now? Learners who have not started will lose access, and results will be published to the creator.", { title: "End assessment", confirmText: "End exam" }))) return;
      if (action === "unpublish" && !(await window.akademiAlert.confirm("Take this assessment offline so you can edit its questions? This is only allowed before any learner starts.", { title: "Unpublish for editing", confirmText: "Unpublish" }))) return;
      availabilityButton.disabled = true;
      try {
        const body = { action };
        if (action === "duration") body.duration_days = Number(durationInput?.value);
        await workspaceRequest(`/api/teacher/online-assessments/${availabilityButton.dataset.assessmentId}/availability`, "POST", body);
        await Promise.all([loadOnlineResults(availabilityButton.dataset.assessmentId), loadOnlineAssessmentLibrary()]);
        showToast(action === "duration" ? "Assessment availability updated."
          : action === "pause" ? "Assessment paused."
            : action === "start" ? "Assessment resumed."
              : action === "publish" ? "Assessment published and learner access is open."
                : action === "unpublish" ? "Assessment unpublished. You can now edit questions in the Question paper tab."
                  : "Assessment ended. Results are being published to the creator.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Assessment availability could not be updated.", "error");
        availabilityButton.disabled = false;
      }
      return;
    }
    const adminPublish = event.target.closest("[data-admin-publish-results]");
    if (adminPublish) {
      if (!(await window.akademiAlert.confirm("Publish these results to the assessment creator and email the score sheet now?", { title: "Publish results", confirmText: "Publish results" }))) return;
      adminPublish.disabled = true;
      try {
        await workspaceRequest(`/api/admin/online-assessments/${adminPublish.dataset.adminPublishResults}/publish-results`, "POST", {});
        await Promise.all([loadOnlineResults(adminPublish.dataset.adminPublishResults), loadOnlineAssessmentLibrary()]);
        showToast("Results published and emailed to the creator.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Results could not be published.", "error");
        adminPublish.disabled = false;
      }
      return;
    }
    const downloadFormattedScores = event.target.closest("[data-download-score-sheet-format]");
    if (downloadFormattedScores && activeOnlineResults) {
      try { downloadScoreSheet(downloadFormattedScores.dataset.downloadScoreSheetFormat, activeOnlineResults); }
      catch (error) { showToast(error instanceof Error ? error.message : "The score sheet could not be exported.", "error"); }
      return;
    }
    const tab = event.target.closest("[data-assessment-tab]");
    if (tab) {
      assessmentResults.querySelectorAll("[data-assessment-tab]").forEach((button) => button.setAttribute("aria-selected", String(button === tab)));
      assessmentResults.querySelectorAll("[data-assessment-panel]").forEach((panel) => { panel.hidden = panel.dataset.assessmentPanel !== tab.dataset.assessmentTab; });
      return;
    }
    const classScoreTab = event.target.closest("[data-score-class-tab]");
    if (classScoreTab) {
      assessmentResults.querySelectorAll("[data-score-class-tab]").forEach((button) => {
        const selected = button === classScoreTab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      assessmentResults.querySelectorAll("[data-score-class-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.scoreClassPanel !== classScoreTab.dataset.scoreClassTab;
      });
      return;
    }
    const downloadScores = event.target.closest("[data-download-score-sheet]");
    if (downloadScores && activeOnlineResults) {
      const assessment = activeOnlineResults.assessment;
      download(`${safeFilename(`${assessment.title}-${assessment.class_name}`)}-scores.csv`, scoreSheetCsv(activeOnlineResults), "text/csv;charset=utf-8");
      return;
    }
    const emailScores = event.target.closest("[data-email-score-sheet]");
    if (emailScores) {
      emailScores.disabled = true;
      emailScores.textContent = "Emailing…";
      try {
        await workspaceRequest(`/api/teacher/online-assessments/${emailScores.dataset.emailScoreSheet}/scoresheet/email`, "POST", {});
        showToast("Score sheet emailed to the creator account.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The score sheet could not be emailed.", "error");
      } finally {
        emailScores.disabled = false;
        emailScores.textContent = "Email score sheet to creator";
      }
      return;
    }
    const copyLink = event.target.closest("[data-copy-assessment-link]");
    if (copyLink) {
      try {
        const message = copyLink.dataset.shareMessage ? decodeURIComponent(copyLink.dataset.shareMessage) : assessmentShareInstructions(activeOnlineResults.assessment, copyLink.dataset.copyAssessmentLink);
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message);
        else {
          const field = document.createElement("textarea");
          field.value = message;
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.append(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          if (!copied) throw new Error("Clipboard access is unavailable.");
        }
        showToast("Exam instructions and student link copied. Send access codes privately.");
      } catch {
        showToast("Could not copy automatically. Copy the learner assessment page address instead.", "error");
      }
      return;
    }
    const refresh = event.target.closest("[data-refresh-results]");
    if (refresh) {
      refresh.disabled = true;
      try {
        await loadOnlineResults(refresh.dataset.refreshResults);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Assessment results could not be loaded.", "error");
        refresh.disabled = false;
      }
      return;
    }
    const gradeButton = event.target.closest("[data-grade-attempt]");
    if (!gradeButton) return;
    const resultRow = gradeButton.closest(".online-result-row");
    const questionReviews = {};
    let manualScore = 0;
    for (const scoreField of resultRow?.querySelectorAll("[data-question-review-score]") || []) {
      const questionIndex = scoreField.dataset.questionReviewScore;
      const commentField = resultRow.querySelector(`[data-question-review-comment="${questionIndex}"]`);
      if (!scoreField.reportValidity() || !commentField?.reportValidity()) return;
      const score = Number(scoreField.value);
      manualScore += score;
      questionReviews[questionIndex] = { score, comment: commentField.value.trim() };
    }
    gradeButton.disabled = true;
    try {
      await workspaceRequest(`/api/teacher/online-assessment-attempts/${gradeButton.dataset.gradeAttempt}/grade`, "POST", {
        manual_score: manualScore,
        question_reviews: questionReviews
      });
      if (activeOnlineAssessmentId) {
        try {
          await loadOnlineResults(activeOnlineAssessmentId);
          openGeneratedAssessmentTab("class");
          showToast("Written-response marks and feedback saved.");
        } catch (error) {
          showToast(error instanceof Error
            ? `Review saved, but refreshed results could not be loaded: ${error.message}`
            : "Review saved, but refreshed results could not be loaded.", "error");
          gradeButton.disabled = false;
        }
      } else {
        showToast("Written-response mark saved. Refresh the class results to see the total.");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The written-response mark could not be saved.", "error");
      gradeButton.disabled = false;
    }
  });

  assessmentResults.addEventListener("change", (event) => {
    const decisionSelect = event.target.closest('select[name="decision"]');
    if (!decisionSelect) return;
    const form = decisionSelect.closest("[data-integrity-review-attempt]");
    const deductionInput = form?.querySelector('[name="marks_deducted"]');
    if (!deductionInput) return;
    deductionInput.disabled = decisionSelect.value === "maintain";
    if (deductionInput.disabled) deductionInput.value = "0";
    else if (Number(deductionInput.value) < 1) deductionInput.value = "1";
  });

  assessmentResults.addEventListener("submit", async (event) => {
    const integrityReviewForm = event.target.closest("[data-integrity-review-attempt]");
    if (integrityReviewForm) {
      event.preventDefault();
      if (!integrityReviewForm.reportValidity()) return;
      const decision = integrityReviewForm.elements.namedItem("decision").value;
      const marksDeducted = decision === "maintain"
        ? 0
        : Number(integrityReviewForm.elements.namedItem("marks_deducted").value);
      const reason = integrityReviewForm.elements.namedItem("reason").value.trim();
      const button = integrityReviewForm.querySelector('[type="submit"]');
      button.disabled = true;
      button.textContent = "Saving review…";
      try {
        await workspaceRequest(`/api/teacher/online-assessment-attempts/${integrityReviewForm.dataset.integrityReviewAttempt}/integrity-review`, "POST", {
          decision,
          marks_deducted: marksDeducted,
          reason
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The integrity review could not be saved.", "error");
        button.disabled = false;
        button.textContent = "Save integrity review";
        return;
      }
      if (activeOnlineAssessmentId) {
        try {
          await loadOnlineResults(activeOnlineAssessmentId);
        } catch (error) {
          showToast(error instanceof Error
            ? `Integrity review saved, but refreshed results could not be loaded: ${error.message}`
            : "Integrity review saved, but refreshed results could not be loaded.", "error");
          button.disabled = false;
          button.textContent = "Save integrity review";
          return;
        }
      }
        showToast(decision === "maintain"
          ? "Integrity review saved. Marks are maintained with the recorded reason."
          : `Integrity review saved. ${marksDeducted} mark(s) deducted with the recorded reason.`);
      return;
    }
    const form = event.target.closest("[data-assessment-roster-form]");
    if (!form) return;
    event.preventDefault();
    const students = lines(form.elements.namedItem("students").value);
    if (!students.length || students.length > 300) {
      showToast("Keep between 1 and 300 learner names in the roster.", "error");
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Saving roster…";
    try {
      const result = await workspaceRequest(`/api/teacher/online-assessments/${form.dataset.assessmentId}/roster`, "POST", { students });
      const assessmentKey = String(form.dataset.assessmentId);
      publishedAccessCodes.set(assessmentKey, [...(publishedAccessCodes.get(assessmentKey) || []), ...result.new_access_codes]);
      await loadOnlineResults(form.dataset.assessmentId);
      const codeOutput = assessmentResults.querySelector("[data-roster-code-output]");
      codeOutput.innerHTML = result.new_access_codes.length
        ? `<div class="assessment-roster-new-codes"><strong>New learner access codes · copy or download these now</strong><ul>${result.new_access_codes.map((item) => `<li>${escapeHtml(item.learner_name)} · <code>${escapeHtml(item.access_code)}</code></li>`).join("")}</ul></div>`
        : "<p class=\"field-help\">Roster saved. No new access codes were needed.</p>";
      showToast("Assessment roster updated. New access codes are available in the teacher roster.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The roster could not be updated.", "error");
      button.disabled = false;
      button.textContent = "Save roster changes";
    }
  });

  const scheduleForm = document.getElementById("schedule-form");
  const scheduleFormDialog = document.getElementById("schedule-form-dialog");
  const scheduleBoard = document.getElementById("schedule-list");
  const scheduleDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const scheduleDateFromKey = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  };
  const scheduleShiftDate = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  const scheduleTimeMinutes = (time) => {
    const [hour, minute] = String(time || "00:00").split(":").map(Number);
    return hour * 60 + minute;
  };
  const scheduleTimeText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const scheduleWeekdayForDate = (date) => weekdays[(date.getDay() + 6) % 7];
  const scheduleDayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const scheduleWeekStartDate = (date) => scheduleShiftDate(date, -((date.getDay() + (schedulePreferences.weekStart === "Sunday" ? 0 : 6)) % 7));
  const scheduleOccursOn = (entry, date) => {
    const weekday = scheduleWeekdayForDate(date);
    if (entry.repeatMode === "daily" ? !schoolDays.includes(weekday) : weekday !== entry.day) return false;
    const dateKey = scheduleDateKey(date);
    if (entry.startsOn && dateKey < entry.startsOn) return false;
    if (entry.repeatUntil && dateKey > entry.repeatUntil) return false;
    if (entry.repeatMode === "daily") return true;
    if (!entry.startsOn || Number(entry.repeatIntervalWeeks || 1) <= 1) return true;
    const elapsedWeeks = Math.floor((scheduleDayNumber(date) - scheduleDayNumber(scheduleDateFromKey(entry.startsOn))) / 7);
    return elapsedWeeks >= 0 && elapsedWeeks % Number(entry.repeatIntervalWeeks) === 0;
  };
  const greatestCommonDivisor = (left, right) => right ? greatestCommonDivisor(right, left % right) : left;
  const scheduleOccurrencesCanOverlap = (left, right) => {
    if (left.repeatMode !== "daily" && right.repeatMode !== "daily" && left.day !== right.day) return false;
    const anchors = [left.startsOn, right.startsOn].filter(Boolean).sort();
    const start = anchors.length ? scheduleDateFromKey(anchors[anchors.length - 1]) : new Date();
    const intervals = [Number(left.repeatIntervalWeeks || 1), Number(right.repeatIntervalWeeks || 1)];
    const cycleWeeks = intervals[0] / greatestCommonDivisor(intervals[0], intervals[1]) * intervals[1];
    for (let day = 0; day <= cycleWeeks * 7 + 6; day++) {
      const occurrenceDate = scheduleShiftDate(start, day);
      if (scheduleOccursOn(left, occurrenceDate) && scheduleOccursOn(right, occurrenceDate)) return true;
      if ((left.repeatUntil && scheduleDateKey(occurrenceDate) >= left.repeatUntil)
        || (right.repeatUntil && scheduleDateKey(occurrenceDate) >= right.repeatUntil)) break;
    }
    return false;
  };
  const scheduleDateLabel = (date, options = { weekday: "short", month: "short", day: "numeric" }) =>
    new Intl.DateTimeFormat("en-GH", options).format(date);
  const persistSchedulePreferences = () => {
    try {
      localStorage.setItem("akademi-schedule-view", JSON.stringify({
        mode: schedulePreferences.mode,
        date: scheduleDateKey(schedulePreferences.date),
        dayStart: schedulePreferences.dayStart,
        dayEnd: schedulePreferences.dayEnd,
        slotMinutes: schedulePreferences.slotMinutes,
        weekStart: schedulePreferences.weekStart
      }));
    } catch (error) {
      console.warn("Schedule view preferences could not be saved.", error);
      showToast("Calendar preferences could not be saved on this device.", "error");
    }
  };
  const scheduleColor = (entry) => /^#[0-9a-f]{6}$/i.test(entry.color || "") ? entry.color : "#398c69";
  const scheduleDuration = (entry) => Math.max(15, scheduleTimeMinutes(entry.endTime || scheduleTimeText(scheduleTimeMinutes(entry.time) + 60)) - scheduleTimeMinutes(entry.time));
  const scheduleRepeatLabel = (entry) => {
    if (entry.repeatMode === "daily") return "Every school day";
    if (entry.repeatMode === "custom") return entry.startsOn || entry.repeatUntil ? "Custom repeat" : "Custom weekly";
    return Number(entry.repeatIntervalWeeks || 1) > 1 ? `Every ${entry.repeatIntervalWeeks} weeks` : "Weekly";
  };
  let editingScheduleId = null;
  let scheduleCopyDraft = null;

  function suggestedScheduleDate(day, anchor = schedulePreferences.date) {
    const dayNumber = weekdays.indexOf(day);
    const offset = (dayNumber - ((anchor.getDay() + 6) % 7) + 7) % 7;
    return scheduleDateKey(scheduleShiftDate(anchor, offset));
  }

  function scheduleSuggestions() {
    const subjects = new Set([profile.primary_subject, ...(String(profile.subjects || "").split(/[,;\n]+/))]);
    const classes = new Set();
    schedule.forEach((entry) => {
      subjects.add(entry.subject);
      classes.add(entry.className);
    });
    documents.forEach((document) => {
      subjects.add(document.subject);
      classes.add(document.className);
    });
    const subjectList = [...subjects].map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20);
    const classList = [...classes].map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20);
    document.getElementById("schedule-subject-suggestions").innerHTML = subjectList
      .map((value) => `<button type="button" class="schedule-suggestion subject-suggestion" data-schedule-suggest-subject="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
    document.getElementById("schedule-class-suggestions").innerHTML = classList
      .map((value) => `<button type="button" class="schedule-suggestion class-suggestion" data-schedule-suggest-class="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
  }

  function openScheduleForm(day = scheduleWeekdayForDate(schedulePreferences.date) || "Monday", time = "08:00") {
    editingScheduleId = null;
    scheduleForm.reset();
    scheduleForm.querySelector('[name="day"]').value = weekdays.includes(day) ? day : "Monday";
    scheduleForm.querySelector('[name="time"]').value = time;
    scheduleForm.querySelector('[name="endTime"]').value = scheduleTimeText(Math.min(scheduleTimeMinutes(time) + 60, 23 * 60 + 59));
    scheduleForm.querySelector('[name="color"]').value = "#398c69";
    scheduleForm.querySelector('[name="repeatMode"]').value = "weekly";
    scheduleForm.querySelector("#schedule-custom-repeat").classList.add("hidden");
    scheduleForm.querySelector("[data-repeat-interval]").classList.remove("hidden");
    scheduleForm.querySelector("[data-repeat-note]").textContent = "Custom intervals repeat on this weekday, every selected number of weeks.";
    scheduleForm.querySelector('[name="startsOn"]').value = "";
    scheduleForm.querySelector('[name="repeatUntil"]').value = "";
    scheduleForm.querySelector("[data-schedule-form-title]").textContent = "Add a recurring class";
    scheduleForm.querySelector("[data-schedule-save]").textContent = "Save class";
    scheduleSuggestions();
    if (!scheduleFormDialog.open) scheduleFormDialog.showModal();
    scheduleForm.querySelector('[name="subject"]').focus();
  }

  function scheduleEntryMarkup(entry, { month = false, agenda = false, compact = false, column, row, span = 1, occurrenceDate = "" } = {}) {
    const color = scheduleColor(entry);
    const classLabel = entry.className ? ` · ${entry.className}` : "";
    const editButton = `<button type="button" class="schedule-edit-entry" data-edit-schedule="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(entry.subject)}">✎</button>`;
    const copyButton = `<button type="button" class="schedule-copy-entry" data-copy-schedule="${escapeHtml(entry.id)}" aria-label="Copy ${escapeHtml(entry.subject)}" title="Copy activity">⧉</button>`;
    const removeButton = `<button type="button" class="schedule-remove-entry" data-remove-schedule="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(entry.subject)}">×</button>`;
    const repeatLabel = scheduleRepeatLabel(entry);
    if (month) {
      const recurrenceLabel = repeatLabel ? ` · ${repeatLabel}` : "";
      return `<article class="schedule-month-event" tabindex="0" data-schedule-detail="${escapeHtml(entry.id)}" data-occurrence-date="${escapeHtml(occurrenceDate)}" style="--schedule-color:${color}" title="${escapeHtml(entry.time)} ${escapeHtml(entry.subject)}${escapeHtml(classLabel)}${recurrenceLabel}"><time>${escapeHtml(entry.time)}</time> ${escapeHtml(entry.subject)}${escapeHtml(classLabel)}${copyButton}${editButton}${removeButton}</article>`;
    }
    const recurrenceBadge = repeatLabel ? `<small class="schedule-repeat-badge">${escapeHtml(repeatLabel)}</small>` : "";
    if (agenda) {
      return `<article class="schedule-agenda-event" tabindex="0" draggable="true" data-schedule-detail="${escapeHtml(entry.id)}" data-schedule-card="${escapeHtml(entry.id)}" data-occurrence-date="${escapeHtml(occurrenceDate)}" style="--schedule-color:${color}"><time>${escapeHtml(entry.time)}–${escapeHtml(entry.endTime || "")}</time><div><strong>${escapeHtml(entry.subject)}${escapeHtml(classLabel)}</strong>${entry.topic ? `<small>${escapeHtml(entry.topic)}</small>` : ""}${recurrenceBadge}</div>${copyButton}${editButton}${removeButton}</article>`;
    }
    return `<article class="schedule-calendar-event${compact ? " is-compact" : ""}" tabindex="0" draggable="true" data-schedule-detail="${escapeHtml(entry.id)}" data-schedule-card="${escapeHtml(entry.id)}" data-occurrence-date="${escapeHtml(occurrenceDate)}" style="--schedule-color:${color};grid-column:${column};grid-row:${row} / span ${span}" title="Drag to move ${escapeHtml(entry.subject)}"><div class="schedule-event-time">${escapeHtml(entry.time)}–${escapeHtml(entry.endTime || "")}</div><div class="schedule-event-copy"><strong>${escapeHtml(entry.subject)}${escapeHtml(classLabel)}</strong>${entry.topic ? `<small>${escapeHtml(entry.topic)}</small>` : ""}${recurrenceBadge}</div>${copyButton}${editButton}${removeButton}</article>`;
  }

  function scheduleCopyTrayMarkup() {
    if (!scheduleCopyDraft) return "";
    const entry = scheduleCopyDraft.entry;
    const classLabel = entry.className ? ` · ${entry.className}` : "";
    return `<div class="schedule-copy-tray" role="status"><div><strong>Copied activity ready to place</strong><small>Drag this card to a time slot or day to create a one-time class.</small></div><article class="schedule-copy-draft" draggable="true" data-schedule-copy-draft style="--schedule-color:${scheduleColor(entry)}"><span>${escapeHtml(entry.time)}–${escapeHtml(entry.endTime || "")}</span><strong>${escapeHtml(entry.subject)}${escapeHtml(classLabel)}</strong>${entry.topic ? `<small>${escapeHtml(entry.topic)}</small>` : ""}</article><button type="button" class="schedule-copy-cancel" data-cancel-schedule-copy aria-label="Cancel copied activity">Cancel</button></div>`;
  }

  function renderSchedule() {
    window.clearTimeout(schedulePopoverTimer);
    scheduleEventPopover.hidden = true;
    schedulePopoverTarget = null;
    const mode = schedulePreferences.mode;
    const anchor = schedulePreferences.date;
    const summary = document.getElementById("schedule-summary");
    const periodLabel = document.getElementById("schedule-period-label");
    const monthName = new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric" }).format(anchor);
    let visibleEntries = [];
    if (mode === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
      const offset = (first.getDay() - (schedulePreferences.weekStart === "Sunday" ? 0 : 1) + 7) % 7;
      const gridStart = scheduleShiftDate(first, -offset);
      const headings = scheduleWeekOrder();
      const cells = Array.from({ length: 42 }, (_, index) => {
        const date = scheduleShiftDate(gridStart, index);
        const day = scheduleWeekdayForDate(date);
        const classes = weekdays.includes(day) ? schedule.filter((entry) => scheduleOccursOn(entry, date)).sort((a, b) => a.time.localeCompare(b.time)) : [];
        if (date.getMonth() === anchor.getMonth()) visibleEntries.push(...classes);
        return `<section class="schedule-month-cell${date.getMonth() === anchor.getMonth() ? "" : " is-outside-month"}${scheduleDateKey(date) === scheduleDateKey(new Date()) ? " is-today" : ""}" data-calendar-date="${scheduleDateKey(date)}"><button type="button" class="schedule-month-date" data-schedule-date="${scheduleDateKey(date)}" aria-label="Open ${scheduleDateLabel(date, { weekday: "long", month: "long", day: "numeric" })}">${date.getDate()}</button><div class="schedule-month-events">${classes.map((entry) => scheduleEntryMarkup(entry, { month: true, occurrenceDate: scheduleDateKey(date) })).join("") || ""}</div></section>`;
      }).join("");
      periodLabel.textContent = monthName;
      const header = headings.map((day) => `<span>${day.slice(0, 3)}</span>`).join("");
      scheduleBoard.innerHTML = `<div class="schedule-month-grid" style="--schedule-month-columns:7"><div class="schedule-month-headings">${header}</div>${cells}</div>`;
      summary.textContent = `${visibleEntries.length} class ${visibleEntries.length === 1 ? "occurrence" : "occurrences"} this month · based on repeat rules`;
    } else {
      let days;
      let weekStart = scheduleWeekStartDate(anchor);
      if (mode === "day") {
        const day = scheduleWeekdayForDate(anchor);
        days = [day];
        visibleEntries = days.flatMap(() => schedule.filter((entry) => scheduleOccursOn(entry, anchor)));
        periodLabel.textContent = `${scheduleDateLabel(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`;
      } else {
        const daysFromWeekStart = scheduleWeekOrder();
        weekStart = scheduleShiftDate(anchor, -((anchor.getDay() + (schedulePreferences.weekStart === "Sunday" ? 0 : 6)) % 7));
        days = daysFromWeekStart;
        visibleEntries = days.flatMap((weekday, index) => {
          const date = scheduleShiftDate(weekStart, index);
          return weekdays.includes(weekday) ? schedule.filter((entry) => scheduleOccursOn(entry, date)) : [];
        });
        const weekEnd = scheduleShiftDate(weekStart, 6);
        periodLabel.textContent = `${scheduleDateLabel(weekStart)} – ${scheduleDateLabel(weekEnd, { month: "short", day: "numeric", year: weekStart.getFullYear() !== weekEnd.getFullYear() ? "numeric" : undefined })}`;
      }
      const slotCount = Math.max(1, Math.ceil((schedulePreferences.dayEnd - schedulePreferences.dayStart) * 60 / schedulePreferences.slotMinutes));
      const columns = days.length || 1;
      const gridColumns = `56px repeat(${columns}, minmax(0, 1fr))`;
      const gridRows = `38px repeat(${slotCount}, 42px) 20px`;
      const headers = `<div class="schedule-grid-corner"></div>${days.map((day) => {
        const dayOffset = scheduleWeekOrder().indexOf(day);
        const dayDate = mode === "day" ? anchor : scheduleShiftDate(weekStart, dayOffset);
        return `<div class="schedule-grid-day"><span>${escapeHtml(day.slice(0, 3))}</span>${mode === "week" ? `<small>${scheduleDateLabel(dayDate, { month: "short", day: "numeric" })}</small>` : ""}</div>`;
      }).join("")}`;
      const slots = [];
      for (let slot = 0; slot < slotCount; slot++) {
        const minutes = schedulePreferences.dayStart * 60 + slot * schedulePreferences.slotMinutes;
        slots.push(`<time class="schedule-grid-time" style="grid-column:1;grid-row:${slot + 2}">${scheduleTimeText(minutes)}</time>`);
        days.forEach((day, dayIndex) => {
          slots.push(`<button type="button" class="schedule-grid-slot" style="grid-column:${dayIndex + 2};grid-row:${slot + 2}" data-schedule-slot="${escapeHtml(day)}" data-schedule-time="${scheduleTimeText(minutes)}" data-occurrence-date="${scheduleDateKey(mode === "day" ? anchor : scheduleShiftDate(weekStart, scheduleWeekOrder().indexOf(day)))}" aria-label="Add a class ${escapeHtml(day)} at ${scheduleTimeText(minutes)}"></button>`);
        });
      }
      slots.push(`<time class="schedule-grid-time schedule-grid-end-time" style="grid-column:1;grid-row:${slotCount + 2}">${scheduleTimeText(schedulePreferences.dayEnd * 60)}</time>`);
      const weekAgenda = mode === "week" ? days.map((day, dayIndex) => {
        const occurrenceDate = scheduleShiftDate(weekStart, dayIndex);
        const dateKey = scheduleDateKey(occurrenceDate);
        const isToday = dateKey === scheduleDateKey(new Date());
        const dayEntries = schedule.filter((entry) => scheduleOccursOn(entry, occurrenceDate)).sort((left, right) => left.time.localeCompare(right.time));
        const nowLabel = isToday
          ? `<small class="schedule-agenda-now" data-schedule-now>${scheduleTimeText(new Date().getHours() * 60 + new Date().getMinutes())} now</small>`
          : "";
        const addButton = `<button type="button" class="schedule-agenda-add" data-schedule-slot="${escapeHtml(day)}" data-schedule-time="08:00" data-occurrence-date="${dateKey}" aria-label="Add a class ${escapeHtml(day)}">+</button>`;
        const eventMarkup = dayEntries.length
          ? dayEntries.map((entry) => scheduleEntryMarkup(entry, { agenda: true, occurrenceDate: dateKey })).join("")
          : '<p class="schedule-agenda-empty">No classes</p>';
        return `<section class="schedule-agenda-day${isToday ? " is-today" : ""}" data-schedule-drop-day="${escapeHtml(day)}" data-occurrence-date="${dateKey}"><header><strong>${escapeHtml(day.slice(0, 3))} · ${scheduleDateLabel(occurrenceDate, { month: "short", day: "numeric" })}</strong><span>${nowLabel}${addButton}</span></header><div>${eventMarkup}</div></section>`;
      }).join("") : "";
      const events = [];
      days.forEach((day, dayIndex) => {
        const occurrenceDate = mode === "day" ? anchor : scheduleShiftDate(weekStart, schedulePreferences.weekStart === "Sunday"
          ? scheduleWeekOrder().indexOf(day)
          : weekdays.indexOf(day));
        schedule.filter((entry) => scheduleOccursOn(entry, occurrenceDate)).forEach((entry) => {
          const startRow = Math.floor((scheduleTimeMinutes(entry.time) - schedulePreferences.dayStart * 60) / schedulePreferences.slotMinutes);
          if (startRow < 0 || startRow >= slotCount) return;
          const span = Math.max(1, Math.min(slotCount - startRow, Math.ceil(scheduleDuration(entry) / schedulePreferences.slotMinutes)));
          events.push(scheduleEntryMarkup(entry, { compact: mode === "day", column: dayIndex + 2, row: startRow + 2, span, occurrenceDate: scheduleDateKey(occurrenceDate) }));
        });
      });
      const now = new Date();
      const nowWeekday = scheduleWeekdayForDate(now);
      const currentDayIndex = days.indexOf(nowWeekday);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const todayKey = scheduleDateKey(now);
      const weekEndKey = scheduleDateKey(scheduleShiftDate(weekStart, 6));
      if ((mode === "week" && scheduleDateKey(weekStart) <= todayKey && todayKey <= weekEndKey
        || mode === "day" && scheduleDateKey(anchor) === todayKey)
        && currentDayIndex >= 0
        && currentMinutes >= schedulePreferences.dayStart * 60
        && currentMinutes < schedulePreferences.dayEnd * 60) {
        const elapsedMinutes = currentMinutes - schedulePreferences.dayStart * 60;
        const markerRow = Math.floor(elapsedMinutes / schedulePreferences.slotMinutes) + 2;
        const markerOffset = (elapsedMinutes % schedulePreferences.slotMinutes) / schedulePreferences.slotMinutes * 42;
        events.push(`<div class="schedule-current-time-marker" role="img" aria-label="Current time ${scheduleTimeText(currentMinutes)}" style="grid-column:${currentDayIndex + 2};grid-row:${markerRow};--schedule-now-offset:${markerOffset}px"><span>${scheduleTimeText(currentMinutes)}</span></div>`);
      }
      const emptyMessage = mode === "day"
        ? "Select an empty time slot to add a class."
        : "Select an empty time slot to add a class. Drag any class card to another day or time.";
      scheduleBoard.innerHTML = mode === "day" && !days.length
        ? `<div class="schedule-calendar-empty">${escapeHtml(emptyMessage)}</div>`
        : days.length
        ? `${mode === "week" ? `<div class="schedule-week-agenda">${weekAgenda}</div>` : ""}<div class="schedule-timeline-wrap${mode === "week" ? " schedule-week-timeline" : ""}"><div class="schedule-timeline" style="grid-template-columns:${gridColumns};grid-template-rows:${gridRows}">${headers}${slots.join("")}${events.join("")}</div></div>`
        : `<div class="schedule-calendar-empty">${escapeHtml(emptyMessage)}</div>`;
      summary.textContent = `${visibleEntries.length} class${visibleEntries.length === 1 ? "" : "es"} in this ${mode}`;
    }
    if (scheduleCopyDraft) scheduleBoard.insertAdjacentHTML("afterbegin", scheduleCopyTrayMarkup());
    document.querySelectorAll("[data-schedule-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.scheduleView === mode)));
    document.getElementById("schedule-copy").disabled = false;
    document.querySelector(".schedule-toolbar .save-note").textContent = mode === "month"
      ? "Synced to your account · Choose a date to see that day's timetable; edit an occurrence to change its class."
      : "Synced to your account · Drag a class to move it, or select an empty slot to add one.";
    scheduleSuggestions();
  }

  function scheduleExportData(format) {
    const date = schedulePreferences.date;
    let occurrences = [];
    let title;
    if (schedulePreferences.mode === "month") {
      const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
        const dayDate = new Date(date.getFullYear(), date.getMonth(), dayNumber, 12);
        schedule.filter((entry) => scheduleOccursOn(entry, dayDate)).forEach((entry) => occurrences.push({ entry, date: dayDate }));
      }
      title = `Teaching schedule · ${new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric" }).format(date)}`;
    } else {
      const viewDates = schedulePreferences.mode === "day"
        ? [date]
        : Array.from({ length: 7 }, (_, index) => scheduleShiftDate(scheduleWeekStartDate(date), index));
      viewDates.forEach((viewDate) => {
        schedule.filter((entry) => scheduleOccursOn(entry, viewDate)).forEach((entry) => occurrences.push({ entry, date: viewDate }));
      });
      title = schedulePreferences.mode === "day"
        ? `Teaching schedule · ${scheduleDateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`
        : `Teaching schedule · week of ${scheduleDateLabel(scheduleWeekStartDate(date), { month: "short", day: "numeric", year: "numeric" })}`;
    }
    occurrences.sort((left, right) => left.date - right.date || left.entry.time.localeCompare(right.entry.time));
    const dayLabel = (occurrenceDate) => schedulePreferences.mode === "day"
      ? scheduleDateLabel(occurrenceDate, { weekday: "long", month: "short", day: "numeric" })
      : schedulePreferences.mode === "month"
        ? scheduleDateLabel(occurrenceDate, { weekday: "short", month: "short", day: "numeric" })
        : `${scheduleDateLabel(occurrenceDate, { weekday: "long" })} · ${scheduleDateLabel(occurrenceDate, { month: "short", day: "numeric" })}`;
    const periods = [...new Set(occurrences.map(({ entry }) => `${entry.time}–${entry.endTime}`))]
      .sort((left, right) => left.localeCompare(right));
    const dayRows = new Map();
    occurrences.forEach(({ entry, date: occurrenceDate }) => {
      const day = dayLabel(occurrenceDate);
      if (!dayRows.has(day)) dayRows.set(day, new Map());
      const period = `${entry.time}–${entry.endTime}`;
      const details = [entry.subject, entry.className, entry.topic].filter(Boolean).join("\n");
      const cell = dayRows.get(day);
      cell.set(period, [...(cell.get(period) ? [cell.get(period)] : []), details].join("\n\n"));
    });
    const tableRows = [
      ["Day / date", ...periods],
      ...Array.from(dayRows, ([day, cells]) => [day, ...periods.map((period) => cells.get(period) || "")]),
    ];
    const lines = [{ text: "Recurring weekly teaching timetable" }, ...tableRows.map((row) => ({ text: row.join(" | ") }))];
    return {
      title,
      school: profile.school || "Teacher workspace",
      lines,
      tableRows,
      scheduleTable: true,
      blocks: [{ text: "Recurring teaching timetable · periods are columns and days are rows" }, { type: "table", rows: tableRows }],
    };
  }

  function schedulePrintCard() {
    const exportData = scheduleExportData("pdf");
    const rows = exportData.tableRows;
    const card = document.createElement("article");
    card.className = "output-card";
    card.innerHTML = `<div class="output-body"><div class="document-title-block"><div class="eyebrow">AKADEMI · TEACHING PLAN</div><h2>${escapeHtml(exportData.title)}</h2><p>Periods are columns · days are rows · ${escapeHtml(profile.school || "Teacher workspace")}</p></div><div class="document-section"><table class="scheme-table schedule-export-table"><thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${rows[0].length}">No classes scheduled for this period.</td></tr>`}</tbody></table></div></div>`;
    printDocument(exportData.title, card);
  }

  function editScheduleEntry(entry, occurrenceDate = "") {
    editingScheduleId = entry.id;
    scheduleForm.reset();
    scheduleForm.querySelector('[name="day"]').value = entry.day;
    scheduleForm.querySelector('[name="time"]').value = entry.time;
    scheduleForm.querySelector('[name="endTime"]').value = entry.endTime;
    scheduleForm.querySelector('[name="subject"]').value = entry.subject;
    scheduleForm.querySelector('[name="className"]').value = entry.className || "";
    scheduleForm.querySelector('[name="topic"]').value = entry.topic || "";
    scheduleForm.querySelector('[name="color"]').value = scheduleColor(entry);
    const repeatMode = entry.repeatMode || (entry.startsOn || entry.repeatUntil || Number(entry.repeatIntervalWeeks || 1) > 1 ? "custom" : "weekly");
    scheduleForm.querySelector('[name="repeatMode"]').value = repeatMode;
    scheduleForm.querySelector("#schedule-custom-repeat").classList.toggle("hidden", !["custom", "daily"].includes(repeatMode));
    scheduleForm.querySelector("[data-repeat-interval]").classList.toggle("hidden", repeatMode === "daily");
    scheduleForm.querySelector("[data-repeat-note]").textContent = repeatMode === "daily"
      ? "Repeats Monday to Friday, beginning on the selected start date."
      : "Custom intervals repeat on this weekday, every selected number of weeks.";
    scheduleForm.querySelector('[name="startsOn"]').value = entry.startsOn || occurrenceDate || suggestedScheduleDate(entry.day);
    scheduleForm.querySelector('[name="repeatUntil"]').value = entry.repeatUntil || "";
    scheduleForm.querySelector('[name="repeatIntervalWeeks"]').value = String(entry.repeatIntervalWeeks || 1);
    scheduleForm.querySelector("[data-schedule-form-title]").textContent = "Edit scheduled class";
    scheduleForm.querySelector("[data-schedule-save]").textContent = "Save changes";
    scheduleSuggestions();
    if (!scheduleFormDialog.open) scheduleFormDialog.showModal();
    scheduleForm.querySelector('[name="subject"]').focus();
  }

  const scheduleStartSelect = document.getElementById("schedule-day-start");
  const scheduleEndSelect = document.getElementById("schedule-day-end");
  for (let hour = 5; hour <= 18; hour++) scheduleStartSelect.add(new Option(`${String(hour).padStart(2, "0")}:00`, String(hour)));
  for (let hour = 7; hour <= 23; hour++) scheduleEndSelect.add(new Option(`${String(hour).padStart(2, "0")}:00`, String(hour)));
  scheduleStartSelect.value = String(schedulePreferences.dayStart);
  scheduleEndSelect.value = String(schedulePreferences.dayEnd);
  document.getElementById("schedule-slot-size").value = String(schedulePreferences.slotMinutes);
  document.getElementById("schedule-week-start").value = schedulePreferences.weekStart;
  document.getElementById("schedule-add").addEventListener("click", () => openScheduleForm());
  const closeScheduleForm = () => {
    editingScheduleId = null;
    if (scheduleFormDialog.open) scheduleFormDialog.close();
  };
  scheduleFormDialog.addEventListener("click", (event) => {
    if (event.target === scheduleFormDialog) closeScheduleForm();
  });
  scheduleFormDialog.addEventListener("close", () => { editingScheduleId = null; });
  document.getElementById("schedule-cancel").addEventListener("click", closeScheduleForm);
  scheduleForm.querySelector("[data-schedule-cancel]").addEventListener("click", closeScheduleForm);
  scheduleForm.querySelector('[name="repeatMode"]').addEventListener("change", (event) => {
    const mode = event.target.value;
    const needsDates = mode === "custom" || mode === "daily";
    scheduleForm.querySelector("#schedule-custom-repeat").classList.toggle("hidden", !needsDates);
    scheduleForm.querySelector("[data-repeat-interval]").classList.toggle("hidden", mode === "daily");
    scheduleForm.querySelector("[data-repeat-note]").textContent = mode === "daily"
      ? "Repeats Monday to Friday, beginning on the selected start date."
      : "Custom intervals repeat on this weekday, every selected number of weeks.";
    if (needsDates && !scheduleForm.querySelector('[name="startsOn"]').value) {
      scheduleForm.querySelector('[name="startsOn"]').value = suggestedScheduleDate(scheduleForm.querySelector('[name="day"]').value);
    }
  });
  scheduleForm.querySelector('[name="startsOn"]').addEventListener("change", (event) => {
    if (!event.target.value) return;
    const selectedDate = scheduleDateFromKey(event.target.value);
    const day = scheduleWeekdayForDate(selectedDate);
    if (day) scheduleForm.querySelector('[name="day"]').value = day;
  });
  scheduleForm.querySelector('[name="day"]').addEventListener("change", (event) => {
    if (["custom", "daily"].includes(scheduleForm.querySelector('[name="repeatMode"]').value)) {
      scheduleForm.querySelector('[name="startsOn"]').value = suggestedScheduleDate(event.target.value);
    }
  });
  scheduleForm.addEventListener("click", (event) => {
    const subjectSuggestion = event.target.closest("[data-schedule-suggest-subject]");
    if (subjectSuggestion) {
      scheduleForm.querySelector('[name="subject"]').value = subjectSuggestion.dataset.scheduleSuggestSubject;
      return;
    }
    const classSuggestion = event.target.closest("[data-schedule-suggest-class]");
    if (classSuggestion) scheduleForm.querySelector('[name="className"]').value = classSuggestion.dataset.scheduleSuggestClass;
  });
  scheduleForm.querySelector('[name="time"]').addEventListener("change", (event) => {
    const endTime = scheduleForm.querySelector('[name="endTime"]');
    if (scheduleTimeMinutes(endTime.value) <= scheduleTimeMinutes(event.target.value)) {
      endTime.value = scheduleTimeText(Math.min(scheduleTimeMinutes(event.target.value) + 60, 23 * 60 + 59));
    }
  });
  scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!scheduleForm.reportValidity()) return;
    const entry = formData(scheduleForm);
    if (scheduleTimeMinutes(entry.endTime) <= scheduleTimeMinutes(entry.time)) {
      showToast("The class end time must be later than its start time.", "error");
      return;
    }
    if (entry.repeatMode === "custom") {
      entry.repeatIntervalWeeks = Number(entry.repeatIntervalWeeks);
      if (!entry.startsOn) {
        showToast("Choose a start date for a custom repeat interval.", "error");
        return;
      }
      const startsOnDay = scheduleWeekdayForDate(scheduleDateFromKey(entry.startsOn));
      if (!startsOnDay || startsOnDay !== entry.day) {
        showToast("The custom repeat start date must match the selected weekday.", "error");
        return;
      }
      if (entry.repeatUntil && entry.repeatUntil < entry.startsOn) {
        showToast("The repeat-until date must be on or after the start date.", "error");
        return;
      }
    } else if (entry.repeatMode === "daily") {
      if (!schoolDays.includes(entry.day)) {
        showToast("Every school day repeats Monday to Friday. Choose a weekday or select a different repeat option.", "error");
        return;
      }
      entry.repeatIntervalWeeks = 1;
      entry.startsOn = entry.startsOn || suggestedScheduleDate(entry.day);
      if (entry.repeatUntil && entry.repeatUntil < entry.startsOn) {
        showToast("The daily repeat must end on or after the start date.", "error");
        return;
      }
    } else {
      entry.repeatIntervalWeeks = 1;
      entry.startsOn = "";
      entry.repeatUntil = "";
    }
    const start = scheduleTimeMinutes(entry.time);
    const end = scheduleTimeMinutes(entry.endTime);
    const conflict = schedule.find((item) => item.id !== editingScheduleId && scheduleOccurrencesCanOverlap(item, entry)
      && start < scheduleTimeMinutes(item.endTime || scheduleTimeText(scheduleTimeMinutes(item.time) + 60))
      && end > scheduleTimeMinutes(item.time));
    if (conflict && !(await window.akademiAlert.confirm(
      `This class overlaps ${conflict.subject} on ${entry.day}. Add it anyway?`,
      { title: "Schedule overlap", confirmText: "Add anyway" }
    ))) return;
    const submit = scheduleForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      if (editingScheduleId) {
        const result = await workspaceRequest(`/api/workspace/schedule/${encodeURIComponent(editingScheduleId)}`, "PUT", entry);
        schedule = schedule.map((item) => item.id === editingScheduleId ? result.entry : item);
        showToast("Class changes saved and synced to your account.");
      } else {
        const result = await workspaceRequest("/api/workspace/schedule", "POST", entry);
        schedule.push(result.entry);
        showToast("Class saved and synced to your account.");
      }
      editingScheduleId = null;
      scheduleForm.reset();
      scheduleFormDialog.close();
      renderSchedule();
      scheduleSuggestions();
      renderDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Schedule entry could not be saved.", "error");
    } finally {
      submit.disabled = false;
    }
  });
  document.querySelectorAll("[data-schedule-view]").forEach((button) => button.addEventListener("click", () => {
    schedulePreferences.mode = button.dataset.scheduleView;
    persistSchedulePreferences();
    renderSchedule();
  }));
  document.querySelectorAll("[data-schedule-nav]").forEach((button) => button.addEventListener("click", () => {
    const direction = Number(button.dataset.scheduleNav);
    const step = schedulePreferences.mode === "month" ? 0 : schedulePreferences.mode === "week" ? 7 : 1;
    schedulePreferences.date = step === 0
      ? new Date(schedulePreferences.date.getFullYear(), schedulePreferences.date.getMonth() + direction, 15, 12)
      : scheduleShiftDate(schedulePreferences.date, step * direction);
    persistSchedulePreferences();
    renderSchedule();
  }));
  document.getElementById("schedule-today").addEventListener("click", () => {
    schedulePreferences.date = new Date();
    persistSchedulePreferences();
    renderSchedule();
  });
  scheduleStartSelect.addEventListener("change", () => {
    schedulePreferences.dayStart = Number(scheduleStartSelect.value);
    if (schedulePreferences.dayEnd <= schedulePreferences.dayStart) {
      schedulePreferences.dayEnd = Math.min(23, schedulePreferences.dayStart + 1);
      scheduleEndSelect.value = String(schedulePreferences.dayEnd);
    }
    persistSchedulePreferences();
    renderSchedule();
  });
  scheduleEndSelect.addEventListener("change", () => {
    schedulePreferences.dayEnd = Number(scheduleEndSelect.value);
    if (schedulePreferences.dayEnd <= schedulePreferences.dayStart) {
      schedulePreferences.dayStart = Math.max(5, schedulePreferences.dayEnd - 1);
      scheduleStartSelect.value = String(schedulePreferences.dayStart);
    }
    persistSchedulePreferences();
    renderSchedule();
  });
  document.getElementById("schedule-slot-size").addEventListener("change", (event) => {
    schedulePreferences.slotMinutes = Number(event.target.value);
    persistSchedulePreferences();
    renderSchedule();
  });
  document.getElementById("schedule-week-start").addEventListener("change", (event) => {
    schedulePreferences.weekStart = event.target.value;
    persistSchedulePreferences();
    renderSchedule();
  });
  document.getElementById("schedule-reset-preferences").addEventListener("click", () => {
    schedulePreferences.dayStart = 7;
    schedulePreferences.dayEnd = 17;
    schedulePreferences.slotMinutes = 30;
    schedulePreferences.weekStart = "Monday";
    scheduleStartSelect.value = "7";
    scheduleEndSelect.value = "17";
    document.getElementById("schedule-slot-size").value = "30";
    document.getElementById("schedule-week-start").value = "Monday";
    persistSchedulePreferences();
    renderSchedule();
  });
  const scheduleCopyDialog = document.getElementById("schedule-copy-dialog");
  const scheduleCopyForm = document.getElementById("schedule-copy-form");
  const scheduleCopyDate = document.getElementById("schedule-copy-date");
  const scheduleCopyScope = document.getElementById("schedule-copy-scope");
  const scheduleCopyDescription = document.getElementById("schedule-copy-description");
  const scheduleCopyDateLabel = document.getElementById("schedule-copy-date-label");
  const scheduleCopyConfirm = document.getElementById("schedule-copy-confirm");
  function syncScheduleCopyScope() {
    const entireSchedule = scheduleCopyScope.value === "entire";
    const dayView = !entireSchedule && schedulePreferences.mode === "day";
    scheduleCopyDescription.textContent = entireSchedule
      ? "Copy every scheduled class into a selected week as one-time entries."
      : dayView
        ? "Copy the selected day to another date."
        : "Copy the selected week to another week.";
    scheduleCopyDateLabel.textContent = dayView ? "Target date" : "Target week (choose any date in that week)";
  }
  document.getElementById("schedule-copy").addEventListener("click", () => {
    scheduleCopyScope.value = schedulePreferences.mode === "month" ? "entire" : "visible";
    syncScheduleCopyScope();
    scheduleCopyDate.value = scheduleDateKey(scheduleCopyScope.value === "visible" && schedulePreferences.mode === "day"
      ? scheduleShiftDate(schedulePreferences.date, 7)
      : scheduleShiftDate(scheduleWeekStartDate(schedulePreferences.date), 7));
    scheduleCopyConfirm.disabled = false;
    if (!scheduleCopyDialog.open) scheduleCopyDialog.showModal();
  });
  scheduleCopyScope.addEventListener("change", syncScheduleCopyScope);
  scheduleCopyDialog.querySelector("[data-schedule-copy-cancel]").addEventListener("click", () => scheduleCopyDialog.close());
  scheduleCopyDialog.addEventListener("click", (event) => {
    if (event.target === scheduleCopyDialog && !scheduleCopyConfirm.disabled) scheduleCopyDialog.close();
  });
  scheduleCopyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!scheduleCopyForm.reportValidity()) return;
    const targetDate = scheduleDateFromKey(scheduleCopyDate.value);
    const entireSchedule = scheduleCopyScope.value === "entire";
    const dayView = !entireSchedule && schedulePreferences.mode === "day";
    const sourceStart = dayView ? schedulePreferences.date : scheduleWeekStartDate(schedulePreferences.date);
    const targetStart = dayView ? targetDate : scheduleWeekStartDate(targetDate);
    const copies = [];
    if (entireSchedule) {
      schedule.forEach((entry) => {
        const dayOffset = scheduleWeekOrder().indexOf(entry.day);
        const targetOccurrenceDate = scheduleShiftDate(targetStart, dayOffset);
        copies.push({ entry, targetOccurrenceDate });
      });
    } else {
      const sourceDates = dayView
        ? [sourceStart]
        : Array.from({ length: 7 }, (_, index) => scheduleShiftDate(sourceStart, index));
      sourceDates.forEach((sourceDate, index) => {
        const targetOccurrenceDate = scheduleShiftDate(targetStart, dayView ? 0 : index);
        schedule.filter((entry) => scheduleOccursOn(entry, sourceDate)).forEach((entry) => {
          copies.push({ entry, targetOccurrenceDate });
        });
      });
    }
    const uniqueCopies = new Set();
    const entriesToCreate = [];
    copies.forEach(({ entry, targetOccurrenceDate }) => {
        const targetDay = scheduleWeekdayForDate(targetOccurrenceDate);
        if (!targetDay) return;
        const duplicate = schedule.some((existing) => existing.day === targetDay
          && existing.time === entry.time
          && existing.endTime === entry.endTime
          && existing.subject === entry.subject
          && (existing.className || "") === (entry.className || "")
          && (existing.topic || "") === (entry.topic || "")
          && scheduleOccursOn(existing, targetOccurrenceDate));
        if (duplicate) return;
        const copyKey = `${targetDay}|${entry.time}|${entry.endTime}|${entry.subject}|${entry.className || ""}|${entry.topic || ""}`;
        if (uniqueCopies.has(copyKey)) return;
        uniqueCopies.add(copyKey);
        entriesToCreate.push({
          day: targetDay,
          time: entry.time,
          endTime: entry.endTime,
          subject: entry.subject,
          className: entry.className || "",
          topic: entry.topic || "",
          color: scheduleColor(entry),
          repeatMode: "custom",
          repeatIntervalWeeks: 1,
          startsOn: scheduleDateKey(targetOccurrenceDate),
          repeatUntil: scheduleDateKey(targetOccurrenceDate),
        });
    });
    if (!entriesToCreate.length) {
      showToast("There are no new classes to copy to the selected date or week.");
      scheduleCopyDialog.close();
      return;
    }
    scheduleCopyConfirm.disabled = true;
    scheduleCopyConfirm.textContent = "Copying…";
    const savedEntries = [];
    try {
      for (const entry of entriesToCreate) {
        const result = await workspaceRequest("/api/workspace/schedule", "POST", entry);
        savedEntries.push(result.entry);
      }
      schedule.push(...savedEntries);
      schedulePreferences.date = dayView ? targetDate : targetStart;
      persistSchedulePreferences();
      renderSchedule();
      renderDashboard();
      scheduleCopyDialog.close();
      showToast(`${savedEntries.length} class${savedEntries.length === 1 ? "" : "es"} copied as one-time entries.`);
    } catch (error) {
      if (savedEntries.length) {
        schedule.push(...savedEntries);
        schedulePreferences.date = dayView ? targetDate : targetStart;
        persistSchedulePreferences();
        renderSchedule();
        renderDashboard();
        scheduleCopyDialog.close();
        showToast(`${savedEntries.length} of ${entriesToCreate.length} classes copied. The remaining classes could not be saved.`, "error");
        return;
      }
      showToast(error instanceof Error ? error.message : "The schedule could not be copied completely.", "error");
      scheduleCopyConfirm.disabled = false;
    } finally {
      scheduleCopyConfirm.textContent = "Copy schedule";
    }
  });
  document.getElementById("schedule-print").addEventListener("click", schedulePrintCard);
  window.setInterval(() => {
    if (!document.getElementById("page-schedule")?.classList.contains("active")) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const label = scheduleTimeText(minutes);
    scheduleBoard.querySelectorAll("[data-schedule-now]").forEach((node) => {
      node.textContent = `${label} now`;
    });
    const marker = scheduleBoard.querySelector(".schedule-current-time-marker");
    if (marker
      && minutes >= schedulePreferences.dayStart * 60
      && minutes < schedulePreferences.dayEnd * 60) {
      const elapsedMinutes = minutes - schedulePreferences.dayStart * 60;
      marker.style.gridRow = String(Math.floor(elapsedMinutes / schedulePreferences.slotMinutes) + 2);
      marker.style.setProperty("--schedule-now-offset", `${(elapsedMinutes % schedulePreferences.slotMinutes) / schedulePreferences.slotMinutes * 42}px`);
      marker.setAttribute("aria-label", `Current time ${label}`);
      marker.querySelector("span").textContent = label;
    }
  }, 60_000);
  document.querySelectorAll("[data-schedule-export]").forEach((button) => button.addEventListener("click", () => {
    try {
      window.akademiAssessmentExport.download(scheduleExportData(button.dataset.scheduleExport), button.dataset.scheduleExport);
      showToast(`${button.dataset.scheduleExport.toUpperCase()} schedule download started.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Schedule export failed.", "error");
    }
  }));
  const scheduleEventPopover = document.getElementById("schedule-event-popover");
  let schedulePopoverTimer = 0;
  let schedulePopoverTarget = null;
  let scheduleDragMode = null;
  function showScheduleEventPopover(target) {
    const entry = schedule.find((item) => item.id === target.dataset.scheduleDetail);
    if (!entry) return;
    window.clearTimeout(schedulePopoverTimer);
    schedulePopoverTarget = target;
    scheduleEventPopover.replaceChildren();
    const heading = document.createElement("strong");
    heading.className = "schedule-event-popover-title";
    heading.textContent = entry.subject;
    scheduleEventPopover.append(heading);
    const dateKey = target.dataset.occurrenceDate;
    const date = dateKey ? scheduleDateFromKey(dateKey) : schedulePreferences.date;
    const details = [
      ["Date", scheduleDateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })],
      ["Time", `${entry.time}–${entry.endTime || scheduleTimeText(scheduleTimeMinutes(entry.time) + 60)}`],
      ["Class", entry.className || "Not specified"],
      ["Topic", entry.topic || "Not specified"],
      ["Repeat", scheduleRepeatLabel(entry)],
    ];
    details.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "schedule-event-popover-row";
      const term = document.createElement("span");
      term.textContent = label;
      const description = document.createElement("strong");
      description.textContent = value;
      row.append(term, description);
      scheduleEventPopover.append(row);
    });
    scheduleEventPopover.hidden = false;
    scheduleEventPopover.style.left = "12px";
    scheduleEventPopover.style.top = "12px";
    const bounds = target.getBoundingClientRect();
    const popoverBounds = scheduleEventPopover.getBoundingClientRect();
    const left = Math.max(12, Math.min(bounds.left, window.innerWidth - popoverBounds.width - 12));
    const above = bounds.top - popoverBounds.height - 8;
    const top = above >= 12 ? above : Math.min(window.innerHeight - popoverBounds.height - 12, bounds.bottom + 8);
    scheduleEventPopover.style.left = `${left}px`;
    scheduleEventPopover.style.top = `${Math.max(12, top)}px`;
  }
  scheduleBoard.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-schedule-detail]");
    if (target) showScheduleEventPopover(target);
  });
  scheduleBoard.addEventListener("pointerout", (event) => {
    if (!schedulePopoverTarget || schedulePopoverTarget.contains(event.relatedTarget)) return;
    schedulePopoverTimer = window.setTimeout(() => {
      scheduleEventPopover.hidden = true;
      schedulePopoverTarget = null;
    }, 100);
  });
  scheduleBoard.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-schedule-detail]");
    if (target) showScheduleEventPopover(target);
  });
  scheduleBoard.addEventListener("focusout", (event) => {
    if (schedulePopoverTarget?.contains(event.relatedTarget)) return;
    schedulePopoverTimer = window.setTimeout(() => {
      scheduleEventPopover.hidden = true;
      schedulePopoverTarget = null;
    }, 100);
  });
  scheduleBoard.addEventListener("click", async (event) => {
    const cancelCopy = event.target.closest("[data-cancel-schedule-copy]");
    if (cancelCopy) {
      scheduleCopyDraft = null;
      renderSchedule();
      return;
    }
    const copyButton = event.target.closest("[data-copy-schedule]");
    if (copyButton) {
      const entry = schedule.find((item) => item.id === copyButton.dataset.copySchedule);
      if (!entry) return;
      scheduleCopyDraft = {
        entry: { ...entry },
        occurrenceDate: copyButton.closest("[data-occurrence-date]")?.dataset.occurrenceDate || scheduleDateKey(schedulePreferences.date),
      };
      renderSchedule();
      showToast("Activity copied. Drag the copied card to a time slot to place it.");
      return;
    }
    const editButton = event.target.closest("[data-edit-schedule]");
    if (editButton) {
      const entry = schedule.find((item) => item.id === editButton.dataset.editSchedule);
      if (entry) editScheduleEntry(entry, editButton.closest("[data-occurrence-date]")?.dataset.occurrenceDate || "");
      return;
    }
    const dateButton = event.target.closest(".schedule-month-date[data-schedule-date]");
    if (dateButton) {
      schedulePreferences.date = scheduleDateFromKey(dateButton.dataset.scheduleDate);
      schedulePreferences.mode = "day";
      persistSchedulePreferences();
      renderSchedule();
      return;
    }
    const slot = event.target.closest("[data-schedule-slot]");
    if (slot) {
      if (scheduleCopyDraft) {
        void placeCopiedScheduleActivity({
          day: slot.dataset.scheduleSlot,
          time: slot.dataset.scheduleTime,
          date: slot.dataset.occurrenceDate,
          slot,
        });
        return;
      }
      openScheduleForm(slot.dataset.scheduleSlot, slot.dataset.scheduleTime);
      return;
    }
    const button = event.target.closest("[data-remove-schedule]");
    if (!button) return;
    button.disabled = true;
    try {
      await workspaceRequest(`/api/workspace/schedule/${encodeURIComponent(button.dataset.removeSchedule)}`, "DELETE");
      schedule = schedule.filter((entry) => entry.id !== button.dataset.removeSchedule);
      renderSchedule();
      renderDashboard();
      showToast("Class removed from your account.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Schedule entry could not be removed.", "error");
      button.disabled = false;
    }
  });
  scheduleBoard.addEventListener("dragstart", (event) => {
    const copiedCard = event.target.closest("[data-schedule-copy-draft]");
    if (copiedCard && event.dataTransfer) {
      scheduleDragMode = "copy";
      event.dataTransfer.setData("application/x-akademi-schedule-copy", "true");
      event.dataTransfer.effectAllowed = "copy";
      return;
    }
    const card = event.target.closest("[data-schedule-card]");
    if (!card || !event.dataTransfer) return;
    scheduleDragMode = "move";
    event.dataTransfer.setData("text/plain", card.dataset.scheduleCard);
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });
  scheduleBoard.addEventListener("dragend", (event) => {
    event.target.closest("[data-schedule-card]")?.classList.remove("is-dragging");
    scheduleDragMode = null;
  });
  function scheduleDropDestination(target, copyDrag = scheduleDragMode === "copy") {
    const agendaDay = target.closest("[data-schedule-drop-day]");
    if (agendaDay && (copyDrag || weekdays.includes(agendaDay.dataset.scheduleDropDay))) {
      return {
        day: agendaDay.dataset.scheduleDropDay,
        time: null,
        date: agendaDay.dataset.occurrenceDate,
        slot: null,
      };
    }
    if (copyDrag) {
      const monthCell = target.closest(".schedule-month-cell[data-calendar-date]");
      if (monthCell) {
        const date = scheduleDateFromKey(monthCell.dataset.calendarDate);
        return { day: scheduleWeekdayForDate(date), time: null, date: monthCell.dataset.calendarDate, slot: null };
      }
    }
    const slot = target.closest("[data-schedule-slot]");
    if (slot) return { day: slot.dataset.scheduleSlot, time: slot.dataset.scheduleTime, date: slot.dataset.occurrenceDate, slot };
    const eventCard = target.closest("[data-schedule-detail][data-occurrence-date]");
    const entry = eventCard && schedule.find((item) => item.id === eventCard.dataset.scheduleDetail);
    if (!entry) return null;
    const date = scheduleDateFromKey(eventCard.dataset.occurrenceDate);
    return {
      day: scheduleWeekdayForDate(date),
      time: entry.time,
      date: eventCard.dataset.occurrenceDate,
      slot: null,
    };
  }
  async function placeCopiedScheduleActivity(destination) {
    if (!scheduleCopyDraft || !weekdays.includes(destination.day) || !destination.date) {
      showToast("Drop the copied activity on a day or time slot.", "error");
      return;
    }
    const source = scheduleCopyDraft.entry;
    const targetTime = destination.time || source.time;
    const duration = scheduleDuration(source);
    const endMinutes = scheduleTimeMinutes(targetTime) + duration;
    if (endMinutes > 23 * 60 + 59) {
      showToast("This activity cannot be placed beyond the end of the day.", "error");
      return;
    }
    const startsOn = destination.date;
    const copiedEntry = {
      day: destination.day,
      time: targetTime,
      endTime: scheduleTimeText(endMinutes),
      subject: source.subject,
      className: source.className || "",
      topic: source.topic || "",
      color: scheduleColor(source),
      repeatMode: "custom",
      repeatIntervalWeeks: 1,
      startsOn,
      repeatUntil: startsOn,
    };
    const duplicate = schedule.find((existing) => existing.day === copiedEntry.day
      && existing.time === copiedEntry.time
      && existing.endTime === copiedEntry.endTime
      && existing.subject === copiedEntry.subject
      && (existing.className || "") === copiedEntry.className
      && (existing.topic || "") === copiedEntry.topic
      && scheduleOccursOn(existing, scheduleDateFromKey(startsOn)));
    if (duplicate) {
      showToast("This activity is already on the target day.");
      return;
    }
    const conflict = schedule.find((existing) => scheduleOccurrencesCanOverlap(existing, copiedEntry)
      && scheduleTimeMinutes(copiedEntry.time) < scheduleTimeMinutes(existing.endTime || scheduleTimeText(scheduleTimeMinutes(existing.time) + 60))
      && endMinutes > scheduleTimeMinutes(existing.time));
    if (conflict && !(await window.akademiAlert.confirm(
      `This activity overlaps ${conflict.subject} on ${copiedEntry.day}. Place it anyway?`,
      { title: "Schedule overlap", confirmText: "Place anyway" }
    ))) return;
    if (destination.slot) destination.slot.disabled = true;
    try {
      const result = await workspaceRequest("/api/workspace/schedule", "POST", copiedEntry);
      schedule.push(result.entry);
      schedulePreferences.date = scheduleDateFromKey(startsOn);
      if (schedulePreferences.mode === "month") schedulePreferences.mode = "day";
      scheduleCopyDraft = null;
      persistSchedulePreferences();
      renderSchedule();
      renderDashboard();
      showToast(`${source.subject} copied to ${copiedEntry.day} at ${copiedEntry.time}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The copied activity could not be placed.", "error");
      if (destination.slot) destination.slot.disabled = false;
    }
  }
  scheduleBoard.addEventListener("dragover", (event) => {
    const destination = scheduleDropDestination(event.target);
    if (!destination) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = scheduleDragMode === "copy" ? "copy" : "move";
    destination.slot?.classList.add("is-drop-target");
  });
  scheduleBoard.addEventListener("dragleave", (event) => event.target.closest("[data-schedule-slot]")?.classList.remove("is-drop-target"));
  scheduleBoard.addEventListener("drop", async (event) => {
    const destination = scheduleDropDestination(event.target);
    if (!destination) return;
    event.preventDefault();
    destination.slot?.classList.remove("is-drop-target");
    const id = event.dataTransfer?.getData("text/plain");
    if ((event.dataTransfer?.getData("application/x-akademi-schedule-copy") === "true" || scheduleDragMode === "copy") && scheduleCopyDraft) {
      await placeCopiedScheduleActivity(destination);
      return;
    }
    const entry = schedule.find((item) => item.id === id);
    if (!entry) return;
    const duration = scheduleDuration(entry);
    if (destination.day === entry.day && destination.time === entry.time) return;
    const nextTime = destination.time || entry.time;
    const nextEnd = scheduleTimeMinutes(nextTime) + duration;
    if (nextEnd > 23 * 60 + 59) {
      showToast("This class cannot be moved beyond the end of the day.", "error");
      return;
    }
    const updatedEntry = { ...entry, day: destination.day, time: nextTime, endTime: scheduleTimeText(nextEnd) };
    if (updatedEntry.startsOn && destination.date) updatedEntry.startsOn = destination.date;
    if (updatedEntry.startsOn && updatedEntry.repeatUntil && updatedEntry.repeatUntil < updatedEntry.startsOn) {
      showToast("This custom repeat cannot be moved past its repeat-until date.", "error");
      return;
    }
    if (destination.slot) destination.slot.disabled = true;
    try {
      const conflict = schedule.find((item) => item.id !== entry.id && scheduleOccurrencesCanOverlap(item, updatedEntry)
          && scheduleTimeMinutes(updatedEntry.time) < scheduleTimeMinutes(item.endTime || scheduleTimeText(scheduleTimeMinutes(item.time) + 60))
        && nextEnd > scheduleTimeMinutes(item.time));
      if (conflict && !(await window.akademiAlert.confirm(
        `This move overlaps ${conflict.subject} on ${updatedEntry.day}. Move it anyway?`,
        { title: "Schedule overlap", confirmText: "Move anyway" }
      ))) {
        renderSchedule();
        return;
      }
      const result = await workspaceRequest(`/api/workspace/schedule/${encodeURIComponent(entry.id)}`, "PUT", updatedEntry);
      schedule = schedule.map((item) => item.id === entry.id ? result.entry : item);
      renderSchedule();
      renderDashboard();
      showToast(`${entry.subject} moved to ${updatedEntry.day} at ${updatedEntry.time}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The class could not be moved.", "error");
      renderSchedule();
    }
  });
  renderSchedule();

  const slidesForm = document.getElementById("slides-form");
  const slidesWeekList = document.getElementById("slides-week-list");
  const slidesCurriculumStatus = document.getElementById("slides-curriculum-status");
  const slidesEditEditor = document.getElementById("slides-edit-editor");
  let slidesWeeklyLessons = [];
  let slidesGeneratedFields = { outcomes: [], indicators: [], points: [] };
  let slidesLoadVersion = 0;

  function selectedSlideWeeks() {
    return Array.from(slidesWeekList.querySelectorAll('input[name="slidesWeek"]:checked'))
      .map((input) => slidesWeeklyLessons[Number(input.value)])
      .filter(Boolean);
  }

  function slideWeekEntryTitles(week, type) {
    return [...new Set((Array.isArray(week?.curriculum_entries) ? week.curriculum_entries : [])
      .filter((entry) => String(entry.section_type || "").toLowerCase() === type)
      .map((entry) => String(entry.title || "").trim())
      .filter(Boolean))];
  }

  function slideEditValues() {
    const slides = [...slidesEditEditor.querySelectorAll("[data-slide-edit-index]")].map((card, index) => {
      const read = (field) => card.querySelector(`[data-slide-field="${field}"]`)?.value || "";
      const sourceIndex = card.dataset.slideSourceIndex === "" ? null : Number(card.dataset.slideSourceIndex);
      const original = Number.isInteger(sourceIndex)
        ? (activeSlideEditDoc?.data?.slides || [])[sourceIndex]
        : null;
      let visual;
      try {
        visual = JSON.parse(read("visual"));
      } catch {
        throw new Error(`Slide ${index + 1} visual must be valid JSON.`);
      }
      if (!visual || typeof visual !== "object" || Array.isArray(visual)
        || !["process", "timeline", "cards", "comparison", "table", "bar_chart", "graph", "line_chart", "geometry"].includes(visual.type)) {
        throw new Error(`Slide ${index + 1} visual must use a supported visual type.`);
      }
      return {
        ...(original || {}),
        title: read("title").trim(),
        key_points: lines(read("key_points")),
        activity: read("activity").trim(),
        presenter_notes: read("presenter_notes").trim(),
        visual,
        visual_suggestion: ""
      };
    });
    if (!slides.length || slides.length > 20) {
      throw new Error("A presentation must contain between 1 and 20 slides.");
    }
    if (slides.some((slide) => !slide.title || !slide.key_points.length)) {
      throw new Error("Each slide needs a title and at least one key point.");
    }
    const year = slidesEditEditor.querySelector('[name="editYear"]').value;
    return {
      ...(activeSlideEditDoc?.data || {}),
      title: slidesEditEditor.querySelector('[name="editTitle"]').value.trim(),
      subject: slidesEditEditor.querySelector('[name="editSubject"]').value.trim(),
      year,
      year_group: year ? `SHS${year.match(/([123])/i)?.[1] || ""}` : (activeSlideEditDoc?.data?.year_group || ""),
      template: slidesEditEditor.querySelector('[name="editTemplate"]').value,
      visual_theme: slidesEditEditor.querySelector('[name="editVisualTheme"]').value,
      number_of_slides: slides.length,
      slides
    };
  }

  function renderSlideEditEditor(doc) {
    const data = doc.data || {};
    const slides = Array.isArray(data.slides) ? data.slides : [];
    const options = (values, selected) => values.map(([value, label]) =>
      `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
    ).join("");
    const templates = [
      ["lesson", "Clear lesson sequence"], ["inquiry", "Inquiry & discovery"], ["worked", "Worked examples"],
      ["discussion", "Discussion & collaboration"], ["project", "Project-based learning"],
      ["revision", "Revision & retrieval practice"], ["flipped", "Flipped classroom"]
    ];
    const themes = [
      ["modern", "Modern classroom"], ["editorial", "Editorial"], ["vibrant", "Vibrant workshop"],
      ["data", "Data studio"], ["minimal", "Minimal"]
    ];
    const yearMatch = String(data.year || data.year_group || "").match(/([123])/);
    const year = yearMatch ? `SHS Year ${yearMatch[1]}` : "";
    slidesEditEditor.innerHTML = `
      <div class="slides-edit-heading">
        <div><span class="eyebrow">EDIT GENERATED CONTENT</span><h3>Presentation slides</h3><p>Edit slide text, speaker notes and visual data directly. Changes appear in the preview as you type.</p></div>
        <button type="button" class="button button-secondary" data-slide-add>+ Add slide</button>
      </div>
      <div class="form-grid slides-edit-metadata">
        <label class="field field-wide"><span>Presentation title <b>*</b></span><input name="editTitle" required value="${escapeHtml(data.title || doc.title.replace(/\s*·\s*presentation outline$/i, ""))}"></label>
        <label class="field"><span>SHS year</span><select name="editYear">${options([["", "Not set"], ["SHS Year 1", "SHS Year 1"], ["SHS Year 2", "SHS Year 2"], ["SHS Year 3", "SHS Year 3"]], year)}</select></label>
        <label class="field"><span>Subject</span><input name="editSubject" value="${escapeHtml(data.subject || "")}"></label>
        <label class="field"><span>Presentation template</span><select name="editTemplate">${options(templates, data.template || "lesson")}</select></label>
        <label class="field"><span>Slide design</span><select name="editVisualTheme">${options(themes, data.visual_theme || "modern")}</select></label>
      </div>
      <p class="field-help slides-edit-count" data-slide-count></p>
      <div class="slides-edit-list" data-slide-list></div>
      <section class="slides-edit-preview"><h4>Live preview</h4><div class="presentation-preview-grid" data-slide-preview></div></section>`;
    updateSlideEditList(slides.map((slide, index) => ({ ...slide, _sourceIndex: index })));
  }

  function slideEditCardMarkup(slide, index) {
    const visual = slide._visualText || (slide.visual && typeof slide.visual === "object"
      ? JSON.stringify(slide.visual, null, 2)
      : JSON.stringify({ type: "cards", title: "Key ideas", items: slide.key_points || [] }, null, 2));
    return `<fieldset class="slides-edit-card" data-slide-edit-index="${index}" data-slide-source-index="${slide._sourceIndex ?? ""}">
      <legend>Slide ${index + 1}</legend>
      <div class="slides-edit-card-heading"><strong>Slide ${index + 1}</strong><button type="button" class="text-button" data-slide-remove="${index}">Remove slide</button></div>
      <label class="field"><span>Slide title <b>*</b></span><input data-slide-field="title" required value="${escapeHtml(slide.title || "")}"></label>
      <label class="field"><span>Key points · one per line <b>*</b></span><textarea data-slide-field="key_points" rows="4" required>${escapeHtml(Array.isArray(slide.key_points) ? slide.key_points.join("\n") : "")}</textarea></label>
      <label class="field"><span>Classroom activity</span><textarea data-slide-field="activity" rows="2">${escapeHtml(slide.activity || "")}</textarea></label>
      <label class="field"><span>Teacher-only presenter notes</span><textarea data-slide-field="presenter_notes" rows="3">${escapeHtml(slide.presenter_notes || slide.speaker_notes || slide.notes || "")}</textarea></label>
      <label class="field"><span>Visual (JSON)</span><textarea data-slide-field="visual" rows="10" spellcheck="false" required>${escapeHtml(visual)}</textarea><small class="field-help">Edit this slide’s chart, graph, diagram or shapes as JSON. Keep the visual type and data structure valid.</small></label>
    </fieldset>`;
  }

  function refreshSlideEditPreview() {
    const cards = [...slidesEditEditor.querySelectorAll("[data-slide-edit-index]")];
    slidesEditEditor.querySelector("[data-slide-count]").textContent = `${cards.length} slide${cards.length === 1 ? "" : "s"} · maximum 20`;
    const preview = slidesEditEditor.querySelector("[data-slide-preview]");
    if (!preview) return;
    try {
      const data = slideEditValues();
      preview.innerHTML = data.slides.map((slide, index) => presentationSlideMarkup(slide, index, data)).join("");
    } catch (error) {
      preview.innerHTML = `<p class="notice notice-amber">${escapeHtml(error.message)}</p>`;
    }
  }

  function captureSlideEditCards() {
    return [...slidesEditEditor.querySelectorAll("[data-slide-edit-index]")].map((card) => {
      const read = (field) => card.querySelector(`[data-slide-field="${field}"]`)?.value || "";
      let visual;
      try {
        visual = JSON.parse(read("visual"));
      } catch {
        visual = undefined;
      }
      return {
        _sourceIndex: card.dataset.slideSourceIndex === "" ? null : Number(card.dataset.slideSourceIndex),
        title: read("title"),
        key_points: lines(read("key_points")),
        activity: read("activity"),
        presenter_notes: read("presenter_notes"),
        visual,
        _visualText: visual ? undefined : read("visual")
      };
    });
  }

  function updateSlideEditList(slides) {
    slidesEditEditor.querySelector("[data-slide-list]").innerHTML = slides
      .map((slide, index) => slideEditCardMarkup(slide, index)).join("");
    slidesEditEditor.querySelectorAll("[data-slide-remove]").forEach((button) => {
      button.disabled = slides.length <= 1;
    });
    slidesEditEditor.querySelector("[data-slide-add]").disabled = slides.length >= 20;
    refreshSlideEditPreview();
  }

  function setSlidesEditMode(editing) {
    const formGrid = slidesForm.querySelector(":scope > .form-grid");
    slidesForm.classList.toggle("is-editing-slides", editing);
    slidesEditEditor.hidden = !editing;
    formGrid.hidden = editing;
    formGrid.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = editing;
    });
    slidesForm.querySelector('[data-ai-generate="slides"]').hidden = editing;
    slidesForm.querySelector(".form-footer > .save-note").hidden = editing;
  }

  function mergeSlideSuggestions(fieldName, suggestions) {
    const field = slidesForm.elements.namedItem(fieldName);
    const currentLines = lines(field.value);
    const oldGenerated = slidesGeneratedFields[fieldName];
    const manualLines = currentLines.filter((line) => !oldGenerated.includes(line));
    field.value = [...suggestions, ...manualLines].join("\n");
    slidesGeneratedFields[fieldName] = suggestions;
  }

  function refreshSlideSuggestions() {
    const weeks = selectedSlideWeeks();
    if (!weeks.length) {
      slidesForm.elements.namedItem("title").value = "";
      ["outcomes", "indicators", "points"].forEach((name) => mergeSlideSuggestions(name, []));
      slidesCurriculumStatus.textContent = slidesWeeklyLessons.length
        ? "Select one or more weeks to draft curriculum-aligned presentation content."
        : "Choose the SHS year and subject to find curriculum weeks.";
      return;
    }
    const topics = weeks.map((week) => String(week.topic || "").trim()).filter(Boolean);
    const focalAreas = [...new Set(weeks.flatMap((week) => Array.isArray(week.focal_areas) ? week.focal_areas : [])
      .map((area) => String(area).trim()).filter(Boolean))];
    const plainTopics = topics.map((topic) => topic.replace(/[.!?;:,]+$/u, ""));
    const sourceOutcomes = [...new Set(weeks.flatMap((week) => Array.isArray(week.learning_outcomes) ? week.learning_outcomes : [])
      .map((item) => String(item).trim()).filter(Boolean))];
    const sourceIndicators = [...new Set(weeks.flatMap((week) => Array.isArray(week.learning_indicators) ? week.learning_indicators : [])
      .map((item) => String(item).trim()).filter(Boolean))];
    const outcomes = sourceOutcomes.length ? sourceOutcomes : [...new Set(plainTopics.flatMap((topic) => [
      `Explain the central ideas in ${topic}.`,
      `Apply knowledge and skills from ${topic} to relevant examples or tasks.`
    ]))];
    const indicators = sourceIndicators.length ? sourceIndicators : focalAreas.length
      ? [...new Set(focalAreas.map((area) => `Identify and explain a key idea in ${area}.`))]
      : [...new Set(plainTopics.map((topic) => `Describe and apply a key concept or skill from ${topic}.`))];
    const points = [...topics.map((topic) => `Topic: ${topic}`),
      ...[...new Set(weeks.flatMap((week) => slideWeekEntryTitles(week, "strand")))].map((strand) => `Strand: ${strand}`),
      ...[...new Set(weeks.flatMap((week) => slideWeekEntryTitles(week, "sub_strand")))].map((subStrand) => `Sub-strand: ${subStrand}`),
      ...focalAreas.map((area) => `Focal area: ${area}`),
      ...[...new Set(weeks.flatMap((week) => [
        ...slideWeekEntryTitles(week, "content_standard"),
        ...(Array.isArray(week.content_standard) ? week.content_standard : [week.content_standard])
      ]).map((standard) => String(standard || "").trim()).filter(Boolean))].map((standard) => `Content standard: ${standard}`)];
    points.push(...sourceIndicators.map((indicator) => `Learning indicator: ${indicator}`));
    points.push(...sourceOutcomes.map((outcome) => `Learning outcome: ${outcome}`));
    const subject = slidesForm.elements.namedItem("subject").value;
    const year = slidesForm.elements.namedItem("year").value;
    slidesForm.elements.namedItem("title").value = topics.length === 1
      ? topics[0]
      : `${subject} · ${year} · ${topics[0]}${topics.length > 1 ? ` + ${topics.length - 1} more` : ""}`;
    mergeSlideSuggestions("outcomes", outcomes);
    mergeSlideSuggestions("indicators", indicators);
    mergeSlideSuggestions("points", points);
    const semesters = [...new Set(weeks.map((week) => Number(week.semester_number)).filter(Boolean))];
    const hasSourceTargets = sourceOutcomes.length > 0 || sourceIndicators.length > 0;
    slidesCurriculumStatus.textContent = `${weeks.length} week${weeks.length === 1 ? "" : "s"} selected${semesters.length ? ` · Semester${semesters.length > 1 ? "s" : ""} ${semesters.join(", ")}` : ""}. ${hasSourceTargets ? "Source-recorded learning targets are included where available; any additional suggestions are teacher drafts." : "Suggestions are teacher-editable drafts, not official curriculum wording."}`;
  }

  async function loadSlideWeeks() {
    const year = slidesForm.elements.namedItem("year").value;
    const subject = slidesForm.elements.namedItem("subject").value;
    const loadVersion = ++slidesLoadVersion;
    if (!activeSlideEditDoc) {
      const customLines = {};
      ["outcomes", "indicators", "points"].forEach((name) => {
        customLines[name] = lines(slidesForm.elements.namedItem(name).value)
          .filter((line) => !slidesGeneratedFields[name].includes(line));
      });
      ["outcomes", "indicators", "points"].forEach((name) => {
        slidesGeneratedFields[name] = [];
        slidesForm.elements.namedItem(name).value = customLines[name].join("\n");
      });
      slidesForm.elements.namedItem("title").value = "";
    }
    slidesWeeklyLessons = [];
    slidesWeekList.replaceChildren();
    ["outcomes", "indicators", "points"].forEach((name) => {
      slidesGeneratedFields[name] = [];
    });
    if (!year || !subject) {
      slidesCurriculumStatus.textContent = "Choose the SHS year and subject to find curriculum weeks.";
      refreshSlideSuggestions();
      return;
    }
    slidesCurriculumStatus.textContent = "Loading curriculum weeks…";
    slidesWeekList.innerHTML = '<div class="slides-week-loading" role="status">Finding weekly topics…</div>';
    const yearGroup = year.match(/SHS\s*Year\s*([123])/i)?.[1];
    if (!yearGroup) {
      slidesWeekList.replaceChildren();
      slidesCurriculumStatus.textContent = "Choose a valid SHS year.";
      return;
    }
    try {
      const params = new URLSearchParams({ subject, year_group: `SHS${yearGroup}`, include_structure: "1" });
      const result = await workspaceRequest(`/api/curriculum/weekly-lessons?${params}`);
      if (loadVersion !== slidesLoadVersion) return;
      slidesWeeklyLessons = Array.isArray(result.lessons) ? result.lessons : [];
      if (!slidesWeeklyLessons.length) {
        slidesWeekList.replaceChildren();
        slidesCurriculumStatus.textContent = "No weekly topics were found for this subject and year. You can still enter presentation content manually.";
        return;
      }
      slidesWeekList.replaceChildren(...slidesWeeklyLessons.map((week, index) => {
        const label = document.createElement("label");
        label.className = "slides-week-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "slidesWeek";
        checkbox.value = String(index);
        checkbox.addEventListener("change", refreshSlideSuggestions);
        const copy = document.createElement("span");
        const heading = document.createElement("strong");
        heading.textContent = `Semester ${week.semester_number || "—"} · Week ${week.week_number || "—"}`;
        const topic = document.createElement("span");
        topic.textContent = week.topic || "Untitled topic";
        const focal = document.createElement("small");
        focal.textContent = Array.isArray(week.focal_areas) && week.focal_areas.length
          ? week.focal_areas.join(" · ")
          : "No focal areas recorded";
        const targets = document.createElement("small");
        const learningTargets = [
          ...(week.learning_indicators || []).map((item) => `Indicator: ${item}`),
          ...(week.learning_outcomes || []).map((item) => `Outcome: ${item}`)
        ];
        targets.textContent = learningTargets.length
          ? learningTargets.join(" · ")
          : "No learning targets recorded";
        const hierarchy = (week.curriculum_entries || [])
          .filter((entry) => ["strand", "sub_strand", "content_standard"].includes(String(entry.section_type || "").toLowerCase()))
          .map((entry) => String(entry.title || "").trim())
          .filter(Boolean);
        if (hierarchy.length) focal.textContent = [...hierarchy, ...(week.focal_areas || [])].join(" · ");
        copy.append(heading, topic, focal, targets);
        label.append(checkbox, copy);
        return label;
      }));
      slidesCurriculumStatus.textContent = `${slidesWeeklyLessons.length} curriculum week${slidesWeeklyLessons.length === 1 ? "" : "s"} available. Select the scope for your presentation.`;
    } catch (error) {
      if (loadVersion !== slidesLoadVersion) return;
      slidesWeekList.replaceChildren();
      slidesCurriculumStatus.textContent = error instanceof Error
        ? `Curriculum weeks could not be loaded: ${error.message}`
        : "Curriculum weeks could not be loaded. You can still enter presentation content manually.";
    }
  }

  function applyPresentationVisualData(slides, rawData) {
    const rows = lines(rawData).map((row) => row.split("|").map((cell) => cell.trim()));
    if (!slides.length || rows.length < 2 || rows[0].length < 2
      || !rows.every((row) => row.length === rows[0].length)) return;
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const numericColumn = headers.findIndex((_, column) => column > 0
      && dataRows.every((row) => row[column] !== "" && Number.isFinite(Number(row[column]))));
    slides[slides.length - 1].visual = numericColumn > 0
      ? {
        type: "bar_chart",
        title: "Teacher-provided data",
        labels: dataRows.map((row) => row[0]),
        values: dataRows.map((row) => Number(row[numericColumn])),
        value_label: headers[numericColumn]
      }
      : { type: "table", title: "Teacher-provided data", headers, rows: dataRows };
    slides[slides.length - 1].visual_suggestion = "";
  }

  function slideOutlineData(values, existing = null) {
    const count = Math.max(5, Math.min(20, Number(values.slides) || 8));
    const templateSequences = {
      lesson: ["Welcome & topic", "Learning outcomes", "Activate prior knowledge", "Key teaching point", "Explore together", "Guided practice", "Independent practice", "Check for understanding", "Review & reflect", "Next steps"],
      inquiry: ["Driving question", "What do we know?", "Notice & wonder", "Investigate", "Gather evidence", "Make sense of findings", "Share an explanation", "Challenge the evidence", "Reflect on learning", "Next inquiry"],
      worked: ["Learning goal", "Recall the essentials", "Worked example · model", "Think aloud", "Guided example", "Spot the misconception", "Try one together", "Independent challenge", "Check your method", "Key takeaways"],
      discussion: ["Opening question", "Set the context", "Think individually", "Pair & compare", "Group discussion", "Evidence and examples", "Share perspectives", "Build on ideas", "Synthesize learning", "Exit reflection"],
      project: ["Project challenge", "Purpose & audience", "Success criteria", "Explore the topic", "Plan the approach", "Create & test", "Peer feedback", "Improve the work", "Present the outcome", "Reflect & extend"],
      revision: ["Retrieval warm-up", "Learning checklist", "Quick recall", "Explain the concept", "Practice question", "Check & correct", "Common misconception", "Mixed challenge", "Self-assess", "Next revision step"],
      flipped: ["Before-class connection", "Today’s learning goal", "Check prior preparation", "Clarify key ideas", "Teacher mini-lesson", "Collaborative application", "Practice & feedback", "Apply to a new context", "Reflection", "Follow-up"]
    };
    const sequence = templateSequences[values.template] || templateSequences.lesson;
    const points = lines(values.points);
    const lectureNotes = lines(values.lectureNotes);
    const lectureNotesBySlide = distributePresentationNotes(lectureNotes, count);
    const outcomes = lines(values.outcomes);
    const indicators = lines(values.indicators);
    const selectedWeeks = selectedSlideWeeks();
    const selectedWeekData = selectedWeeks.length
      ? selectedWeeks.map((week) => ({
        curriculum_entries: week.curriculum_entries || [],
        semester_number: week.semester_number,
        week_number: week.week_number,
        topic: week.topic,
        strand: week.strand || slideWeekEntryTitles(week, "strand").join("; "),
        sub_strand: week.sub_strand || slideWeekEntryTitles(week, "sub_strand").join("; "),
        content_standard: week.content_standard || slideWeekEntryTitles(week, "content_standard").join("; "),
        focal_areas: week.focal_areas || [],
        learning_indicators: week.learning_indicators || [],
        learning_outcomes: week.learning_outcomes || [],
        source_title: week.source_title || "",
        source_reference: week.source_reference || "",
        source_page: week.source_page || null
      }))
      : slidesWeeklyLessons.length
        ? []
        : (existing?.selected_weeks || existing?.selected_week_sections || []);
    const slides = Array.from({ length: count }, (_, index) => {
      const weekIndex = selectedWeeks.length
        ? Math.min(selectedWeeks.length - 1, Math.floor(index * selectedWeeks.length / count))
        : -1;
      const selectedWeek = weekIndex >= 0 ? selectedWeeks[weekIndex] : null;
      const topic = String(selectedWeek?.topic || values.title).trim().replace(/[.!?;:,]+$/u, "");
      const weekFocalAreas = [...new Set((selectedWeek?.focal_areas || [])
        .map((area) => String(area).trim()).filter(Boolean))];
      const weekOutcomes = [...new Set([...(selectedWeek?.learning_outcomes || []), ...outcomes]
        .map((item) => String(item).trim()).filter(Boolean))];
      const weekIndicators = [...new Set([...(selectedWeek?.learning_indicators || []), ...indicators]
        .map((item) => String(item).trim()).filter(Boolean))];
      const title = selectedWeek ? `${sequence[index % sequence.length]} · ${topic}` : sequence[index % sequence.length];
      const pointIndex = Math.max(0, index - 3) % Math.max(points.length, 1);
      const point = points.length ? points[pointIndex] : `Introduce and explore ${weekFocalAreas[0] || topic}.`;
      const relevantOutcomes = weekOutcomes.filter((outcome) =>
        outcome.toLocaleLowerCase().includes(topic.toLocaleLowerCase())
        || (selectedWeek?.learning_outcomes || []).includes(outcome)
      ).slice(0, 3);
      const relevantIndicators = weekIndicators.filter((indicator) =>
        [topic, ...weekFocalAreas].some((focus) => focus && indicator.toLocaleLowerCase().includes(focus.toLocaleLowerCase()))
        || (selectedWeek?.learning_indicators || []).includes(indicator)
      ).slice(0, 3);
      let keyPoints;
      if (/outcome|goal|success criteria|checklist/i.test(title)) keyPoints = relevantOutcomes.length ? relevantOutcomes : [`Explain the purpose of ${topic}.`];
      else if (/indicator|check|assess|self-assess/i.test(title)) keyPoints = relevantIndicators.length ? relevantIndicators : [`Check understanding of ${weekFocalAreas[0] || topic}.`];
      else if (/driving question|opening question|warm-up|what do we know|notice & wonder|prior knowledge|activate prior|retrieval/i.test(title)) {
        keyPoints = [`Connect prior learning to ${topic}.`, `Discuss: How can these ideas help explain a new example?`];
      } else if (/summary|reflect|next step|follow-up|takeaways|exit|homework/i.test(title)) {
        keyPoints = [`Summarise the most important learning about ${topic}.`, "Identify one idea or skill to practise next."];
      }
      else if (/practice|worked|create|investigate|application|evidence|challenge|recall|explore|mini-lesson|discussion|example|idea|context|approach/i.test(title)) keyPoints = [point];
      else keyPoints = [point];
      const activities = {
        inquiry: "Learners investigate, compare evidence and explain their reasoning.",
        worked: "Model the process, make thinking visible and invite learners to try the next step.",
        discussion: "Use a focused prompt, invite evidence-based contributions and connect different ideas.",
        project: "Learners apply the topic to a purposeful task and share progress with peers.",
        revision: "Use retrieval practice, feedback and a short follow-up challenge.",
        flipped: "Use class time for clarification, collaboration and active application.",
        lesson: "Connect the explanation to a clear example, learner response or short check."
      };
      const topicVisual = /process|cycle|stages|sequence|steps|method/i.test(`${title} ${topic}`)
        ? { type: "process", title: "Learning sequence", steps: (points.length ? points : keyPoints).slice(0, 5) }
        : weekFocalAreas.length > 1
          ? { type: "cards", title: "Curriculum focal areas", items: weekFocalAreas.slice(0, 4) }
          : { type: "cards", title: "Key ideas", items: keyPoints.slice(0, 4) };
      return {
        title,
        key_points: keyPoints,
        activity: activities[values.template] || activities.lesson,
        presenter_notes: [
          templateLectureCue(values.template, title, activities[values.template] || activities.lesson),
          lectureNotesBySlide[index]
        ].filter(Boolean).join("\n\n"),
        visual_suggestion: topicVisual ? "" : "Add a relevant labelled diagram, worked example, or classroom visual.",
        visual: topicVisual
      };
    });
    applyPresentationVisualData(slides, values.visualData);
    return {
      ...(existing || {}),
      title: values.title.trim(),
      subject: values.subject,
      year: values.year,
      year_group: `SHS${values.year.match(/([123])/)[1]}`,
      template: values.template || "lesson",
      visual_theme: values.visualTheme || "modern",
      visual_data: values.visualData || "",
      number_of_slides: count,
      selected_weeks: selectedWeekData,
      learning_outcomes: outcomes,
      learning_indicators: indicators,
      teaching_points: points,
      lecture_notes: lectureNotes,
      slides: ensurePresentationVisuals(slides)
    };
  }

  function normalizePresentationData(data = {}) {
    const templates = ["lesson", "inquiry", "worked", "discussion", "project", "revision", "flipped"];
    const themes = ["modern", "editorial", "vibrant", "data", "minimal"];
    const template = data.template || data.presentation_template;
    const visualTheme = data.visual_theme || data.presentation_visual_theme;
    return {
      ...data,
      template: templates.includes(template) ? template : "lesson",
      visual_theme: themes.includes(visualTheme) ? visualTheme : "modern"
    };
  }

  function presentationSlideMarkup(slide, index, data) {
    const imageMarkup = presentationImageMarkup(slide.image);
    const visualMarkup = presentationVisualMarkup(slide.visual);
    const mediaMarkup = imageMarkup
      ? `<div class="presentation-media-column">${imageMarkup}${visualMarkup}</div>`
      : visualMarkup;
    return `<article class="presentation-slide-preview presentation-theme-${escapeHtml(data.visual_theme)} presentation-template-${escapeHtml(data.template)}"><header><span>SLIDE ${String(index + 1).padStart(2, "0")}</span><small>${escapeHtml(data.subject || "")} · ${escapeHtml(data.year || data.year_group || "")}</small></header><h4>${escapeHtml(slide.title)}</h4><ul>${(slide.key_points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>${mediaMarkup}<p>${escapeHtml(slide.activity || "")}${slide.visual_suggestion ? `<br><b>Visual:</b> ${escapeHtml(slide.visual_suggestion)}` : ""}</p></article>`;
  }

  function presentationImageMarkup(image) {
    if (!image || typeof image !== "object") return "";
    let imageUrl;
    let sourceUrl;
    try {
      imageUrl = new URL(String(image.url || ""));
      sourceUrl = new URL(String(image.source_url || ""));
    } catch {
      return "";
    }
    if (imageUrl.protocol !== "https:" || !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(imageUrl.hostname)
      || sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "commons.wikimedia.org") return "";
    let licenseMarkup = "";
    try {
      const licenseUrl = new URL(String(image.license_url || ""));
      if (licenseUrl.protocol === "https:" && ["creativecommons.org", "www.gnu.org"].includes(licenseUrl.hostname)) {
        licenseMarkup = ` · <a href="${escapeHtml(licenseUrl.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(image.license || "License")}</a>`;
      }
    } catch { /* Some public-domain images do not have a separate license URL. */ }
    return `<figure class="presentation-slide-image"><img src="${escapeHtml(imageUrl.href)}" alt="${escapeHtml(image.alt || "Curriculum-related classroom image")}" loading="lazy" referrerpolicy="no-referrer"><figcaption><a href="${escapeHtml(sourceUrl.href)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>${image.attribution ? ` · ${escapeHtml(image.attribution)}` : ""}${licenseMarkup}</figcaption></figure>`;
  }

  async function enrichPresentationImages(slides, subject) {
    const allCandidates = slides.filter((slide) => !slide.image);
    const imageLimit = Math.min(8, allCandidates.length);
    const candidates = imageLimit === allCandidates.length
      ? allCandidates
      : Array.from({ length: imageLimit }, (_, index) =>
        allCandidates[Math.round(index * (allCandidates.length - 1) / Math.max(1, imageLimit - 1))]
      );
    let nextIndex = 0;
    let failed = 0;
    let unavailable = 0;
    const plainText = (value) => new DOMParser().parseFromString(String(value || ""), "text/html").body.textContent.trim();
    const searchImage = async (slide) => {
      const concepts = [slide.title, ...(Array.isArray(slide.key_points) ? slide.key_points.slice(0, 2) : [])]
        .map((value) => String(value || "").replace(/[^\p{L}\p{N}\s-]/gu, " ").trim())
        .filter(Boolean);
      const query = `${concepts.join(" ")} ${String(subject || "").trim()}`.replace(/\s+/g, " ").slice(0, 180);
      if (!concepts.length) return null;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      try {
        const params = new URLSearchParams({
          action: "query",
          generator: "search",
          gsrsearch: `filetype:bitmap ${query}`,
          gsrnamespace: "6",
          gsrlimit: "5",
          prop: "imageinfo|info",
          inprop: "url",
          iiprop: "url|extmetadata",
          iiurlwidth: "1200",
          format: "json",
          origin: "*"
        });
        const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
          headers: { Accept: "application/json" },
          cache: "force-cache",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Wikimedia image search returned HTTP ${response.status}.`);
        const result = await response.json();
        const pages = Object.values(result.query?.pages || {});
        const page = pages.find((candidate) => {
          const info = candidate.imageinfo?.[0];
          let imageUrl;
          let sourceUrl;
          try { imageUrl = new URL(String(info?.thumburl || "")); } catch { return false; }
          try { sourceUrl = new URL(String(candidate.fullurl || "")); } catch { return false; }
          const metadata = info?.extmetadata || {};
          const license = plainText(metadata.LicenseShortName?.value || "");
          return imageUrl.protocol === "https:"
            && ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(imageUrl.hostname)
            && sourceUrl.protocol === "https:" && sourceUrl.hostname === "commons.wikimedia.org"
            && /(?:\bcc\b|creative commons|public domain|gfdl|free art)/i.test(license);
        });
        if (!page) {
          unavailable++;
          return null;
        }
        const info = page.imageinfo[0];
        const metadata = info.extmetadata || {};
        const artist = plainText(metadata.Artist?.value || metadata.Credit?.value || "");
        return {
          url: info.thumburl,
          source_url: page.fullurl,
          alt: plainText(metadata.ObjectName?.value || page.title.replace(/^File:/, "")),
          attribution: artist.slice(0, 240),
          license: plainText(metadata.LicenseShortName?.value || "").slice(0, 80),
          license_url: plainText(metadata.LicenseUrl?.value || "")
        };
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const slide = candidates[nextIndex++];
        try {
          slide.image = await searchImage(slide);
        } catch (error) {
          failed++;
          console.warn("A curriculum slide image could not be loaded:", error);
        }
      }
    });
    await Promise.all(workers);
    return { failed, unavailable };
  }

  function openPresentationViewer(data, title, resumedSession = null) {
    const presentation = normalizePresentationData(data);
    const slides = ensurePresentationVisuals(presentation.slides || []);
    if (!slides.length) {
      showToast("This saved presentation has no slides to display.", "error");
      return;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "presentation-viewer-dialog";
    if (resumedSession) dialog.dataset.presentationSimulationId = String(resumedSession.id);
    dialog.setAttribute("aria-label", `${title || presentation.title || "Presentation"} slideshow`);
    dialog.innerHTML = `
      <div class="presentation-fullscreen-content">
      <header class="presentation-viewer-header">
        <strong class="presentation-viewer-title">${escapeHtml(title || presentation.title || "Presentation")}</strong>
        <nav class="presentation-toolbar" aria-label="Presentation controls">
          <div class="presentation-toolbar-category" aria-label="Slides">
            <button type="button" class="presentation-icon-button" data-presentation-previous aria-label="Previous slide or reveal" title="Previous"><i class="fa-solid fa-arrow-left"></i><small>Back</small></button>
            <button type="button" class="presentation-icon-button" data-presentation-next aria-label="Next reveal or slide" title="Next / reveal"><i class="fa-solid fa-arrow-right"></i><small>Next</small></button>
            <details class="presentation-toolbar-menu">
              <summary class="presentation-icon-button" aria-label="Reveal settings" title="Reveal settings"><i class="fa-solid fa-eye"></i><small>Reveal</small></summary>
              <div class="presentation-toolbar-popover">
                <label>Reveal
                  <select data-presentation-reveal>
                    <option value="all">All content</option><option value="group">Groups of two</option>
                    <option value="item">One item at a time</option><option value="timed">Timed reveal</option>
                  </select>
                </label>
                <label data-reveal-interval-wrap hidden>Every <input data-reveal-interval type="number" min="2" max="60" value="5"> seconds</label>
              </div>
            </details>
          </div>
          <div class="presentation-toolbar-category" aria-label="Pointing">
            <button type="button" class="presentation-icon-button" data-presentation-tool="pointer" aria-label="Laser pointer" aria-pressed="false" title="Laser pointer"><i class="fa-solid fa-location-crosshairs"></i><small>Point</small></button>
          </div>
          <div class="presentation-toolbar-category" aria-label="Classroom">
            <details class="presentation-toolbar-menu">
              <summary class="presentation-icon-button" aria-label="Class timer" title="Class timer"><i class="fa-solid fa-stopwatch"></i><small>Timer</small></summary>
              <div class="presentation-toolbar-popover">
                <label>Minutes <input data-presentation-timer-minutes type="number" min="1" max="120" value="5"></label>
                <button type="button" class="presentation-icon-button" data-presentation-timer-start aria-label="Start timer" title="Start timer"><i class="fa-solid fa-play"></i><small>Start</small></button>
                <button type="button" class="presentation-icon-button" data-presentation-timer-stop aria-label="Stop timer" title="Stop timer"><i class="fa-solid fa-stop"></i><small>Stop</small></button>
                <strong data-presentation-timer-label aria-live="off"></strong>
              </div>
            </details>
            <details class="presentation-toolbar-menu">
              <summary class="presentation-icon-button" aria-label="Class poll" title="Class poll"><i class="fa-solid fa-square-poll-vertical"></i><small>Poll</small></summary>
              <form class="presentation-toolbar-popover presentation-poll-form" data-presentation-poll-form>
                <label>Question <input data-presentation-poll-question maxlength="240" placeholder="Ask your class"></label>
                <fieldset class="presentation-poll-options" data-presentation-poll-options>
                  <legend>Choices</legend>
                  <div class="presentation-poll-option-row">
                    <input data-presentation-poll-option maxlength="120" aria-label="Choice 1" placeholder="Choice 1" required>
                    <button type="button" class="presentation-poll-option-remove" aria-label="Remove choice 1" title="Remove choice"><i class="fa-solid fa-minus"></i></button>
                  </div>
                  <div class="presentation-poll-option-row">
                    <input data-presentation-poll-option maxlength="120" aria-label="Choice 2" placeholder="Choice 2" required>
                    <button type="button" class="presentation-poll-option-remove" aria-label="Remove choice 2" title="Remove choice"><i class="fa-solid fa-minus"></i></button>
                  </div>
                  <button type="button" class="presentation-poll-option-add" data-presentation-poll-option-add><i class="fa-solid fa-plus"></i> Add choice</button>
                </fieldset>
                <button type="submit" class="presentation-icon-button" data-presentation-poll-start aria-label="Start poll" title="Start poll"><i class="fa-solid fa-paper-plane"></i><small>Start</small></button>
                <button type="button" class="presentation-icon-button" data-presentation-poll-close aria-label="Close poll" title="Close poll"><i class="fa-solid fa-xmark"></i><small>Close</small></button>
                <span data-presentation-poll-results aria-live="polite"></span>
              </form>
            </details>
            <button type="button" class="presentation-icon-button" data-presentation-live aria-label="Start student follow" title="Start student follow"><i class="fa-solid fa-tower-broadcast"></i><small>Share</small></button>
          </div>
          <div class="presentation-toolbar-category" aria-label="View">
            <button type="button" class="presentation-icon-button" data-presentation-presenter-view aria-label="Presenter notes" aria-pressed="false" title="Presenter notes"><i class="fa-solid fa-sticky-note"></i><small>Notes</small></button>
            <button type="button" class="presentation-icon-button" data-presentation-open-history aria-label="Open presentation history" title="Presentation history"><i class="fa-solid fa-clock-rotate-left"></i><small>History</small></button>
            <button type="button" class="presentation-icon-button" data-presentation-fullscreen aria-label="Toggle full screen" title="Full screen"><i class="fa-solid fa-expand"></i><small>Full</small></button>
            <button type="button" class="presentation-icon-button" data-presentation-close aria-label="Exit presentation" title="Exit"><i class="fa-solid fa-xmark"></i><small>Exit</small></button>
          </div>
        </nav>
      </header>
      <div class="presentation-live-sharing" data-presentation-live-sharing hidden>
        <div class="presentation-live-controls" data-presentation-live-controls></div>
        <p class="presentation-join-notice" data-presentation-join-notice role="status" aria-live="polite"></p>
        <section class="presentation-feedback-card presentation-pace-card" data-presentation-pace-summary aria-label="Class pace responses">
          <h3><i class="fa-solid fa-gauge-high"></i> Class pace <span class="presentation-live-count" data-presentation-feedback-count="pace" hidden></span></h3>
          <div class="presentation-feedback-items" data-presentation-pace-items></div>
        </section>
        <span class="presentation-reaction-notice" data-presentation-reaction-notice role="status" aria-live="polite"></span>
        <section class="presentation-feedback-card presentation-poll-live-feedback" data-presentation-poll-live-feedback aria-label="Live poll results" aria-live="polite" hidden>
          <h3><i class="fa-solid fa-square-poll-vertical"></i> Live poll <span class="presentation-live-count" data-presentation-feedback-count="poll" hidden></span></h3>
          <div class="presentation-poll-feedback-content" data-presentation-poll-feedback></div>
        </section>
        <section class="presentation-feedback-card presentation-question-live-feedback" data-presentation-question-live-feedback aria-label="Student questions" hidden>
          <h3><i class="fa-solid fa-circle-question"></i> Student questions <span class="presentation-live-count" data-presentation-feedback-count="questions" hidden></span></h3>
          <div class="presentation-question-feedback-content" data-presentation-question-feedback></div>
        </section>
      </div>
      <dialog class="presentation-participants-dialog" data-presentation-participants-dialog aria-labelledby="presentation-participants-title">
        <section class="presentation-feedback-card presentation-participants" aria-label="Students in this presentation">
          <header class="presentation-participants-heading">
            <div>
              <h2 id="presentation-participants-title"><i class="fa-solid fa-users" aria-hidden="true"></i> Students joined <span class="presentation-live-count" data-presentation-participant-count>0</span></h2>
              <p class="presentation-participant-online" data-presentation-participant-online>0 online</p>
            </div>
            <button type="button" class="presentation-icon-button" data-presentation-participants-close aria-label="Close student list" title="Close student list"><i class="fa-solid fa-xmark" aria-hidden="true"></i><small>Close</small></button>
          </header>
          <ul class="presentation-participant-list" data-presentation-participant-list>
            <li class="presentation-participant-empty">No students have joined yet.</li>
          </ul>
        </section>
      </dialog>
      <div class="presentation-viewer-progress" role="progressbar" aria-label="Slide progress" aria-valuemin="1" aria-valuemax="${slides.length}" aria-valuenow="1"><span data-presentation-progress></span></div>
      <div class="presentation-viewer-layout">
        <div class="presentation-viewer-stage" data-presentation-stage></div>
        <aside class="presentation-presenter-notes" data-presentation-notes hidden>
          <label>Private presenter notes<textarea data-presentation-notes-input rows="12" placeholder="Only you can see these notes."></textarea></label>
          <p>Notes are private to this presenter and are never sent to student devices.</p>
        </aside>
      </div>
      <footer class="presentation-viewer-controls"><span data-presentation-slide-count aria-live="polite"></span><span class="presentation-viewer-feedback" data-presentation-feedback role="status" aria-live="polite"></span></footer>
      </div>`;
    document.body.append(dialog);
    const fullscreenContent = dialog.querySelector(".presentation-fullscreen-content");
    const stage = dialog.querySelector("[data-presentation-stage]");
    const previous = dialog.querySelector("[data-presentation-previous]");
    const next = dialog.querySelector("[data-presentation-next]");
    const count = dialog.querySelector("[data-presentation-slide-count]");
    const liveButton = dialog.querySelector("[data-presentation-live]");
    const liveSharing = dialog.querySelector("[data-presentation-live-sharing]");
    const liveControls = dialog.querySelector("[data-presentation-live-controls]");
    const revealSelect = dialog.querySelector("[data-presentation-reveal]");
    const revealInterval = dialog.querySelector("[data-reveal-interval]");
    const revealIntervalWrap = dialog.querySelector("[data-reveal-interval-wrap]");
    const notesPanel = dialog.querySelector("[data-presentation-notes]");
    const notesInput = dialog.querySelector("[data-presentation-notes-input]");
    const timerLabel = dialog.querySelector("[data-presentation-timer-label]");
    const pollResults = dialog.querySelector("[data-presentation-poll-results]");
    const pollLiveFeedback = dialog.querySelector("[data-presentation-poll-live-feedback]");
    const pollFeedback = dialog.querySelector("[data-presentation-poll-feedback]");
    const questionLiveFeedback = dialog.querySelector("[data-presentation-question-live-feedback]");
    const questionFeedback = dialog.querySelector("[data-presentation-question-feedback]");
    const pollOptionsContainer = dialog.querySelector("[data-presentation-poll-options]");
    const feedback = dialog.querySelector("[data-presentation-feedback]");
    const historyButton = dialog.querySelector("[data-presentation-open-history]");
    historyButton.addEventListener("click", () => {
      openPresentationHistory(fullscreenContent);
    });
    const paceSummary = dialog.querySelector("[data-presentation-pace-summary]");
    const paceItems = dialog.querySelector("[data-presentation-pace-items]");
    const participantCount = dialog.querySelector("[data-presentation-participant-count]");
    const participantOnline = dialog.querySelector("[data-presentation-participant-online]");
    const participantList = dialog.querySelector("[data-presentation-participant-list]");
    const participantsDialog = dialog.querySelector("[data-presentation-participants-dialog]");
    const participantsClose = dialog.querySelector("[data-presentation-participants-close]");
    participantsClose.addEventListener("click", () => participantsDialog.close());
    const participantJoinNotice = dialog.querySelector("[data-presentation-join-notice]");
    const reactionNotice = dialog.querySelector("[data-presentation-reaction-notice]");
    let activeSlide = 0;
    let liveSession = resumedSession ? { id: resumedSession.id, url: resumedSession.url } : null;
    let stopLiveSession = async () => true;
    let stoppingLiveSession = null;
    let slideUpdatePending = false;
    let revealMode = "all";
    let revealStep = 0;
    let lastRevealRender = null;
    let liveState = null;
    let annotations = [];
    let pointerState = null;
    let latestPointerState = null;
    let activeTool = "none";
    let activeColor = "#e5484d";
    let stateWritePending = 0;
    let pointerUpdateTimer = null;
    let pointerRequestPending = false;
    let pointerRequestPromise = Promise.resolve();
    let queuedPointerUpdate = false;
    let liveStateWriteQueue = Promise.resolve();
    let ownerPollTimer = null;
    let presentationClock = null;
    let lastTimedReveal = Date.now();
    let timerEndAt = null;
    let lastRenderedStateKey = "";
    let lastReactionCounts = null;
    let reactionNoticeTimer = null;
    let participantJoinNoticeTimer = null;
    let fullscreenActive = false;
    let lastPollSummary = "";
    let lastQuestionSummary = "";
    let lastParticipantSummary = "";
    let seenParticipantKeys = null;
    const feedbackPanels = { pace: true, poll: true, questions: false };
    const feedbackVisibilityButtons = {};
    let activePollId = "";
    let currentPollResponses = 0;
    const updateFeedbackCount = (key, count) => {
      const total = Math.max(0, Number(count) || 0);
      const badge = dialog.querySelector(`[data-presentation-feedback-count="${key}"]`);
      if (badge) {
        badge.textContent = total > 99 ? "99+" : String(total);
        badge.hidden = total === 0;
      }
      const button = feedbackVisibilityButtons[key];
      if (!button) return;
      let buttonBadge = button.querySelector(".presentation-feedback-count");
      if (!buttonBadge) {
        buttonBadge = document.createElement("span");
        buttonBadge.className = "presentation-feedback-count";
        button.append(buttonBadge);
      }
      buttonBadge.textContent = total > 99 ? "99+" : String(total);
      buttonBadge.hidden = total === 0;
      button.setAttribute("aria-label", `${feedbackPanels[key] ? "Hide" : "Show"} ${key === "questions" ? "Q&A" : key === "pace" ? "Pace" : "Poll"} feedback, ${total}`);
    };
    let pointerRenderFrame = null;

    const visualRevealUnitCount = (visual) => {
      if (!visual || typeof visual !== "object" || Array.isArray(visual)) return 1;
      const type = String(visual.type || "").toLowerCase();
      if (type === "table") {
        return Math.max(1, (Array.isArray(visual.rows) ? visual.rows : []).filter(Array.isArray).slice(0, 3).length);
      }
      if (type === "bar_chart" || type === "chart") {
        const labels = Array.isArray(visual.labels) ? visual.labels.slice(0, 6) : [];
        const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length).map(Number) : [];
        return values.length === labels.length && values.every(Number.isFinite) ? Math.max(1, labels.length) : 1;
      }
      if (["process", "timeline", "cards", "comparison"].includes(type)) {
        const items = Array.isArray(visual.steps) ? visual.steps : Array.isArray(visual.items) ? visual.items : [];
        const meaningfulItems = items.slice(0, 5).filter((item) => typeof item === "string"
          ? item.trim()
          : item && typeof item === "object" && [item.label, item.title, item.details].some((value) => typeof value === "string" && value.trim()));
        return Math.max(1, meaningfulItems.length);
      }
      if (type === "graph") {
        return Math.max(1, (Array.isArray(visual.points) ? visual.points : []).slice(0, 12)
          .filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value)))).length);
      }
      if (type === "line_chart") {
        const counts = (Array.isArray(visual.series) ? visual.series : []).slice(0, 4)
          .filter((series) => series && Array.isArray(series.values))
          .map((series) => series.values.slice(0, 12).filter((value) => Number.isFinite(Number(value))).length);
        return Math.max(1, ...counts);
      }
      return 1;
    };
    const revealedVisual = (visual, visibleCount) => {
      if (!visual || typeof visual !== "object" || Array.isArray(visual)) return visual;
      const type = String(visual.type || "").toLowerCase();
      if (type === "table") {
        return { ...visual, rows: (Array.isArray(visual.rows) ? visual.rows : []).filter(Array.isArray).slice(0, 3).slice(0, visibleCount) };
      }
      if (type === "bar_chart" || type === "chart") {
        const labels = Array.isArray(visual.labels) ? visual.labels.slice(0, 6) : [];
        const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length) : [];
        return { ...visual, labels: labels.slice(0, visibleCount), values: values.slice(0, visibleCount) };
      }
      if (["process", "timeline", "cards", "comparison"].includes(type)) {
        const field = Array.isArray(visual.steps) ? "steps" : "items";
        const items = Array.isArray(visual[field]) ? visual[field] : [];
        const meaningfulItems = items.slice(0, 5).filter((item) => typeof item === "string"
          ? item.trim()
          : item && typeof item === "object" && [item.label, item.title, item.details].some((value) => typeof value === "string" && value.trim()));
        return { ...visual, [field]: meaningfulItems.slice(0, visibleCount) };
      }
      if (type === "graph") {
        const points = (Array.isArray(visual.points) ? visual.points : []).slice(0, 12)
          .filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value))));
        return { ...visual, points: points.slice(0, visibleCount) };
      }
      if (type === "line_chart") {
        const series = (Array.isArray(visual.series) ? visual.series : []).slice(0, 4).map((item) => (
          item && Array.isArray(item.values)
            ? {
              ...item,
              values: item.values.slice(0, 12).filter((value) => Number.isFinite(Number(value))).slice(0, Math.min(12, visibleCount))
            }
            : item
        ));
        return { ...visual, series };
      }
      return visual;
    };
    const revealUnitCount = (slide, mode) => {
      const points = (Array.isArray(slide.key_points) ? slide.key_points : [])
        .filter((point) => typeof point === "string" && point.trim()).slice(0, 12);
      const groupSize = mode === "item" || mode === "timed" ? 1 : 2;
      return Math.ceil(points.length / groupSize)
        + Math.ceil(visualRevealUnitCount(slide.visual) / groupSize) * Number(Boolean(slide.visual))
        + Number(Boolean(slide.image))
        + Number(Boolean(slide.visual_suggestion)) + Number(Boolean(slide.activity));
    };
    const revealedSlide = (slide, mode, step) => {
      if (mode === "all") return slide;
      const points = (Array.isArray(slide.key_points) ? slide.key_points : [])
        .filter((point) => typeof point === "string" && point.trim()).slice(0, 12);
      const groupSize = mode === "item" || mode === "timed" ? 1 : 2;
      const pointGroups = Math.ceil(points.length / groupSize);
      let remaining = Math.max(0, step - pointGroups);
      const visible = { ...slide, key_points: points.slice(0, Math.min(points.length, step * groupSize)) };
      for (const field of ["image", "visual", "visual_suggestion", "activity"]) {
        if (!slide[field]) continue;
        const unitCount = field === "visual" ? visualRevealUnitCount(slide[field]) : 1;
        const unitGroups = Math.ceil(unitCount / groupSize);
        if (remaining >= unitGroups) {
          remaining -= unitGroups;
          if (field === "visual") visible[field] = revealedVisual(slide[field], unitCount);
        } else if (remaining > 0 && field === "visual") {
          visible[field] = revealedVisual(slide[field], Math.min(unitCount, remaining * groupSize));
          remaining = 0;
        } else {
          delete visible[field];
          remaining = 0;
        }
      }
      return visible;
    };
    const setFeedback = (message, isError = false) => {
      feedback.textContent = message;
      feedback.classList.toggle("is-error", isError);
    };
    const updateReactionFeedback = (counts = {}, responses = []) => {
      const labels = {
        understood: "Understood",
        confused: "Confused",
        slower: "Slower",
        faster: "Faster"
      };
      paceItems.replaceChildren();
      Object.entries(labels).forEach(([key, label]) => {
        const item = document.createElement("span");
        item.className = `presentation-feedback-item presentation-feedback-${key}`;
        const name = document.createElement("span");
        name.textContent = label;
        const value = document.createElement("strong");
        value.textContent = String(Number(counts[key] || 0));
        const respondents = document.createElement("small");
        const respondentNames = responses.filter((response) => response.reaction === key)
          .map((response) => response.participant_name).join(", ");
        respondents.textContent = respondentNames;
        if (respondentNames) {
          item.title = `${label}: ${respondentNames}`;
          item.setAttribute("aria-label", `${label}: ${respondentNames}`);
        } else {
          item.setAttribute("aria-label", `${label}: ${value.textContent}`);
        }
        item.append(name, value, respondents);
        paceItems.append(item);
      });
      updateFeedbackCount("pace", Object.values(counts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0));
      if (lastReactionCounts) {
        const changes = Object.entries(labels)
          .filter(([key]) => Number(counts[key] || 0) > Number(lastReactionCounts[key] || 0))
          .map(([, label]) => label);
        if (changes.length) {
          reactionNotice.textContent = `Student response: ${changes.join(", ")}`;
          if (reactionNoticeTimer !== null) window.clearTimeout(reactionNoticeTimer);
          reactionNoticeTimer = window.setTimeout(() => {
            reactionNotice.textContent = "";
            reactionNoticeTimer = null;
          }, 6000);
        }
      }
      lastReactionCounts = { ...counts };
    };
    const renderParticipants = (participants = []) => {
      const summary = JSON.stringify(participants);
      if (summary === lastParticipantSummary) return;
      lastParticipantSummary = summary;
      const students = Array.isArray(participants) ? participants : [];
      const occurrences = new Map();
      const studentKeys = students.map((student) => {
        const base = `${student.name || "Student"}|${student.joined_at || ""}`;
        const occurrence = occurrences.get(base) || 0;
        occurrences.set(base, occurrence + 1);
        return `${base}|${occurrence}`;
      });
      if (seenParticipantKeys !== null) {
        const newNames = students
          .filter((_, index) => !seenParticipantKeys.has(studentKeys[index]))
          .map((student) => String(student.name || "Student"));
        if (newNames.length) {
          participantJoinNotice.textContent = newNames.length === 1
            ? `${newNames[0]} joined the live presentation.`
            : `${newNames.join(", ")} joined the live presentation.`;
          if (participantJoinNoticeTimer !== null) window.clearTimeout(participantJoinNoticeTimer);
          participantJoinNoticeTimer = window.setTimeout(() => {
            participantJoinNotice.textContent = "";
            participantJoinNoticeTimer = null;
          }, 8000);
        }
      }
      seenParticipantKeys = new Set(studentKeys);
      participantCount.textContent = String(students.length);
      participantOnline.textContent = `${students.filter((student) => student.online).length} online`;
      const participantButtonCount = liveControls.querySelector("[data-presentation-participant-button-count]");
      if (participantButtonCount) participantButtonCount.textContent = students.length > 99 ? "99+" : String(students.length);
      const participantButton = liveControls.querySelector("[data-presentation-participants-open]");
      if (participantButton) participantButton.setAttribute("aria-label", `View students, ${students.length} joined`);
      participantList.replaceChildren();
      if (!students.length) {
        const empty = document.createElement("li");
        empty.className = "presentation-participant-empty";
        empty.textContent = "No students have joined yet.";
        participantList.append(empty);
        return;
      }
      students.forEach((student) => {
        const item = document.createElement("li");
        item.className = "presentation-participant";
        const name = document.createElement("span");
        name.textContent = student.name || "Student";
        const presence = document.createElement("small");
        presence.className = student.online ? "is-online" : "is-offline";
        presence.textContent = student.online ? "Online" : "Away";
        item.append(name, presence);
        participantList.append(item);
      });
    };
    const renderPollFeedback = (poll) => {
      const options = Array.isArray(poll.options) ? poll.options : [];
      const counts = options.map((_, index) => Math.max(0, Number(poll.results?.[index] || 0)));
      const totalVotes = counts.reduce((sum, value) => sum + value, 0);
      updateFeedbackCount("poll", totalVotes);
      pollFeedback.replaceChildren();
      const question = document.createElement("p");
      question.className = "presentation-poll-feedback-question";
      question.textContent = String(poll.question || "Class poll");
      const status = document.createElement("span");
      status.className = `presentation-poll-status${poll.open ? " is-open" : ""}`;
      status.textContent = poll.open ? "Open" : "Closed";
      const heading = document.createElement("div");
      heading.className = "presentation-poll-feedback-heading";
      heading.append(question, status);
      const rows = document.createElement("div");
      rows.className = "presentation-poll-feedback-options";
      options.forEach((option, index) => {
        const votes = counts[index];
        const percentage = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
        const row = document.createElement("div");
        row.className = "presentation-poll-feedback-option";
        const label = document.createElement("span");
        label.className = "presentation-poll-feedback-label";
        label.textContent = String(option);
        const meter = document.createElement("span");
        meter.className = "presentation-poll-feedback-meter";
        meter.setAttribute("role", "img");
        meter.setAttribute("aria-label", `${percentage}%`);
        const fill = document.createElement("span");
        fill.style.width = `${percentage}%`;
        meter.append(fill);
        const countLabel = document.createElement("strong");
        countLabel.textContent = `${votes} · ${percentage}%`;
        row.append(label, meter, countLabel);
        rows.append(row);
      });
      const footer = document.createElement("small");
      footer.textContent = `${totalVotes} ${totalVotes === 1 ? "response" : "responses"}`;
      pollFeedback.append(heading, rows, footer);
    };
    const renderQuestionFeedback = (questions = []) => {
      const summary = JSON.stringify(questions);
      if (summary === lastQuestionSummary) return;
      lastQuestionSummary = summary;
      questionFeedback.replaceChildren();
      updateFeedbackCount("questions", questions.length);
      if (!questions.length) {
        const empty = document.createElement("p");
        empty.className = "presentation-question-empty";
        empty.textContent = "Student questions will appear here.";
        questionFeedback.append(empty);
        return;
      }
      renderQuestionChat(questionFeedback, questions.slice(-30), liveSession?.id, (error) => {
        setFeedback(error instanceof Error ? error.message : "The response could not be saved.", true);
      }, (updatedQuestions) => {
        lastQuestionSummary = JSON.stringify(updatedQuestions);
      }, true);
    };
    const setTool = (tool) => {
      activeTool = activeTool === tool ? "none" : tool;
      dialog.querySelectorAll("[data-presentation-tool]").forEach((button) => {
        const selected = button.dataset.presentationTool === activeTool;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      stage.dataset.tool = activeTool;
      if (activeTool !== "pointer" && pointerState?.active) {
        pointerState = { ...pointerState, active: false };
        latestPointerState = pointerState;
        updateTeacherPointer();
        queuePointerUpdate(false);
      }
    };
    const updateNotes = () => {
      const slide = slides[activeSlide];
      if (slide && typeof slide === "object") slide.presenter_notes = notesInput.value;
    };
    const updateTimerDisplay = () => {
      if (!timerEndAt) {
        timerLabel.textContent = "";
        return;
      }
      const remaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      timerLabel.textContent = remaining ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Time ended";
    };
    const applyLiveState = (state) => {
      liveState = state;
      const stateKey = JSON.stringify([state.active_slide, state.reveal_mode, state.reveal_step]);
      const shouldRender = stateKey !== lastRenderedStateKey;
      if (Number.isInteger(state.active_slide)) activeSlide = state.active_slide;
      revealMode = ["all", "group", "item", "timed"].includes(state.reveal_mode) ? state.reveal_mode : revealMode;
      revealStep = Number(state.reveal_step) || 0;
      annotations = Array.isArray(state.annotations) ? state.annotations : [];
      pointerState = pointerRequestPending || queuedPointerUpdate || pointerUpdateTimer !== null
        ? latestPointerState
        : state.pointer || null;
      timerEndAt = state.timer_ends_at ? Date.parse(state.timer_ends_at) : null;
      if (revealSelect.value !== revealMode) revealSelect.value = revealMode;
      revealIntervalWrap.hidden = revealMode !== "timed";
      if (Number(state.reveal_interval_seconds) >= 2) revealInterval.value = String(state.reveal_interval_seconds);
      const poll = state.active_poll;
      updateReactionFeedback(state.reaction_counts || {}, state.reaction_responses || []);
      renderParticipants(state.participants || []);
      paceSummary.hidden = !feedbackPanels.pace;
      renderQuestionFeedback(Array.isArray(state.questions) ? state.questions : []);
      questionLiveFeedback.hidden = !feedbackPanels.questions;
      if (poll) {
        if (activePollId !== String(poll.id || "")) {
          activePollId = String(poll.id || "");
          currentPollResponses = 0;
        }
        const options = Array.isArray(poll.options) ? poll.options : [];
        currentPollResponses = options.reduce((total, _, index) => total + Math.max(0, Number(poll.results?.[index] || 0)), 0);
        const summary = `${poll.question} · ${options.map((option, index) => `${option}: ${Number(poll.results?.[index] || 0)}`).join(" · ")} · ${poll.open ? "Open" : "Closed"}`;
        const pollKey = JSON.stringify([poll.question, options, poll.results, poll.open]);
        if (lastPollSummary !== pollKey) {
          renderPollFeedback(poll);
          pollResults.textContent = summary;
        }
        pollLiveFeedback.hidden = !feedbackPanels.poll;
        lastPollSummary = pollKey;
      } else {
        updateFeedbackCount("poll", currentPollResponses);
        if (pollResults.textContent !== "No open classroom check.") pollResults.textContent = "No open classroom check.";
        if (lastPollSummary) {
          pollFeedback.replaceChildren();
          const closed = document.createElement("p");
          closed.className = "presentation-poll-feedback-closed";
          closed.textContent = "Poll closed.";
          pollFeedback.append(closed);
          pollLiveFeedback.hidden = !feedbackPanels.poll;
          window.setTimeout(() => {
            if (!liveState?.active_poll) pollLiveFeedback.hidden = true;
          }, 5000);
        } else {
          pollFeedback.replaceChildren();
          pollLiveFeedback.hidden = true;
        }
        lastPollSummary = "";
      }
      if (shouldRender) {
        renderActiveSlide();
        lastRenderedStateKey = stateKey;
      } else {
        updateTeacherPointer();
      }
      updateTimerDisplay();
    };
    const updateLiveState = async (payload, { silent = true } = {}) => {
      if (!liveSession) return null;
      const sessionId = liveSession.id;
      const write = async () => {
        if (!liveSession || liveSession.id !== sessionId) return null;
        stateWritePending++;
        try {
          const state = await workspaceRequest(`/api/teacher/presentation-simulations/${sessionId}`, "PUT", payload, { silent });
          if (liveSession?.id === sessionId) applyLiveState(state);
          return state;
        } finally {
          stateWritePending--;
        }
      };
      const queuedWrite = liveStateWriteQueue.then(write, write);
      liveStateWriteQueue = queuedWrite.catch(() => null);
      return queuedWrite;
    };
    const currentPoint = (event) => {
      const bounds = stage.querySelector(".presentation-slide-preview")?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height) return null;
      return [
        Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
      ];
    };
    const updateTeacherPointer = (article = stage.querySelector(".presentation-slide-preview")) => {
      if (!article) return;
      let laser = article.querySelector(".presentation-teacher-laser");
      if (pointerState?.active) {
        if (!laser) {
          laser = document.createElement("span");
          laser.className = "presentation-teacher-laser";
          laser.setAttribute("aria-hidden", "true");
          article.append(laser);
        }
        laser.style.left = `${pointerState.x * 100}%`;
        laser.style.top = `${pointerState.y * 100}%`;
        laser.style.setProperty("--laser-color", pointerState.color);
      } else {
        laser?.remove();
      }
    };
    const refreshAnnotationLayer = () => {
      updateTeacherPointer();
    };
    const fitSlideToStage = () => {
      const article = stage.querySelector(".presentation-slide-preview");
      if (!article || !stage.clientWidth || !stage.clientHeight) return;
      const width = Math.min(1100, stage.clientWidth, stage.clientHeight * 16 / 9);
      article.style.width = `${width}px`;
      article.style.height = `${width * 9 / 16}px`;
    };
    const stageResizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => window.requestAnimationFrame(fitSlideToStage))
      : null;
    stageResizeObserver?.observe(stage);
    const renderActiveSlide = () => {
      const previousArticle = stage.querySelector(".presentation-slide-preview");
      const animateNewReveal = lastRevealRender?.slide === activeSlide
        && lastRevealRender.mode === revealMode
        && revealStep > lastRevealRender.step;
      const visibleSlide = revealedSlide(slides[activeSlide], revealMode, revealStep);
      stage.innerHTML = presentationSlideMarkup(visibleSlide, activeSlide, presentation);
      const article = stage.querySelector(".presentation-slide-preview");
      if (animateNewReveal && article) {
        const revealSelectors = [
          "li",
          ".presentation-slide-image",
          ".presentation-visual-cards > div > span",
          ".presentation-visual-table tbody tr",
          ".presentation-chart-column",
          ".presentation-graph-point"
        ];
        revealSelectors.forEach((selector) => {
          const previousCount = previousArticle?.querySelectorAll(selector).length || 0;
          Array.from(article.querySelectorAll(selector)).slice(previousCount).forEach((item, index) => {
            item.classList.add("presentation-item-zoom-in");
            item.style.setProperty("--reveal-delay", `${index * 70}ms`);
          });
        });
        const previousDetail = previousArticle?.querySelector(":scope > p");
        const detail = article.querySelector(":scope > p");
        if (detail?.textContent.trim() && detail.textContent !== previousDetail?.textContent) {
          detail.classList.add("presentation-item-zoom-in");
        }
      }
      lastRevealRender = { slide: activeSlide, mode: revealMode, step: revealStep };
      if (revealMode !== "all") {
        const marker = document.createElement("small");
        marker.className = "presentation-local-reveal-progress";
        marker.textContent = `Content ${Math.min(revealStep, revealUnitCount(slides[activeSlide], revealMode))} of ${revealUnitCount(slides[activeSlide], revealMode)}`;
        stage.querySelector(".presentation-slide-preview")?.append(marker);
      }
      const revealedCount = revealUnitCount(slides[activeSlide], revealMode);
      count.textContent = `Slide ${activeSlide + 1} of ${slides.length}${revealMode === "all" ? "" : ` · ${revealStep} of ${revealedCount} revealed`}`;
      previous.disabled = slideUpdatePending || (activeSlide === 0 && revealStep === 0);
      next.disabled = slideUpdatePending || (activeSlide === slides.length - 1
        && (revealMode === "all" || revealStep >= revealedCount));
      const progress = dialog.querySelector("[data-presentation-progress]");
      const progressBar = progress.parentElement;
      const total = slides.length + (revealMode === "all" ? 0 : slides.reduce((sum, slide) => sum + revealUnitCount(slide, revealMode), 0));
      const completed = activeSlide + 1 + (revealMode === "all" ? 0 : slides.slice(0, activeSlide).reduce((sum, slide) => sum + revealUnitCount(slide, revealMode), 0))
        + (revealMode === "all" ? 0 : revealStep);
      progress.style.width = `${Math.min(100, Math.round(completed / Math.max(1, total) * 100))}%`;
      progressBar.setAttribute("aria-valuemax", String(Math.max(1, total)));
      progressBar.setAttribute("aria-valuenow", String(Math.min(completed, total)));
      const notes = slides[activeSlide].presenter_notes || slides[activeSlide].speaker_notes || slides[activeSlide].notes || "";
      if (notesInput.value !== notes) notesInput.value = notes;
      fitSlideToStage();
      refreshAnnotationLayer();
    };
    const moveToSlide = async (slideIndex) => {
      if (slideUpdatePending || slideIndex < 0 || slideIndex >= slides.length || slideIndex === activeSlide) return;
      const previousSlide = activeSlide;
      const previousReveal = revealStep;
      updateNotes();
      if (liveSession) {
        slideUpdatePending = true;
        if (pointerUpdateTimer !== null) {
          window.clearTimeout(pointerUpdateTimer);
          pointerUpdateTimer = null;
        }
        latestPointerState = null;
        queuedPointerUpdate = false;
        await pointerRequestPromise;
      }
      activeSlide = slideIndex;
      revealStep = 0;
      annotations = [];
      pointerState = null;
      renderActiveSlide();
      if (!liveSession) {
        slideUpdatePending = false;
        return;
      }
      renderActiveSlide();
      try {
        await updateLiveState({ active_slide: activeSlide, reveal_step: 0, annotations: [], pointer: null });
        lastRenderedStateKey = JSON.stringify([liveState.active_slide, liveState.reveal_mode, liveState.reveal_step]);
        lastTimedReveal = Date.now();
      } catch (error) {
        activeSlide = previousSlide;
        revealStep = previousReveal;
        setFeedback(error instanceof Error ? error.message : "The student presentation could not be updated.", true);
      } finally {
        slideUpdatePending = false;
        renderActiveSlide();
      }
    };
    const advance = async (direction = 1) => {
      if (slideUpdatePending) return;
      if (direction > 0 && revealMode !== "all"
        && revealStep < revealUnitCount(slides[activeSlide], revealMode)) {
        revealStep++;
        lastTimedReveal = Date.now();
        renderActiveSlide();
        try {
          if (liveSession) await updateLiveState({ reveal_mode: revealMode, reveal_step: revealStep });
          else setFeedback("");
        } catch (error) {
          revealStep--;
          renderActiveSlide();
          setFeedback(error instanceof Error ? error.message : "The reveal step could not be synchronized.", true);
        }
        return;
      }
      if (direction < 0 && revealMode !== "all" && revealStep > 0) {
        revealStep--;
        lastTimedReveal = Date.now();
        renderActiveSlide();
        try {
          if (liveSession) await updateLiveState({ reveal_mode: revealMode, reveal_step: revealStep });
        } catch (error) {
          revealStep++;
          renderActiveSlide();
          setFeedback(error instanceof Error ? error.message : "The reveal step could not be synchronized.", true);
        }
        return;
      }
      await moveToSlide(activeSlide + direction);
    };
    previous.addEventListener("click", () => void advance(-1));
    next.addEventListener("click", () => void advance(1));
    revealSelect.addEventListener("change", async () => {
      revealMode = revealSelect.value;
      revealStep = 0;
      revealIntervalWrap.hidden = revealMode !== "timed";
      lastTimedReveal = Date.now();
      renderActiveSlide();
      lastRenderedStateKey = "";
      if (liveSession) {
        try {
          await updateLiveState({
            reveal_mode: revealMode,
            reveal_step: 0,
            reveal_interval_seconds: Number(revealInterval.value)
          });
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "The reveal mode could not be synchronized.", true);
        }
      }
    });
    revealInterval.addEventListener("change", () => {
      if (liveSession && revealMode === "timed") {
        void updateLiveState({ reveal_interval_seconds: Number(revealInterval.value) }).catch((error) =>
          setFeedback(error instanceof Error ? error.message : "Reveal timing could not be saved.", true)
        );
      }
    });
    dialog.querySelectorAll("[data-presentation-tool]").forEach((button) =>
      button.addEventListener("click", () => setTool(button.dataset.presentationTool))
    );
    const queuePointerUpdate = (active) => {
      if (pointerState) pointerState = { ...pointerState, color: activeColor, active };
      latestPointerState = pointerState;
      if (pointerUpdateTimer !== null) return;
      pointerUpdateTimer = window.setTimeout(async () => {
        pointerUpdateTimer = null;
        if (!liveSession) return;
        if (pointerRequestPending) {
          queuedPointerUpdate = true;
          return;
        }
        pointerRequestPromise = (async () => {
          pointerRequestPending = true;
          try {
            await updateLiveState({ pointer: latestPointerState }, { silent: true });
          } catch (error) {
            console.warn("The teacher pointer could not be synchronized.", error);
          } finally {
            pointerRequestPending = false;
            if (queuedPointerUpdate) {
              queuedPointerUpdate = false;
              pointerState = latestPointerState;
              queuePointerUpdate(Boolean(latestPointerState?.active));
            }
          }
        })();
        await pointerRequestPromise;
      }, 75);
    };
    const renderPointerOnFrame = () => {
      if (pointerRenderFrame !== null) return;
      pointerRenderFrame = window.requestAnimationFrame(() => {
        pointerRenderFrame = null;
        updateTeacherPointer();
      });
    };
    stage.addEventListener("pointerdown", (event) => {
      const point = currentPoint(event);
      if (!point) return;
      if (activeTool === "pointer") {
        event.preventDefault();
      }
      if (activeTool === "pointer") {
        pointerState = { x: point[0], y: point[1], color: activeColor, active: true };
        latestPointerState = pointerState;
        renderPointerOnFrame();
        queuePointerUpdate(true);
      }
    });
    document.addEventListener("pointermove", (event) => {
      if (activeTool !== "pointer" || !dialog.open) return;
      const article = stage.querySelector(".presentation-slide-preview");
      const bounds = article?.getBoundingClientRect();
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        if (pointerState?.active) {
          pointerState = { ...pointerState, active: false };
          latestPointerState = pointerState;
          updateTeacherPointer(article);
          queuePointerUpdate(false);
        }
        return;
      }
      const point = [
        (event.clientX - bounds.left) / bounds.width,
        (event.clientY - bounds.top) / bounds.height
      ];
      pointerState = { x: point[0], y: point[1], color: activeColor, active: true };
      latestPointerState = pointerState;
      renderPointerOnFrame();
      queuePointerUpdate(true);
    });
    stage.addEventListener("pointerleave", () => {
      if (activeTool === "pointer" && pointerState?.active) {
        pointerState.active = false;
        latestPointerState = pointerState;
        refreshAnnotationLayer();
        queuePointerUpdate(false);
      }
    });
    notesInput.addEventListener("input", updateNotes);
    dialog.querySelector("[data-presentation-presenter-view]").addEventListener("click", (event) => {
      const visible = notesPanel.hidden;
      notesPanel.hidden = !visible;
      event.currentTarget.setAttribute("aria-pressed", String(visible));
      window.requestAnimationFrame(fitSlideToStage);
    });
    dialog.querySelector("[data-presentation-fullscreen]").addEventListener("click", async () => {
      const button = dialog.querySelector("[data-presentation-fullscreen]");
      if (!document.fullscreenElement && dialog.classList.contains("is-fullscreen-fallback")) {
        fullscreenActive = false;
        dialog.classList.remove("is-fullscreen-fallback");
        handleFullscreenChange();
        return;
      }
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          if (typeof fullscreenContent.requestFullscreen !== "function") {
            throw new Error("Full screen is not supported by this browser.");
          }
          await fullscreenContent.requestFullscreen();
        }
      } catch (error) {
        fullscreenActive = document.fullscreenElement === fullscreenContent || !document.fullscreenElement;
        dialog.classList.toggle("is-fullscreen-fallback", fullscreenActive && !document.fullscreenElement);
        button.setAttribute("aria-pressed", String(fullscreenActive));
        button.title = fullscreenActive ? "Exit full screen" : "Full screen";
        button.setAttribute("aria-label", fullscreenActive ? "Exit full screen" : "Toggle full screen");
        button.querySelector("i").className = `fa-solid ${fullscreenActive ? "fa-compress" : "fa-expand"}`;
        button.querySelector("small").textContent = fullscreenActive ? "Exit" : "Full";
        setFeedback(error instanceof Error
          ? `Browser fullscreen unavailable; using presentation view instead. ${error.message}`
          : "Browser fullscreen unavailable; using presentation view instead.");
      }
    });
    const handleFullscreenChange = () => {
      fullscreenActive = document.fullscreenElement === fullscreenContent;
      const button = dialog.querySelector("[data-presentation-fullscreen]");
      if (!button) return;
      button.setAttribute("aria-pressed", String(fullscreenActive));
      button.title = fullscreenActive ? "Exit full screen" : "Full screen";
      button.setAttribute("aria-label", fullscreenActive ? "Exit full screen" : "Toggle full screen");
      button.querySelector("i").className = `fa-solid ${fullscreenActive ? "fa-compress" : "fa-expand"}`;
      button.querySelector("small").textContent = fullscreenActive ? "Exit" : "Full";
      dialog.classList.toggle("is-fullscreen-fallback", false);
      fitSlideToStage();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    const handleViewportResize = () => window.requestAnimationFrame(fitSlideToStage);
    window.addEventListener("resize", handleViewportResize);
    dialog.querySelector("[data-presentation-timer-start]").addEventListener("click", async () => {
      const minutes = Number(dialog.querySelector("[data-presentation-timer-minutes]").value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
        setFeedback("Choose a timer between 1 and 120 minutes.", true);
        return;
      }
      timerEndAt = Date.now() + minutes * 60_000;
      updateTimerDisplay();
      if (liveSession) {
        try {
          await updateLiveState({ timer_duration_seconds: minutes * 60 });
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "The class timer could not be started.", true);
        }
      }
    });
    dialog.querySelector("[data-presentation-timer-stop]").addEventListener("click", async () => {
      timerEndAt = null;
      updateTimerDisplay();
      if (liveSession) {
        try {
          await updateLiveState({ timer_duration_seconds: 0 });
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "The class timer could not be stopped.", true);
        }
      }
    });
    dialog.querySelector("[data-presentation-poll-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = dialog.querySelector("[data-presentation-poll-question]").value.trim();
      const options = [...pollOptionsContainer.querySelectorAll("[data-presentation-poll-option]")]
        .map((option) => option.value.trim());
      if (!liveSession) {
        setFeedback("Start student follow before opening a classroom check.", true);
        return;
      }
      if (!question || options.length < 2 || options.length > 6 || options.some((option) => !option)) {
        setFeedback("Add a poll question and between two and six choices.", true);
        return;
      }
      try {
        const pollId = typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join("");
        await updateLiveState({ active_poll: { id: pollId, question, options, open: true } });
        dialog.querySelector("[data-presentation-poll-form]").closest("details").open = false;
        setFeedback("");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "The classroom check could not be started.", true);
      }
    });
    pollOptionsContainer.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-presentation-poll-option-add]");
      if (addButton) {
        const currentOptions = pollOptionsContainer.querySelectorAll("[data-presentation-poll-option]");
        if (currentOptions.length >= 6) {
          setFeedback("A poll can have at most six choices.", true);
          return;
        }
        const row = document.createElement("div");
        row.className = "presentation-poll-option-row";
        const number = currentOptions.length + 1;
        const input = document.createElement("input");
        input.dataset.presentationPollOption = "";
        input.maxLength = 120;
        input.required = true;
        input.setAttribute("aria-label", `Choice ${number}`);
        input.placeholder = `Choice ${number}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "presentation-poll-option-remove";
        remove.setAttribute("aria-label", `Remove choice ${number}`);
        remove.title = "Remove choice";
        remove.innerHTML = '<i class="fa-solid fa-minus"></i>';
        row.append(input, remove);
        addButton.before(row);
        input.focus();
        return;
      }
      const removeButton = event.target.closest(".presentation-poll-option-remove");
      if (removeButton) {
        const rows = pollOptionsContainer.querySelectorAll(".presentation-poll-option-row");
        if (rows.length <= 2) {
          setFeedback("A poll needs at least two choices.", true);
          return;
        }
        removeButton.closest(".presentation-poll-option-row").remove();
        pollOptionsContainer.querySelectorAll(".presentation-poll-option-row").forEach((row, index) => {
          const number = index + 1;
          row.querySelector("input").setAttribute("aria-label", `Choice ${number}`);
          row.querySelector("input").placeholder = `Choice ${number}`;
          row.querySelector("button").setAttribute("aria-label", `Remove choice ${number}`);
        });
      }
    });
    dialog.querySelector("[data-presentation-poll-close]").addEventListener("click", async () => {
      if (!liveState?.active_poll) return;
      try {
        await updateLiveState({ active_poll: { ...liveState.active_poll, open: false } });
        dialog.querySelector("[data-presentation-poll-form]").closest("details").open = false;
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "The classroom check could not be closed.", true);
      }
    });
    liveButton.addEventListener("click", async () => {
      liveButton.disabled = true;
      liveButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><small>Wait</small>';
      try {
        const startingSlide = activeSlide;
        const startingReveal = revealStep;
        const startingRevealMode = revealMode;
        const result = resumedSession || await workspaceRequest("/api/teacher/presentation-simulations", "POST", {
          title: title || presentation.title || "Class presentation",
          presentation: {
            subject: presentation.subject || "",
            year: presentation.year || presentation.year_group || "",
            template: presentation.template || "lesson",
            visual_theme: presentation.visual_theme || "modern",
            reveal_mode: revealMode,
            reveal_interval_seconds: Number(revealInterval.value),
            slides
          }
        });
        liveSession = { id: result.id, url: result.url };
        dialog.dataset.presentationSimulationId = String(liveSession.id);
        if (!resumedSession) {
          saveActiveLivePresentation({
            id: liveSession.id,
            url: liveSession.url,
            title: title || presentation.title || "Class presentation",
            presentation: { ...presentation, slides }
          });
        }
        activePollId = "";
        currentPollResponses = 0;
        lastPollSummary = "";
        liveState = await workspaceRequest(`/api/teacher/presentation-simulations/${liveSession.id}`);
        if (liveState.status !== "active") {
          clearActiveLivePresentation();
          liveSession = null;
          throw new Error("This live presentation has ended or expired. Start a new student follow session.");
        }
        if (!liveState.student_url) {
          let previousToken = null;
          if (result.url) {
            try {
              previousToken = new URL(result.url, window.location.href).searchParams.get("token");
            } catch (error) {
              console.warn("The saved student link could not be parsed for recovery.", error);
            }
          }
          const linkResult = await workspaceRequest(
            `/api/teacher/presentation-simulations/${liveSession.id}/student-link`,
            "POST",
            previousToken ? { token: previousToken } : {}
          );
          liveState.student_url = linkResult.url;
        }
        result.url = currentStudentPresentationUrl(liveState.student_url);
        liveSession.url = result.url;
        saveActiveLivePresentation({
          id: liveSession.id,
          url: liveSession.url,
          title: title || result.title || presentation.title || "Class presentation",
          presentation: { ...presentation, slides }
        });
        applyLiveState(liveState);
        if (!resumedSession) {
          activeSlide = startingSlide;
          revealStep = startingReveal;
          revealMode = startingRevealMode;
          await updateLiveState({
            active_slide: activeSlide,
            reveal_step: revealStep,
            reveal_mode: revealMode
          });
        }
        const pollOwnerState = async () => {
          if (!liveSession || !dialog.open) return;
          try {
            const state = await workspaceRequest(`/api/teacher/presentation-simulations/${liveSession.id}`, "GET", null, { silent: true });
            if (state.status !== "active") {
              const endedSessionId = liveSession.id;
              clearActiveLivePresentation();
              liveSession = null;
              if (ownerPollTimer !== null) window.clearTimeout(ownerPollTimer);
              ownerPollTimer = null;
              liveSharing.dataset.ended = "true";
              liveStatus.textContent = "Live session ended. Students can no longer view the presentation.";
              copyButton.disabled = true;
              linkInput.disabled = true;
              linkToggle.disabled = true;
              liveButton.disabled = false;
              liveButton.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i><small>Share</small>';
              liveButton.setAttribute("aria-label", "Start student follow");
              endButton.disabled = true;
              endButton.innerHTML = '<i class="fa-solid fa-check"></i><small>Done</small>';
              endButton.setAttribute("aria-label", `Session ${endedSessionId} ended`);
              return;
            }
            if (stateWritePending === 0) applyLiveState(state);
          } catch (error) {
            setFeedback(error instanceof Error ? `Reconnecting… ${error.message}` : "Reconnecting to students…", true);
          }
          if (liveSession && dialog.open) ownerPollTimer = window.setTimeout(pollOwnerState, 500);
        };
        ownerPollTimer = window.setTimeout(pollOwnerState, 500);
        const linkLabel = document.createElement("span");
        linkLabel.className = "presentation-live-label";
        linkLabel.innerHTML = '<i class="fa-solid fa-users"></i> Student link';
        linkLabel.hidden = !result.url;
        const linkInput = document.createElement("input");
        linkInput.className = "presentation-live-link";
        linkInput.type = "text";
        linkInput.readOnly = true;
        linkInput.setAttribute("aria-label", "Student presentation follow link");
        linkInput.value = result.url;
        linkInput.hidden = !result.url;
        const participantsButton = document.createElement("button");
        participantsButton.type = "button";
        participantsButton.className = "presentation-icon-button";
        participantsButton.setAttribute("data-presentation-participants-open", "");
        const joinedStudentCount = Array.isArray(liveState?.participants) ? liveState.participants.length : 0;
        participantsButton.setAttribute("aria-label", `View students, ${joinedStudentCount} joined`);
        participantsButton.title = "View joined students";
        participantsButton.innerHTML = `<i class="fa-solid fa-users" aria-hidden="true"></i><small>Students</small><span class="presentation-live-count" data-presentation-participant-button-count>${joinedStudentCount > 99 ? "99+" : joinedStudentCount}</span>`;
        participantsButton.addEventListener("click", () => participantsDialog.showModal());
        const openLink = document.createElement("a");
        openLink.className = "presentation-icon-button";
        openLink.href = result.url;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.setAttribute("aria-label", "Open student presentation link in a new tab");
        openLink.title = "Open student presentation link";
        openLink.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><small>Open</small>';
        openLink.hidden = !result.url;
        const linkToggle = document.createElement("button");
        linkToggle.type = "button";
        linkToggle.className = "presentation-icon-button";
        linkToggle.innerHTML = '<i class="fa-solid fa-eye-slash"></i><small>Hide link</small>';
        linkToggle.setAttribute("aria-label", "Hide student presentation link");
        linkToggle.setAttribute("aria-pressed", "true");
        linkToggle.hidden = !result.url;
        linkToggle.addEventListener("click", () => {
          const hideLink = !linkInput.hidden;
          linkInput.hidden = hideLink;
          linkToggle.querySelector("i").className = `fa-solid fa-${hideLink ? "eye" : "eye-slash"}`;
          linkToggle.querySelector("small").textContent = hideLink ? "Show link" : "Hide link";
          linkToggle.setAttribute("aria-label", `${hideLink ? "Show" : "Hide"} student presentation link`);
          linkToggle.setAttribute("aria-pressed", String(!hideLink));
        });
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "presentation-icon-button";
        copyButton.innerHTML = '<i class="fa-solid fa-copy"></i><small>Copy</small>';
        copyButton.setAttribute("aria-label", "Copy student link");
        copyButton.title = "Copy student link";
        copyButton.disabled = !result.url;
        const copyFeedback = document.createElement("span");
        copyFeedback.className = "presentation-copy-feedback";
        copyFeedback.setAttribute("role", "status");
        copyFeedback.setAttribute("aria-live", "polite");
        let copyFeedbackTimer = null;
        copyButton.addEventListener("click", async () => {
          if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
            await navigator.clipboard.writeText(result.url);
            copyFeedback.textContent = "Copied!";
            setFeedback("");
          } catch (error) {
            linkInput.focus();
            linkInput.select();
            copyFeedback.textContent = "Link selected — copy it manually.";
            setFeedback(error instanceof Error ? error.message : "Automatic copy failed; the link is selected for manual copying.", true);
          }
          copyFeedbackTimer = window.setTimeout(() => {
            copyFeedback.textContent = "";
            copyFeedbackTimer = null;
          }, 3000);
        });
        const endButton = document.createElement("button");
        endButton.type = "button";
        endButton.className = "presentation-icon-button";
        endButton.innerHTML = '<i class="fa-solid fa-stop"></i><small>End</small>';
        endButton.setAttribute("aria-label", "End live session");
        endButton.title = "End live session";
        const liveStatus = document.createElement("span");
        liveStatus.className = "presentation-live-status";
        liveStatus.setAttribute("aria-live", "polite");
        liveStatus.textContent = "Students follow reveals, drawings, polls, reactions and the class timer. The secure link remains available until this session expires.";
        liveControls.replaceChildren(linkLabel, linkInput, openLink, participantsButton, linkToggle, copyButton, endButton, copyFeedback, liveStatus);
        const visibilityButton = (key, label, icon, panel) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "presentation-icon-button presentation-feedback-toggle";
          button.setAttribute("aria-pressed", String(feedbackPanels[key]));
          button.setAttribute("aria-label", `${feedbackPanels[key] ? "Hide" : "Show"} ${label}`);
          button.innerHTML = `<i class="fa-solid fa-${icon}"></i><small>${feedbackPanels[key] ? "Hide" : "Show"} ${label}</small>`;
          feedbackVisibilityButtons[key] = button;
          button.addEventListener("click", () => {
            feedbackPanels[key] = !feedbackPanels[key];
            const visible = feedbackPanels[key];
            button.setAttribute("aria-pressed", String(visible));
            button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${label}`);
            button.querySelector("i").className = `fa-solid fa-${visible ? icon : "eye"}`;
            button.querySelector("small").textContent = `${visible ? "Hide" : "Show"} ${label}`;
            panel.hidden = !visible;
            updateFeedbackCount(key, key === "pace"
              ? Object.values(liveState?.reaction_counts || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
              : key === "questions" ? liveState?.questions?.length || 0 : currentPollResponses);
          });
          liveControls.append(button);
          updateFeedbackCount(key, key === "pace"
            ? Object.values(liveState?.reaction_counts || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
            : key === "questions" ? liveState?.questions?.length || 0 : currentPollResponses);
        };
        visibilityButton("pace", "Pace", "gauge-high", paceSummary);
        visibilityButton("poll", "Poll", "square-poll-vertical", pollLiveFeedback);
        visibilityButton("questions", "Q&A", "circle-question", questionLiveFeedback);
        const endLiveSession = async () => {
          if (!liveSession) return true;
          if (stoppingLiveSession) return stoppingLiveSession;
          const sessionId = liveSession.id;
          endButton.disabled = true;
          stoppingLiveSession = (async () => {
            try {
              await workspaceRequest(`/api/teacher/presentation-simulations/${sessionId}`, "PUT", {
                active_slide: activeSlide,
                status: "ended"
              });
              clearActiveLivePresentation();
              if (liveSession?.id === sessionId) liveSession = null;
              if (ownerPollTimer !== null) window.clearTimeout(ownerPollTimer);
              ownerPollTimer = null;
              endButton.innerHTML = '<i class="fa-solid fa-check"></i><small>Done</small>';
              endButton.setAttribute("aria-label", "Session ended");
              liveSharing.dataset.ended = "true";
              liveStatus.textContent = "Live session ended. Students can no longer view the presentation.";
              copyButton.disabled = true;
              linkInput.disabled = true;
              linkToggle.disabled = true;
              liveButton.disabled = false;
              liveButton.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i><small>Share</small>';
              liveButton.setAttribute("aria-label", "Start student follow");
              stoppingLiveSession = null;
              return true;
            } catch (error) {
              endButton.disabled = false;
              stoppingLiveSession = null;
              setFeedback(error instanceof Error ? error.message : "The live session could not be ended.", true);
              return false;
            }
          })();
          return stoppingLiveSession;
        };
        stopLiveSession = endLiveSession;
        endButton.addEventListener("click", () => void endLiveSession());
        liveSharing.hidden = false;
        delete liveSharing.dataset.ended;
        window.requestAnimationFrame(fitSlideToStage);
        liveButton.disabled = true;
        liveButton.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i><small>Live</small>';
        liveButton.setAttribute("aria-label", "Student follow is live");
        setFeedback("Student follow is live.");
      } catch (error) {
        liveButton.disabled = false;
        liveButton.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i><small>Share</small>';
        setFeedback(error instanceof Error ? error.message : "The live presentation could not be started.", true);
      }
    });
    presentationClock = window.setInterval(() => {
      updateTimerDisplay();
      if (revealMode === "timed" && !slideUpdatePending
        && Date.now() - lastTimedReveal >= Number(revealInterval.value) * 1000
        && revealStep < revealUnitCount(slides[activeSlide], revealMode)) {
        void advance(1);
      }
    }, 500);
    dialog.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if ((event.key === "ArrowRight" || event.key === " ") && (activeSlide < slides.length - 1 || revealStep < revealUnitCount(slides[activeSlide], revealMode))) {
        event.preventDefault();
        void advance(1);
      } else if (event.key === "ArrowLeft" && (activeSlide > 0 || revealStep > 0)) {
        event.preventDefault();
        void advance(-1);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        dialog.querySelector("[data-presentation-fullscreen]").click();
      }
    });
    const closeViewer = async () => {
      if (liveSession && !(await stopLiveSession())) return;
      dialog.close();
    };
    dialog.querySelector("[data-presentation-close]").addEventListener("click", () => void closeViewer());
    dialog.addEventListener("cancel", (event) => {
      if (!liveSession) return;
      event.preventDefault();
      void closeViewer();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) void closeViewer();
    });
    dialog.addEventListener("close", () => {
      if (participantsDialog.open) participantsDialog.close();
      if (ownerPollTimer !== null) window.clearTimeout(ownerPollTimer);
      if (presentationClock !== null) window.clearInterval(presentationClock);
      if (pointerUpdateTimer !== null) window.clearTimeout(pointerUpdateTimer);
      if (pointerRenderFrame !== null) window.cancelAnimationFrame(pointerRenderFrame);
      if (reactionNoticeTimer !== null) window.clearTimeout(reactionNoticeTimer);
      if (participantJoinNoticeTimer !== null) window.clearTimeout(participantJoinNoticeTimer);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("resize", handleViewportResize);
      stageResizeObserver?.disconnect();
      if (document.fullscreenElement === fullscreenContent) {
        void document.exitFullscreen().catch((error) => console.warn("Could not exit presentation fullscreen.", error));
      }
      dialog.remove();
    }, { once: true });
    renderActiveSlide();
    dialog.showModal();
    window.requestAnimationFrame(fitSlideToStage);
    dialog.querySelector("[data-presentation-next]").focus();
    if (resumedSession) liveButton.click();
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-saved-doc-present]");
    if (!button) return;
    if (!activeSavedDocument || activeSavedDocument.type !== "slides") {
      showToast("The saved presentation is unavailable. Reopen it and try again.", "error");
      return;
    }
    openPresentationViewer(activeSavedDocument.data || {}, activeSavedDocument.title);
  });

  function renderSlideDocument(data) {
    data = normalizePresentationData(data);
    const templateLabels = {
      lesson: "Clear lesson sequence", inquiry: "Inquiry & discovery", worked: "Worked examples",
      discussion: "Discussion & collaboration", project: "Project-based learning",
      revision: "Revision & retrieval practice", flipped: "Flipped classroom"
    };
    const visualThemeLabels = {
      modern: "Modern classroom", editorial: "Editorial", vibrant: "Vibrant workshop",
      data: "Data studio", minimal: "Minimal"
    };
    const weekLabels = (data.selected_weeks || []).map((week) => {
      const hierarchy = [
        week.strand,
        week.sub_strand,
        week.content_standard && `Content standard: ${week.content_standard}`,
        ...(Array.isArray(week.focal_areas) ? week.focal_areas : [])
      ].filter(Boolean);
      const source = [week.source_title, week.source_reference, week.source_page ? `p. ${week.source_page}` : ""].filter(Boolean).join(" · ");
      return `Semester ${week.semester_number || "—"} · Week ${week.week_number || "—"}: ${week.topic}${hierarchy.length ? ` · ${hierarchy.join(" · ")}` : ""}${source ? ` · Source: ${source}` : ""}`;
    });
    const outline = ensurePresentationVisuals(data.slides || [])
      .map((slide, index) => presentationSlideMarkup(slide, index, data)).join("");
    const speakerNotes = (data.slides || [])
      .map((slide, index) => ({ index, notes: String(slide.presenter_notes || slide.speaker_notes || slide.notes || "").trim() }))
      .filter((slide) => slide.notes);
    const sections = [
      `<div class="document-section"><h3>Curriculum scope</h3>${weekLabels.length ? `<ul>${weekLabels.map((week) => `<li>${escapeHtml(week)}</li>`).join("")}</ul>` : "<p>No verified weekly scope selected. Add and verify your own curriculum references.</p>"}</div>`,
      `<div class="document-section"><h3>Learning outcomes</h3><ul>${(data.learning_outcomes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`,
      `<div class="document-section"><h3>Learning indicators</h3><ul>${(data.learning_indicators || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p>Source-recorded targets are included where available; any additional suggestions are teacher drafts and are not represented as official curriculum wording.</p></div>`,
      `<div class="document-section"><h3>Presentation preview · ${escapeHtml(templateLabels[data.template] || templateLabels.lesson)}</h3><p>PowerPoint design: ${escapeHtml(visualThemeLabels[data.visual_theme] || visualThemeLabels.modern)}. Every slide includes a visual: charts, tables, graphs and concept diagrams are previewed below and exported as editable PowerPoint elements.</p><div class="presentation-preview-grid">${outline}</div></div>`,
      ...(speakerNotes.length ? [`<div class="document-section"><h3>Teacher lecture notes · private</h3><ol>${speakerNotes.map(({ index, notes }) => `<li><strong>Slide ${index + 1}:</strong> ${escapeHtml(notes)}</li>`).join("")}</ol><p>These notes are for the teacher and are not shared on student presentation screens.</p></div>`] : [])
    ];
    return documentFrame(
      data.title,
      "POWERPOINT PRESENTATION · TEACHER REVIEW DRAFT",
      [["Subject", data.subject], ["SHS year", data.year], ["Teaching structure", templateLabels[data.template] || templateLabels.lesson], ["Slide design", visualThemeLabels[data.visual_theme] || visualThemeLabels.modern], ["Number of slides", String(data.number_of_slides)]],
      sections.join(""),
      "Export the editable PowerPoint deck to present or further edit. Review curriculum alignment, data and examples before classroom use."
    );
  }

  async function editSavedSlides(doc) {
    goTo("slides");
    activeSlideEditDoc = doc;
    document.getElementById("slides-dialog-title").textContent = "Edit presentation slides";
    document.querySelector("#slides-dialog .lesson-wizard-header p").textContent =
      "Edit the generated slide content directly, then preview and save your changes.";
    slidesForm.reset();
    setSlidesEditMode(true);
    slidesGeneratedFields = { outcomes: [], indicators: [], points: [] };
    slidesEditEditor.innerHTML = "";
    renderSlideEditEditor(doc);
    slidesForm.dataset.editingId = String(doc.id);
    slidesForm.querySelector('[type="submit"]').textContent = "Save presentation";
    slidesCurriculumStatus.textContent = "";
    planningDialogs.slides.showModal();
  }

  function renderQuestionChat(container, questions, simulationId, onError = () => {}, onSaved = () => {}, showReplyComposer = false) {
    const drafts = new Map([...container.querySelectorAll(".presentation-chat-composer")].map((form) => [
      form.dataset.questionId,
      form.querySelector("textarea")?.value || ""
    ]));
    container.replaceChildren();
    questions.forEach((question) => {
      const card = document.createElement("article");
      card.className = "presentation-chat-thread";
      card.dataset.questionId = String(question.id);
      const studentMeta = document.createElement("div");
      studentMeta.className = "presentation-chat-meta presentation-chat-meta-student";
      studentMeta.textContent = question.participant_name || "Student";
      const studentMessage = document.createElement("p");
      studentMessage.className = "presentation-chat-bubble presentation-chat-bubble-student";
      studentMessage.textContent = question.question;
      card.append(studentMeta, studentMessage);

      const teacherReplies = Array.isArray(question.teacher_replies) && question.teacher_replies.length
        ? question.teacher_replies
        : question.teacher_feedback ? [{ feedback: question.teacher_feedback }] : [];
      teacherReplies.forEach((reply) => {
        const teacherMessage = document.createElement("p");
        teacherMessage.className = "presentation-chat-bubble presentation-chat-bubble-teacher";
        const teacherMeta = document.createElement("small");
        teacherMeta.textContent = "Teacher";
        const message = document.createElement("span");
        message.textContent = reply.feedback;
        teacherMessage.append(teacherMeta, message);
        card.append(teacherMessage);
      });

      const actions = document.createElement("div");
      actions.className = "presentation-chat-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "presentation-chat-edit";
      editButton.innerHTML = `<i class="fa-solid fa-reply" aria-hidden="true"></i><span>${teacherReplies.length ? "Reply again" : "Reply"}</span>`;
      actions.append(editButton);
      card.append(actions);
      const openComposer = (focus = true) => {
        editButton.disabled = true;
        actions.hidden = true;
        const form = document.createElement("form");
        form.className = "presentation-chat-composer";
        form.dataset.questionId = String(question.id);
        const reply = document.createElement("textarea");
        reply.name = "feedback";
        reply.maxLength = 1000;
        reply.required = true;
        reply.rows = 2;
        reply.placeholder = "Write a response…";
        reply.value = drafts.get(String(question.id)) ?? "";
        const buttons = document.createElement("div");
        buttons.className = "presentation-chat-composer-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "presentation-chat-cancel";
        cancel.textContent = "Cancel";
        const save = document.createElement("button");
        save.type = "submit";
        save.className = "presentation-question-reply";
        save.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>Save response</span>';
        const errorMessage = document.createElement("small");
        errorMessage.className = "presentation-chat-error";
        buttons.append(cancel, save);
        form.append(reply, errorMessage, buttons);
        card.append(form);
        cancel.addEventListener("click", () => {
          form.remove();
          actions.hidden = false;
          editButton.disabled = false;
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const feedback = reply.value.trim();
          if (!simulationId || !feedback) return;
          save.disabled = true;
          errorMessage.textContent = "";
          try {
            const result = await workspaceRequest(
              `/api/teacher/presentation-simulations/${encodeURIComponent(simulationId)}/questions/${encodeURIComponent(question.id)}`,
              "PUT",
              { feedback },
              { silent: true }
            );
            const updatedQuestions = questions.map((item) => Number(item.id) === Number(question.id)
              ? { ...item, ...result.question }
              : item);
            renderQuestionChat(container, updatedQuestions, simulationId, onError, onSaved, showReplyComposer);
            onSaved(updatedQuestions);
          } catch (error) {
            save.disabled = false;
            errorMessage.textContent = error instanceof Error ? error.message : "The response could not be saved.";
            onError(error);
          }
        });
        if (focus) reply.focus();
      };
      editButton.addEventListener("click", () => openComposer());
      if (showReplyComposer && teacherReplies.length === 0) {
        openComposer(false);
      }
      container.append(card);
    });
  }

  const slidesHistoryDialog = document.getElementById("slides-history-dialog");
  const slidesHistoryList = slidesHistoryDialog.querySelector("[data-slides-history-list]");
  const slidesHistoryDetail = slidesHistoryDialog.querySelector("[data-slides-history-detail]");
  function openPresentationHistory(parent = null) {
    if (parent) {
      const existing = parent.querySelector(".presentation-history-overlay");
      if (existing) return;
      const overlay = document.createElement("section");
      overlay.className = "presentation-history-overlay";
      overlay.setAttribute("aria-hidden", "false");
      overlay.innerHTML = `
        <div class="presentation-history-backdrop">
          <section class="presentation-history-card" role="dialog" aria-modal="true" aria-labelledby="presentation-history-overlay-title">
            <header class="lesson-wizard-header">
              <div><span class="eyebrow"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> YOUR LIVE SESSIONS</span><h2 id="presentation-history-overlay-title">Presentation history</h2><p>Review saved slides, student participation, polls and questions from previous sessions.</p></div>
              <button class="lesson-wizard-close" type="button" aria-label="Close presentation history"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            <div class="slides-history-content">
              <nav class="slides-history-list" aria-label="Past presentations"></nav>
              <section class="slides-history-detail" aria-live="polite"><p class="field-help">Choose a presentation to review its saved session details.</p></section>
            </div>
          </section>
        </div>`;
      const historyList = overlay.querySelector(".slides-history-list");
      const historyDetail = overlay.querySelector(".slides-history-detail");
      const closeOverlay = () => {
        overlay.remove();
        parent.querySelector("[data-presentation-open-history]")?.focus();
      };
      overlay.querySelector(".lesson-wizard-close").addEventListener("click", closeOverlay);
      overlay.querySelector(".presentation-history-backdrop").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeOverlay();
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeOverlay();
        }
      });
      parent.append(overlay);
      void loadPresentationHistory(historyList, historyDetail);
      overlay.querySelector(".lesson-wizard-close").focus();
      return;
    }
    slidesHistoryDialog.showModal();
    void loadPresentationHistory();
  }
  const appendHistorySection = (container, heading, entries) => {
    const section = document.createElement("section");
    section.className = "slides-history-section";
    const title = document.createElement("h4");
    const icons = {
      "Presentation & lecture notes": "chalkboard-user",
      "Polls & responses": "square-poll-vertical",
      "Pace responses": "gauge-high",
      "Student questions & teacher replies": "comments"
    };
    const icon = document.createElement("i");
    icon.className = `fa-solid fa-${icons[heading] || "circle-info"}`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = heading;
    title.append(icon, label);
    section.append(title);
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "No entries recorded.";
      section.append(empty);
    } else {
      const list = document.createElement("ul");
      entries.forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = entry;
        list.append(item);
      });
      section.append(list);
    }
    container.append(section);
  };
  async function loadPresentationHistory(historyList = slidesHistoryList, historyDetail = slidesHistoryDetail) {
    historyList.replaceChildren();
    historyDetail.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "field-help";
    loading.textContent = "Loading past presentations…";
    historyList.append(loading);
    try {
      const result = await workspaceRequest("/api/teacher/presentation-simulations", "GET", null, { silent: true });
      historyList.replaceChildren();
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      if (!sessions.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "No live presentation sessions have been saved yet.";
        historyList.append(empty);
        return;
      }
      sessions.forEach((session) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slides-history-entry";
        button.dataset.simulationId = String(session.id);
        const icon = document.createElement("span");
        icon.className = "slides-history-entry-icon";
        icon.innerHTML = '<i class="fa-solid fa-display" aria-hidden="true"></i>';
        const title = document.createElement("strong");
        title.textContent = session.title;
        const entryHeading = document.createElement("span");
        entryHeading.className = "slides-history-entry-heading";
        const statusBadge = document.createElement("span");
        statusBadge.className = `presentation-history-status-badge ${session.status === "active" ? "is-active" : "is-ended"}`;
        statusBadge.textContent = session.status === "active" ? "Ongoing" : "Ended";
        entryHeading.append(title, statusBadge);
        const metadata = document.createElement("span");
        metadata.className = "slides-history-entry-meta";
        const date = document.createElement("small");
        date.innerHTML = '<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>';
        const dateLabel = document.createElement("span");
        dateLabel.textContent = `${session.subject || "Presentation"} · ${new Intl.DateTimeFormat("en-GH", {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(new Date(session.ended_at || session.created_at))}`;
        date.append(dateLabel);
        const summary = document.createElement("small");
        summary.innerHTML = `<i class="fa-solid fa-users" aria-hidden="true"></i><span>${Number(session.participant_count) || 0}</span><i class="fa-solid fa-square-poll-vertical" aria-hidden="true"></i><span>${Number(session.poll_responses) || 0}</span><i class="fa-solid fa-comments" aria-hidden="true"></i><span>${Number(session.question_count) || 0}</span>`;
        metadata.append(date, summary);
        button.append(icon, entryHeading, metadata);
        button.addEventListener("click", () => void showPresentationHistory(session, button, historyList, historyDetail));
        historyList.append(button);
      });
    } catch (error) {
      historyList.replaceChildren();
      const failure = document.createElement("p");
      failure.className = "field-help";
      failure.textContent = error instanceof Error ? error.message : "Presentation history could not be loaded.";
      historyList.append(failure);
    }
  }
  async function showPresentationHistory(session, selectedButton, historyList = slidesHistoryList, historyDetail = slidesHistoryDetail) {
    historyList.querySelectorAll(".slides-history-entry").forEach((button) => {
      button.setAttribute("aria-current", String(button === selectedButton));
    });
    historyDetail.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "field-help";
    loading.textContent = "Loading session details…";
    historyDetail.append(loading);
    try {
      const history = await workspaceRequest(
        `/api/teacher/presentation-simulations/${encodeURIComponent(session.id)}/history`,
        "GET",
        null,
        { silent: true }
      );
      historyDetail.replaceChildren();
      const title = document.createElement("h3");
      title.textContent = history.title;
      if (history.status === "active") {
        const actions = document.createElement("div");
        actions.className = "presentation-history-actions";
        const resumeButton = document.createElement("button");
        resumeButton.type = "button";
        resumeButton.className = "button button-primary presentation-history-resume";
        resumeButton.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Resume live presentation';
        resumeButton.addEventListener("click", () => {
          const currentViewer = historyDetail.closest(".presentation-viewer-dialog");
          if (currentViewer?.dataset.presentationSimulationId === String(history.id)) {
            historyDetail.closest(".presentation-history-overlay")?.remove();
            showToast("This live presentation is already open.");
            return;
          }
          const savedSession = loadActiveLivePresentation();
          const resumedSession = {
            id: Number(history.id),
            url: Number(savedSession?.id) === Number(history.id)
              ? savedSession.url
              : "",
            title: history.title,
            presentation: history.presentation
          };
          saveActiveLivePresentation(resumedSession);
          if (slidesHistoryDialog.open) slidesHistoryDialog.close();
          historyDetail.closest(".presentation-history-overlay")?.remove();
          openPresentationViewer(resumedSession.presentation, resumedSession.title, resumedSession);
        });
        const endButton = document.createElement("button");
        endButton.type = "button";
        endButton.className = "button presentation-history-end";
        endButton.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i> End presentation';
        endButton.addEventListener("click", async () => {
          if (!window.confirm("End this live presentation? Students will no longer be able to follow it.")) return;
          endButton.disabled = true;
          try {
            await workspaceRequest(
              `/api/teacher/presentation-simulations/${encodeURIComponent(history.id)}`,
              "PUT",
              { status: "ended" },
              { silent: true }
            );
            const activeSession = loadActiveLivePresentation();
            if (Number(activeSession?.id) === Number(history.id)) clearActiveLivePresentation();
            showToast("The live presentation has ended.");
            await loadPresentationHistory(historyList, historyDetail);
            const refreshedButton = [...historyList.querySelectorAll(".slides-history-entry")]
              .find((button) => button.dataset.simulationId === String(history.id));
            if (refreshedButton) {
              await showPresentationHistory(history, refreshedButton, historyList, historyDetail);
            }
          } catch (error) {
            endButton.disabled = false;
            showToast(error instanceof Error ? error.message : "The presentation could not be ended.", "error");
          }
        });
        actions.append(resumeButton, endButton);
        historyDetail.append(actions);
      }
      const status = document.createElement("div");
      status.className = "slides-history-status";
      [
        { icon: history.status === "ended" ? "circle-check" : "tower-broadcast", label: history.status === "ended" ? "Ended" : "In progress" },
        { icon: "display", label: `${(history.presentation?.slides || []).length} slides` },
        { icon: "square-poll-vertical", label: `${history.polls.length} polls` },
        { icon: "gauge-high", label: `${history.pace_responses.length} pace responses` }
      ].forEach(({ icon: iconName, label }) => {
        const tag = document.createElement("span");
        tag.innerHTML = `<i class="fa-solid fa-${iconName}" aria-hidden="true"></i>`;
        tag.append(document.createTextNode(label));
        status.append(tag);
      });
      historyDetail.append(title, status);
      const slides = (history.presentation?.slides || []).map((slide, index) =>
        `Slide ${index + 1}: ${slide.title || "Untitled"}${(slide.key_points || []).length ? ` — ${slide.key_points.join("; ")}` : ""}${slide.presenter_notes ? ` · Lecture notes: ${slide.presenter_notes}` : ""}`
      );
      appendHistorySection(historyDetail, "Presentation & lecture notes", slides);
      const polls = history.polls.map((poll) => {
        const options = (poll.options || []).map((option, index) => {
          const responses = poll.responses.filter((response) => response.answer_index === index).length;
          return `${option}: ${responses} ${responses === 1 ? "response" : "responses"}`;
        });
        return `${poll.question} — ${options.join(" · ")}`;
      });
      appendHistorySection(historyDetail, "Polls & responses", polls);
      const paceLabels = { understood: "Understood", confused: "Confused", slower: "Slower", faster: "Faster" };
      appendHistorySection(historyDetail, "Pace responses",
        history.pace_responses.map((response) => `${response.participant_name}: ${paceLabels[response.reaction] || response.reaction}`));
      const questionSection = document.createElement("section");
      questionSection.className = "slides-history-section presentation-history-chat";
      const questionHeading = document.createElement("h4");
      const questionIcon = document.createElement("i");
      questionIcon.className = "fa-solid fa-comments";
      questionIcon.setAttribute("aria-hidden", "true");
      const questionTitle = document.createElement("span");
      questionTitle.textContent = `Student questions & teacher replies · ${history.questions.length}`;
      questionHeading.append(questionIcon, questionTitle);
      questionSection.append(questionHeading);
      if (!history.questions.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "No student questions were recorded.";
        questionSection.append(empty);
      } else {
        const thread = document.createElement("div");
        thread.className = "presentation-chat-history";
        questionSection.append(thread);
        renderQuestionChat(thread, history.questions, history.id, (error) => {
          showToast(error instanceof Error ? error.message : "The response could not be saved.", "error");
        }, (updatedQuestions) => {
          history.questions = updatedQuestions;
          questionTitle.textContent = `Student questions & teacher replies · ${updatedQuestions.length}`;
        });
      }
      historyDetail.append(questionSection);
    } catch (error) {
      historyDetail.replaceChildren();
      const failure = document.createElement("p");
      failure.className = "field-help";
      failure.textContent = error instanceof Error ? error.message : "Presentation details could not be loaded.";
      historyDetail.append(failure);
    }
  }
  document.getElementById("slides-history-button").addEventListener("click", () => {
    openPresentationHistory();
  });
  slidesHistoryDialog.querySelector("[data-close-slides-history]").addEventListener("click", () => slidesHistoryDialog.close());

  slidesForm.elements.namedItem("year").addEventListener("change", loadSlideWeeks);
  slidesForm.elements.namedItem("subject").addEventListener("change", loadSlideWeeks);
  document.getElementById("slides-reload-weeks").addEventListener("click", loadSlideWeeks);
  slidesEditEditor.addEventListener("input", refreshSlideEditPreview);
  slidesEditEditor.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-slide-add]");
    const removeButton = event.target.closest("[data-slide-remove]");
    if (!addButton && !removeButton) return;
    const slides = captureSlideEditCards();
    if (addButton && slides.length < 20) {
      slides.push({
        _sourceIndex: null,
        title: `New slide ${slides.length + 1}`,
        key_points: ["Add a key point"],
        activity: "",
        presenter_notes: "",
        visual: { type: "cards", title: "Key ideas", items: ["Add a visual item"] }
      });
    } else if (removeButton && slides.length > 1) {
      slides.splice(Number(removeButton.dataset.slideRemove), 1);
    }
    updateSlideEditList(slides);
  });
  document.getElementById("slides-new-button").addEventListener("click", () => {
    activeSlideEditDoc = null;
    setSlidesEditMode(false);
    slidesEditEditor.replaceChildren();
    document.getElementById("slides-dialog-title").textContent = "Create a presentation";
    document.querySelector("#slides-dialog .lesson-wizard-header p").textContent =
      "Start with a year and subject. Select one or more curriculum weeks to draft outcomes, indicators and teaching points.";
    slidesForm.reset();
    slidesForm.dataset.editingId = "";
    slidesForm.querySelector('[type="submit"]').textContent = "Build slide outline";
    slidesGeneratedFields = { outcomes: [], indicators: [], points: [] };
    slidesWeekList.replaceChildren();
    slidesWeeklyLessons = [];
    slidesCurriculumStatus.textContent = "Choose the SHS year and subject to find curriculum weeks.";
    if (profile.primary_subject) {
      slidesForm.elements.namedItem("subject").value = profile.primary_subject;
    }
    if (slidesForm.elements.namedItem("subject").value && slidesForm.elements.namedItem("year").value) loadSlideWeeks();
  });
  slidesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!slidesForm.reportValidity()) return;
    const editing = Boolean(activeSlideEditDoc);
    let data;
    let html;
    let title;
    try {
      data = editing
        ? slideEditValues()
        : slideOutlineData(formData(slidesForm), null);
      if (!data.title) throw new Error("Enter a presentation title.");
      html = renderSlideDocument(data);
      title = `${data.title} · presentation outline`;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The presentation could not be prepared.", "error");
      return;
    }
    const submitButton = slidesForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = editing ? "Saving…" : "Building…";
    try {
      if (editing) {
        const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(activeSlideEditDoc.id)}`, "PUT", {
          type: "slides",
          title,
          data,
          html
        });
        documents = documents.map((item) => item.id === result.document.id ? result.document : item);
        renderAll();
        activeSlideEditDoc = null;
        setSlidesEditMode(false);
        slidesEditEditor.replaceChildren();
        document.getElementById("slides-dialog-title").textContent = "Create a presentation";
        document.querySelector("#slides-dialog .lesson-wizard-header p").textContent =
          "Start with a year and subject. Select one or more curriculum weeks to draft outcomes, indicators and teaching points.";
        slidesForm.dataset.editingId = "";
        planningDialogs.slides.close();
        openSavedDocument(result.document);
        showToast("Presentation outline updated.");
      } else {
        planningDialogs.slides.close();
        const region = document.getElementById("slides-output");
        region.innerHTML = html;
        region.scrollIntoView({ behavior: "smooth", block: "start" });
        bindOutputActions(region, { type: "slides", title, data, html });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The presentation outline could not be saved.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = activeSlideEditDoc ? "Save presentation" : "Build slide outline";
    }
  });

  function iconFor(type) {
    const [icon, color] = TYPE_ICONS[type] || ["folder-open", "sage"];
    return `<span class="tool-icon ${color}">${iconMarkup(icon)}</span>`;
  }
  function friendlyDate(value) {
    return new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  }
  function getUpcomingScheduleOccurrences(days = 7) {
    const now = new Date();
    const today = scheduleShiftDate(now, 0);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const occurrences = [];
    for (let offset = 0; offset < days; offset++) {
      const date = scheduleShiftDate(today, offset);
      schedule.filter((entry) => scheduleOccursOn(entry, date)).forEach((entry) => {
        if (offset === 0 && scheduleTimeMinutes(entry.time) < currentMinutes) return;
        occurrences.push({ entry, date, offset });
      });
    }
    return occurrences.sort((left, right) =>
      scheduleDateKey(left.date).localeCompare(scheduleDateKey(right.date))
      || left.entry.time.localeCompare(right.entry.time)
      || left.entry.subject.localeCompare(right.entry.subject)
    );
  }
  function dashboardGreeting(date = new Date()) {
    const hour = Number(new Intl.DateTimeFormat("en", {
      timeZone: "Africa/Accra",
      hour: "numeric",
      hourCycle: "h23"
    }).formatToParts(date).find((part) => part.type === "hour")?.value);
    if (!Number.isFinite(hour)) return "Good day";
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }
  function updateDashboardGreeting() {
    const title = document.getElementById("welcome-title");
    if (title?.firstChild) title.firstChild.nodeValue = dashboardGreeting();
  }
  window.setInterval(updateDashboardGreeting, 60_000);
  function renderDashboard() {
    updateDashboardGreeting();
    const active = activeDocuments();
    const lessons = active.filter((doc) => doc.type === "lesson").length;
    const upcoming = getUpcomingScheduleOccurrences();
    document.getElementById("stat-documents").textContent = active.length;
    document.getElementById("stat-lessons").textContent = lessons;
    document.getElementById("stat-schedule").textContent = upcoming.length;
    document.getElementById("stat-schedule-hint").textContent = `Next 7 days · ${schedule.length} timetable ${schedule.length === 1 ? "entry" : "entries"}`;
    document.getElementById("document-count").textContent = active.length;
    document.getElementById("greeting-name").textContent = profile.name ? `, ${profile.name.split(/\s+/)[0]}` : "";
    const upcomingList = document.getElementById("upcoming-activities");
    upcomingList.innerHTML = upcoming.length
      ? upcoming.slice(0, 5).map(({ entry, date, offset }, index) => {
        const dayLabel = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : scheduleDateLabel(date, { weekday: "short" });
        const dateLabel = scheduleDateLabel(date, { month: "short", day: "numeric" });
        const classLabel = entry.className ? ` · ${entry.className}` : "";
        const timeLabel = `${entry.time}${entry.endTime ? `–${entry.endTime}` : ""}`;
        return `<article class="upcoming-activity" style="--activity-color:${scheduleColor(entry)}"><div class="upcoming-activity-date"><strong>${escapeHtml(dayLabel)}</strong><small>${escapeHtml(dateLabel)}</small></div><div class="upcoming-activity-copy"><strong>${escapeHtml(entry.subject)}${escapeHtml(classLabel)}</strong><small>${escapeHtml(timeLabel)}</small>${entry.topic ? `<p>${escapeHtml(entry.topic)}</p>` : ""}</div>${index === 0 ? `<span class="upcoming-next-badge">Next up</span>` : ""}</article>`;
      }).join("")
      : `<div class="upcoming-empty"><strong>${schedule.length ? "No classes coming up this week" : "Your timetable is empty"}</strong><span>${schedule.length ? "Your scheduled classes will appear here when they’re due." : "Add your classes to see what’s coming up."}</span><button class="text-button" data-page="schedule">${schedule.length ? "View schedule" : "Build your schedule"} <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-chevron-right"></use></svg></button></div>`;
    const recent = document.getElementById("recent-documents");
    recent.innerHTML = active.length ? active.slice(0, 4).map((doc) => `<div class="recent-item">${iconFor(doc.type)}<div class="recent-item-copy"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(TYPE_LABELS[doc.type])} · ${friendlyDate(doc.createdAt)}</small></div></div>`).join("") : `<div class="empty-state"><div><strong>No documents yet</strong>Your saved drafts will appear here.</div></div>`;
  }

  function renderDocuments() {
    const list = document.getElementById("document-list");
    const query = document.getElementById("document-search").value.trim().toLowerCase();
    const filter = document.getElementById("document-type-filter").value;
    const statusFilter = document.getElementById("document-status-filter").value;
    const filtered = documents.filter((doc) => (statusFilter === "archived" ? doc.status === "archived" : doc.status !== "archived")
      && (filter === "all" || doc.type === filter) && `${doc.title} ${doc.subject} ${doc.className}`.toLowerCase().includes(query));
    if (!filtered.length) {
      const hasDocuments = statusFilter === "archived"
        ? documents.some((doc) => doc.status === "archived")
        : activeDocuments().length > 0;
      list.innerHTML = `<div class="form-card empty-state"><div><strong>${hasDocuments ? "No matching documents" : statusFilter === "archived" ? "No archived documents" : "Your library is empty"}</strong>${hasDocuments ? "Try a different search or filter." : statusFilter === "archived" ? "Archived documents will appear here." : "Build a lesson plan, assessment, scheme or slide outline to get started."}</div></div>`;
      return;
    }
    const action = (symbol, label, attributes, extraClass = "") =>
      `<button type="button" ${attributes} class="${extraClass}"><svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-${symbol}"></use></svg><span>${label}</span></button>`;
    list.innerHTML = filtered.map((doc) => {
      const exportActions = doc.type === "slides"
        ? `${action("file-lines", "PDF", `data-export-document="${escapeHtml(doc.id)}" data-format="pdf"`)}${action("file-lines", "PowerPoint · PPTX", `data-export-document="${escapeHtml(doc.id)}" data-format="pptx"`)}`
        : `${action("file-lines", "Word · DOCX", `data-export-document="${escapeHtml(doc.id)}" data-format="docx"`)}${action("file-lines", "PDF", `data-export-document="${escapeHtml(doc.id)}" data-format="pdf"`)}`;
      const printAction = doc.type === "slides" ? "" : action("file-lines", "Print", `data-print-document="${escapeHtml(doc.id)}"`);
      const archived = doc.status === "archived";
      const statusAction = archived
        ? action("upload", "Restore", `data-archive-document="${escapeHtml(doc.id)}" data-archived="false"`)
        : action("folder-open", "Archive", `data-archive-document="${escapeHtml(doc.id)}" data-archived="true"`);
      const standardActions = archived ? ""
        : `${doc.data?.online_assessment_id ? action("users", "Manage class & scores", `data-manage-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}"`) : ""}${action("book-open", "View", `data-view-document="${escapeHtml(doc.id)}"`)}${action("file-lines", "Edit", `data-edit-document="${escapeHtml(doc.id)}"`)}${printAction}<span class="document-actions-divider" aria-hidden="true"></span><span class="document-actions-label">Export as</span>${exportActions}`;
      return `<article class="document-row">${iconFor(doc.type)}<div class="document-row-copy"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(TYPE_LABELS[doc.type])}${archived ? " · Archived" : ""} · ${escapeHtml(doc.subject || "Subject not set")} · ${friendlyDate(doc.createdAt)}</small></div><div class="document-actions"><details class="document-actions-menu"><summary aria-label="Actions for ${escapeHtml(doc.title)}"><svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-bars"></use></svg><span>Actions</span></summary><div class="document-actions-popover" role="group" aria-label="Document actions">${standardActions}${statusAction}<span class="document-actions-divider" aria-hidden="true"></span>${action("trash-can", "Delete", `data-delete-document="${escapeHtml(doc.id)}"`, "document-action-delete")}</div></details></div></article>`;
    }).join("");
  }

  const savedDocumentDialog = document.getElementById("saved-document-dialog");
  const savedDocumentContent = document.getElementById("saved-document-dialog-content");
  let activeSavedDocument = null;
  function renderSavedLessonDocument(doc) {
    const savedData = doc.data && typeof doc.data === "object" ? doc.data : {};
    const legacyTemplate = new DOMParser().parseFromString(String(doc.html || ""), "text/html");
    const templateRow = (field, label) => legacyTemplate.querySelector(`[data-template-field="${field}"]`)
      || Array.from(legacyTemplate.querySelectorAll(".lesson-plan-table tr")).find((row) =>
        row.querySelector("th")?.textContent.trim().toLocaleLowerCase() === label.toLocaleLowerCase()
      );
    const templateText = (field, label) => {
      const row = templateRow(field, label);
      if (row?.querySelector(".lesson-template-placeholder")) return "";
      const items = Array.from(row?.querySelectorAll("li") || [], (item) => item.textContent.trim()).filter(Boolean);
      return items.length ? items : row?.querySelector("td")?.textContent.trim() || "";
    };
    const savedField = (...values) => values.find((value) =>
      (Array.isArray(value) && value.length) || (typeof value === "string" && value.trim())
    );
    const data = {
      ...savedData,
      strand: savedField(savedData.strand, templateText("strand", "Strand")) || "",
      sub_strand: savedField(savedData.sub_strand, savedData.substrand, templateText("sub_strand", "Sub-Strand")) || "",
      focal_areas: savedField(savedData.focal_areas, savedData.focalAreas, templateText("focal_areas", "Focal Area(s)")) || [],
      content_standard: savedField(savedData.content_standard, savedData.standard, templateText("content_standard", "Content Standard")) || "",
      learning_indicators: savedField(savedData.learning_indicators, savedData.indicators, templateText("learning_indicators", "Learning Indicator(s)")) || [],
      learning_outcomes: savedField(savedData.learning_outcomes, savedData.learningOutcomes, templateText("learning_outcomes", "Learning Outcome(s)")) || []
    };
    const itemData = { type: "lesson", title: doc.title, data, html: doc.html || "" };
    const draft = extractLessonDraft(itemData);
    const sourceList = (draft.curriculum_sources || []).map((source) => {
      const sourceUrl = safeSourceUrl(source.source_url);
      return `<li>${escapeHtml(source.title || "Curriculum source")}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</li>`;
    }).join("");
    const formatSourceList = (draft.format_sources || []).map((source) => {
      const sourceUrl = safeSourceUrl(source.source_url);
      return `<li>${escapeHtml(source.title || "Planning template")}${source.source_reference ? ` · ${escapeHtml(source.source_reference)}` : ""}${source.page ? ` · page ${escapeHtml(source.page)}` : ""}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</li>`;
    }).join("");
    const formatSection = formatSourceList
      ? `<div class="document-section"><h3>Verified planning template checked</h3><ul class="ai-citations">${formatSourceList}</ul></div>`
      : `<div class="document-section"><h3>Planning format</h3><p>No administrator-verified template was found. This is an editable teacher-review draft and is not represented as an officially approved format.</p></div>`;
    return documentFrame(
      doc.title,
      "LESSON PLAN · TEACHER-REVIEW DRAFT",
      [],
      renderLessonTemplate(data, draft, formatSection, sourceList),
      "",
      true
    );
  }
  function openSavedDocument(doc, editing = false) {
    if (editing && doc.type === "slides") {
      editSavedSlides(doc);
      return;
    }
    activeSavedDocument = doc;
    document.getElementById("saved-document-dialog-title").textContent = doc.title;
    document.getElementById("saved-document-dialog-description").textContent =
      `${TYPE_LABELS[doc.type] || "Document"} · ${doc.subject || "Subject not set"} · ${friendlyDate(doc.createdAt)}`;
    savedDocumentContent.innerHTML = doc.type === "slides"
      ? renderSlideDocument({ ...(doc.data || {}), title: doc.data?.title || doc.title })
      : doc.type === "lesson"
        ? renderSavedLessonDocument(doc)
      : doc.html || `<p class="empty-state">This document has no saved preview.</p>`;
    const card = savedDocumentContent.querySelector(".output-card");
    if (!card) {
      savedDocumentContent.innerHTML = '<p class="empty-state">This saved document has no readable preview. Rebuild it to create a new copy.</p>';
    } else {
      const actions = card.querySelector(".output-actions");
      if (actions) {
        const exportActions = doc.type === "slides"
          ? '<button type="button" class="small-button" data-saved-doc-present>Present</button><button type="button" class="small-button" data-saved-doc-export="pdf">Download PDF</button><button type="button" class="small-button" data-saved-doc-export="pptx">Download PowerPoint</button>'
          : '<button type="button" class="small-button" data-saved-doc-export="docx">Word · DOCX</button><button type="button" class="small-button" data-saved-doc-export="pdf">PDF</button><button type="button" class="small-button" data-saved-doc-print>Print</button>';
        actions.innerHTML = `${doc.data?.online_assessment_id ? `<button type="button" class="small-button" data-manage-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}">Manage class &amp; scores</button>` : ""}<button type="button" class="small-button" data-saved-doc-edit>${editing ? "Save changes" : "Edit"}</button>${editing ? '<button type="button" class="small-button" data-saved-doc-cancel>Cancel edit</button>' : ""}${exportActions}`;
      }
      if (editing && doc.type !== "lesson") card.querySelector(".output-body")?.setAttribute("contenteditable", "true");
    }
    if (!savedDocumentDialog.open) savedDocumentDialog.showModal();
    if (editing && doc.type === "lesson") {
      showLessonEditor(savedDocumentContent, {
        type: "lesson",
        title: doc.title,
        data: doc.data || {},
        html: doc.html || "",
        alreadySaved: true,
        documentId: doc.id
      });
    }
  }
  savedDocumentDialog.querySelector("[data-close-saved-document]").addEventListener("click", () => savedDocumentDialog.close());
  savedDocumentDialog.addEventListener("click", (event) => {
    if (event.target === savedDocumentDialog) savedDocumentDialog.close();
  });
  savedDocumentContent.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !activeSavedDocument) return;
    const card = savedDocumentContent.querySelector(".output-card");
    if (button.matches("[data-saved-doc-edit]")) {
      if (!card.querySelector(".output-body")?.isContentEditable) {
        openSavedDocument(activeSavedDocument, true);
        return;
      }
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const updatedTitle = card.querySelector(".document-title-block h2")?.textContent.trim() || activeSavedDocument.title;
        const serializedCard = card.cloneNode(true);
        serializedCard.querySelector(".output-body")?.removeAttribute("contenteditable");
        const html = serializedCard.outerHTML;
        const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(activeSavedDocument.id)}`, "PUT", {
          type: activeSavedDocument.type,
          title: updatedTitle,
          data: activeSavedDocument.data || {},
          html
        });
        documents = documents.map((item) => item.id === result.document.id ? result.document : item);
        renderAll();
        openSavedDocument(result.document);
        showToast("Document edits saved to your workspace.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Document changes could not be saved.", "error");
        button.disabled = false;
        button.textContent = "Save changes";
      }
    } else if (button.matches("[data-saved-doc-cancel]")) {
      openSavedDocument(activeSavedDocument);
    } else if (button.matches("[data-saved-doc-export]")) {
      const exportDocument = activeSavedDocument.type === "slides"
        ? { ...activeSavedDocument, data: normalizePresentationData(activeSavedDocument.data || {}) }
        : activeSavedDocument;
      exportDocumentFormat(exportDocument, button.dataset.savedDocExport);
    } else if (button.matches("[data-saved-doc-print]")) {
      printDocument(activeSavedDocument.title, card);
    }
  });

  function renderPlanningLibraries() {
    for (const type of ["assessment", "scheme", "slides"]) {
      const library = document.getElementById(`${type}-library`);
      const entries = (type === "slides" ? documents : activeDocuments()).filter((doc) => doc.type === type);
      const slideSearch = type === "slides" ? document.getElementById("slides-library-search").value.trim().toLowerCase() : "";
      const slideStatus = type === "slides" ? document.getElementById("slides-library-status").value : "active";
      const visibleEntries = type === "slides"
        ? entries.filter((doc) => (slideStatus === "all" || (slideStatus === "archived" ? doc.status === "archived" : doc.status !== "archived"))
          && `${doc.title} ${doc.subject} ${doc.className} ${doc.year}`.toLowerCase().includes(slideSearch))
        : entries;
      const orderedEntries = type === "assessment"
        ? [...entries.filter((doc) => doc.data?.assessment_builder_draft), ...entries.filter((doc) => !doc.data?.assessment_builder_draft)]
        : entries;
      const assessmentAction = (symbol, label, attributes, extraClass = "") =>
        `<button type="button" ${attributes} class="${extraClass}"><svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-${symbol}"></use></svg><span>${label}</span></button>`;
      const exportActions = (doc) => doc.type === "slides"
        ? `${assessmentAction("file-lines", "PDF", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pdf"`, "small-button")}${assessmentAction("file-lines", "PowerPoint · PPTX", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pptx"`, "small-button")}`
        : `${assessmentAction("file-lines", "Word · DOCX", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="docx"`, "small-button")}${assessmentAction("file-lines", "PDF", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pdf"`, "small-button")}`;
      const assessmentActionMenu = (doc) => {
        const items = [];
        if (doc.data?.assessment_builder_draft) {
          items.push(assessmentAction("file-lines", "Continue", `data-open-planning-document="${escapeHtml(doc.id)}"`));
        } else {
          if (doc.data?.online_assessment_id) {
            items.push(assessmentAction("arrow-up-right-from-square", "Copy student link", `data-share-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}"`));
            items.push(assessmentAction("user", "Manage class & scores", `data-manage-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}"`));
          } else if (doc.data?.assessment_builder_generated && doc.data?.assessment_draft) {
            items.push(assessmentAction("upload", "Publish online", `data-publish-saved-assessment="${escapeHtml(doc.id)}"`));
          }
          if (doc.data?.assessment_draft && doc.data?.assessment_builder_generated) {
            items.push(assessmentAction("clipboard-check", "Open generated assessment", `data-open-saved-generated-assessment="${escapeHtml(doc.id)}"`));
          } else {
            items.push(assessmentAction("book-open", "View", `data-open-planning-document="${escapeHtml(doc.id)}"`));
          }
          items.push('<span class="document-actions-divider" aria-hidden="true"></span>', '<span class="document-actions-label">Export as</span>');
          items.push(assessmentAction("file-lines", "Word · DOCX", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="docx"`));
          items.push(assessmentAction("file-lines", "PDF", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pdf"`));
        }
        items.push(assessmentAction("xmark", "Delete", `data-delete-assessment-document="${escapeHtml(doc.id)}"`, "document-action-delete"));
        return `<div class="document-actions"><details class="document-actions-menu"><summary aria-label="Actions for ${escapeHtml(doc.title)}"><svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-bars"></use></svg><span>Actions</span></summary><div class="document-actions-popover" role="group" aria-label="Assessment actions">${items.join("")}</div></details></div>`;
      };
      const slideActionMenu = (doc) => {
        const archived = doc.status === "archived";
        const items = [
          assessmentAction("pen", "Edit", `data-edit-slide-document="${escapeHtml(doc.id)}"`),
          assessmentAction("eye", "View", `data-open-planning-document="${escapeHtml(doc.id)}"`)
        ];
        if (!archived) {
          items.push('<span class="document-actions-divider" aria-hidden="true"></span>', '<span class="document-actions-label">Export as</span>');
          items.push(assessmentAction("file-lines", "PDF", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pdf"`));
          items.push(assessmentAction("file-lines", "PowerPoint · PPTX", `data-saved-assessment-export="${escapeHtml(doc.id)}" data-format="pptx"`));
        }
        items.push('<span class="document-actions-divider" aria-hidden="true"></span>');
        items.push(archived
          ? assessmentAction("upload", "Restore", `data-archive-slide-document="${escapeHtml(doc.id)}" data-archived="false"`)
          : assessmentAction("folder-open", "Archive", `data-archive-slide-document="${escapeHtml(doc.id)}" data-archived="true"`));
        items.push(assessmentAction("trash-can", "Delete", `data-delete-slide-document="${escapeHtml(doc.id)}"`, "document-action-delete"));
        return `<div class="document-actions"><details class="document-actions-menu"><summary aria-label="Actions for ${escapeHtml(doc.title)}"><svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-bars"></use></svg><span>Actions</span></summary><div class="document-actions-popover" role="group" aria-label="Presentation actions">${items.join("")}</div></details></div>`;
      };
      library.innerHTML = visibleEntries.length
        ? `<div class="planning-library-heading"><strong>${type === "slides" ? `${slideStatus === "archived" ? "Archived" : slideStatus === "all" ? "All saved" : "Saved"} presentations` : `Saved ${TYPE_LABELS[type].toLocaleLowerCase()} documents`}</strong><button type="button" class="text-button" data-page="documents">View all ${activeDocuments().length} documents</button></div><div class="planning-library-list">${(type === "slides" ? visibleEntries : orderedEntries.slice(0, 8)).map((doc) => {
          const actions = type === "assessment"
            ? assessmentActionMenu(doc)
            : type === "slides" ? slideActionMenu(doc) : `<div class="document-actions assessment-saved-actions">${doc.data?.assessment_builder_draft
              ? assessmentAction("file-lines", "Continue", `data-open-planning-document="${escapeHtml(doc.id)}"`, "small-button")
              : `${doc.data?.online_assessment_id ? `${assessmentAction("arrow-up-right-from-square", "Copy student link", `data-share-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}"`, "small-button")}${assessmentAction("user", "Manage class &amp; scores", `data-manage-saved-assessment="${escapeHtml(doc.data.online_assessment_id)}"`, "small-button")}` : ""}${exportActions(doc)}${assessmentAction("eye", "View", `data-open-planning-document="${escapeHtml(doc.id)}"`, "small-button")}`}</div>`;
          const archived = doc.status === "archived";
          return `<article class="document-row">${iconFor(doc.type)}<div class="document-row-copy"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.data?.assessment_builder_draft ? "Saved builder draft" : doc.subject || "Subject not set")}${type === "slides" && archived ? " · Archived" : ""} · ${friendlyDate(doc.createdAt)}</small></div>${actions}</article>`;
        }).join("")}</div>`
        : `<div class="planning-library-empty">${type === "slides"
          ? entries.length ? "No presentations match your search and status filter." : "Your saved presentations will appear here. Archived presentations can be found with the status filter above."
          : `Your saved ${TYPE_LABELS[type].toLocaleLowerCase()} documents will appear here.`}</div>`;
    }
  }

  document.getElementById("slides-library-search").addEventListener("input", renderPlanningLibraries);
  document.getElementById("slides-library-status").addEventListener("change", renderPlanningLibraries);

  document.getElementById("slides-library").addEventListener("click", async (event) => {
    const archiveButton = event.target.closest("[data-archive-slide-document]");
    if (archiveButton) {
      const doc = documents.find((item) => String(item.id) === archiveButton.dataset.archiveSlideDocument);
      if (!doc) return;
      archiveButton.disabled = true;
      const archived = archiveButton.dataset.archived === "true";
      try {
        const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(doc.id)}/archive`, "POST", { archived });
        documents = documents.map((item) => item.id === doc.id ? { ...item, status: result.document.status } : item);
        renderAll();
        showToast(archived ? "Presentation archived. Find and restore it using the presentation status filter." : "Presentation restored to your active presentations.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The presentation could not be archived.", "error");
        archiveButton.disabled = false;
      }
      return;
    }
    const deleteButton = event.target.closest("[data-delete-slide-document]");
    if (deleteButton) {
      const doc = documents.find((item) => String(item.id) === deleteButton.dataset.deleteSlideDocument);
      if (!doc) return;
      if (!await window.akademiAlert.confirm(`Delete "${doc.title}" from your saved presentations? This cannot be undone.`, {
        title: "Delete saved presentation",
        confirmText: "Delete"
      })) return;
      deleteButton.disabled = true;
      try {
        await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(doc.id)}`, "DELETE");
        documents = documents.filter((item) => item.id !== doc.id);
        renderAll();
        showToast("Saved presentation deleted from your workspace.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The presentation could not be deleted.", "error");
        deleteButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-edit-slide-document]");
    if (button) {
      const doc = documents.find((item) => String(item.id) === button.dataset.editSlideDocument);
      if (doc) openSavedDocument(doc, true);
    }
  });

  document.querySelector("[data-dismiss-ai-notice]")?.addEventListener("click", () => {
    const aiNotice = document.getElementById("ai-provider-notice");
    aiNotice.hidden = true;
    if (!window.akademiUserId) return;
    try {
      localStorage.setItem(`akademi-ai-notice-dismissed:${window.akademiUserId}`, "1");
    } catch (error) {
      console.warn("AI notice preference could not be saved to local storage.", error);
    }
  });

  document.addEventListener("click", async (event) => {
    const openSavedGeneratedAssessment = event.target.closest("[data-open-saved-generated-assessment]");
    if (openSavedGeneratedAssessment) {
      const doc = documents.find((item) => item.id === openSavedGeneratedAssessment.dataset.openSavedGeneratedAssessment);
      try {
        if (!await restoreSavedAssessmentPreview(doc)) {
          showToast("This saved document does not contain a generated assessment to review.", "error");
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The saved assessment could not be opened.", "error");
      }
      return;
    }
    const deleteAssessment = event.target.closest("[data-delete-assessment-document]");
    if (deleteAssessment) {
      const doc = documents.find((item) => item.id === deleteAssessment.dataset.deleteAssessmentDocument);
      if (!doc || doc.type !== "assessment") return;
      if (!(await window.akademiAlert.confirm(
        `Delete "${doc.title}" from your saved assessments? This removes the saved paper and guide. Any separately published online assessment, student link, roster, submissions and scores will remain active.`,
        { title: "Delete saved assessment", confirmText: "Delete" }
      ))) return;
      deleteAssessment.disabled = true;
      try {
        await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(doc.id)}`, "DELETE");
        documents = documents.filter((item) => item.id !== doc.id);
        if (latestAssessment?.savedDocument?.id === doc.id) latestAssessment.savedDocument = null;
        renderAll();
        if (activeSavedDocument?.id === doc.id) {
          activeSavedDocument = null;
          if (savedDocumentDialog.open) savedDocumentDialog.close();
        }
        showToast("Saved assessment deleted from your workspace.");
        if (deleteAssessment.closest("#generated-assessment-online-actions")) {
          if (generatedAssessmentDialog.open) generatedAssessmentDialog.close();
          resetGeneratedAssessmentOnlineActions();
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Assessment could not be deleted.", "error");
        deleteAssessment.disabled = false;
      }
      return;
    }
    const publishSaved = event.target.closest("[data-publish-saved-assessment]");
    if (publishSaved) {
      const doc = documents.find((item) => item.id === publishSaved.dataset.publishSavedAssessment);
      if (!doc || doc.type !== "assessment") {
        showToast("This saved assessment could not be found.", "error");
        return;
      }
      document.querySelector('[data-page="assessment"]')?.click();
      try {
        if (!await restoreSavedAssessmentPreview(doc)) {
          showToast("This saved assessment is missing the generated questions needed to publish online.", "error");
          return;
        }
        openGeneratedAssessmentTab("class");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The saved assessment could not be prepared for publishing.", "error");
      }
      return;
    }
    const shareSaved = event.target.closest("[data-share-saved-assessment]");
    if (shareSaved) {
      shareSaved.disabled = true;
      try {
        const result = await workspaceRequest(`/api/teacher/online-assessments/${encodeURIComponent(shareSaved.dataset.shareSavedAssessment)}`);
        const takeUrl = new URL(result.assessment.take_url, window.location.href).href;
        const shareText = assessmentShareInstructions(result.assessment, takeUrl);
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareText);
        else {
          const field = document.createElement("textarea"); field.value = shareText; field.style.position = "fixed"; field.style.opacity = "0";
          document.body.append(field); field.select(); const copied = document.execCommand("copy"); field.remove();
          if (!copied) throw new Error("Clipboard access is unavailable.");
        }
        showToast("Exam instructions and student link copied. Share each access code privately.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The student link could not be copied.", "error");
      } finally {
        shareSaved.disabled = false;
      }
      return;
    }
    const exportSavedAssessment = event.target.closest("[data-saved-assessment-export]");
    if (exportSavedAssessment) {
      const doc = documents.find((item) => item.id === exportSavedAssessment.dataset.savedAssessmentExport);
      if (doc) exportDocumentFormat(doc, exportSavedAssessment.dataset.format);
      return;
    }
    const manageButton = event.target.closest("[data-manage-saved-assessment]");
    if (manageButton) {
      activeOnlineAssessmentId = manageButton.dataset.manageSavedAssessment;
      document.querySelector('[data-page="assessment"]')?.click();
      try {
        await restoreOnlineAssessmentPreview(activeOnlineAssessmentId);
        await loadOnlineResults(activeOnlineAssessmentId);
        openGeneratedAssessmentTab("class");
        assessmentResults.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The assessment class and scores could not be loaded.", "error");
      }
      return;
    }
    const button = event.target.closest("[data-open-planning-document]");
    if (!button) return;
    const doc = documents.find((item) => String(item.id) === button.dataset.openPlanningDocument);
    if (doc?.data?.assessment_builder_draft && continueAssessmentDraft) continueAssessmentDraft(doc);
    else if (doc) openSavedDocument(doc);
  });

  function renderLessonLibrary() {
    const list = document.getElementById("lesson-library");
    const lessons = activeDocuments().filter((doc) => doc.type === "lesson");
    if (!lessons.length) {
      list.innerHTML = `<div class="lesson-library-empty"><span class="lesson-library-empty-icon">${iconMarkup("book-open")}</span><div><strong>Your lesson plans will appear here</strong><p>Start with an SHS year and subject. AI will use verified resource content to draft and save the complete plan.</p></div></div>`;
      return;
    }
    list.innerHTML = lessons.map((doc) => `<article class="lesson-library-card"><span class="lesson-library-icon">${iconMarkup("book-open")}</span><div class="lesson-library-copy"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.subject || "Subject not set")} · ${escapeHtml(doc.year || doc.year_group || "Year not set")} · ${friendlyDate(doc.createdAt)}</small></div><button class="small-button" type="button" data-open-saved-lesson="${escapeHtml(doc.id)}">View plan</button></article>`).join("");
  }
  document.getElementById("lesson-library").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-saved-lesson]");
    if (!button) return;
    const doc = documents.find((item) => String(item.id) === button.dataset.openSavedLesson);
    if (doc) openSavedDocument(doc);
  });

  document.getElementById("document-search").addEventListener("input", renderDocuments);
  document.getElementById("document-type-filter").addEventListener("change", renderDocuments);
  document.getElementById("document-status-filter").addEventListener("change", renderDocuments);
  document.getElementById("document-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    button.closest(".document-actions-menu")?.removeAttribute("open");
    if (button.dataset.manageSavedAssessment) return;
    const doc = documents.find((item) => String(item.id) === (button.dataset.viewDocument || button.dataset.editDocument || button.dataset.exportDocument || button.dataset.printDocument || button.dataset.deleteDocument || button.dataset.archiveDocument));
    if (!doc) return;
    if (button.dataset.archiveDocument) {
      button.disabled = true;
      try {
        const archived = button.dataset.archived === "true";
        const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(doc.id)}/archive`, "POST", { archived });
        documents = documents.map((item) => item.id === doc.id ? { ...item, status: result.document.status } : item);
        renderAll();
        showToast(archived ? "Document archived. Restore it from My documents whenever you need it." : "Document restored to your workspace.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The document archive status could not be changed.", "error");
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.deleteDocument) {
      if (!(await window.akademiAlert.confirm(`Delete "${doc.title}" from your account?`, {
        title: "Delete saved document",
        confirmText: "Delete"
      }))) return;
      button.disabled = true;
      try {
        await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(doc.id)}`, "DELETE");
        documents = documents.filter((item) => item.id !== doc.id);
        renderAll();
        showToast("Document deleted from your synced workspace.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Document could not be deleted.", "error");
        button.disabled = false;
      }
    } else if (button.dataset.viewDocument || button.dataset.editDocument) {
      openSavedDocument(doc, Boolean(button.dataset.editDocument));
    } else if (button.dataset.printDocument) {
      const parsed = new DOMParser().parseFromString(doc.html || "", "text/html");
      printDocument(doc.title, parsed.querySelector(".output-card"));
    } else {
      exportDocumentFormat(doc, button.dataset.format);
    }
  });
  document.addEventListener("click", (event) => {
    document.querySelectorAll(".document-actions-menu[open]").forEach((menu) => {
      if (!menu.contains(event.target) || event.target.closest(".document-actions-popover button")) {
        menu.removeAttribute("open");
      }
    });
  });

  function download(name, contents, mime) {
    const progressId = window.akademiProgress?.start("Preparing your download…");
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (progressId) window.akademiProgress.finish(progressId, "Download started.");
  }
  function safeFilename(value) {
    return value.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "akademi-draft";
  }
  function exportDocumentFormat(doc, format) {
    if (!["docx", "pdf", "pptx"].includes(format)
      || (doc.type === "slides" && !["pdf", "pptx"].includes(format))
      || (format === "pptx" && doc.type !== "slides")) {
      showToast("Choose a supported export format for this document.", "error");
      return;
    }
    try {
      const exportDoc = doc.type === "assessment"
        ? { ...doc, data: { ...doc.data, administrator: doc.data?.administrator || assessmentAdministratorDetails() } }
        : doc;
      const downloadTask = doc.type === "assessment"
        ? window.akademiAssessmentExport.downloadDocumentWithLogo(exportDoc, format)
        : Promise.resolve(window.akademiAssessmentExport.downloadDocument(exportDoc, format));
      Promise.resolve(downloadTask)
        .then(() => showToast(`${format.toUpperCase()} download started.`))
        .catch((error) => showToast(error instanceof Error ? error.message : "This document could not be exported.", "error"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "This document could not be exported.", "error");
    }
  }
  document.getElementById("export-backup").addEventListener("click", () => {
    download(`akademi-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), profile, documents, schedule }, null, 2), "application/json;charset=utf-8");
    showToast("Workspace backup downloaded.");
  });

  const profileLogoInput = document.getElementById("profile-logo-file");
  const profileLogoPreview = document.getElementById("profile-logo-preview");
  const profileLogoImage = document.getElementById("profile-logo-image");
  function releaseProfileLogoPreview() {
    if (profileLogoImage?.dataset.objectUrl) {
      URL.revokeObjectURL(profileLogoImage.dataset.objectUrl);
      delete profileLogoImage.dataset.objectUrl;
    }
  }
  profileLogoInput?.addEventListener("change", () => {
    const file = profileLogoInput.files[0];
    if (!file) {
      releaseProfileLogoPreview();
      updateProfile();
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      profileLogoInput.value = "";
      releaseProfileLogoPreview();
      updateProfile();
      showToast("Choose a JPEG, PNG or WebP school logo.", "error");
      return;
    }
    releaseProfileLogoPreview();
    const objectUrl = URL.createObjectURL(file);
    profileLogoImage.dataset.objectUrl = objectUrl;
    profileLogoImage.src = objectUrl;
    profileLogoPreview.hidden = false;
    profileLogoImage.onerror = () => {
      if (profileLogoImage.dataset.objectUrl !== objectUrl) return;
      releaseProfileLogoPreview();
      profileLogoInput.value = "";
      updateProfile();
      showToast("The selected school logo could not be previewed. Choose a valid JPEG, PNG or WebP image.", "error");
    };
  });
  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const logoFile = document.getElementById("profile-logo-file").files[0] || null;
    button.disabled = true;
    button.textContent = "Saving profile…";
    try {
      if (logoFile && logoFile.size > 2 * 1024 * 1024) {
        throw new Error("School logos must be 2 MB or smaller.");
      }
      const data = formData(form);
      delete data.logo;
      const result = await workspaceRequest("/api/workspace/profile", "PUT", data);
      profile = result.profile;
      if (logoFile) {
        const upload = new FormData();
        upload.append("logo", logoFile);
        const response = await fetch(`${appBase}/api/workspace/profile/logo`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Accept": "application/json", "X-CSRF-Token": window.akademiCsrfToken || "" },
          body: upload
        });
        let uploaded;
        try {
          uploaded = await response.json();
        } catch {
          throw new Error("The school logo service returned an unreadable response.");
        }
        if (!response.ok) {
          const reference = uploaded.request_id ? ` (Reference: ${uploaded.request_id})` : "";
          throw new Error(`${uploaded.error || "The school logo could not be uploaded."}${reference}`);
        }
        profile.logo_url = uploaded.logo_url;
        profileLogoInput.value = "";
        releaseProfileLogoPreview();
      }
      updateProfile();
      renderDashboard();
      document.getElementById("sync-state").textContent = "Synced to your account";
      showToast("Workspace profile saved and synced to your account.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace profile could not be saved.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save profile";
    }
  });
  function updateProfile() {
    const name = profile.name || "Your profile";
    document.getElementById("profile-name").textContent = name;
    document.getElementById("profile-school").textContent = profile.school || "Set up your workspace";
    document.getElementById("profile-avatar").textContent = (profile.name || "T").trim().charAt(0).toUpperCase();
    document.querySelector(".top-avatar").textContent = (profile.name || "T").trim().charAt(0).toUpperCase();
    document.querySelectorAll(".profile-school-input").forEach((input) => { if (!input.value) input.value = profile.school || ""; });
    const logoPreview = document.getElementById("profile-logo-preview");
    const logoImage = document.getElementById("profile-logo-image");
    if (logoPreview && logoImage) {
      const logoInput = document.getElementById("profile-logo-file");
      const pendingPreview = Boolean(logoImage.dataset.objectUrl && logoInput?.files.length);
      logoPreview.hidden = !pendingPreview && !profile.logo_url;
      if (!pendingPreview) {
        if (profile.logo_url) logoImage.src = profile.logo_url;
        else logoImage.removeAttribute("src");
      }
    }
    const greeting = document.getElementById("greeting-name");
    if (greeting) greeting.textContent = profile.name ? `, ${profile.name.split(/\s+/)[0]}` : "";
  }
  function renderAll() {
    renderDashboard();
    renderDocuments();
    renderPlanningLibraries();
    renderLessonLibrary();
    renderSchedule();
    updateProfile();
    const profileForm = document.getElementById("profile-form");
    Object.entries(profile).forEach(([key, value]) => {
      const field = profileForm.elements.namedItem(key);
      if (field) field.value = value;
    });
  }
  const academicYearField = document.querySelector('#scheme-form [name="academicYear"]');
  if (academicYearField) {
    const currentYear = new Date().getFullYear();
    academicYearField.value = `${currentYear}/${currentYear + 1}`;
  }
  async function configureProfileOptions() {
    const profileForm = document.getElementById("profile-form");
    const regionList = document.getElementById("ghana-region-options");
    const districtList = document.getElementById("ghana-district-options");
    const subjectList = document.getElementById("ghana-subject-options");
    const departmentList = document.getElementById("ghana-department-options");
    try {
      const [areasResponse, subjectsResponse] = await Promise.all([
        fetch(`${appBase}/assets/data/ghana-admin-areas.json`, { credentials: "same-origin" }),
        fetch(`${appBase}/assets/data/ghana-shs-subjects.json`, { credentials: "same-origin" })
      ]);
      if (!areasResponse.ok || !subjectsResponse.ok) {
        throw new Error("The searchable Ghana profile lists could not be loaded.");
      }
      const [areas, subjectGroups] = await Promise.all([areasResponse.json(), subjectsResponse.json()]);
      const lessonSubjects = [...new Set(Object.values(subjectGroups).flat())].sort((left, right) => left.localeCompare(right));
      subjectList.replaceChildren(...lessonSubjects.map((subject) => new Option(subject, subject)));
      lessonSubjectOptions.replaceChildren(...lessonSubjects.map((subject) => new Option(subject, subject)));
      if (profile.primary_subject && lessonSubjects.includes(profile.primary_subject)) {
        lessonSubjectSelect.value = profile.primary_subject;
      }
      schemeSubjectSelect.replaceChildren(new Option("Choose a subject", ""));
      lessonSubjects.forEach((subject) => schemeSubjectSelect.add(new Option(subject, subject)));
      if (profile.primary_subject && lessonSubjects.includes(profile.primary_subject)) {
        schemeSubjectSelect.value = profile.primary_subject;
      }
      if (profile.primary_subject && lessonSubjects.includes(profile.primary_subject)) {
        slidesForm.elements.namedItem("subject").value = profile.primary_subject;
      }
      const academicYearSelect = lessonForm.elements.namedItem("academicYear");
      const currentAcademicYear = new Date().getFullYear();
      for (let year = currentAcademicYear - 2; year <= currentAcademicYear + 3; year++) {
        academicYearSelect.add(new Option(`${year}/${year + 1}`, `${year}/${year + 1}`));
      }
      const regionField = profileForm.elements.namedItem("region");
      const districtField = profileForm.elements.namedItem("district");
      const subjectField = profileForm.elements.namedItem("primary_subject");
      function bindOptionList(field, list, options) {
        let activeIndex = -1;
        const close = () => {
          list.hidden = true;
          field.setAttribute("aria-expanded", "false");
          field.removeAttribute("aria-activedescendant");
          activeIndex = -1;
        };
        const choose = (value) => {
          field.value = value;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
          close();
        };
        const render = () => {
          const available = options().filter((option) => option.label.toLocaleLowerCase().includes(field.value.trim().toLocaleLowerCase()));
          list.replaceChildren(...available.map((option, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.id = `${list.id}-option-${index}`;
            button.className = "profile-option";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", String(index === activeIndex));
            button.textContent = option.label;
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => choose(option.value));
            return button;
          }));
          const open = available.length > 0;
          list.hidden = !open;
          field.setAttribute("aria-expanded", String(open));
          if (!open) field.removeAttribute("aria-activedescendant");
          return available;
        };
        field.addEventListener("focus", () => { activeIndex = -1; render(); });
        field.addEventListener("click", () => { activeIndex = -1; render(); });
        field.addEventListener("input", () => { activeIndex = -1; render(); });
        field.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            close();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
          const available = options().filter((option) => option.label.toLocaleLowerCase().includes(field.value.trim().toLocaleLowerCase()));
          if (!available.length) return;
          event.preventDefault();
          if (event.key === "Enter") {
            if (activeIndex >= 0 && available[activeIndex]) choose(available[activeIndex].value);
            else render();
            return;
          }
          activeIndex = event.key === "ArrowDown"
            ? Math.min(activeIndex + 1, available.length - 1)
            : Math.max(activeIndex - 1, 0);
          render();
          const activeOption = list.querySelector(`#${CSS.escape(`${list.id}-option-${activeIndex}`)}`);
          if (activeOption) {
            field.setAttribute("aria-activedescendant", activeOption.id);
            activeOption.scrollIntoView({ block: "nearest" });
          }
        });
        field.addEventListener("blur", () => setTimeout(close, 120));
      }
      bindOptionList(regionField, regionList, () => areas.map((area) => ({ value: area.name, label: area.name })));
      bindOptionList(districtField, districtList, () => {
        const selectedRegion = areas.find((area) => area.name.toLowerCase() === regionField.value.trim().toLowerCase());
        return selectedRegion ? selectedRegion.districts.map((name) => ({ value: name, label: name })) : [];
      });
      const updateDistricts = () => {
        const selectedRegion = areas.find((area) => area.name.toLowerCase() === regionField.value.trim().toLowerCase());
        districtField.disabled = !selectedRegion;
        districtField.placeholder = selectedRegion ? "Search or select a district" : "Choose a region first";
        if (selectedRegion && districtField.value
          && !selectedRegion.districts.some((name) => name.toLowerCase() === districtField.value.trim().toLowerCase())) {
          districtField.value = "";
        }
        if (!selectedRegion) districtField.value = "";
        if (document.activeElement === districtField) {
          districtField.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      regionField.addEventListener("input", updateDistricts);
      updateDistricts();
      const subjects = [...new Set(Object.values(subjectGroups).flat())].sort((left, right) => left.localeCompare(right));
      subjectList.replaceChildren(...subjects.map((subject) => {
        const option = document.createElement("option");
        option.value = subject;
        return option;
      }));
      const departments = [
        "General Arts", "General Science", "Business", "Agriculture", "Home Economics",
        "Visual Arts", "Technical", "Vocational", "Languages", "Physical Education", "ICT"
      ];
      departmentList.replaceChildren(...departments.map((department) => {
        const option = document.createElement("option");
        option.value = department;
        return option;
      }));
      if (!subjects.includes(subjectField.value) && subjectField.value) {
        const option = document.createElement("option");
        option.value = subjectField.value;
        subjectList.append(option);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The Ghana profile lists could not be loaded.", "error");
    }
  }
  function configureAssessmentTopics() {
    const form = document.getElementById("assessment-form");
    const subjectField = form.elements.namedItem("subject");
    const topicList = document.getElementById("assessment-topics-list");
    const topicStatus = document.getElementById("assessment-topics-status");
    const selectedSummary = document.getElementById("assessment-selected-topics");
    const catalogPreview = document.getElementById("assessment-curriculum-catalog-preview");
    const loadButton = document.getElementById("load-assessment-topics");
    const questionCountField = form.elements.namedItem("questionCount");
    const totalMarksField = form.elements.namedItem("marks");
    const deliveryField = form.elements.namedItem("deliveryMode");
    const onlineSecurityPanel = document.getElementById("assessment-online-security");
    const staticDraftButton = document.getElementById("assessment-build-draft");
    const timeShare = document.getElementById("assessment-time-share");
    const weeklySections = document.getElementById("assessment-week-list");
    const weeklyStatus = document.getElementById("assessment-week-status");
    const selectedWeeksByYear = new Map();
    const updateTimeShare = () => {
      const count = Math.max(1, Number(questionCountField.value) || 1);
      const duration = Number(Array.from(assessmentSelections.duration)[0] || 60);
      const seconds = duration * 60 / count;
      const wholeMinutes = Math.floor(seconds / 60);
      const wholeSeconds = Math.round(seconds % 60);
      timeShare.textContent = `Time guide: ${wholeMinutes ? `${wholeMinutes} min ` : ""}${wholeSeconds} sec per question on average (${duration} minutes ÷ ${count}). The total exam timer remains available across all questions.`;
    };
    let requestController = null;
    let debounceTimer = 0;
    const typeLabels = {
      topic: "Curriculum entry",
      sub_strand: "Sub-strand",
      focal_area: "Focal area",
      strand: "Strand",
      section: "Curriculum section",
      content_standard: "Content standard",
      learning_indicator: "Learning indicator",
      learning_outcome: "Learning outcome",
      learning_objective: "Learning objective"
    };
    let curriculumCatalogPromise = null;
    const normalizeCatalogSubject = (value) => String(value || "").toLocaleLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    const normalizeYearGroup = (value) => String(value || "").toUpperCase().replace(/SHS\s*YEAR\s*/g, "SHS").replace(/SHS\s+/g, "SHS").replace(/[^A-Z0-9]/g, "");
    let weeklySectionsRequest = 0;
    let weeklySectionsController = null;
    const renderWeeklySections = async () => {
      if (!weeklySections) return;
      const requestId = ++weeklySectionsRequest;
      weeklySectionsController?.abort();
      weeklySectionsController = null;
      weeklyStatus.removeAttribute("aria-busy");
      const subject = subjectField.value.trim();
      const years = selectedValues("year");
      const previous = new Map();
      weeklySections.querySelectorAll('input[name="selectedAssessmentWeek"]:checked').forEach((checkbox) => {
        try {
          const week = JSON.parse(checkbox.dataset.weekSection || "{}");
          const set = previous.get(week.year_group) || new Map();
          set.set(checkbox.dataset.weekKey, week);
          previous.set(week.year_group, set);
        } catch { /* Ignore malformed saved week data. */ }
      });
      previous.forEach((weeks, year) => selectedWeeksByYear.set(year, new Map([...(selectedWeeksByYear.get(year) || new Map()), ...weeks])));
      weeklySections.replaceChildren();
      if (!subject || !years.length) {
        weeklyStatus.textContent = "Choose a subject and SHS year to load weekly sections.";
        return;
      }
      if (subject.length < 2) {
        weeklyStatus.textContent = "Enter at least two characters of the subject name to load weekly sections.";
        return;
      }
      const matchingSchemes = activeDocuments().filter((doc) => doc.type === "scheme"
        && normalizeCatalogSubject(doc.subject || doc.data?.subject) === normalizeCatalogSubject(subject)
        && Array.isArray(doc.data?.weeks));
      const schemeForYear = (year) => matchingSchemes
        .filter((doc) => normalizeYearGroup(doc.data?.year_group || doc.year_group || doc.data?.year || doc.year) === normalizeYearGroup(year))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
      const controller = new AbortController();
      weeklySectionsController = controller;
      weeklyStatus.textContent = `Loading verified weekly curriculum for ${subject}…`;
      weeklyStatus.setAttribute("aria-busy", "true");
      let curriculumLessonsByYear;
      try {
        curriculumLessonsByYear = await Promise.all(years.map(async (year) => {
          const query = new URLSearchParams({ year_group: year, subject, include_structure: "1" });
          const response = await fetch(`${appBase}/api/curriculum/weekly-lessons?${query}`, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || `Weekly curriculum for ${year} could not be loaded.`);
          if (!Array.isArray(result.lessons)) throw new Error(`Weekly curriculum for ${year} returned an invalid response.`);
          return [year, result.lessons];
        }));
      } catch (error) {
        if (controller.signal.aborted || requestId !== weeklySectionsRequest) return;
        weeklyStatus.textContent = error instanceof Error
          ? error.message
          : "Verified weekly curriculum could not be loaded. Try again.";
        weeklyStatus.removeAttribute("aria-busy");
        showToast(weeklyStatus.textContent, "error");
        return;
      } finally {
        if (weeklySectionsController === controller) weeklySectionsController = null;
      }
      if (requestId !== weeklySectionsRequest) return;
      weeklyStatus.removeAttribute("aria-busy");
      const curriculumLessons = new Map(curriculumLessonsByYear);
      let total = 0;
      const availableSources = new Set();
      years.forEach((year) => {
        const scheme = schemeForYear(year);
        const suppliedWeeks = scheme?.data?.weeks || [];
        const sourceLessons = curriculumLessons.get(year) || [];
        const resourceWeeks = sourceLessons.slice(0, 39).map((lesson) => {
          const entries = Array.isArray(lesson.curriculum_entries) ? lesson.curriculum_entries : [];
          const entryTitles = (type) => entries
            .filter((entry) => entry.section_type === type)
            .map((entry) => String(entry.title || "").trim())
            .filter(Boolean);
          const focalAreas = Array.isArray(lesson.focal_areas) ? lesson.focal_areas.map(String) : [];
          return {
            term: `Semester ${Number(lesson.semester_number) || 1}`,
            semester_number: Number(lesson.semester_number) || 1,
            week: Number(lesson.week_number) || 0,
            week_number: Number(lesson.week_number) || 0,
            weekly_lesson_id: Number(lesson.id) || 0,
            strand: entryTitles("strand").join("; "),
            sub_strand: entryTitles("sub_strand").join("; "),
            focal_area: focalAreas.join("; "),
            focal_areas: focalAreas,
            topic: String(lesson.topic || ""),
            learning_focus: "",
            content_standard: entryTitles("content_standard").join("; "),
            learning_indicators: Array.isArray(lesson.learning_indicators) ? lesson.learning_indicators.map(String) : [],
            learning_outcomes: Array.isArray(lesson.learning_outcomes) ? lesson.learning_outcomes.map(String) : [],
            source_title: String(lesson.source_title || ""),
            year_group: year
          };
        });
        const weeks = resourceWeeks.length ? resourceWeeks : suppliedWeeks.length ? suppliedWeeks.slice(0, 39).map((week) => ({
          term: String(week.term || ""), week: Number(week.week) || 0,
          strand: String(week.strand || ""), sub_strand: String(week.sub_strand || ""),
          focal_area: String(week.focal_area || ""), topic: String(week.topic || ""),
          learning_focus: String(week.learning_focus || ""),
          content_standard: String(week.content_standard || ""),
          learning_indicators: Array.isArray(week.learning_indicators) ? week.learning_indicators.map(String) : [],
          activities: String(week.activities || ""), year_group: year
        })) : Array.from({ length: 13 }, (_, index) => ({ term: "", week: index + 1, topic: "", learning_focus: "", year_group: year }));
        availableSources.add(resourceWeeks.length ? "verified curriculum resources"
          : suppliedWeeks.length ? "saved schemes" : "editable weeks");
        const group = document.createElement("details");
        group.className = "assessment-week-year";
        group.open = true;
        const summary = document.createElement("summary");
        summary.textContent = `${year.replace("SHS", "SHS Year ")} · ${weeks.length} weeks`;
        const list = document.createElement("div");
        list.className = "assessment-week-year-list";
        weeks.forEach((week, index) => {
          const key = week.weekly_lesson_id
            ? `${normalizeCatalogSubject(subject)}:lesson:${week.weekly_lesson_id}`
            : `${normalizeCatalogSubject(subject)}:${scheme?.id || "manual"}:${week.term}:${week.week}:${index}`;
          const selected = selectedWeeksByYear.get(year)?.get(key) || week;
          const label = document.createElement("div");
          label.className = "assessment-week-option";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.name = "selectedAssessmentWeek";
          checkbox.id = `assessment-week-${year}-${scheme?.id || "manual"}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "-");
          checkbox.dataset.weekKey = key;
          checkbox.checked = selectedWeeksByYear.get(year)?.has(key) || false;
          const serialized = { ...selected, year_group: year };
          checkbox.dataset.weekSection = JSON.stringify(serialized);
          const copy = document.createElement("span");
          copy.id = `${checkbox.id}-label`;
          checkbox.setAttribute("aria-labelledby", copy.id);
          const heading = document.createElement("strong");
          heading.textContent = `${week.term ? `${week.term} · ` : ""}Week ${week.week || index + 1}`;
          copy.append(heading);
          const detail = [
            week.topic,
            week.strand && `Strand: ${week.strand}`,
            week.sub_strand && `Sub-strand: ${week.sub_strand}`,
            week.content_standard && `Content standard: ${week.content_standard}`,
            Array.isArray(week.focal_areas) && week.focal_areas.length ? `Focal areas: ${week.focal_areas.join("; ")}` : week.focal_area && `Focal area: ${week.focal_area}`,
            ...(Array.isArray(week.learning_indicators) ? week.learning_indicators : []).map((item) => `Learning indicator: ${item}`),
            ...(Array.isArray(week.learning_outcomes) ? week.learning_outcomes : []).map((item) => `Learning outcome: ${item}`),
            week.learning_focus && `Teacher focus: ${week.learning_focus}`,
            week.source_title
          ].filter(Boolean).join(" · ");
          const text = document.createElement("small");
          text.textContent = detail || "No saved weekly content; use the focus field to tell the AI what was taught.";
          copy.append(text);
          const focus = document.createElement("input");
          focus.type = "text";
          focus.className = "assessment-week-focus";
          focus.placeholder = "Optional: taught content / focus for this week";
          focus.value = selected.learning_focus || "";
          focus.setAttribute("aria-label", `Learning focus for ${year} week ${week.week || index + 1}`);
          checkbox.addEventListener("change", () => {
            const selectedWeeks = selectedWeeksByYear.get(year) || new Map();
            if (checkbox.checked) selectedWeeks.set(key, JSON.parse(checkbox.dataset.weekSection));
            else selectedWeeks.delete(key);
            selectedWeeksByYear.set(year, selectedWeeks);
            const count = Array.from(weeklySections.querySelectorAll('input[name="selectedAssessmentWeek"]:checked')).length;
            weeklyStatus.textContent = count ? `${count} weekly section${count === 1 ? "" : "s"} selected.` : "No weekly sections selected. Select taught weeks to guide the assessment.";
          });
          focus.addEventListener("input", () => {
            const section = JSON.parse(checkbox.dataset.weekSection || "{}");
            section.learning_focus = focus.value.trim();
            checkbox.dataset.weekSection = JSON.stringify(section);
            if (checkbox.checked) selectedWeeksByYear.get(year)?.set(key, section);
          });
          label.append(checkbox, copy, focus);
          list.append(label);
          total++;
        });
        group.append(summary, list);
        weeklySections.append(group);
      });
      const selectedCount = weeklySections.querySelectorAll('input[name="selectedAssessmentWeek"]:checked').length;
      weeklyStatus.textContent = `${selectedCount ? `${selectedCount} selected. ` : ""}${total} weekly sections available from ${Array.from(availableSources).join(", ")}.`;
    };
    const catalogOutlineRows = (yearEntries) => {
      const rows = [];
      const add = (label, value) => { if (String(value || "").trim()) rows.push(`<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></li>`); };
      (Array.isArray(yearEntries) ? yearEntries : []).forEach((strand) => {
        add("Strand", [strand.strand_code, strand.strand].filter(Boolean).join(". "));
        (strand.sub_strands || []).forEach((subStrand) => {
          add("Sub-strand", [subStrand.code, subStrand.name].filter(Boolean).join(". "));
          (subStrand.focal_areas || []).forEach((focal) => {
            add("Focal area", focal.name);
            (focal.content_standards || []).forEach((standard) => {
              add("Content standard", [standard.code, standard.description].filter(Boolean).join(". "));
              (standard.learning_indicators || []).forEach((indicator) => add("Learning indicator", typeof indicator === "string" ? indicator : [indicator.code, indicator.description].filter(Boolean).join(". ")));
            });
          });
          (subStrand.content_standards || []).forEach((standard) => {
            add("Content standard", [standard.code, standard.description].filter(Boolean).join(". "));
            (standard.learning_indicators || []).forEach((indicator) => add("Learning indicator", typeof indicator === "string" ? indicator : [indicator.code, indicator.description].filter(Boolean).join(". ")));
          });
        });
      });
      return rows;
    };
    const updateCatalogPreview = async (subjectName, yearGroups) => {
      if (!catalogPreview) return;
      if (!subjectName || !yearGroups.length) {
        catalogPreview.hidden = true;
        catalogPreview.replaceChildren();
        return;
      }
      try {
        if (!curriculumCatalogPromise) {
          curriculumCatalogPromise = fetch(`${appBase}/assets/data/nacca-shs-curriculum.json?v=2`, { credentials: "same-origin", headers: { Accept: "application/json" } })
            .then((response) => { if (!response.ok) throw new Error("Curriculum catalog unavailable"); return response.json(); });
        }
        const catalog = await curriculumCatalogPromise;
        const key = normalizeCatalogSubject(subjectName);
        const subjectRecord = (catalog.subjects || []).find((item) => [item.name, ...(item.aliases || [])].some((name) => normalizeCatalogSubject(name) === key));
        const rows = yearGroups.flatMap((year) => catalogOutlineRows(subjectRecord?.years?.[year] || []));
        const selectedCount = topicList.querySelectorAll('input[name="selectedTopic"]:checked').length;
        if (selectedCount) {
          catalogPreview.hidden = true;
          catalogPreview.replaceChildren();
          return;
        }
        const partial = subjectRecord?.curriculum_status === "partially_imported";
        catalogPreview.innerHTML = `<h3>${rows.length ? "NaCCA curriculum structure from the local catalog" : "NaCCA structure not imported for this subject yet"}</h3><p>${rows.length ? `These strands and sub-strands are transcribed from the linked official curriculum.${partial ? " Lower hierarchy levels may still need import; missing items are not guessed." : ""}` : "No stored strand hierarchy is available for this subject and SHS year yet. No fallback items will be guessed."} ${subjectRecord?.source_url ? `<a href="${escapeHtml(subjectRecord.source_url)}" target="_blank" rel="noopener noreferrer">Open official source</a>` : ""}</p>${rows.length ? `<ul>${rows.join("")}</ul>` : ""}`;
        catalogPreview.hidden = false;
      } catch (error) {
        catalogPreview.innerHTML = '<h3>NaCCA curriculum catalog unavailable</h3><p>Could not load the local subject structure. Ask an administrator to check the catalog file.</p>';
        catalogPreview.hidden = false;
      }
    };
    const classesContainer = document.getElementById("assessment-classes");
    const combinationSummary = document.getElementById("assessment-combination-summary");
    const classForm = document.getElementById("assessment-class-form");
    const classRosterInput = document.getElementById("assessment-class-roster-input");
    const classRosterSearch = document.getElementById("assessment-class-roster-search");
    const classRosterMatches = document.getElementById("assessment-class-roster-matches");
    const classLibrary = document.getElementById("assessment-class-library");
    const classStatus = document.getElementById("assessment-class-status");
    const classDialog = document.getElementById("assessment-class-dialog");
    const subjectPicker = document.getElementById("assessment-class-subject-list");
    const subjectSearch = document.getElementById("assessment-class-subject-search");
    const subjectSummary = document.getElementById("assessment-class-subject-summary");
    const classSearch = document.getElementById("assessment-class-search");
    const classSubjectFilter = document.getElementById("assessment-class-filter-subject");
    const classYearFilter = document.getElementById("assessment-class-filter-year");
    const classStatusFilter = document.getElementById("assessment-class-filter-status");
    const classSelectionSearch = document.getElementById("assessment-class-selection-search");
    const learnerPerformanceDialog = document.getElementById("assessment-learner-performance-dialog");
    const learnerPerformanceSelect = document.getElementById("assessment-learner-performance-select");
    const learnerPerformanceOptions = document.getElementById("assessment-learner-performance-options");
    const learnerPerformanceStatus = document.getElementById("assessment-learner-performance-status");
    const learnerPerformanceReport = document.getElementById("assessment-learner-performance-report");
    const learnerPerformanceClass = document.getElementById("assessment-learner-performance-class");
    const learnerPerformanceStudentPdf = document.getElementById("assessment-performance-export-student-pdf");
    const learnerPerformanceStudentDocx = document.getElementById("assessment-performance-export-student-docx");
    const learnerPerformanceClassPdf = document.getElementById("assessment-performance-export-class-pdf");
    const learnerPerformanceClassDocx = document.getElementById("assessment-performance-export-class-docx");
    let learnerPerformanceStudents = [];
    let currentLearnerPerformance = null;
    let learnerPerformanceExporting = false;
    let assessmentSubjectOptions = [];
    let assessmentSubjectGroups = {};
    const selectedClassSubjects = new Set();
    const updateSubjectSummary = () => {
      subjectSummary.textContent = selectedClassSubjects.size
        ? `${selectedClassSubjects.size} subject${selectedClassSubjects.size === 1 ? "" : "s"} selected`
        : "Choose one or more subjects from the school subject list.";
    };
    const renderClassSubjectOptions = () => {
      subjectPicker.replaceChildren();
      const query = subjectSearch.value.trim().toLocaleLowerCase();
      const categoryLabels = {
        core_and_general: "Core and general",
        science_and_stem: "Science and STEM",
        business_and_humanities: "Business and humanities",
        creative_and_applied: "Creative and applied",
        ghanaian_languages: "Ghanaian languages"
      };
      let renderedSubjects = 0;
      Object.entries(assessmentSubjectGroups).forEach(([category, subjects]) => {
        const matches = subjects.filter((subject) => !query || subject.toLocaleLowerCase().includes(query));
        if (!matches.length) return;
        const group = document.createElement("section");
        group.className = "assessment-subject-group";
        const heading = document.createElement("h4");
        heading.textContent = categoryLabels[category] || category.replaceAll("_", " ");
        const options = document.createElement("div");
        options.className = "assessment-subject-options";
        matches.forEach((subject) => {
          options.append(makeSubjectCheckbox(subject));
          renderedSubjects += 1;
        });
        group.append(heading, options);
        subjectPicker.append(group);
      });
      const extraSubjects = [...selectedClassSubjects].filter((subject) => !assessmentSubjectOptions.includes(subject));
      const extraMatches = extraSubjects.filter((subject) => !query || subject.toLocaleLowerCase().includes(query));
      if (extraMatches.length) {
        const group = document.createElement("section");
        group.className = "assessment-subject-group";
        const heading = document.createElement("h4");
        heading.textContent = "Other saved subjects";
        const options = document.createElement("div");
        options.className = "assessment-subject-options";
        extraMatches.forEach((subject) => {
          options.append(makeSubjectCheckbox(subject));
          renderedSubjects += 1;
        });
        group.append(heading, options);
        subjectPicker.append(group);
      }
      if (!renderedSubjects) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "No subjects match your search.";
        subjectPicker.append(empty);
      }
      updateSubjectSummary();
    };
    const makeSubjectCheckbox = (subject) => {
      const label = document.createElement("label");
      label.className = "assessment-subject-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = subject;
      checkbox.dataset.assessmentClassSubject = "";
      checkbox.checked = selectedClassSubjects.has(subject);
      const name = document.createElement("span");
      name.textContent = subject;
      label.append(checkbox, name);
      return label;
    };
    const loadAssessmentSubjectOptions = async () => {
      const response = await fetch(`${appBase}/assets/data/ghana-shs-subjects.json`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("The subject catalog could not be loaded. Refresh and try again.");
      const groups = await response.json();
      if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
        throw new Error("The subject catalog is invalid. Ask an administrator to check the SHS subject list.");
      }
      assessmentSubjectGroups = Object.fromEntries(Object.entries(groups).map(([name, subjects]) => {
        if (!Array.isArray(subjects) || subjects.some((subject) => typeof subject !== "string")) {
          throw new Error("The subject catalog contains an invalid subject group.");
        }
        return [name, subjects];
      }));
      assessmentSubjectOptions = [...new Set(Object.values(assessmentSubjectGroups).flat())].sort((a, b) => a.localeCompare(b));
      updateClassSubjectFilters();
      renderClassSubjectOptions();
    };
    const classRows = () => teacherAssessmentClasses.filter((item) => selectedAssessmentClassIds.has(Number(item.id)));
    const classSubjects = (item) => item.subjects || [item.subject_name].filter(Boolean);
    const renderClassRosterMatches = () => {
      const query = classRosterSearch.value.trim().toLocaleLowerCase();
      classRosterMatches.replaceChildren();
      if (!query) {
        classRosterMatches.hidden = true;
        return;
      }
      const rosterLines = classRosterInput.value.split(/\r?\n/);
      const matches = rosterLines
        .map((name, index) => ({ name: name.trim(), index }))
        .filter((student) => student.name && student.name.toLocaleLowerCase().includes(query));
      if (!matches.length) {
        const empty = document.createElement("p");
        empty.className = "assessment-class-roster-empty";
        empty.textContent = "No roster names match your search.";
        classRosterMatches.append(empty);
      } else {
        matches.forEach((student) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "assessment-class-roster-match";
          button.textContent = student.name;
          button.addEventListener("click", () => {
            const start = rosterLines.slice(0, student.index).reduce((total, line) => total + line.length + 1, 0);
            classRosterInput.focus();
            classRosterInput.setSelectionRange(start, start + rosterLines[student.index].length);
          });
          classRosterMatches.append(button);
        });
      }
      classRosterMatches.hidden = false;
    };
    classRosterSearch.addEventListener("input", renderClassRosterMatches);
    classRosterInput.addEventListener("input", renderClassRosterMatches);
    const selectedValues = (name) => Array.from(assessmentSelections[name]);
    const comboCount = () => {
      const selections = ["year", "assessmentType", "questionFormat", "duration"].map(selectedValues);
      if (selections.some((values) => values.length === 0)) return 0;
      return selections.slice(1).reduce((total, values) => total * values.length, 1);
    };
    const updateCombinationSummary = () => {
      const count = comboCount();
      combinationSummary.textContent = count
        ? `${count} assessment draft${count === 1 ? "" : "s"} will be generated for ${classRows().length} selected class${classRows().length === 1 ? "" : "es"}. Selected years and classes share each draft; one question format is used at a time.`
        : "Select at least one SHS year, assessment type, question format and duration.";
    };
    const renderClassSelections = () => {
      classesContainer.replaceChildren();
      if (!teacherAssessmentClasses.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "Create a class and add its students in Class management before generating an online assessment.";
        classesContainer.append(empty);
        updateCombinationSummary();
        return;
      }
      const query = classSelectionSearch.value.trim().toLocaleLowerCase();
      const subject = document.querySelector('#assessment-form [name="subject"]').value.trim().toLocaleLowerCase();
      const years = selectedValues("year");
      const matchingClasses = teacherAssessmentClasses.filter((item) => !item.archived_at).filter((item) =>
        subject
        && years.includes(item.year_group)
        && classSubjects(item).some((name) => name.trim().toLocaleLowerCase() === subject)
      );
      const matchingIds = new Set(matchingClasses.map((item) => Number(item.id)));
      Array.from(selectedAssessmentClassIds).forEach((id) => {
        if (!matchingIds.has(id)) selectedAssessmentClassIds.delete(id);
      });
      const visibleClasses = matchingClasses.filter((item) =>
        !query || [item.name, String(item.learner_count || ""), ...classSubjects(item), ...(item.students || []).map((student) => student.learner_name)]
          .some((value) => String(value).toLocaleLowerCase().includes(query))
      );
      if (!visibleClasses.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = !subject
          ? "Choose an assessment subject to see classes that teach it."
          : !years.length
            ? "Select at least one SHS year to see matching classes."
            : matchingClasses.length
              ? "No matching classes contain that search. Try another search."
              : `No active classes match ${subjectField.value.trim()} in ${years.map((year) => year.replace("SHS", "SHS Year ")).join(", ")}. Update a class subject/year or change the assessment selections.`;
        classesContainer.append(empty);
      }
      visibleClasses.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "assessment-class-badge-option";
        button.dataset.assessmentClassId = String(item.id);
        button.setAttribute("aria-pressed", String(selectedAssessmentClassIds.has(Number(item.id))));
        button.title = Number(item.learner_count) > 0
          ? `${item.name}: ${classSubjects(item).join(", ")} · ${item.year_group}`
          : `${item.name}: add at least one student to its roster before using it for an online assessment.`;
        const name = document.createElement("strong");
        name.textContent = item.name;
        const meta = document.createElement("small");
        meta.textContent = `${item.year_group.replace("SHS", "Year ")} · ${item.learner_count} student${item.learner_count === 1 ? "" : "s"}`;
        button.append(name, meta);
        classesContainer.append(button);
      });
      updateCombinationSummary();
    };
    const updateClassSubjectFilters = () => {
      const currentValue = classSubjectFilter.value;
      const subjects = [...new Set([...assessmentSubjectOptions, ...teacherAssessmentClasses.flatMap(classSubjects)])].sort((a, b) => a.localeCompare(b));
      classSubjectFilter.replaceChildren(new Option("All subjects", ""), ...subjects.map((value) => new Option(value, value)));
      classSubjectFilter.value = subjects.includes(currentValue) ? currentValue : "";
    };
    const renderManagedClasses = () => {
      classLibrary.replaceChildren();
      const query = classSearch.value.trim().toLocaleLowerCase();
      const subject = classSubjectFilter.value.toLocaleLowerCase();
      const year = classYearFilter.value;
      const status = classStatusFilter.value;
      const filteredClasses = teacherAssessmentClasses.filter((item) =>
        (status === "all" || (status === "archived" ? Boolean(item.archived_at) : !item.archived_at))
        &&
        (!query || [item.name, String(item.learner_count || ""), ...classSubjects(item), ...(item.students || []).map((student) => student.learner_name)]
          .some((value) => String(value).toLocaleLowerCase().includes(query)))
        && (!subject || classSubjects(item).some((value) => value.toLocaleLowerCase() === subject))
        && (!year || item.year_group === year)
      );
      if (!teacherAssessmentClasses.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "No saved classes yet. Create your first class above.";
        classLibrary.append(empty);
        return;
      }
      if (!filteredClasses.length) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "No classes match those filters. Adjust the search or filters to see more.";
        classLibrary.append(empty);
        return;
      }
      filteredClasses.forEach((item) => {
        const card = document.createElement("article");
        card.className = "assessment-managed-class";
        const details = document.createElement("div");
        details.className = "assessment-managed-class-details";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const subjects = document.createElement("small");
        subjects.className = "assessment-managed-class-subjects";
        subjects.textContent = classSubjects(item).join(", ");
        const metadata = document.createElement("div");
        metadata.className = "assessment-managed-class-metadata";
        const makeMetadataBadge = (iconClass, text, label) => {
          const badge = document.createElement("span");
          badge.className = "assessment-managed-class-meta-badge";
          badge.setAttribute("aria-label", label);
          const icon = document.createElement("i");
          icon.className = `fa-solid ${iconClass}`;
          icon.setAttribute("aria-hidden", "true");
          const value = document.createElement("span");
          value.textContent = text;
          badge.append(icon, value);
          return badge;
        };
        const year = item.year_group.replace("SHS", "SHS Year ");
        const studentCount = Number(item.learner_count || 0);
        metadata.append(
          makeMetadataBadge("fa-graduation-cap", year, year),
          makeMetadataBadge("fa-users", `${studentCount} student${studentCount === 1 ? "" : "s"}`, `${studentCount} students`)
        );
        details.append(name, metadata, subjects);
        const actions = document.createElement("div");
        const makeClassAction = (iconClass, label, dataset, value) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "assessment-class-action-badge";
          button.setAttribute("aria-label", label);
          button.title = label;
          button.dataset[dataset] = String(value);
          const icon = document.createElement("i");
          icon.className = `fa-solid ${iconClass}`;
          icon.setAttribute("aria-hidden", "true");
          button.append(icon);
          return button;
        };
        const makeClassReportExport = (format, label) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "small-button assessment-class-report-export";
          button.textContent = label;
          button.dataset.exportClassReport = String(item.id);
          button.dataset.format = format;
          button.disabled = studentCount === 0;
          button.title = studentCount ? `Export ${item.name} student reports as ${format.toUpperCase()}` : "This class has no students to export";
          return button;
        };
        const reportActions = document.createElement("div");
        reportActions.className = "assessment-class-report-actions";
        reportActions.append(makeClassReportExport("pdf", "Bulk PDF"), makeClassReportExport("docx", "Bulk Word"));
        details.append(reportActions);
        actions.append(makeClassAction("fa-eye", `View ${item.name} student results`, "performanceClass", item.id));
        if (item.archived_at) {
          actions.append(makeClassAction("fa-plus", `Restore ${item.name}`, "restoreClass", item.id));
        } else {
          actions.append(
            makeClassAction("fa-pencil", `Edit ${item.name}`, "editClass", item.id),
            makeClassAction("fa-trash-can", `Delete or archive ${item.name}`, "deleteClass", item.id)
          );
        }
        if (item.archived_at) {
          const archived = document.createElement("small");
          archived.className = "assessment-class-archived-badge";
          archived.textContent = "Archived · history preserved";
          details.append(archived);
        }
        card.append(details, actions);
        classLibrary.append(card);
      });
    };
    const loadManagedClasses = async () => {
      const result = await workspaceRequest("/api/teacher/assessment-classes");
      teacherAssessmentClasses = result.classes;
      managedClassesLoaded = true;
      managedClassesLoadError = "";
      updateClassOptions();
      const existingIds = new Set(teacherAssessmentClasses.map((item) => Number(item.id)));
      Array.from(selectedAssessmentClassIds).forEach((id) => {
        if (!existingIds.has(id)) selectedAssessmentClassIds.delete(id);
      });
      updateClassSubjectFilters();
      renderManagedClasses();
      renderClassSelections();
      if (!assessmentPublishClasses.querySelector('input[name="publishClassIds"]')) {
        renderAssessmentPublishClasses(true);
        syncAssessmentPublishVariant();
      }
    };
    classForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!classForm.reportValidity()) return;
      const subjects = Array.from(selectedClassSubjects);
      if (!subjects.length) {
        classStatus.textContent = "Select at least one subject for this class.";
        subjectSearch.focus();
        return;
      }
      const students = lines(classForm.elements.namedItem("students").value);
      if (students.length > 300) {
        showToast("Add no more than 300 students to a class.", "error");
        return;
      }
      const submit = classForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const id = Number(classForm.elements.namedItem("id").value) || null;
        const result = await workspaceRequest("/api/teacher/assessment-classes", "POST", {
          ...(id ? { id } : {}),
          name: classForm.elements.namedItem("name").value.trim(),
          subjects,
          year_group: classForm.elements.namedItem("year_group").value,
          students
        });
        const codeMessage = result.new_access_codes?.length
          ? ` Save complete. New individual codes for active assessments: ${result.new_access_codes.map((item) => `${item.class_name} · ${item.learner_name}: ${item.access_code}`).join(" | ")}. Distribute codes privately.`
          : " Class and roster saved.";
        classStatus.textContent = codeMessage;
        classForm.reset();
        selectedClassSubjects.clear();
        subjectSearch.value = "";
        renderClassSubjectOptions();
        submit.textContent = "Save class and roster";
        await loadManagedClasses();
        showToast("Class and student roster saved.");
        if (!result.new_access_codes?.length) classDialog.close();
      } catch (error) {
        classStatus.textContent = error instanceof Error ? error.message : "The class could not be saved.";
        showToast(classStatus.textContent, "error");
      } finally {
        submit.disabled = false;
      }
    });
    document.getElementById("assessment-class-form-reset").addEventListener("click", () => {
      classForm.reset();
      classRosterSearch.value = "";
      renderClassRosterMatches();
      selectedClassSubjects.clear();
      subjectSearch.value = "";
      renderClassSubjectOptions();
      document.getElementById("assessment-class-dialog-title").textContent = "Create a class";
      classForm.querySelector('[type="submit"]').textContent = "Save class and roster";
      classStatus.textContent = "Your classes are private to your account.";
      classDialog.showModal();
      classForm.elements.namedItem("name").focus();
    });
    subjectPicker.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-assessment-class-subject]");
      if (!checkbox) return;
      if (checkbox.checked) selectedClassSubjects.add(checkbox.value);
      else selectedClassSubjects.delete(checkbox.value);
      updateSubjectSummary();
    });
    subjectSearch.addEventListener("input", renderClassSubjectOptions);
    document.querySelectorAll("[data-close-assessment-class]").forEach((button) => {
      button.addEventListener("click", () => classDialog.close());
    });
    classDialog.addEventListener("click", (event) => {
      if (event.target === classDialog) classDialog.close();
    });
    [classSearch, classSubjectFilter, classYearFilter, classStatusFilter].forEach((field) => {
      field.addEventListener(field === classSearch ? "input" : "change", renderManagedClasses);
    });
    classSelectionSearch.addEventListener("input", renderClassSelections);
    classLibrary.addEventListener("click", async (event) => {
      const reportExportButton = event.target.closest("[data-export-class-report]");
      if (reportExportButton) {
        await exportClassLearnerReports(
          reportExportButton.dataset.format,
          reportExportButton.dataset.exportClassReport,
          reportExportButton
        );
        return;
      }
      const performanceButton = event.target.closest("[data-performance-class]");
      if (performanceButton) {
        const item = teacherAssessmentClasses.find((candidate) => Number(candidate.id) === Number(performanceButton.dataset.performanceClass));
        if (!item) return;
        learnerPerformanceSelect.dataset.classId = String(item.id);
        learnerPerformanceSelect.dataset.learnerId = "";
        learnerPerformanceSelect.value = "";
        learnerPerformanceSelect.setAttribute("aria-expanded", "false");
        learnerPerformanceOptions.hidden = true;
        learnerPerformanceStudents = item.students;
        currentLearnerPerformance = null;
        learnerPerformanceExporting = false;
        updateLearnerPerformanceExportButtons();
        learnerPerformanceClass.textContent = `${item.name} · ${item.year_group.replace("SHS", "SHS Year ")} · ${classSubjects(item).join(", ")}`;
        learnerPerformanceReport.replaceChildren();
        learnerPerformanceStatus.textContent = item.students.length
          ? "Search for a student by name, then choose them to view their assessment history."
          : "This class does not have any students in its roster yet.";
        learnerPerformanceDialog.showModal();
        learnerPerformanceSelect.focus();
        return;
      }
      const restore = event.target.closest("[data-restore-class]");
      if (restore) {
        restore.disabled = true;
        try {
          await workspaceRequest(`/api/teacher/assessment-classes/${restore.dataset.restoreClass}/restore`, "POST", {});
          await loadManagedClasses();
          showToast("Class restored. It is available for new assessments again.");
        } catch (error) {
          showToast(error instanceof Error ? error.message : "The class could not be restored.", "error");
          restore.disabled = false;
        }
        return;
      }
      const edit = event.target.closest("[data-edit-class]");
      if (edit) {
        const item = teacherAssessmentClasses.find((candidate) => Number(candidate.id) === Number(edit.dataset.editClass));
        if (!item) return;
        classForm.elements.namedItem("id").value = String(item.id);
        classForm.elements.namedItem("name").value = item.name;
        selectedClassSubjects.clear();
        classSubjects(item).forEach((subject) => selectedClassSubjects.add(subject));
        subjectSearch.value = "";
        renderClassSubjectOptions();
        classForm.elements.namedItem("year_group").value = item.year_group;
        classForm.elements.namedItem("students").value = item.students.map((student) => student.learner_name).join("\n");
        classRosterSearch.value = "";
        renderClassRosterMatches();
        document.getElementById("assessment-class-dialog-title").textContent = `Edit ${item.name}`;
        classForm.querySelector('[type="submit"]').textContent = "Update class and roster";
        classStatus.textContent = "Changes to this roster update its active assessments automatically.";
        classDialog.showModal();
        classForm.elements.namedItem("name").focus();
        return;
      }
      const remove = event.target.closest("[data-delete-class]");
      if (!remove) return;
      if (!(await window.akademiAlert.confirm("Delete this class? Classes linked to assessment history will be archived so results remain available.", { title: "Delete class", confirmText: "Delete or archive class" }))) return;
      remove.disabled = true;
      try {
        const deletion = await workspaceRequest(`/api/teacher/assessment-classes/${remove.dataset.deleteClass}`, "DELETE");
        if (deletion.deleted) selectedAssessmentClassIds.delete(Number(remove.dataset.deleteClass));
        await loadManagedClasses();
        showToast(deletion.archived
          ? "This class is archived because assessment history is linked to it. Its student results have been preserved."
          : "Class and roster deleted.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The class could not be deleted.", "error");
        remove.disabled = false;
      }
    });
    const renderLearnerPerformance = (result) => {
      const { learner, summary, assessments } = result;
      currentLearnerPerformance = result;
      updateLearnerPerformanceExportButtons();
      const typeLabels = { mcq: "Multiple choice", worked: "Worked / structured", extended: "Extended response", brief: "Brief response", other: "Other" };
      const percentage = (value) => value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
      const performanceTone = (value) => value === null || value === undefined
        ? "pending"
        : Number(value) >= 70 ? "good" : Number(value) >= 50 ? "partial" : "low";
      const analysisRows = Object.entries(summary.question_type_analysis || {}).map(([type, analysis]) =>
        `<li class="assessment-performance-type-${performanceTone(analysis.percentage)}"><span>${escapeHtml(typeLabels[type] || type)}</span><strong>${analysis.earned}/${analysis.possible} · ${percentage(analysis.percentage)}</strong></li>`
      ).join("");
      const assessmentCards = assessments.map((assessment) => {
        const scoreLabel = assessment.final_score === null
          ? `${assessment.auto_score} objective marks · written responses pending`
          : `${assessment.final_score}/${assessment.total_marks} · ${percentage(assessment.percentage)}`;
        const questions = assessment.questions.map((question) => {
          const options = question.options || [];
          const learnerAnswer = question.question_type === "mcq" && /^\d+$/.test(question.learner_answer)
            ? `${String.fromCharCode(65 + Number(question.learner_answer))}. ${options[Number(question.learner_answer)] || "Unavailable option"}`
            : question.learner_answer || "No response";
          const correctAnswer = question.question_type === "mcq" && question.correct_option >= 0
            ? `${String.fromCharCode(65 + question.correct_option)}. ${options[question.correct_option] || "Unavailable option"}`
            : question.expected_answer;
          const resultLabel = question.score === null
            ? "Awaiting teacher review"
            : question.question_type === "mcq"
              ? question.is_correct ? `Correct · ${question.score}/${question.marks}` : `Review this answer · ${question.score}/${question.marks}`
              : `${question.score}/${question.marks} marks`;
          const answerTone = question.is_correct === true
            ? "assessment-answer-correct"
            : question.is_correct === false || (question.score !== null && Number(question.score) === 0)
              ? "assessment-answer-wrong"
              : question.score === null ? "assessment-answer-pending"
                : Number(question.score) >= Number(question.marks) ? "assessment-answer-correct" : "assessment-performance-type-partial";
          return `<li><div class="assessment-student-question-heading"><strong>Question ${question.question_number} · ${escapeHtml(typeLabels[question.question_type] || question.question_type)}</strong><span class="${answerTone}">${escapeHtml(resultLabel)}</span></div><p>${escapeHtml(question.prompt)}</p><p class="${answerTone}"><strong>Your response:</strong> ${escapeHtml(learnerAnswer)}</p>${correctAnswer ? `<p class="assessment-answer-correct"><strong>Expected response:</strong> ${escapeHtml(correctAnswer)}</p>` : ""}${question.teacher_feedback ? `<p><strong>Teacher feedback:</strong> ${escapeHtml(question.teacher_feedback)}</p>` : ""}</li>`;
        }).join("");
        const typeRows = Object.entries(assessment.question_type_analysis || {}).map(([type, analysis]) =>
          `<li class="assessment-performance-type-${performanceTone(analysis.percentage)}"><span>${escapeHtml(typeLabels[type] || type)}</span><strong>${analysis.earned}/${analysis.possible} (${percentage(analysis.percentage)})</strong></li>`
        ).join("");
        return `<details class="assessment-student-result-card"><summary><span><strong>${escapeHtml(assessment.title)}</strong><small>${escapeHtml(assessment.subject)} · ${escapeHtml(assessment.submitted_at || "")}</small></span><strong>${escapeHtml(scoreLabel)}</strong></summary><div class="assessment-student-result-details"><p><strong>Assessment:</strong> ${escapeHtml(String(assessment.assessment_type || "").replaceAll("_", " "))} · ${escapeHtml(assessment.status)}</p>${assessment.review_pending ? "<p>Written answers are not fully included in the percentage until your teacher finishes marking.</p>" : ""}${typeRows ? `<h3>Performance by question type</h3><ul>${typeRows}</ul>` : ""}<ol class="assessment-student-question-list">${questions}</ol></div></details>`;
      }).join("");
      learnerPerformanceStatus.textContent = assessments.length
        ? `${learner.name} · ${learner.class_name} · ${summary.assessment_count} assessment attempt${summary.assessment_count === 1 ? "" : "s"}`
        : `${learner.name} has no submitted online assessments in this class yet.`;
      learnerPerformanceReport.innerHTML = assessments.length
        ? `<header class="assessment-performance-learner-heading"><div><h3>${escapeHtml(learner.name)}</h3><p>${escapeHtml(learner.class_name)}</p></div><strong>${percentage(summary.overall_percentage)}<small>overall finalized performance</small></strong></header><div class="assessment-performance-metrics"><article><strong>${summary.assessment_count}</strong><span>assessments taken</span></article><article><strong>${summary.finalized_count}</strong><span>fully marked</span></article><article><strong>${summary.earned_marks}/${summary.possible_marks}</strong><span>marks across released results</span></article><article><strong>${summary.pending_review_count}</strong><span>awaiting written review</span></article></div>${analysisRows ? `<section class="assessment-performance-analysis"><h3>Performance by question type</h3><p>Green: 70% or higher · Amber: 50–69% · Red: below 50%.</p>${summary.strongest_area ? `<p>Strongest area: <strong>${escapeHtml(typeLabels[summary.strongest_area] || summary.strongest_area)}</strong>. Focus for growth: <strong>${escapeHtml(typeLabels[summary.growth_area] || summary.growth_area)}</strong>.</p>` : ""}<ul>${analysisRows}</ul><p class="assessment-performance-answer-key"><span class="assessment-answer-correct">Correct / full marks</span><span class="assessment-answer-wrong">Incorrect / no marks</span><span class="assessment-answer-pending">Partial / pending</span></p></section>` : ""}<h3 class="assessment-performance-history-title">Assessment history</h3>${assessmentCards}`
        : "";
    };
    const loadLearnerPerformance = async () => {
      const rosterId = learnerPerformanceSelect.dataset.learnerId || "";
      learnerPerformanceReport.replaceChildren();
      currentLearnerPerformance = null;
      updateLearnerPerformanceExportButtons();
      if (!rosterId) {
        learnerPerformanceStatus.textContent = "Choose a student to view their assessment history.";
        return;
      }
      const classId = learnerPerformanceSelect.dataset.classId;
      learnerPerformanceSelect.disabled = true;
      learnerPerformanceStatus.textContent = "Loading assessment history…";
      try {
        const result = await workspaceRequest(`/api/teacher/assessment-classes/${classId}/learners/${rosterId}/performance`);
        renderLearnerPerformance(result);
      } catch (error) {
        learnerPerformanceStatus.textContent = error instanceof Error ? error.message : "The student performance report could not be loaded.";
      } finally {
        learnerPerformanceSelect.disabled = false;
      }
    };
    const updateLearnerPerformanceExportButtons = () => {
      const hasLearnerReport = currentLearnerPerformance !== null;
      [learnerPerformanceStudentPdf, learnerPerformanceStudentDocx].forEach((button) => {
        button.disabled = learnerPerformanceExporting || !hasLearnerReport;
      });
      [learnerPerformanceClassPdf, learnerPerformanceClassDocx].forEach((button) => {
        button.disabled = learnerPerformanceExporting || learnerPerformanceStudents.length === 0;
      });
      classLibrary.querySelectorAll(".assessment-class-report-export").forEach((button) => {
        button.disabled = learnerPerformanceExporting || Number(teacherAssessmentClasses.find(
          (item) => Number(item.id) === Number(button.dataset.exportClassReport)
        )?.learner_count || 0) === 0;
      });
    };
    const learnerReportExportPayload = (reports, title, includeQuestionDetails) => {
      const blocks = [];
      const lines = [];
      const addText = (text, style, color, bold = false) => {
        const formatting = { ...(style ? { style } : {}), ...(color ? { color } : {}), ...(bold ? { bold } : {}) };
        blocks.push({ text, ...formatting });
        lines.push({ text, ...formatting });
      };
      const addTable = (rows, rowKinds) => {
        blocks.push({ type: "table", rows, ...(rowKinds ? { rowKinds } : {}) });
        rows.forEach((row) => lines.push({ text: row.map((cell) => String(cell ?? "")).join(" | ") }));
      };
      const performanceTone = (value) => value === null || value === undefined
        ? "pending"
        : Number(value) >= 70 ? "good" : Number(value) >= 50 ? "partial" : "low";
      const displayPercentage = (value) => value === null || value === undefined ? "Not available" : `${Number(value).toFixed(1)}%`;
      const ordinalPosition = (rank, total) => rank && total ? `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[rank % 10] || "th")} of ${total}` : "Not ranked";
      const displayScore = (assessment) => assessment.final_score === null
        ? assessment.review_pending ? `${assessment.auto_score} objective marks; written responses pending` : "Not finalized"
        : `${assessment.final_score}/${assessment.total_marks} (${displayPercentage(assessment.percentage)})`;
      const typeLabels = { mcq: "Multiple choice", worked: "Worked / structured", extended: "Extended response", brief: "Brief response", other: "Other" };

      reports.forEach(({ learner, summary, assessments }, reportIndex) => {
        const ranking = reports[reportIndex].reportCardRanking || {};
        if (reportIndex > 0) {
          blocks.push({ type: "page-break" });
          lines.push({ text: "" });
        }
        addText("STUDENT ASSESSMENT REPORT", "Title");
        addText(`Student: ${learner.name}  |  Class: ${learner.class_name}`, "Heading1");
        addText(`Prepared by: ${profile.name || "Teacher / administrator"}${profile.school ? `  |  ${profile.school}` : ""}`);
        const administratorContacts = [workspaceUserEmail, profile.phone, [profile.region, profile.district].filter(Boolean).join(" · ")].filter(Boolean);
        if (administratorContacts.length) addText(administratorContacts.join("  |  "));
        addText("Overall performance", "Heading1");
        addTable([
          ["OVERALL", "ASSESSMENT GPA", "CLASS POSITION", "MANAGED-CLASS POSITION"],
          [
            displayPercentage(summary.overall_percentage),
            ranking.gpa === null || ranking.gpa === undefined ? "—" : `${Number(ranking.gpa).toFixed(1)} / 4.0`,
            ordinalPosition(ranking.classRank, ranking.classSize),
            ordinalPosition(ranking.overallRank, ranking.overallSize)
          ]
        ]);
        addTable([
          ["ASSESSMENTS", "FULLY MARKED", "AWAITING REVIEW", "MARKS"],
          [
            String(summary.assessment_count),
            String(summary.finalized_count),
            String(summary.pending_review_count),
            `${summary.earned_marks}/${summary.possible_marks}`
          ]
        ]);
        addText("GPA bands: 80–100 = 4.0, 75–79 = 3.5, 70–74 = 3.0, 65–69 = 2.5, 60–64 = 2.0, 50–59 = 1.5, 45–49 = 1.0, 40–44 = 0.5, below 40 = 0.0.", null, "65736A");
        addText("Positions include only students with finalized aggregate results; ties share a rank.", null, "65736A");
        if (Object.keys(summary.question_type_analysis || {}).length) {
          addText("Performance by question type", "Heading1");
          addText("Color key: green = strong (70%+), amber = developing (50-69%), red = needs attention (below 50%).", null, "65736A");
          const typeAnalysis = Object.entries(summary.question_type_analysis);
          addTable([
            ["Question type", "Marks", "Performance"],
            ...typeAnalysis.map(([type, analysis]) => [
              typeLabels[type] || type,
              `${analysis.earned}/${analysis.possible}`,
              displayPercentage(analysis.percentage)
            ])
          ], [null, ...typeAnalysis.map(([, analysis]) => `report_${performanceTone(analysis.percentage)}`)]);
        }
        if (summary.strongest_area) {
          addText(`Learning analysis: strongest area - ${typeLabels[summary.strongest_area] || summary.strongest_area}; focus for growth - ${typeLabels[summary.growth_area] || summary.growth_area}.`);
        }
        if (assessments.length) {
          addText("Assessment history", "Heading1");
          addTable([
            ["Assessment and subject", "Score", "Status and submitted"],
            ...assessments.map((assessment) => [
              `${assessment.title}\n${assessment.subject}`,
              displayScore(assessment),
              `${String(assessment.status || "").replaceAll("_", " ")}\n${assessment.submitted_at || "Not recorded"}`
            ])
          ]);
        } else {
          addText("No online assessment attempts have been recorded for this student.");
        }
        if (includeQuestionDetails) {
          addText("Answer color key: green = correct/full marks, red = incorrect/no marks, amber = partial or awaiting review.", null, "65736A");
          assessments.forEach((assessment) => {
            addText(`${assessment.title} · ${assessment.subject} · ${displayScore(assessment)}`, "Heading1");
            assessment.questions.forEach((question) => {
              const label = typeLabels[question.question_type] || question.question_type;
              const answerTone = question.is_correct === true ? "15803D"
                : question.is_correct === false || (question.score !== null && Number(question.score) === 0) ? "B42318"
                  : question.score === null ? "8A5A00"
                    : Number(question.score) >= Number(question.marks) ? "15803D" : "8A5A00";
              addText(`Question ${question.question_number} · ${label} · ${question.score === null ? "Awaiting review" : `${question.score}/${question.marks} marks`}`, "Heading2", answerTone, true);
              addText(question.prompt || "Question text unavailable.");
              let learnerAnswer = question.learner_answer || "No response";
              if (question.question_type === "mcq" && /^\d+$/.test(learnerAnswer)) {
                const answerIndex = Number(learnerAnswer);
                learnerAnswer = `${String.fromCharCode(65 + answerIndex)}. ${question.options?.[answerIndex] || "Unavailable option"}`;
              }
              addText(`Student response: ${learnerAnswer}`, null, answerTone, true);
              if (question.expected_answer) addText(`Expected response: ${question.expected_answer}`, null, "15803D");
              if (question.teacher_feedback) addText(`Teacher feedback: ${question.teacher_feedback}`);
            });
          });
        }
        addText("TEACHER VERIFICATION", "Heading1");
        addTable([
          ["Class teacher signature", "Headteacher signature", "Date"],
          ["____________________", "____________________", new Date().toLocaleDateString()]
        ]);
      });
      return {
        title,
        blocks,
        lines,
        reportCard: true,
        includeQuestionDetails,
        reportCards: reports,
        administrator: assessmentAdministratorDetails()
      };
    };
    const rankLearnerPerformanceReports = (reports) => {
      const eligible = reports.filter((report) => Number.isFinite(Number(report.summary?.overall_percentage))
        && report.summary?.overall_percentage !== null);
      const assignRanks = (cohort) => {
        const ordered = [...cohort].sort((left, right) =>
          Number(right.summary.overall_percentage) - Number(left.summary.overall_percentage)
          || left.learner.name.localeCompare(right.learner.name)
        );
        const positions = new Map();
        let previousPercentage = null;
        let previousRank = 0;
        ordered.forEach((report, index) => {
          const currentPercentage = Number(report.summary.overall_percentage);
          const rank = currentPercentage === previousPercentage ? previousRank : index + 1;
          positions.set(report, { rank, size: ordered.length });
          previousPercentage = currentPercentage;
          previousRank = rank;
        });
        return positions;
      };
      const overallPositions = assignRanks(eligible);
      const classGroups = new Map();
      eligible.forEach((report) => {
        const classId = String(report.learner.class_id);
        if (!classGroups.has(classId)) classGroups.set(classId, []);
        classGroups.get(classId).push(report);
      });
      const classPositions = new Map();
      classGroups.forEach((cohort) => assignRanks(cohort).forEach((position, report) => classPositions.set(report, position)));
      reports.forEach((report) => {
        const percentage = report.summary?.overall_percentage;
        const score = percentage === null || percentage === undefined ? null : Number(percentage);
        const gradePoints = score === null || !Number.isFinite(score) ? null
          : score >= 80 ? 4
            : score >= 75 ? 3.5
              : score >= 70 ? 3
                : score >= 65 ? 2.5
                  : score >= 60 ? 2
                    : score >= 50 ? 1.5
                      : score >= 45 ? 1
                        : score >= 40 ? 0.5 : 0;
        const classPosition = classPositions.get(report);
        const overallPosition = overallPositions.get(report);
        report.reportCardRanking = {
          gpa: gradePoints,
          grade: null,
          classRank: classPosition?.rank ?? null,
          classSize: classPosition?.size ?? 0,
          overallRank: overallPosition?.rank ?? null,
          overallSize: overallPosition?.size ?? 0
        };
      });
      return reports;
    };
    const fetchReportsForAllManagedClasses = async (seedReports = []) => {
      const reportsByRoster = new Map(seedReports.map((report) => [
        `${report.learner.class_id}:${report.learner.id}`,
        report
      ]));
      const roster = teacherAssessmentClasses.flatMap((classItem) =>
        (classItem.students || []).map((student) => ({
          classId: Number(classItem.id),
          rosterId: Number(student.id),
          learnerName: student.learner_name,
          key: `${classItem.id}:${student.id}`
        }))
      ).filter((student) => !reportsByRoster.has(student.key));
      const batchSize = 4;
      let loaded = seedReports.length;
      for (let start = 0; start < roster.length; start += batchSize) {
        const batch = roster.slice(start, start + batchSize);
        const batchReports = await Promise.all(batch.map(async (student) => {
          try {
            return await workspaceRequest(`/api/teacher/assessment-classes/${student.classId}/learners/${student.rosterId}/performance`);
          } catch (error) {
            const reason = error instanceof Error ? error.message : "report could not be loaded";
            throw new Error(`${student.learnerName}: ${reason}`);
          }
        }));
        batchReports.forEach((report) => reportsByRoster.set(`${report.learner.class_id}:${report.learner.id}`, report));
        loaded += batchReports.length;
        const total = loaded + roster.length - (start + batch.length);
        learnerPerformanceStatus.textContent = `Calculating class positions… ${loaded} of ${total} student reports loaded.`;
      }
      return rankLearnerPerformanceReports(Array.from(reportsByRoster.values()));
    };
    const setLearnerPerformanceExporting = (exporting) => {
      learnerPerformanceExporting = exporting;
      updateLearnerPerformanceExportButtons();
      if (exporting) learnerPerformanceStatus.setAttribute("aria-busy", "true");
      else learnerPerformanceStatus.removeAttribute("aria-busy");
    };
    const exportSelectedLearnerReport = async (format) => {
      if (!currentLearnerPerformance) return;
      setLearnerPerformanceExporting(true);
      try {
        if (!window.akademiAssessmentExport) throw new Error("The assessment export tools are unavailable. Refresh and try again.");
        const { learner } = currentLearnerPerformance;
        const reports = await fetchReportsForAllManagedClasses([currentLearnerPerformance]);
        const report = reports.find((item) => Number(item.learner.class_id) === Number(learner.class_id)
          && Number(item.learner.id) === Number(learner.id));
        if (!report) throw new Error("The selected student's report could not be included in the class ranking.");
        const payload = learnerReportExportPayload([report], `${learner.name} - Assessment Report`, true);
        await window.akademiAssessmentExport.downloadWithLogo(payload, format);
        showToast(`${format.toUpperCase()} student report started.`);
      } catch (error) {
        learnerPerformanceStatus.textContent = error instanceof Error ? error.message : "The student report could not be exported.";
        showToast(learnerPerformanceStatus.textContent, "error");
      } finally {
        setLearnerPerformanceExporting(false);
      }
    };
    const exportClassLearnerReports = async (format, selectedClassId = learnerPerformanceSelect.dataset.classId, exportButton = null) => {
      if (learnerPerformanceExporting || !selectedClassId) return;
      const classId = String(selectedClassId);
      const classItem = teacherAssessmentClasses.find((item) => Number(item.id) === Number(classId));
      const students = classItem?.students || [];
      if (!students.length) return;
      setLearnerPerformanceExporting(true);
      if (exportButton) exportButton.disabled = true;
      learnerPerformanceStatus.textContent = `Preparing class report for ${students.length} students…`;
      try {
        if (!window.akademiAssessmentExport) throw new Error("The assessment export tools are unavailable. Refresh and try again.");
        const reports = [];
        const batchSize = 4;
        for (let start = 0; start < students.length; start += batchSize) {
          const batch = students.slice(start, start + batchSize);
          const batchReports = await Promise.all(batch.map(async (student) => {
            try {
              const result = await workspaceRequest(`/api/teacher/assessment-classes/${classId}/learners/${student.id}/performance`);
              return result;
            } catch (error) {
              const reason = error instanceof Error ? error.message : "report could not be loaded";
              throw new Error(`${student.learner_name}: ${reason}`);
            }
          }));
          reports.push(...batchReports);
          learnerPerformanceStatus.textContent = `Preparing class report… ${reports.length} of ${students.length} students loaded.`;
        }
        const rankedReports = await fetchReportsForAllManagedClasses(reports);
        const classReports = rankedReports.filter((report) => Number(report.learner.class_id) === Number(classId));
        if (classReports.length !== students.length) {
          throw new Error("Some class reports could not be included in the rankings. No report was exported.");
        }
        const className = classReports[0]?.learner?.class_name || "Class";
        const payload = learnerReportExportPayload(classReports, `${className} - Assessment Reports`);
        await window.akademiAssessmentExport.downloadWithLogo(payload, format);
        learnerPerformanceStatus.textContent = `Class report prepared for ${reports.length} students.`;
        showToast(`${format.toUpperCase()} class report started.`);
      } catch (error) {
        learnerPerformanceStatus.textContent = error instanceof Error ? error.message : "The class report could not be exported.";
        showToast(learnerPerformanceStatus.textContent, "error");
      } finally {
        setLearnerPerformanceExporting(false);
        if (exportButton) exportButton.disabled = false;
      }
    };
    learnerPerformanceStudentPdf.addEventListener("click", () => void exportSelectedLearnerReport("pdf"));
    learnerPerformanceStudentDocx.addEventListener("click", () => void exportSelectedLearnerReport("docx"));
    learnerPerformanceClassPdf.addEventListener("click", () => void exportClassLearnerReports("pdf"));
    learnerPerformanceClassDocx.addEventListener("click", () => void exportClassLearnerReports("docx"));
    const renderLearnerPerformanceOptions = () => {
      const query = learnerPerformanceSelect.value.trim().toLocaleLowerCase();
      const matches = learnerPerformanceStudents.filter((student) =>
        student.learner_name.toLocaleLowerCase().includes(query)
      );
      learnerPerformanceOptions.replaceChildren();
      matches.forEach((student) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "assessment-performance-student-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.learnerId = String(student.id);
        option.textContent = student.learner_name;
        learnerPerformanceOptions.append(option);
      });
      learnerPerformanceOptions.hidden = matches.length === 0;
      learnerPerformanceSelect.setAttribute("aria-expanded", String(matches.length > 0));
      if (query && !matches.length) learnerPerformanceStatus.textContent = "No students match that name. Try another search.";
      else if (!learnerPerformanceSelect.dataset.learnerId && learnerPerformanceStudents.length) {
        learnerPerformanceStatus.textContent = query
          ? `${matches.length} student${matches.length === 1 ? "" : "s"} found. Choose a name to view their assessment history.`
          : "Choose a student to view their assessment history.";
      }
    };
    learnerPerformanceSelect.addEventListener("focus", renderLearnerPerformanceOptions);
    learnerPerformanceSelect.addEventListener("input", () => {
      learnerPerformanceSelect.dataset.learnerId = "";
      learnerPerformanceReport.replaceChildren();
      renderLearnerPerformanceOptions();
    });
    learnerPerformanceSelect.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        learnerPerformanceOptions.hidden = true;
        learnerPerformanceSelect.setAttribute("aria-expanded", "false");
      } else if (event.key === "ArrowDown" && !learnerPerformanceOptions.hidden) {
        learnerPerformanceOptions.querySelector("button")?.focus();
        event.preventDefault();
      } else if (event.key === "Enter" && !learnerPerformanceOptions.hidden) {
        learnerPerformanceOptions.querySelector("button")?.click();
        event.preventDefault();
      }
    });
    learnerPerformanceOptions.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-learner-id]")) event.preventDefault();
    });
    learnerPerformanceOptions.addEventListener("click", (event) => {
      const option = event.target.closest("[data-learner-id]");
      if (!option) return;
      const student = learnerPerformanceStudents.find((item) => String(item.id) === option.dataset.learnerId);
      if (!student) return;
      learnerPerformanceSelect.value = student.learner_name;
      learnerPerformanceSelect.dataset.learnerId = String(student.id);
      learnerPerformanceOptions.hidden = true;
      learnerPerformanceSelect.setAttribute("aria-expanded", "false");
      void loadLearnerPerformance();
    });
    learnerPerformanceOptions.addEventListener("keydown", (event) => {
      const options = Array.from(learnerPerformanceOptions.querySelectorAll("[role='option']"));
      const index = options.indexOf(event.target);
      if (event.key === "ArrowDown" && index < options.length - 1) {
        options[index + 1].focus();
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        if (index > 0) options[index - 1].focus();
        else learnerPerformanceSelect.focus();
        event.preventDefault();
      } else if (event.key === "Enter") {
        event.target.click();
        event.preventDefault();
      } else if (event.key === "Escape") {
        learnerPerformanceOptions.hidden = true;
        learnerPerformanceSelect.setAttribute("aria-expanded", "false");
        learnerPerformanceSelect.focus();
      }
    });
    document.querySelectorAll("[data-close-learner-performance]").forEach((button) => {
      button.addEventListener("click", () => learnerPerformanceDialog.close());
    });
    learnerPerformanceDialog.addEventListener("click", (event) => {
      if (event.target === learnerPerformanceDialog) learnerPerformanceDialog.close();
    });
    classesContainer.addEventListener("click", (event) => {
      const button = event.target.closest("[data-assessment-class-id]");
      if (!button || button.disabled) return;
      const id = Number(button.dataset.assessmentClassId);
      if (selectedAssessmentClassIds.has(id)) selectedAssessmentClassIds.delete(id);
      else selectedAssessmentClassIds.add(id);
      renderClassSelections();
      updateCombinationSummary();
    });
    document.getElementById("assessment-manage-classes").addEventListener("click", () => {
      planningDialogs.assessment?.close();
      document.getElementById("assessment-tab-classes").click();
      document.getElementById("assessment-panel-classes").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    void loadManagedClasses().catch((error) => {
      managedClassesLoaded = true;
      managedClassesLoadError = error instanceof Error ? error.message : "Saved classes could not be loaded.";
      classLibrary.textContent = managedClassesLoadError;
      updateClassOptions();
    });
    void loadAssessmentSubjectOptions().catch((error) => {
      classStatus.textContent = error instanceof Error ? error.message : "The subject list could not be loaded.";
      subjectPicker.textContent = classStatus.textContent;
      document.getElementById("assessment-class-form-reset").disabled = true;
      classForm.querySelector('[type="submit"]').disabled = true;
    });
    const syncBadgeButtons = (groupName) => {
      form.querySelectorAll(`[data-assessment-options="${groupName}"] [data-assessment-value]`).forEach((button) => {
        button.setAttribute("aria-pressed", String(assessmentSelections[groupName].has(button.dataset.assessmentValue)));
      });
    };
    const updateOtherFormat = () => {
      const otherField = document.getElementById("other-format-field");
      const otherFormat = form.elements.namedItem("otherFormat");
      const requiresOther = assessmentSelections.questionFormat.has("other");
      otherField.hidden = !requiresOther;
      otherFormat.required = requiresOther;
    };
    const validateSelections = () => {
      if (["year", "assessmentType", "questionFormat", "duration"].some((name) => assessmentSelections[name].size === 0)) {
        showToast("Select at least one badge for SHS year, assessment type, question format and duration.", "error");
        return false;
      }
      if (assessmentSelections.questionFormat.size !== 1) {
        showToast("Select exactly one question format.", "error");
        return false;
      }
      if (assessmentSelections.questionFormat.has("other") && !form.elements.namedItem("otherFormat").value.trim()) {
        form.elements.namedItem("otherFormat").reportValidity();
        return false;
      }
      if (deliveryField.value === "online") {
        const selectedClasses = classRows();
        if (!selectedClasses.length) {
          showToast("Select at least one saved class for an online assessment.", "error");
          return false;
        }
        if (selectedClasses.length > 30) {
          showToast("Select no more than 30 saved classes for one assessment.", "error");
          return false;
        }
        const studentCount = selectedClasses.reduce((total, item) => total + Number(item.learner_count || 0), 0);
        if (studentCount > 300) {
          showToast("The selected classes contain more than 300 students. Choose fewer classes or reduce their rosters.", "error");
          return false;
        }
        const selectedYears = selectedValues("year");
        const subject = subjectField.value.trim().toLocaleLowerCase();
        const incompatibleClass = selectedClasses.find((item) =>
          !(item.subjects || [item.subject_name]).some((name) => name.trim().toLocaleLowerCase() === subject)
          || !selectedYears.includes(item.year_group)
          || Number(item.learner_count) < 1
        );
        if (incompatibleClass) {
          const subjectMatches = (incompatibleClass.subjects || [incompatibleClass.subject_name])
            .some((name) => name.trim().toLocaleLowerCase() === subject);
          if (!subjectMatches) {
            showToast(`${incompatibleClass.name} does not have ${subjectField.value.trim() || "the chosen subject"} assigned. Choose one of its subjects or update the class in Class management.`, "error");
          } else if (!selectedYears.includes(incompatibleClass.year_group)) {
            showToast(`Select SHS Year ${incompatibleClass.year_group.slice(-1)} for ${incompatibleClass.name}, or remove that class from this assessment.`, "error");
          } else {
            showToast(`Add at least one student to ${incompatibleClass.name} in Class management before generating its online assessment.`, "error");
          }
          return false;
        }
      }
      if (weeklyStatus.hasAttribute("aria-busy")) {
        showToast("Wait for the weekly curriculum to finish loading before generating the assessment.", "error");
        return false;
      }
      const selectedWeeks = Array.from(weeklySections.querySelectorAll('input[name="selectedAssessmentWeek"]:checked'), (checkbox) =>
        JSON.parse(checkbox.dataset.weekSection || "{}")
      );
      const selectedTopics = topicList?.querySelectorAll('input[name="selectedTopic"]:checked').length ?? 0;
      if (selectedTopics > 30) {
        showToast("Select no more than 30 curriculum topics across the chosen SHS years.", "error");
        return false;
      }
      if (!selectedWeeks.length) {
        showToast("Select at least one teaching week to set the assessment scope.", "error");
        return false;
      }
      const yearsWithoutWeeks = selectedValues("year").filter((year) =>
        !selectedWeeks.some((week) => week.year_group === year)
      );
      if (yearsWithoutWeeks.length) {
        showToast(`Select at least one teaching week for each selected year: ${yearsWithoutWeeks.join(", ")}.`, "error");
        return false;
      }
      if (comboCount() > 30) {
        showToast("Choose fewer options. A single run can create at most 30 assessment combinations.", "error");
        return false;
      }
      return true;
    };
    validateAssessmentSelections = validateSelections;
    refreshAssessmentCombinationSummary = updateCombinationSummary;
    form.addEventListener("click", (event) => {
      const choiceBadge = event.target.closest("[data-assessment-choice] [data-choice-value]");
      if (choiceBadge) {
        const group = choiceBadge.closest("[data-assessment-choice]");
        const field = form.elements.namedItem(group.dataset.assessmentChoice);
        field.value = choiceBadge.dataset.choiceValue;
        group.querySelectorAll("[data-choice-value]").forEach((button) => {
          button.setAttribute("aria-pressed", String(button === choiceBadge));
        });
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const badge = event.target.closest("[data-assessment-options] [data-assessment-value]");
      if (!badge) return;
      const groupName = badge.closest("[data-assessment-options]").dataset.assessmentOptions;
      const selected = assessmentSelections[groupName];
      if (groupName === "duration") {
        selected.clear();
        selected.add(badge.dataset.assessmentValue);
      } else if (groupName === "questionFormat") {
        selected.clear();
        selected.add(badge.dataset.assessmentValue);
      } else if (selected.has(badge.dataset.assessmentValue)) selected.delete(badge.dataset.assessmentValue);
      else selected.add(badge.dataset.assessmentValue);
      syncBadgeButtons(groupName);
      if (groupName === "duration") updateTimeShare();
      if (groupName === "year") {
        updateClassSuggestions();
        renderWeeklySections();
        renderClassSelections();
      }
      if (groupName === "questionFormat") updateOtherFormat();
      updateCombinationSummary();
    });
    document.getElementById("assessment-add-duration").addEventListener("click", () => {
      const input = document.getElementById("assessment-custom-duration");
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 10 || value > 300) {
        input.setCustomValidity("Enter a whole number from 10 to 300 minutes.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      const group = form.querySelector('[data-assessment-options="duration"]');
      let badge = Array.from(group.querySelectorAll("[data-assessment-value]"))
        .find((button) => Number(button.dataset.assessmentValue) === value);
      if (!badge) {
        badge = document.createElement("button");
        badge.type = "button";
        badge.className = "assessment-badge";
        badge.dataset.assessmentValue = String(value);
        badge.textContent = `${value} min`;
        badge.setAttribute("aria-pressed", "false");
        group.append(badge);
      }
      assessmentSelections.duration.clear();
      assessmentSelections.duration.add(String(value));
      syncBadgeButtons("duration");
      input.value = "";
      updateCombinationSummary();
      updateTimeShare();
    });
    document.getElementById("assessment-custom-duration").addEventListener("input", (event) => {
      event.currentTarget.setCustomValidity("");
    });
    const classSuggestions = document.createElement("datalist");
    classSuggestions.id = "assessment-class-suggestions";
    classesContainer.before(classSuggestions);
    const learnerDialog = document.getElementById("assessment-learner-dialog");
    const learnerForm = document.getElementById("assessment-learner-form");
    let activeRosterCard = null;
    let editingLearnerIndex = -1;
    const rosterNames = (card) => card.querySelector('[name="assessmentClassRoster"]').value
      .split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    const renderRosterPanel = (card) => {
      const list = card.querySelector("[data-class-roster-list]");
      const count = card.querySelector("[data-class-roster-count]");
      const names = rosterNames(card);
      count.textContent = `${names.length} learner${names.length === 1 ? "" : "s"}`;
      const useButton = card.querySelector("[data-class-use-toggle]");
      const included = card.querySelector("[data-class-selection]").getAttribute("aria-pressed") === "true";
      useButton.textContent = included ? "Included in assessment" : "Include in assessment";
      useButton.setAttribute("aria-pressed", String(included));
      list.replaceChildren();
      if (!names.length) {
        const empty = document.createElement("p");
        empty.className = "assessment-roster-empty";
        empty.textContent = "No learners added to this class yet.";
        list.append(empty);
        return;
      }
      names.forEach((name, index) => {
        const row = document.createElement("div");
        row.className = "assessment-roster-row";
        const label = document.createElement("span");
        label.textContent = name;
        const actions = document.createElement("div");
        actions.className = "assessment-roster-row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "small-button";
        edit.dataset.editLearner = String(index);
        edit.textContent = "Edit";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "small-button";
        remove.dataset.removeLearner = String(index);
        remove.textContent = "Remove";
        actions.append(edit, remove);
        row.append(label, actions);
        list.append(row);
      });
    };
    const openLearnerDialog = (card, index = -1) => {
      activeRosterCard = card;
      editingLearnerIndex = index;
      const input = learnerForm.elements.namedItem("learnerName");
      input.value = index >= 0 ? rosterNames(card)[index] || "" : "";
      document.getElementById("assessment-learner-dialog-title").textContent = index >= 0 ? "Edit learner" : "Add learner";
      learnerForm.querySelector('[type="submit"]').textContent = index >= 0 ? "Save changes" : "Add learner";
      learnerDialog.showModal();
      input.focus();
    };
    const makeClassCard = (className = "", roster = "") => {
      const card = document.createElement("div");
      card.className = "assessment-class-card";
      const heading = document.createElement("div");
      heading.className = "assessment-class-card-heading";
      const title = document.createElement("strong");
      title.textContent = "Class";
      const selection = document.createElement("button");
      selection.type = "button";
      selection.className = "assessment-badge assessment-class-badge";
      selection.dataset.classSelection = "";
      selection.setAttribute("aria-pressed", String(Boolean(className)));
      selection.textContent = className || "Enter class name";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small-button";
      remove.dataset.removeAssessmentClass = "";
      remove.textContent = "Remove";
      heading.append(title, selection, remove);
      const nameLabel = document.createElement("label");
      nameLabel.className = "field";
      const nameCaption = document.createElement("span");
      nameCaption.textContent = "Class / group name";
      const nameInput = document.createElement("input");
      nameInput.name = "assessmentClassName";
      nameInput.maxLength = 160;
      nameInput.placeholder = "e.g. 2B";
      nameInput.setAttribute("list", classSuggestions.id);
      nameInput.value = className;
      nameInput.addEventListener("input", () => {
        const value = nameInput.value.trim();
        selection.textContent = value || "Enter class name";
        selection.setAttribute("aria-pressed", String(Boolean(value)));
        updateCombinationSummary();
      });
      nameLabel.append(nameCaption, nameInput);
      const rosterLabel = document.createElement("label");
      rosterLabel.className = "field";
      const rosterCaption = document.createElement("span");
      rosterCaption.textContent = "Learner roster · one name per line (optional)";
      const rosterInput = document.createElement("textarea");
      rosterInput.name = "assessmentClassRoster";
      rosterInput.rows = 3;
      rosterInput.maxLength = 50000;
      rosterInput.value = roster;
      rosterInput.setAttribute("aria-hidden", "true");
      rosterInput.tabIndex = -1;
      rosterLabel.className = "assessment-roster-storage";
      rosterLabel.append(rosterInput);
      const rosterPanel = document.createElement("section");
      rosterPanel.className = "assessment-class-roster-panel";
      rosterPanel.hidden = true;
      rosterPanel.setAttribute("aria-label", "Class learner roster");
      const rosterHeading = document.createElement("div");
      rosterHeading.className = "assessment-roster-heading";
      const rosterTitle = document.createElement("strong");
      rosterTitle.textContent = "Class roster";
      const rosterCount = document.createElement("span");
      rosterCount.dataset.classRosterCount = "";
      rosterHeading.append(rosterTitle, rosterCount);
      const useClass = document.createElement("button");
      useClass.type = "button";
      useClass.className = "small-button assessment-class-use-toggle";
      useClass.dataset.classUseToggle = "";
      rosterHeading.append(useClass);
      const rosterList = document.createElement("div");
      rosterList.className = "assessment-roster-list";
      rosterList.dataset.classRosterList = "";
      const addLearner = document.createElement("button");
      addLearner.type = "button";
      addLearner.className = "small-button assessment-add-learner";
      addLearner.dataset.addLearner = "";
      addLearner.innerHTML = '<svg class="icon" aria-hidden="true"><use href="assets/icons.svg#fa-plus"></use></svg> Add learner';
      rosterPanel.append(rosterHeading, rosterList, addLearner);
      card.append(heading, nameLabel, rosterLabel, rosterPanel);
      renderRosterPanel(card);
      return card;
    };
    const addClassCard = () => {
      classesContainer.append(makeClassCard());
      classesContainer.lastElementChild.querySelector('[name="assessmentClassName"]').focus();
      updateCombinationSummary();
    };
    classesContainer.addEventListener("click", (event) => {
      const selection = event.target.closest("[data-class-selection]");
      if (selection) {
        const card = selection.closest(".assessment-class-card");
        if (!card.querySelector('[name="assessmentClassName"]').value.trim()) {
          card.querySelector('[name="assessmentClassName"]').focus();
          showToast("Enter a class or group name before selecting it.", "error");
          return;
        }
        selection.setAttribute("aria-pressed", "true");
        document.querySelectorAll(".assessment-class-roster-panel").forEach((panel) => {
          panel.hidden = panel !== card.querySelector(".assessment-class-roster-panel");
        });
        renderRosterPanel(card);
        updateCombinationSummary();
        return;
      }
      const useClass = event.target.closest("[data-class-use-toggle]");
      if (useClass) {
        const card = useClass.closest(".assessment-class-card");
        const selection = card.querySelector("[data-class-selection]");
        selection.setAttribute("aria-pressed", String(selection.getAttribute("aria-pressed") !== "true"));
        renderRosterPanel(card);
        updateCombinationSummary();
        return;
      }
      const addLearner = event.target.closest("[data-add-learner]");
      if (addLearner) {
        openLearnerDialog(addLearner.closest(".assessment-class-card"));
        return;
      }
      const editLearner = event.target.closest("[data-edit-learner]");
      if (editLearner) {
        openLearnerDialog(editLearner.closest(".assessment-class-card"), Number(editLearner.dataset.editLearner));
        return;
      }
      const removeLearner = event.target.closest("[data-remove-learner]");
      if (removeLearner) {
        const card = removeLearner.closest(".assessment-class-card");
        const names = rosterNames(card);
        names.splice(Number(removeLearner.dataset.removeLearner), 1);
        card.querySelector('[name="assessmentClassRoster"]').value = names.join("\n");
        renderRosterPanel(card);
        return;
      }
      const remove = event.target.closest("[data-remove-assessment-class]");
      if (!remove) return;
      if (classesContainer.children.length === 1) {
        const card = remove.closest(".assessment-class-card");
        card.querySelector('[name="assessmentClassName"]').value = "";
        card.querySelector('[name="assessmentClassRoster"]').value = "";
        const badge = card.querySelector("[data-class-selection]");
        badge.textContent = "Enter class name";
        badge.setAttribute("aria-pressed", "false");
        card.querySelector(".assessment-class-roster-panel").hidden = true;
        renderRosterPanel(card);
        updateCombinationSummary();
        return;
      }
      remove.closest(".assessment-class-card").remove();
      updateCombinationSummary();
    });
    document.getElementById("assessment-learner-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!activeRosterCard) return;
      const input = learnerForm.elements.namedItem("learnerName");
      const value = input.value.trim();
      const names = rosterNames(activeRosterCard);
      const duplicate = names.some((name, index) => index !== editingLearnerIndex && name.toLocaleLowerCase() === value.toLocaleLowerCase());
      if (!value || duplicate) {
        input.setCustomValidity(!value ? "Enter a learner name." : "This learner is already in the roster.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      if (editingLearnerIndex >= 0) names[editingLearnerIndex] = value;
      else names.push(value);
      activeRosterCard.querySelector('[name="assessmentClassRoster"]').value = names.join("\n");
      renderRosterPanel(activeRosterCard);
      learnerDialog.close();
      activeRosterCard = null;
    });
    learnerForm.elements.namedItem("learnerName").addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
    learnerDialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-learner-dialog]")) learnerDialog.close();
    });
    const updateClassSuggestions = () => {
      const years = selectedValues("year").map((year) => year.replace("SHS", ""));
      classSuggestions.replaceChildren(...years.flatMap((year) =>
        Array.from("ABCDEFG", (letter) => new Option(`${year}${letter}`, `${year}${letter}`))
      ));
    };
    updateClassSuggestions();
    renderClassSelections();
    updateCombinationSummary();
    const validateQuestionCount = () => {
      const count = Number(questionCountField.value);
      const marks = Number(totalMarksField.value);
      questionCountField.setCustomValidity(
        count > marks
          ? "The total marks must be at least the number of questions because each question needs at least one mark."
          : ""
      );
    };
    questionCountField.addEventListener("input", validateQuestionCount);
    totalMarksField.addEventListener("input", validateQuestionCount);
    validateQuestionCount();
    questionCountField.addEventListener("input", updateTimeShare);
    updateTimeShare();
    const syncDeliveryMode = () => {
      staticDraftButton.hidden = deliveryField.value === "online";
      onlineSecurityPanel.hidden = deliveryField.value !== "online";
    };
    deliveryField.addEventListener("change", syncDeliveryMode);
    syncDeliveryMode();

    function updateSelectedSummary() {
      const selected = Array.from(topicList.querySelectorAll('input[name="selectedTopic"]:checked'));
      selectedSummary.textContent = selected.length
        ? `${selected.length} curriculum entr${selected.length === 1 ? "y" : "ies"} selected: ${selected.map((checkbox) => checkbox.dataset.title).join("; ")}`
        : "No curriculum entries selected.";
      if (catalogPreview) {
        if (selected.length) catalogPreview.hidden = true;
        else updateCatalogPreview(subjectField.value.trim(), selectedValues("year"));
      }
    }
    topicList?.addEventListener("change", (event) => {
      const checkbox = event.target.closest('input[name="selectedTopic"]');
      if (checkbox) {
        const selectedForYear = selectedAssessmentTopicsByYear.get(checkbox.dataset.yearGroup) || new Set();
        if (checkbox.checked) selectedForYear.add(checkbox.value);
        else selectedForYear.delete(checkbox.value);
        selectedAssessmentTopicsByYear.set(checkbox.dataset.yearGroup, selectedForYear);
      }
      updateSelectedSummary();
    });

    async function loadTopics() {
      const subject = subjectField.value.trim();
      const yearGroups = selectedValues("year");
      if (!yearGroups.length || subject.length < 2) {
        topicStatus.textContent = "Choose at least one SHS year and a subject to browse verified curriculum content.";
        topicList.replaceChildren();
        updateCatalogPreview("", []);
        updateSelectedSummary();
        return;
      }
      requestController?.abort();
      requestController = new AbortController();
      const controller = requestController;
      loadButton.disabled = true;
      topicStatus.textContent = `Finding reviewed topics for ${subject} · ${yearGroups.map((year) => year.replace("SHS", "SHS Year ")).join(", ")}…`;
      topicList.replaceChildren();
      try {
        const results = await Promise.all(yearGroups.map(async (yearGroup) => {
          const cacheKey = `${yearGroup}:${subject.toLocaleLowerCase()}`;
          let cached = assessmentTopicCache.get(cacheKey);
          if (!cached) {
            const query = new URLSearchParams({ year_group: yearGroup, subject, offset: "0" });
            const response = await fetch(`${appBase}/api/curriculum/structure?${query}`, {
              credentials: "same-origin",
              headers: { Accept: "application/json" },
              signal: controller.signal
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Topics for ${yearGroup} could not be loaded.`);
            cached = {
              sections: (result.sections || []).filter((section) =>
                section.year_group === yearGroup && Object.hasOwn(typeLabels, section.section_type)
              ),
              nextOffset: result.next_offset ?? null
            };
            assessmentTopicCache.set(cacheKey, cached);
          }
          return { yearGroup, cacheKey, cached };
        }));
        if (controller.signal.aborted) return;
        let availableTotal = 0;
        for (const { yearGroup, cacheKey, cached } of results) {
          const group = document.createElement("details");
          group.className = "assessment-topic-year";
          group.open = true;
          const summary = document.createElement("summary");
          const list = document.createElement("div");
          list.className = "assessment-topic-year-list";
          const selectedForYear = selectedAssessmentTopicsByYear.get(yearGroup) || new Set();
          const appendEntries = (entries) => entries.forEach((section) => {
            const label = document.createElement("label");
            label.className = "assessment-topic-option";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "selectedTopic";
            checkbox.value = String(section.id);
            checkbox.dataset.yearGroup = yearGroup;
            checkbox.dataset.title = `${section.title} (${yearGroup.replace("SHS", "Year ")})`;
            checkbox.checked = selectedForYear.has(checkbox.value);
            const text = document.createElement("span");
            const prefix = document.createElement("small");
            prefix.textContent = typeLabels[section.section_type];
            const title = document.createElement("strong");
            title.textContent = section.title;
            text.append(prefix, title);
            if (section.parent_title) {
              const parent = document.createElement("small");
              parent.textContent = `Under ${section.parent_title}`;
              text.append(parent);
            }
            const source = document.createElement("small");
            source.textContent = `${section.document_title || "Verified resource"}${section.page_number ? ` · page ${section.page_number}` : ""}`;
            text.append(source);
            label.append(checkbox, text);
            list.append(label);
          });
          appendEntries(cached.sections);
          summary.textContent = `${yearGroup.replace("SHS", "SHS Year ")} · ${cached.sections.length} verified entries`;
          group.append(summary, list);
          if (cached.nextOffset !== null) {
            const moreButton = document.createElement("button");
            moreButton.type = "button";
            moreButton.className = "small-button assessment-topic-load-more";
            moreButton.textContent = "Load more entries";
            moreButton.addEventListener("click", async () => {
              moreButton.disabled = true;
              moreButton.textContent = "Loading…";
              try {
                const query = new URLSearchParams({ year_group: yearGroup, subject, offset: String(cached.nextOffset) });
                const response = await fetch(`${appBase}/api/curriculum/structure?${query}`, {
                  credentials: "same-origin",
                  headers: { Accept: "application/json" },
                  signal: controller.signal
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `More topics for ${yearGroup} could not be loaded.`);
                const nextEntries = (result.sections || []).filter((section) =>
                  section.year_group === yearGroup && Object.hasOwn(typeLabels, section.section_type)
                );
                appendEntries(nextEntries);
                cached.sections.push(...nextEntries);
                cached.nextOffset = result.next_offset ?? null;
                summary.textContent = `${yearGroup.replace("SHS", "SHS Year ")} · ${cached.sections.length} verified entries`;
                moreButton.hidden = cached.nextOffset === null;
                moreButton.textContent = "Load more entries";
                topicStatus.textContent = `Verified curriculum entries loaded for ${subject}.`;
                updateSelectedSummary();
              } catch (error) {
                if (controller.signal.aborted) return;
                topicStatus.textContent = error instanceof Error ? error.message : `More topics for ${yearGroup} could not be loaded.`;
                moreButton.textContent = "Retry loading entries";
              } finally {
                moreButton.disabled = false;
              }
            });
            group.append(moreButton);
          }
          availableTotal += cached.sections.length;
          topicList.append(group);
        }
        topicStatus.textContent = availableTotal
          ? `${availableTotal} verified curriculum entries loaded across ${yearGroups.map((year) => year.replace("SHS", "SHS Year ")).join(", ")}. Scroll the assessment window to review the full list.`
          : `No verified extracted curriculum content was found for ${subject} in the selected years. Check the resource year and verification status, or enter additional scope manually.`;
        await updateCatalogPreview(subject, yearGroups);
        updateSelectedSummary();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        topicStatus.textContent = error instanceof Error ? error.message : "Curriculum topics could not be loaded.";
      } finally {
        if (requestController === controller) loadButton.disabled = false;
      }
    }

    let weeklyInputTimer = 0;
    subjectField.addEventListener("input", () => {
      renderClassSelections();
      window.clearTimeout(weeklyInputTimer);
      weeklyInputTimer = window.setTimeout(renderWeeklySections, 250);
    });
    subjectField.addEventListener("change", () => {
      renderClassSelections();
      window.clearTimeout(weeklyInputTimer);
      renderWeeklySections();
    });
    refreshAssessmentWeeklySections = () => {
      void renderWeeklySections();
    };
    renderWeeklySections();

    const saveDraftButton = document.getElementById("assessment-save-draft");
    const draftClassRows = () => classRows().map((item) => ({ id: Number(item.id), selected: true }));
    saveDraftButton.addEventListener("click", async () => {
      const state = {
        fields: formData(form),
        selections: Object.fromEntries(Object.entries(assessmentSelections).map(([name, values]) => [name, Array.from(values)])),
        classes: draftClassRows(),
        selected_week_sections: Array.from(weeklySections.querySelectorAll('input[name="selectedAssessmentWeek"]:checked'), (checkbox) => ({
          selection_key: checkbox.dataset.weekKey,
          ...JSON.parse(checkbox.dataset.weekSection || "{}")
        })),
        step: currentAssessmentStep
      };
      const title = String(state.fields.title || "").trim() || "Untitled assessment draft";
      const subject = String(state.fields.subject || "").trim();
      const yearSummary = Object.values(state.selections.year || {}).join(", ") || "Year not selected";
      const html = `<article class="output-card"><div class="output-heading"><div><h2>Assessment builder draft</h2><p>Saved progress · continue in the Assessment Builder</p></div></div><div class="output-body"><div class="document-title-block"><div class="eyebrow">ASSESSMENT DRAFT</div><h2>${escapeHtml(title)}</h2></div><div class="document-section"><p><strong>Subject:</strong> ${escapeHtml(subject || "Not set")}</p><p><strong>SHS year:</strong> ${escapeHtml(yearSummary)}</p><p><strong>Saved step:</strong> ${state.step + 1} of 3</p><p>Use Continue in the saved assessment drafts list to resume this assessment.</p></div></div></article>`;
      const data = { assessment_builder_draft: true, assessment_builder_state: state, subject, year_group: yearSummary };
      saveDraftButton.disabled = true;
      saveDraftButton.textContent = "Saving draft…";
      showToast("Saving assessment draft to your account…", "info");
      try {
        let saved;
        const payload = { type: "assessment", title, data, html };
        if (activeAssessmentDraftId) {
          const result = await workspaceRequest(`/api/workspace/documents/${encodeURIComponent(activeAssessmentDraftId)}`, "PUT", payload);
          saved = result.document;
          documents = documents.map((doc) => doc.id === saved.id ? saved : doc);
          renderAll();
        } else {
          saved = await saveDocument("assessment", title, data, html);
          activeAssessmentDraftId = saved.id;
        }
        saveDraftButton.innerHTML = `${iconMarkup("file-lines")} Update saved draft`;
        showToast("Assessment draft saved to your account. You can continue it later from the assessment library.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Assessment draft could not be saved.", "error");
      } finally {
        saveDraftButton.disabled = false;
      }
    });
    continueAssessmentDraft = async (savedDocument) => {
      const state = savedDocument.data?.assessment_builder_state;
      if (!state || typeof state !== "object") {
        showToast("This saved assessment draft could not be restored.", "error");
        return;
      }
      goTo("assessment");
      const fields = state.fields && typeof state.fields === "object" ? state.fields : {};
      for (const [name, value] of Object.entries(fields)) {
        if (["assessmentClassName", "assessmentClassRoster"].includes(name)) continue;
        const control = form.elements.namedItem(name);
        if (control && "value" in control && typeof value === "string") control.value = value;
      }
      selectedAssessmentClassIds.clear();
      for (const row of Array.isArray(state.classes) ? state.classes : []) {
        const id = Number(row.id);
        if (row.selected && Number.isInteger(id) && id > 0) selectedAssessmentClassIds.add(id);
      }
      for (const name of ["year", "assessmentType", "questionFormat", "duration"]) {
        assessmentSelections[name].clear();
        for (const rawValue of state.selections?.[name] || []) {
          const value = String(rawValue);
          assessmentSelections[name].add(value);
          if (name === "duration" && !form.querySelector(`[data-assessment-options="duration"] [data-assessment-value="${CSS.escape(value)}"]`)) {
            const customBadge = document.createElement("button");
            customBadge.type = "button";
            customBadge.className = "assessment-badge";
            customBadge.dataset.assessmentValue = value;
            customBadge.textContent = `${value} min`;
            customBadge.setAttribute("aria-pressed", "false");
            form.querySelector('[data-assessment-options="duration"]').append(customBadge);
          }
        }
        syncBadgeButtons(name);
      }
      renderClassSelections();
      for (const name of ["deliveryMode", "securityLevel"]) {
        const field = form.elements.namedItem(name);
        const choice = form.querySelector(`[data-assessment-choice="${name}"]`);
        if (choice && field) choice.querySelectorAll("[data-choice-value]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.choiceValue === field.value)));
        field?.dispatchEvent(new Event("change", { bubbles: true }));
      }
      updateOtherFormat();
      selectedWeeksByYear.clear();
      (Array.isArray(state.selected_week_sections) ? state.selected_week_sections : []).forEach((week) => {
        const key = String(week.selection_key || "");
        if (!key) return;
        const selected = selectedWeeksByYear.get(week.year_group) || new Map();
        selected.set(key, week);
        selectedWeeksByYear.set(week.year_group, selected);
      });
      renderWeeklySections();
      updateClassSuggestions();
      updateTimeShare();
      updateCombinationSummary();
      activeAssessmentDraftId = savedDocument.id;
      saveDraftButton.innerHTML = `${iconMarkup("file-lines")} Update saved draft`;
      if (!planningDialogs.assessment.open) planningDialogs.assessment.showModal();
      showFormStep("assessment", Number.isInteger(state.step) ? state.step : 0);
      showToast("Assessment draft restored. Continue where you left off.");
    };
    updateOtherFormat();
  }
  renderAll();
  configureProfileOptions();
  configureAssessmentTopics();
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  if (requestedPage) goTo(requestedPage);
  async function recoverUnstoredLivePresentation() {
    try {
      const { sessions = [] } = await workspaceRequest(
        "/api/teacher/presentation-simulations",
        "GET",
        null,
        { silent: true }
      );
      const activeSessions = sessions.filter((session) => session.status === "active");
      if (activeSessions.length !== 1) {
        if (activeSessions.length > 1) {
          showToast("More than one live presentation is active. Open its session from Presentation history to resume.", "error");
        }
        return;
      }
      const session = activeSessions[0];
      const details = await workspaceRequest(
        `/api/teacher/presentation-simulations/${encodeURIComponent(session.id)}/history`,
        "GET",
        null,
        { silent: true }
      );
      if (!Array.isArray(details.presentation?.slides) || !details.presentation.slides.length) {
        throw new Error("The active presentation's slides could not be recovered.");
      }
      const recovered = {
        id: Number(session.id),
        url: "",
        title: String(session.title || details.title || "Class presentation"),
        presentation: details.presentation
      };
      saveActiveLivePresentation(recovered);
      openPresentationViewer(recovered.presentation, recovered.title, recovered);
      showToast("Resumed the existing live presentation. Students can keep using the link already shared.");
    } catch (error) {
      console.error("The active presentation could not be recovered.", error);
      showToast(error instanceof Error ? error.message : "The active presentation could not be recovered.", "error");
    }
  }
  const activeLivePresentation = loadActiveLivePresentation();
  if (activeLivePresentation) {
    openPresentationViewer(activeLivePresentation.presentation, activeLivePresentation.title, activeLivePresentation);
  } else if (requestedPage === "slides") {
    void recoverUnstoredLivePresentation();
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((error) => console.error("Service worker registration failed", error));
    });
  }
})();
