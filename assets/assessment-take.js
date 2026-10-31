(() => {
  "use strict";

  const base = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const assessmentRendering = window.akademiAssessmentRendering;
  const entry = document.getElementById("assessment-entry");
  const active = document.getElementById("active-assessment");
  const complete = document.getElementById("assessment-complete");
  const entryStatus = document.getElementById("assessment-entry-status");
  const activeStatus = document.getElementById("assessment-active-status");
  const answerForm = document.getElementById("assessment-answer-form");
  const submitDialog = document.getElementById("assessment-submit-dialog");
  const submitProgress = document.getElementById("assessment-submit-progress");
  let attempt = null;
  let clockTimer = 0;
  let remainingSeconds = 0;
  let questionRemainingSeconds = 0;
  let currentQuestionIndex = 0;
  let questionCards = [];
  const timedOutQuestions = new Set();
  let submitted = false;
  let submitProgressTimer = 0;
  let submitStartedAt = 0;
  let codePreview = null;
  const assessmentToken = new URLSearchParams(window.location.search).get("assessment") || "";
  let assessmentInfo = null;
  let availabilityTimer = 0;
  let selectedLearnerName = "";
  let selectedLearnerId = 0;
  const lastEventAt = new Map();

  class AssessmentRequestError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "AssessmentRequestError";
      this.status = status;
    }
  }

  async function request(path, method = "GET", body = null) {
    const options = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.headers["X-CSRF-Token"] = csrf;
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${base}${path}`, options);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`The assessment service returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new AssessmentRequestError(result.error || "The assessment request could not be completed.", response.status);
    return result;
  }

  const studentResultsSection = document.getElementById("assessment-student-results");
  const studentResultsList = document.getElementById("assessment-student-results-list");
  const studentResultsStatus = document.getElementById("assessment-student-results-status");
  const studentResultsButton = document.getElementById("assessment-view-results");
  let entryVisibilityBeforeResults = null;
  let resultsOpenedFromCompletion = false;

  function appendResultText(parent, label, value) {
    const paragraph = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    paragraph.append(strong, document.createTextNode(value || "No response"));
    parent.append(paragraph);
  }

  function renderStudentResults(results) {
    studentResultsList.replaceChildren();
    const released = results.filter((result) => result.result_published);
    const completed = released.filter((result) => result.final_score !== null);
    const earned = completed.reduce((total, result) => total + result.final_score, 0);
    const possible = completed.reduce((total, result) => total + result.total_marks, 0);
    if (released.length) {
      const summary = document.createElement("p");
      summary.className = "assessment-student-results-summary";
      summary.textContent = `${released.length} result${released.length === 1 ? "" : "s"} released · Overall finalized performance: ${possible ? `${(earned / possible * 100).toFixed(1)}% (${earned}/${possible})` : "written responses are awaiting review"}.`;
      studentResultsList.append(summary);
    }
    results.forEach((result) => {
      const card = document.createElement("details");
      card.className = "assessment-student-result-card";
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = result.title;
      const meta = document.createElement("small");
      meta.textContent = `${result.subject}${result.submitted_at ? ` · ${result.submitted_at}` : ""}`;
      title.append(name, meta);
      const score = document.createElement("strong");
      score.textContent = result.result_published
        ? result.final_score === null
          ? `${result.auto_score} objective marks · written responses pending`
          : `${result.final_score}/${result.total_marks} · ${Number(result.percentage).toFixed(1)}%`
        : "Results pending release";
      summary.append(title, score);
      card.append(summary);
      if (result.result_published) {
        const detail = document.createElement("div");
        detail.className = "assessment-student-result-details";
        const assessmentType = document.createElement("p");
        assessmentType.textContent = `Assessment: ${String(result.assessment_type || "").replaceAll("_", " ")} · ${result.status}`;
        detail.append(assessmentType);
        if (result.review_pending) {
          const pending = document.createElement("p");
          pending.textContent = "Your score is provisional until your teacher marks the written responses.";
          detail.append(pending);
        }
        if (result.integrity_review_decision) {
          const integrityReview = document.createElement("p");
          integrityReview.textContent = result.integrity_review_decision === "deduct"
            ? `Teacher integrity review: ${result.integrity_marks_deducted} mark(s) deducted. Reason: ${result.integrity_review_reason}`
            : `Teacher integrity review: marks maintained. Reason: ${result.integrity_review_reason}`;
          detail.append(integrityReview);
        }
        const questions = document.createElement("ol");
        questions.className = "assessment-student-question-list";
        result.questions.forEach((question) => {
          const item = document.createElement("li");
          const heading = document.createElement("div");
          heading.className = "assessment-student-question-heading";
          const questionTitle = document.createElement("strong");
          questionTitle.textContent = `Question ${question.question_number}`;
          const mark = document.createElement("span");
          mark.textContent = question.score === null ? `Awaiting review · ${question.marks} marks` : `${question.score}/${question.marks} marks`;
          heading.append(questionTitle, mark);
          item.append(heading);
          appendResultText(item, "Question", question.prompt);
          appendResultText(item, "Your response", question.learner_answer);
          if (question.question_type === "mcq" && question.correct_option >= 0) {
            const option = question.options[question.correct_option] || "";
            appendResultText(item, "Correct answer", `${String.fromCharCode(65 + question.correct_option)}. ${option}`);
          } else if (question.expected_answer) {
            appendResultText(item, "Expected response", question.expected_answer);
          }
          if (question.teacher_feedback) appendResultText(item, "Teacher feedback", question.teacher_feedback);
          questions.append(item);
        });
        detail.append(questions);
        card.append(detail);
      } else {
        const pending = document.createElement("p");
        pending.className = "assessment-student-result-pending";
        pending.textContent = "Your submission is saved. Your teacher has not released this result yet.";
        card.append(pending);
      }
      studentResultsList.append(card);
    });
    studentResultsStatus.textContent = results.length
      ? "Only results released by your teacher include marks, answers and feedback."
      : "No results are available in this browser session yet.";
    studentResultsButton.hidden = results.length === 0;
  }

  async function loadStudentResults() {
    const result = await request("/api/student/assessment/results");
    renderStudentResults(Array.isArray(result.results) ? result.results : []);
    return result.results || [];
  }

  function showStudentResults(fromCompletion = false) {
    resultsOpenedFromCompletion = fromCompletion;
    entryVisibilityBeforeResults = new Map(Array.from(entry.children, (child) => [child, child.hidden]));
    entry.hidden = false;
    Array.from(entry.children).forEach((child) => { child.hidden = child !== studentResultsSection; });
    if (fromCompletion) complete.hidden = true;
    studentResultsSection.hidden = false;
    void loadStudentResults().catch((error) => {
      studentResultsStatus.textContent = error instanceof Error ? error.message : "Your results could not be loaded.";
    });
  }

  function closeStudentResults() {
    studentResultsSection.hidden = true;
    if (entryVisibilityBeforeResults) {
      entryVisibilityBeforeResults.forEach((hidden, child) => { child.hidden = hidden; });
      entryVisibilityBeforeResults = null;
    }

    if (resultsOpenedFromCompletion) {
      entry.hidden = true;
      complete.hidden = false;
      resultsOpenedFromCompletion = false;
    }
  }

  studentResultsButton.addEventListener("click", () => showStudentResults(false));
  document.getElementById("assessment-complete-view-results").addEventListener("click", () => showStudentResults(true));
  document.getElementById("assessment-close-results").addEventListener("click", closeStudentResults);
  void loadStudentResults().catch((error) => {
    studentResultsStatus.textContent = error instanceof Error ? error.message : "Your results could not be loaded.";
  });

  function showCurrent(data) {
    attempt = data;
    entry.hidden = true;
    active.hidden = false;
    document.body.classList.add("assessment-active");
    document.getElementById("assessment-title").textContent = data.title;
    document.getElementById("assessment-learner").textContent = `Learner: ${data.learner_name} · ${data.assessment_type.replaceAll("_", " ")}`;
    document.getElementById("assessment-instructions").textContent = data.instructions || "Answer each question and submit before the timer expires.";
    document.getElementById("assessment-security-instructions").textContent = data.security_instructions;
    document.getElementById("assessment-security-heading").textContent = `${data.security_level === "advanced" ? "Advanced" : "Medium"} security instructions`;
    document.getElementById("assessment-time-per-question").textContent = `Each question has an average time guide of ${data.average_seconds_per_question} seconds. The overall ${data.duration_minutes}-minute deadline still applies.`;
    document.getElementById("assessment-fullscreen").hidden = data.security_level !== "advanced" || Boolean(document.fullscreenElement);
    if (data.security_level === "advanced") activeStatus.textContent = "Advanced security is enabled. Use Enter fullscreen and tell your teacher if your browser cannot enter fullscreen.";
    remainingSeconds = data.remaining_seconds;
    const questionRoot = document.getElementById("assessment-questions");
    questionRoot.replaceChildren(...data.questions.map((question, index) => {
      const card = document.createElement("section");
      card.className = "assessment-question-card";
      card.hidden = index !== 0;
      const heading = document.createElement("h2");
      const title = document.createElement("strong");
      title.textContent = `Question ${index + 1}`;
      const marks = document.createElement("span");
      marks.textContent = `${question.marks} marks · ${data.average_seconds_per_question} sec time guide`;
      heading.append(title, marks);
      const prompt = document.createElement("div");
      prompt.classList.add("assessment-question-prompt");
      if (assessmentRendering) prompt.innerHTML = assessmentRendering.formatQuestionPrompt(question.prompt, question.table).html;
      else prompt.textContent = question.prompt;
      card.append(heading, prompt);
      const visual = assessmentRendering?.renderVisual(question.visual);
      if (visual) {
        const visualWrap = document.createElement("div");
        visualWrap.className = "assessment-visual-wrap";
        visualWrap.append(visual);
        card.append(visualWrap);
      }
      if (question.question_type === "mcq" && Array.isArray(question.options)) {
        question.options.forEach((option, optionIndex) => {
          const label = document.createElement("label");
          label.className = "assessment-answer-option";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `answer-${index}`;
          radio.value = String(optionIndex);
          const value = document.createElement("span");
          if (assessmentRendering) value.innerHTML = `${String.fromCharCode(65 + optionIndex)}. ${assessmentRendering.formatText(option)}`;
          else value.textContent = `${String.fromCharCode(65 + optionIndex)}. ${option}`;
          label.append(radio, value);
          card.append(label);
        });
      } else {
        const textarea = document.createElement("textarea");
        textarea.className = "assessment-answer-text";
        textarea.name = `answer-${index}`;
        textarea.maxLength = 5000;
        textarea.rows = 5;
        textarea.setAttribute("aria-label", `Answer to question ${index + 1}`);
        textarea.placeholder = "Write your answer clearly…";
        card.append(textarea);
      }
      return card;
    }));
    questionCards = Array.from(questionRoot.children);
    currentQuestionIndex = 0;
    timedOutQuestions.clear();
    questionRemainingSeconds = data.average_seconds_per_question;
    const responseProgress = document.getElementById("assessment-response-progress");
    responseProgress.max = questionCards.length || 1;
    document.getElementById("assessment-next-question").hidden = questionCards.length < 2;
    answerForm.querySelector(".assessment-submit-row [type=submit]").hidden = questionCards.length > 1;
    updateQuestionPage();
    updateResponseProgress();
    renderClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      remainingSeconds = Math.max(0, remainingSeconds - 1);
      questionRemainingSeconds = Math.max(0, questionRemainingSeconds - 1);
      renderClock();
      if (questionRemainingSeconds === 0) {
        if (data.security_level === "advanced") {
          activeStatus.textContent = "Question time expired. Moving to the next question.";
          advanceQuestion(true);
          if (currentQuestionIndex < questionCards.length - 1) scheduleAnswerDraftSave();
        } else {
          activeStatus.textContent = "The average time guide for this question has ended. Continue when ready; the overall exam deadline still applies.";
        }
      }
      if (remainingSeconds <= 0) {
        clearInterval(clockTimer);
        deadlineReached = true;
        clearTimeout(answerDraftTimer);
        saveAnswerDraft();
        activeStatus.textContent = "Time has ended. Answers saved before the deadline are preserved. Contact your teacher if anything is missing.";
        answerForm.querySelector('[type="submit"]').disabled = true;
        document.getElementById("assessment-next-question").disabled = true;
      }
    }, 1000);
  }

  function updateQuestionPage() {
    questionCards.forEach((card, index) => { card.hidden = index !== currentQuestionIndex; });
    document.getElementById("assessment-question-progress").textContent = `Question ${currentQuestionIndex + 1} of ${questionCards.length}`;
    document.getElementById("assessment-next-question").hidden = currentQuestionIndex >= questionCards.length - 1;
    answerForm.querySelector(".assessment-submit-row [type=submit]").hidden = currentQuestionIndex < questionCards.length - 1;
    const nextInput = questionCards[currentQuestionIndex]?.querySelector("textarea");
    if (nextInput) nextInput.focus();
  }

  function updateResponseProgress() {
    const answered = attempt.questions.reduce((count, question, index) => {
      if (question.question_type === "mcq") {
        return count + (answerForm.querySelector(`input[name="answer-${index}"]:checked`) ? 1 : 0);
      }
      return count + (String(answerForm.elements.namedItem(`answer-${index}`)?.value || "").trim() ? 1 : 0);
    }, 0);
    const total = attempt.questions.length;
    document.getElementById("assessment-response-progress").value = answered;
    document.getElementById("assessment-response-progress-label").textContent = `${answered} of ${total} answered`;
    return { answered, total };
  }

  function advanceQuestion(didTimeOut = false) {
    if (didTimeOut) timedOutQuestions.add(currentQuestionIndex);
    if (currentQuestionIndex >= questionCards.length - 1) {
      if (didTimeOut && attempt.security_level === "advanced") {
        clearInterval(clockTimer);
        submitAnswers();
      }
      return;
    }
    currentQuestionIndex += 1;
    questionRemainingSeconds = attempt.average_seconds_per_question;
    activeStatus.textContent = "";
    updateQuestionPage();
    renderClock();
  }

  function setCredentialsVisible(visible) {
    const credentials = document.getElementById("assessment-credentials");
    const codeField = document.getElementById("assessment-student-code-field");
    const codeInput = identityForm.elements.namedItem("accessCode");
    const codeHelp = document.getElementById("assessment-student-code-help");
    const codeLabel = document.getElementById("assessment-student-code-label");
    const accessMode = assessmentInfo?.access_mode || "individual_code";
    credentials.hidden = !visible;
    const needsCode = accessMode !== "none";
    codeField.hidden = !needsCode;
    codeInput.required = visible && needsCode;
    codeLabel.textContent = accessMode === "teacher_code" ? "Teacher assessment code" : "Your individual code";
    codeInput.placeholder = accessMode === "teacher_code" ? "Enter the code shared by your teacher" : "Enter your private learner code";
    codeHelp.textContent = accessMode === "teacher_code"
      ? "Your teacher’s code is required before you can begin."
      : accessMode === "individual_code"
        ? "Use the individual code your teacher shared with you."
        : "No code is needed. You can start after selecting your class and name.";
    document.getElementById("assessment-identity-help").hidden = visible;
  }

  async function loadPublicAssessment() {
    const proceed = document.getElementById("assessment-proceed");
    if (!/^[a-f0-9]{64}$/i.test(assessmentToken)) {
      entryStatus.textContent = "This assessment link is missing or invalid. Ask your teacher for the current link.";
      return;
    }
    try {
      const result = await request(`/api/student/assessment/info/${assessmentToken}`);
      assessmentInfo = result.assessment;
      document.getElementById("assessment-link-title").textContent = assessmentInfo.title;
      document.getElementById("assessment-link-meta").textContent = `${assessmentInfo.subject} · ${assessmentInfo.class_name} · ${assessmentInfo.duration_minutes} minutes · ${assessmentInfo.question_count} questions`;
      document.getElementById("assessment-link-instructions").textContent = assessmentInfo.instructions || "Answer each question and submit before the timer expires.";
      document.getElementById("assessment-link-security").textContent = assessmentInfo.security_instructions;
      document.getElementById("assessment-link-details").hidden = false;
      const classSelect = identityForm.elements.namedItem("classId");
      const classOptions = assessmentInfo.classes.map((item) => {
        const label = item.status === "paused" ? `${item.name} (paused)` : item.status === "closed" ? `${item.name} (ended)` : item.name;
        const option = new Option(label, String(item.id));
        option.disabled = item.status !== "active";
        return option;
      });
      classSelect.replaceChildren(new Option("Choose your class", ""), ...classOptions);
      document.getElementById("assessment-legacy-entry").hidden = assessmentInfo.access_mode !== "individual_code";
      const availability = document.getElementById("assessment-link-availability");
      clearInterval(availabilityTimer);
      const updateAvailability = () => {
        const expiration = new Date(`${String(assessmentInfo.expires_at || "").replace(" ", "T")}Z`).valueOf();
        const seconds = Math.max(0, Math.floor((expiration - Date.now()) / 1000));
        const hasAvailableClass = assessmentInfo.classes.some((item) => item.status === "active");
        if (assessmentInfo.status === "paused") {
          availability.textContent = "This exam is paused by your teacher. You cannot begin until it is resumed.";
          proceed.disabled = true;
        } else if (assessmentInfo.status === "published" && !hasAvailableClass) {
          availability.textContent = "No assigned class is currently accepting attempts. Contact your teacher.";
          proceed.disabled = true;
        } else if (assessmentInfo.status !== "published" || seconds <= 0) {
          availability.textContent = "This exam link has expired or closed. Contact your teacher.";
          proceed.disabled = true;
        } else {
          const days = Math.floor(seconds / 86400);
          const hours = Math.floor(seconds % 86400 / 3600);
          const minutes = Math.floor(seconds % 3600 / 60);
          const remainder = seconds % 60;
          availability.textContent = `Link expires in ${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
          proceed.disabled = false;
        }
      };
      updateAvailability();
      availabilityTimer = window.setInterval(updateAvailability, 1000);
      entryStatus.textContent = assessmentInfo.status === "published"
        ? "Read the assessment instructions. The exam timer has not started."
        : "This assessment is not currently accepting new attempts.";
    } catch (error) {
      entryStatus.textContent = error instanceof Error ? error.message : "The assessment details could not be loaded.";
    }
  }

  document.getElementById("assessment-proceed").addEventListener("click", () => {
    if (!assessmentInfo) return;
    document.getElementById("assessment-proceed").hidden = true;
    const form = document.getElementById("assessment-identity-form");
    form.hidden = false;
    form.elements.namedItem("classId").focus();
    entryStatus.textContent = "Enter your class, then select your name from the class roster.";
  });

  const identityForm = document.getElementById("assessment-identity-form");
  const classInput = identityForm.elements.namedItem("classId");
  const learnerInput = identityForm.elements.namedItem("learnerName");
  const suggestions = document.getElementById("assessment-roster-suggestions");
  let suggestionTimer = 0;
  let suggestionRequestId = 0;
  async function loadRosterSuggestions() {
    const requestId = ++suggestionRequestId;
    selectedLearnerName = "";
    selectedLearnerId = 0;
    setCredentialsVisible(false);
    const query = learnerInput.value.trim();
    const classId = classInput.value;
    if (!assessmentInfo || query.length < 2 || !classId) {
      suggestions.replaceChildren();
      suggestions.hidden = true;
      return;
    }
    try {
      const params = new URLSearchParams({ assessment: assessmentToken, class_id: classId, q: query });
      const result = await request(`/api/student/assessment/roster?${params}`);
      if (requestId !== suggestionRequestId || query !== learnerInput.value.trim() || classId !== classInput.value) return;
      suggestions.replaceChildren();
      result.learners.forEach((learner) => {
        const option = document.createElement("button");
        option.type = "button";
        option.role = "option";
        option.className = "assessment-roster-option";
        option.textContent = learner.name;
        option.addEventListener("click", () => {
          learnerInput.value = learner.name;
          selectedLearnerName = learner.name;
          selectedLearnerId = Number(learner.id);
          suggestions.hidden = true;
          setCredentialsVisible(true);
          if (assessmentInfo.access_mode !== "none") identityForm.elements.namedItem("accessCode").focus();
          else document.getElementById("assessment-identity-submit").focus();
        });
        suggestions.append(option);
      });
      suggestions.hidden = result.learners.length === 0;
      if (result.learners.length === 0) entryStatus.textContent = "No matching learner found. Check the class and spelling, or ask your teacher to add you to the roster.";
    } catch (error) {
      entryStatus.textContent = error instanceof Error ? error.message : "The class roster could not be loaded.";
    }
  }
  classInput.addEventListener("change", () => {
    selectedLearnerName = "";
    selectedLearnerId = 0;
    learnerInput.value = "";
    suggestions.replaceChildren();
    suggestions.hidden = true;
    setCredentialsVisible(false);
    clearTimeout(suggestionTimer);
  });
  learnerInput.addEventListener("input", () => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(loadRosterSuggestions, 200); });
  identityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!assessmentInfo || !selectedLearnerId || !selectedLearnerName || learnerInput.value !== selectedLearnerName) {
      entryStatus.textContent = "Select your exact name from the class list before continuing.";
      learnerInput.focus();
      return;
    }
    if (!identityForm.reportValidity()) return;
    const submit = document.getElementById("assessment-identity-submit");
    submit.disabled = true;
    try {
      if (assessmentInfo.security_level === "advanced" && !document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) throw new Error("Advanced security requires fullscreen. Contact your teacher before starting.");
        await document.documentElement.requestFullscreen();
      }
      entryStatus.textContent = "Checking your roster entry and starting your timed assessment…";
      const result = await request("/api/student/assessment/enroll", "POST", {
        assessment: assessmentToken,
        class_id: Number(classInput.value),
        learner_id: selectedLearnerId,
        access_code: identityForm.elements.namedItem("accessCode").value
      });
      showCurrent(result.attempt);
    } catch (error) {
      const startError = error instanceof Error ? error.message : "Your assessment could not be started.";
      const canRecoverActiveAttempt = !(error instanceof AssessmentRequestError)
        || error.status >= 500
        || error.status === 409;
      if (canRecoverActiveAttempt) {
        try {
          const current = await request("/api/student/assessment/current");
          showCurrent(current.attempt);
          return;
        } catch {
          // Keep the original enrollment error when no active attempt can be restored.
        }
      }
      entryStatus.textContent = startError;
      entryStatus.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } finally {
      submit.disabled = false;
    }
  });

  function renderClock() {
    const minutes = Math.floor(questionRemainingSeconds / 60);
    const seconds = questionRemainingSeconds % 60;
    const clock = document.getElementById("assessment-clock");
    clock.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const overallMinutes = Math.floor(remainingSeconds / 60);
    const overallSeconds = remainingSeconds % 60;
    document.getElementById("assessment-overall-clock").textContent = `Overall: ${String(overallMinutes).padStart(2, "0")}:${String(overallSeconds).padStart(2, "0")}`;
    clock.closest(".assessment-clock").classList.toggle("is-low-time", questionRemainingSeconds < 60);
  }

  async function recordEvent(eventType) {
    const now = Date.now();
    if (now - (lastEventAt.get(eventType) || 0) < 2500 || !attempt || submitted) return;
    lastEventAt.set(eventType, now);
    try {
      await request("/api/student/assessment/events", "POST", { event_type: eventType });
    } catch {
      activeStatus.textContent = "Connection interrupted. Activity logging may be delayed; keep this tab open and reconnect.";
    }
  }

  async function tryRestore() {
    try {
      const result = await request("/api/student/assessment/current");
      showCurrent(result.attempt);
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith("Enter the learner access code")) {
        entryStatus.textContent = error.message;
      }
    }
  }

  document.getElementById("assessment-code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const enteredCode = form.elements.namedItem("code").value;
    const normalizedCode = enteredCode.toUpperCase().replace(/[\s-]+/g, "");
    try {
      if (!codePreview || codePreview.code !== normalizedCode) {
        entryStatus.textContent = "Checking your code and loading the exam instructions…";
        const result = await request("/api/student/assessment/preview", "POST", { assessment: assessmentToken, code: enteredCode });
        codePreview = { ...result.preview, code: normalizedCode };
        const level = codePreview.security_level === "advanced" ? "Advanced" : "Medium";
        document.getElementById("assessment-preview-heading").textContent = `${level} security · ${codePreview.title}`;
        document.getElementById("assessment-preview-security").textContent = codePreview.security_instructions;
        document.getElementById("assessment-preview-time").textContent = `Time guide: ${codePreview.average_seconds_per_question} seconds per question on average across ${codePreview.question_count} questions. The ${codePreview.duration_minutes}-minute timer starts when you begin.`;
        document.getElementById("assessment-entry-preview").hidden = false;
        submit.textContent = "Start timed assessment";
        entryStatus.textContent = "Read the instructions above. Your timer has not started.";
        return;
      }
      if (codePreview.security_level === "advanced" && !document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) {
          entryStatus.textContent = "Advanced security requires fullscreen. This browser does not support it; contact your teacher before starting.";
          return;
        }
        try {
          await document.documentElement.requestFullscreen();
        } catch {
          entryStatus.textContent = "Fullscreen could not be enabled. Contact your teacher before starting the advanced assessment.";
          return;
        }
      }
      entryStatus.textContent = "Starting your timed assessment…";
      const result = await request("/api/student/assessment/start", "POST", { assessment: assessmentToken, code: enteredCode });
      showCurrent(result.attempt);
    } catch (error) {
      entryStatus.textContent = error instanceof Error ? error.message : "Your code could not start the assessment.";
      codePreview = null;
      document.getElementById("assessment-entry-preview").hidden = true;
      submit.textContent = "Review instructions";
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector('#assessment-code-form [name="code"]').addEventListener("input", () => {
    codePreview = null;
    document.getElementById("assessment-entry-preview").hidden = true;
    document.getElementById("assessment-code-submit").textContent = "Review instructions";
  });

  document.getElementById("assessment-fullscreen").addEventListener("click", async () => {
    try {
      await document.documentElement.requestFullscreen();
      activeStatus.textContent = "Fullscreen enabled. Keep the assessment open in this tab.";
    } catch {
      activeStatus.textContent = "Fullscreen is unavailable in this browser. Continue only if your teacher permits it.";
    }
  });

  document.getElementById("assessment-next-question").addEventListener("click", () => {
    scheduleAnswerDraftSave();
    advanceQuestion(false);
  });
  answerForm.addEventListener("change", () => {
    updateResponseProgress();
    scheduleAnswerDraftSave();
  });
  answerForm.addEventListener("input", () => {
    updateResponseProgress();
    scheduleAnswerDraftSave();
  });

  let answerDraftTimer = null;
  let answerDraftQueue = Promise.resolve();
  let deadlineReached = false;

  function collectAnswers() {
    const answers = {};
    attempt.questions.forEach((question, index) => {
      if (question.question_type === "mcq") {
        answers[String(index)] = answerForm.querySelector(`input[name="answer-${index}"]:checked`)?.value || "";
      } else {
        answers[String(index)] = answerForm.elements.namedItem(`answer-${index}`).value;
      }
    });
    return answers;
  }

  function saveAnswerDraft() {
    const payload = {
      answers: collectAnswers(),
      timed_out_questions: Array.from(timedOutQuestions).sort((first, second) => first - second)
    };
    answerDraftQueue = answerDraftQueue
      .catch(() => {})
      .then(() => request("/api/student/assessment/save", "POST", payload))
      .then(() => {
        if (!deadlineReached && !submitted) activeStatus.textContent = "Answers saved.";
      })
      .catch((error) => {
        if (!deadlineReached && !submitted) {
          activeStatus.textContent = error instanceof Error
            ? `Your latest answers could not be saved: ${error.message}`
            : "Your latest answers could not be saved. Check your connection.";
        }
      });
    return answerDraftQueue;
  }

  function scheduleAnswerDraftSave() {
    if (submitted || deadlineReached) return;
    clearTimeout(answerDraftTimer);
    answerDraftTimer = setTimeout(() => {
      saveAnswerDraft();
    }, 400);
  }

  async function submitAnswers() {
    if (submitted) return;
    clearTimeout(answerDraftTimer);
    await answerDraftQueue;
    const answers = collectAnswers();
    const submit = answerForm.querySelector('[type="submit"]');
    submit.disabled = true;
    document.getElementById("assessment-next-question").disabled = true;
    answerForm.querySelectorAll("input, textarea").forEach((input) => { input.disabled = true; });
    submit.textContent = "Submitting answers…";
    submit.setAttribute("aria-busy", "true");
    submitProgress.hidden = false;
    submitStartedAt = Date.now();
    const progressTitle = document.getElementById("assessment-submit-progress-title");
    const progressMessage = document.getElementById("assessment-submit-progress-message");
    const elapsedLabel = document.getElementById("assessment-submit-elapsed");
    progressTitle.textContent = "Sending your responses securely";
    progressMessage.textContent = "Please keep this page open while your submission is confirmed.";
    elapsedLabel.textContent = "0s";
    clearInterval(submitProgressTimer);
    submitProgressTimer = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - submitStartedAt) / 1000);
      elapsedLabel.textContent = `${elapsedSeconds}s`;
      if (elapsedSeconds >= 7) {
        progressTitle.textContent = "Still waiting for confirmation";
        progressMessage.textContent = "Your answers are being saved. Keep this page open and do not submit again.";
      } else if (elapsedSeconds >= 2) {
        progressTitle.textContent = "Saving your responses";
        progressMessage.textContent = "Your submission is in progress. Waiting for the server to confirm receipt.";
      }
    }, 500);
    activeStatus.textContent = "Submitting your answers securely…";
    try {
      const result = await request("/api/student/assessment/submit", "POST", {
        answers,
        timed_out_questions: Array.from(timedOutQuestions).sort((first, second) => first - second)
      });
      submitted = true;
      clearInterval(submitProgressTimer);
      clearInterval(clockTimer);
      active.hidden = true;
      complete.hidden = false;
      document.getElementById("assessment-complete-message").textContent = result.message;
      const objectiveMaximum = attempt.questions.reduce((total, question) => total + (question.question_type === "mcq" ? question.marks : 0), 0);
      document.getElementById("assessment-complete-score").textContent = result.needs_manual_review
        ? objectiveMaximum > 0
          ? `Objective score: ${result.auto_score} / ${objectiveMaximum}. Written responses are awaiting teacher review.`
          : "Written responses are awaiting teacher review."
        : `Score: ${result.auto_score} / ${result.total_marks}.`;
      document.body.classList.remove("assessment-active");
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    } catch (error) {
      clearInterval(submitProgressTimer);
      activeStatus.textContent = error instanceof Error ? error.message : "Your answers could not be submitted.";
      submit.disabled = false;
      document.getElementById("assessment-next-question").disabled = false;
      answerForm.querySelectorAll("input, textarea").forEach((input) => { input.disabled = false; });
      submit.textContent = "Submit answers";
      submit.removeAttribute("aria-busy");
      submitProgress.hidden = true;
    }
  }

  answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitted || !answerForm.reportValidity()) return;
    const { answered, total } = updateResponseProgress();
    const unanswered = total - answered;
    document.getElementById("assessment-submit-dialog-summary").textContent = unanswered
      ? `You have answered ${answered} of ${total} questions. ${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still unanswered. You can review your answers or submit now.`
      : `You have answered all ${total} questions. You can review your answers or submit now.`;
    submitDialog.showModal();
  });
  document.querySelector("[data-cancel-assessment-submit]").addEventListener("click", () => submitDialog.close());
  document.getElementById("assessment-confirm-submit").addEventListener("click", () => {
    submitDialog.close();
    submitAnswers();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) recordEvent("tab_hidden");
  });
  window.addEventListener("blur", () => recordEvent("window_blur"));
  document.addEventListener("fullscreenchange", () => {
    if (attempt?.security_level === "advanced") {
      document.getElementById("assessment-fullscreen").hidden = Boolean(document.fullscreenElement);
      if (!document.fullscreenElement) recordEvent("fullscreen_exit");
    }
  });
  document.addEventListener("copy", (event) => {
    if (!attempt || submitted) return;
    event.preventDefault();
    recordEvent("copy_attempt");
    activeStatus.textContent = "Copying is disabled where this browser supports it. This attempt may be recorded.";
  });
  document.addEventListener("paste", (event) => {
    if (!attempt || submitted) return;
    event.preventDefault();
    recordEvent("paste_attempt");
    activeStatus.textContent = "Pasting is disabled where this browser supports it. This attempt may be recorded.";
  });
  document.addEventListener("cut", (event) => {
    if (!attempt || submitted) return;
    event.preventDefault();
    recordEvent("cut_attempt");
    activeStatus.textContent = "Cutting is disabled where this browser supports it. This attempt may be recorded.";
  });
  document.addEventListener("contextmenu", (event) => {
    if (!attempt || submitted) return;
    event.preventDefault();
    recordEvent("context_menu");
  });
  document.addEventListener("keydown", (event) => {
    if (!attempt || submitted) return;
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const screenshotShortcut = event.key === "PrintScreen"
      || (event.shiftKey && event.metaKey && ["3", "4", "5", "s"].includes(key));
    if (screenshotShortcut) {
      event.preventDefault();
      recordEvent("screenshot_attempt");
      activeStatus.textContent = "This browser can only deter or record some screenshot shortcuts; it cannot prevent screenshots from other apps or devices.";
      return;
    }
    if (!modifier) return;
    const eventType = key === "c" ? "copy_attempt" : key === "v" ? "paste_attempt" : key === "x" ? "cut_attempt" : "";
    if (!eventType) return;
    event.preventDefault();
    recordEvent(eventType);
    activeStatus.textContent = "Copying, cutting and pasting are disabled where this browser supports it. This attempt may be recorded.";
  }, true);
  window.addEventListener("beforeunload", (event) => {
    if (!attempt || submitted) return;
    event.preventDefault();
    event.returnValue = "";
  });

  tryRestore();
  loadPublicAssessment();
})();
