(() => {
  "use strict";

  const root = document.getElementById("curriculum-review");
  const canManageCurriculum = root.dataset.canManage === "true";
  const list = document.getElementById("curriculum-list");
  const alertBox = document.getElementById("curriculum-alert");
  const filterForm = document.getElementById("curriculum-filters");
  const previewDialog = document.getElementById("resource-preview-dialog");
  const previewTitle = document.getElementById("resource-preview-title");
  const previewContent = document.getElementById("resource-preview-content");
  const bulkToolbar = document.querySelector("[data-bulk-toolbar]");
  const bulkVerifyDialog = document.getElementById("curriculum-bulk-verify-dialog");
  const bulkVerifyForm = bulkVerifyDialog.querySelector("[data-bulk-verify-form]");
  const selectedYears = new Set();
  const selectedRoles = new Set();
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const appBase = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg#fa-${name}"></use></svg>`;
  let currentPage = 1;
  let listRequestVersion = 0;
  let previewRequestVersion = 0;
  let pdfLibraryPromise;

  function pdfLibrary() {
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = import(`${appBase}/assets/pdfjs/pdf.min.mjs`).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${appBase}/assets/pdfjs/pdf.worker.min.mjs`;
        return pdfjs;
      });
    }
    return pdfLibraryPromise;
  }

  function nativePdfCover(canvas) {
    if (!canvas.isConnected) return;
    const wrapper = canvas.closest(".curriculum-cover-pdf");
    const loading = wrapper.querySelector(".curriculum-cover-loading");
    wrapper.classList.add("is-error");
    loading.textContent = "Opening native PDF preview…";
    const frame = document.createElement("iframe");
    frame.className = "curriculum-cover-native";
    frame.title = `PDF cover preview of ${canvas.dataset.pdfCover}`;
    frame.src = `${root.dataset.reviewBase}/${canvas.dataset.pdfCover}/file#page=1&toolbar=0&navpanes=0&view=FitH`;
    const link = document.createElement("a");
    link.className = "curriculum-cover-native-link";
    link.href = `${root.dataset.reviewBase}/${canvas.dataset.pdfCover}/file`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open PDF";
    frame.addEventListener("load", () => {
      if (frame.isConnected) wrapper.classList.add("is-native");
      loading.hidden = true;
    }, { once: true });
    wrapper.append(frame, link);
  }

  async function renderPdfCovers() {
    const canvases = Array.from(list.querySelectorAll("[data-pdf-cover]"));
    if (!canvases.length) return;
    try {
      const pdfjs = await pdfLibrary();
      await Promise.all(canvases.map(async (canvas) => {
        if (!canvas.isConnected) return;
        const wrapper = canvas.closest(".curriculum-cover-pdf");
        const loading = wrapper.querySelector(".curriculum-cover-loading");
        let documentTask;
        try {
          documentTask = pdfjs.getDocument({
            url: `${root.dataset.reviewBase}/${canvas.dataset.pdfCover}/file`,
            withCredentials: true
          });
          const pdf = await documentTask.promise;
          const page = await pdf.getPage(1);
          if (!canvas.isConnected) {
            await pdf.destroy();
            return;
          }
          const bounds = wrapper.getBoundingClientRect();
          const sourceViewport = page.getViewport({ scale: 1 });
          const scale = Math.min((bounds.width - 8) / sourceViewport.width, (bounds.height - 8) / sourceViewport.height)
            * Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale });
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("The browser could not create a PDF cover canvas.");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport }).promise;
          wrapper.classList.add("is-rendered");
          loading.hidden = true;
          await pdf.destroy();
        } catch {
          if (documentTask) await documentTask.destroy().catch(() => {});
          nativePdfCover(canvas);
        }
      }));
    } catch {
      canvases.forEach(nativePdfCover);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  function show(message, success = false) {
    alertBox.classList.add("hidden");
    window.akademiAlert.toast(message, success ? "success" : "error");
  }
  async function api(url, method = "GET", body = null, requestOptions = {}) {
    const options = { method, credentials: "same-origin", headers: { "Accept": "application/json" } };
    if (body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.headers["X-CSRF-Token"] = csrf;
      options.body = JSON.stringify(body);
    }
    if (requestOptions.keepalive) options.keepalive = true;
    const response = await fetch(url, options);
    let result;
    try {
      result = await response.json();
    } catch {
      const error = new Error(`The resource service returned an unreadable response (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const reference = result.request_id ? ` Reference: ${result.request_id}.` : "";
      const error = new Error(`${result.error || "Resource request failed."} (HTTP ${response.status}).${reference}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function statusLabel(value) {
    return String(value || "unknown").replaceAll("_", " ");
  }
  const reviewChecks = [
    ["publisher", "Publisher / document identity"],
    ["edition", "Edition or version"],
    ["year-subject", "Subject and SHS year"],
    ["text", "Extracted text and page content"],
    ["structure", "Curriculum sections and weekly lessons"],
    ["source", "Source URL and provenance"],
    ["licensing", "Licensing or usage evidence"],
    ["other", "Other"]
  ];
  function reviewCheckState(notes) {
    const value = String(notes || "").trim();
    const checkedPrefix = "Checked items:";
    if (!value.startsWith(checkedPrefix)) {
      return {
        selected: value ? ["other"] : [],
        other: value
      };
    }
    const lines = value.split(/\r?\n/);
    const selectedLine = lines[0].slice(checkedPrefix.length);
    const selectedLabels = selectedLine.split("|").map((item) => item.trim());
    const selected = reviewChecks.filter(([, label]) => selectedLabels.includes(label)).map(([key]) => key);
    const otherIndex = lines.findIndex((line) => line === "Other details:");
    return {
      selected,
      other: otherIndex < 0 ? "" : lines.slice(otherIndex + 1).join("\n").trim()
    };
  }
  function reviewNotesFromCard(card, requireSelection) {
    const selected = Array.from(card.querySelectorAll("[data-review-check-option][aria-pressed='true']"))
      .map((button) => button.dataset.value);
    const otherSelected = selected.includes("other");
    const otherText = card.querySelector("[data-review-other-notes]").value.trim();
    if (requireSelection && !selected.length) {
      throw new Error("Select at least one item you checked before verifying this source.");
    }
    if (requireSelection && otherSelected && !otherText) {
      throw new Error("Add the details you checked under Other, or deselect Other.");
    }
    const labels = selected.filter((value) => value !== "other")
      .map((value) => reviewChecks.find(([key]) => key === value)?.[1])
      .filter(Boolean);
    if (!labels.length && (!otherSelected || !otherText)) return "";
    return [
      `Checked items: ${labels.join(" | ")}`,
      ...(otherSelected && otherText ? ["Other details:", otherText] : [])
    ].join("\n").trim();
  }
  function extractionStatusLabel(value) {
    return ({
      queued: "Queued",
      processing: "Processing text",
      extracted: "Ready to review",
      needs_ocr: "Needs OCR",
      failed: "Failed"
    })[value] || statusLabel(value);
  }
  function extractionErrorLabel(documentItem) {
    const message = String(documentItem.extraction_error || "");
    if (documentItem.extraction_status === "failed"
      && message.includes("Text extraction stopped unexpectedly; increase PHP memory and retry")) {
      return "Text extraction stopped unexpectedly, likely due to PHP memory limits. Increase the server memory limit and retry; scanned pages require OCR.";
    }
    return message;
  }
  function resourceLabel(value, customLabel = "") {
    if (value === "other" && customLabel) return customLabel;
    return ({
      teacher_manual: "Teacher manual",
      learner_material: "Learning material",
      lesson_template: "AI lesson-plan format template",
      scheme_template: "AI scheme-of-work format template",
      curriculum: "Curriculum",
      other: "Other resource"
    })[value] || statusLabel(value);
  }
  function yearGroups(value) {
    return String(value || "").split(",").map((year) => year.trim()).filter(Boolean);
  }
  function yearGroupLabel(value) {
    const labels = { SHS1: "SHS 1", SHS2: "SHS 2", SHS3: "SHS 3" };
    return yearGroups(value).map((year) => labels[year] || year).join(", ") || "Year not identified";
  }
  function updateBulkToolbar() {
    const eligible = Array.from(list.querySelectorAll("[data-select-resource]"));
    const selected = eligible.filter((checkbox) => checkbox.checked);
    bulkToolbar.hidden = eligible.length === 0;
    bulkToolbar.querySelector("[data-bulk-selection-count]").textContent =
      `${selected.length} resource${selected.length === 1 ? "" : "s"} selected`;
    bulkToolbar.querySelector("[data-bulk-verify]").disabled = selected.length === 0;
    bulkToolbar.querySelector("[data-clear-selection]").disabled = selected.length === 0;
    bulkToolbar.querySelector("[data-select-visible]").disabled = eligible.every((checkbox) => checkbox.checked);
  }
  function selectedFilterValues(name) {
    return name === "year_groups" ? selectedYears : selectedRoles;
  }
  function syncFilterBadges(name) {
    const group = filterForm.querySelector(`[data-filter-badges="${name}"]`);
    const selected = selectedFilterValues(name);
    group.querySelectorAll("[data-filter-value]").forEach((button) => {
      const value = button.dataset.filterValue;
      button.setAttribute("aria-pressed", String(value === "" ? selected.size === 0 : selected.has(value)));
    });
  }
  function contentPreview(value, maxLength = 150) {
    const text = String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/[`*_#>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  }
  function previewListHtml(values, limit = 3) {
    const unique = [...new Set(values.map((value) => contentPreview(value, 120)).filter(Boolean))];
    if (!unique.length) return "";
    const shown = unique.slice(0, limit);
    const remaining = unique.length - shown.length;
    return `<span class="curriculum-content-group-preview">${shown.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}${remaining ? `<span class="curriculum-content-group-more">+${remaining} more</span>` : ""}</span>`;
  }
  function detectedContentTabsHtml(sections, lessons, documentId, emptyMessage, idPrefix = "detected-content") {
    const sectionTypes = ["subject", "strand", "sub_strand", "focal_area", "content_standard", "learning_outcome", "learning_indicator", "learning_objective", "topic", "section", "other"];
    const categories = [
      { key: "subjects", label: "Subjects", types: ["subject"] },
      { key: "strands", label: "Strands", types: ["strand"] },
      { key: "sub-strands", label: "Sub-strands", types: ["sub_strand"] },
      { key: "focal-areas", label: "Focal areas", types: ["focal_area"] },
      { key: "standards", label: "Content standards", types: ["content_standard"] },
      { key: "learning-targets", label: "Learning targets", types: ["learning_outcome", "learning_indicator", "learning_objective"] },
      { key: "topics", label: "Topics", types: ["topic"] },
      { key: "sections", label: "Sections", types: ["section"] },
      { key: "other", label: "Other detected", types: ["other"] }
    ];
    const unknownSections = sections.filter((section) => !sectionTypes.includes(section.section_type));
    const populatedCategories = categories.map((category) => ({
      ...category,
      sections: sections.filter((section) => category.types.includes(section.section_type)
        || (category.key === "other" && unknownSections.includes(section)))
    })).filter((category) => category.sections.length);
    if (lessons.length) populatedCategories.push({ key: "weekly-plans", label: "Weekly plans", lessons });
    if (!populatedCategories.length) return emptyMessage;

    const typeOrder = new Map(sectionTypes.map((type, index) => [type, index]));
    const sectionDetails = (section) => {
      const title = String(section.title || "").trim();
      const code = String(section.code || "").trim();
      const titleMatch = title.match(/^sect(?:ion|in)\s*(\d+)\s*:\s*(.*)$/i);
      const codeMatch = code.match(/^sect(?:ion|in)\s*(\d+)$/i);
      const number = titleMatch?.[1] || codeMatch?.[1] || null;
      const label = titleMatch ? titleMatch[2].trim() : title;
      return {
        number: number ? Number(number) : null,
        label: label || "Untitled section",
        heading: number ? `SECTION ${Number(number)}: ${label || "Untitled section"}` : `Unnumbered section · ${label || "Untitled section"}`
      };
    };
    const groupSections = (items) => {
      const groups = new Map();
      items.forEach((section) => {
        const details = sectionDetails(section);
        const key = details.number === null ? "un-numbered" : String(details.number);
        if (!groups.has(key)) groups.set(key, {
          number: details.number,
          heading: details.number === null ? "Unnumbered sections" : details.heading,
          sections: []
        });
        groups.get(key).sections.push(section);
      });
      return [...groups.values()].sort((left, right) => {
        if (left.number === null) return right.number === null ? 0 : 1;
        if (right.number === null) return -1;
        return left.number - right.number;
      });
    };
    const groupWeeks = (items) => {
      const groups = new Map();
      items.forEach((lesson) => {
        const semester = lesson.semester_number == null ? "" : String(Number(lesson.semester_number));
        const week = Number(lesson.week_number);
        const key = `${semester}:${week}`;
        if (!groups.has(key)) groups.set(key, { semester: semester || null, week, lessons: [] });
        groups.get(key).lessons.push(lesson);
      });
      return [...groups.values()].sort((left, right) =>
        Number(left.semester || 99) - Number(right.semester || 99) || left.week - right.week
      );
    };
    const sectionGroups = groupSections(sections.filter((section) => section.section_type === "section"));
    const weekGroups = groupWeeks(lessons);
    const sectionCardHtml = (section) => {
      const sectionInfo = section.section_type === "section" ? sectionDetails(section) : null;
      const title = sectionInfo ? sectionInfo.heading : `${section.code ? `${section.code} · ` : ""}${section.title}`;
      const sectionText = `${title}${section.body ? `\n\n${section.body}` : ""}`;
      const preview = contentPreview(section.body, 150);
      return `<details class="preview-section-review">
        <summary><span class="preview-section-summary"><span class="preview-section-summary-title">${sectionInfo ? `${escapeHtml(title)} · ` : `${escapeHtml(statusLabel(section.section_type))} · ${escapeHtml(title)} · `}page ${section.page_number || "—"}</span>${preview ? `<span class="preview-section-summary-preview">${escapeHtml(preview)}</span>` : ""}</span><span class="review-badge review-${escapeHtml(section.review_status)}">${escapeHtml(statusLabel(section.review_status))}</span></summary>
        <div class="preview-section-content">${readableTextHtml(sectionText)}</div>
        <div class="preview-section-controls">
          <label class="curriculum-section-select"><input type="checkbox" data-select-section="${section.id}" data-document-id="${documentId}" aria-label="Select ${escapeHtml(section.title)} for bulk verification"><span>Select for bulk verify</span></label>
          <div class="curriculum-modal-badge-field"><span>Detected section type · click to correct</span><div class="curriculum-modal-badges" role="group" aria-label="Section type">
            ${sectionTypes.map((type) => `<button type="button" class="curriculum-modal-badge" data-section-type-option="${section.id}" data-value="${type}" aria-pressed="${String(section.section_type === type)}">${escapeHtml(statusLabel(type))}</button>`).join("")}
          </div><input type="hidden" data-section-type="${section.id}" value="${escapeHtml(section.section_type)}"></div>
          <div class="curriculum-modal-badge-field"><span>Review state · click to change</span><div class="curriculum-modal-badges" role="group" aria-label="Section review state">
            ${[["unreviewed", "Needs review"], ["verified", "Verified"], ["rejected", "Rejected"]].map(([value, label]) => `<button type="button" class="curriculum-modal-badge" data-section-status-option="${section.id}" data-value="${value}" aria-pressed="${String(section.review_status === value || (value === "unreviewed" && section.review_status === "in_review"))}">${label}</button>`).join("")}
          </div><input type="hidden" data-section-status="${section.id}" value="${section.review_status === "in_review" ? "unreviewed" : escapeHtml(section.review_status)}"></div>
          <label class="auth-field"><span>Review note (optional)</span><input data-section-note="${section.id}" maxlength="500" value="${escapeHtml(section.review_notes || "")}" placeholder="Why this type matches (or does not match) the source"></label>
          <button type="button" class="auth-secondary compact-button" data-review-section="${section.id}" data-document-id="${documentId}">Save section review</button>
        </div>
      </details>`;
    };
    const tabId = (key) => `${idPrefix}-${documentId}-${key}`;
    const tabs = populatedCategories.map((category, index) => {
      const count = category.key === "weekly-plans" ? weekGroups.length
        : category.key === "sections" ? sectionGroups.length
          : category.sections.length;
      return `<button type="button" role="tab" class="curriculum-detected-tab" id="${tabId(category.key)}-tab" aria-controls="${tabId(category.key)}-panel" aria-selected="${String(index === 0)}" tabindex="${index === 0 ? "0" : "-1"}" data-detected-content-tab="${category.key}"><span>${escapeHtml(category.label)}</span><span class="curriculum-detected-tab-count">${count}</span></button>`;
    }).join("");
    const panels = populatedCategories.map((category, index) => {
      let content;
      if (category.key === "weekly-plans") {
        content = weeklyLessonReviewsHtml(category.lessons, documentId, weekGroups);
      } else if (category.key === "sections") {
        content = sectionGroups.map((group) => `<details class="curriculum-content-group">
          <summary><span class="curriculum-content-group-heading"><span>${escapeHtml(group.heading)}</span>${previewListHtml(group.sections.map((section) => section.body || section.title))}</span><span class="review-badge">${group.sections.length} ${group.sections.length === 1 ? "entry" : "entries"}</span></summary>
          <div class="curriculum-content-group-items">${group.sections
            .sort((left, right) => Number(left.page_number || 0) - Number(right.page_number || 0) || Number(left.id) - Number(right.id))
            .map(sectionCardHtml).join("")}</div>
        </details>`).join("");
      } else {
        content = [...category.sections].sort((left, right) =>
          (typeOrder.get(left.section_type) ?? sectionTypes.length) - (typeOrder.get(right.section_type) ?? sectionTypes.length)
          || Number(left.page_number || 0) - Number(right.page_number || 0)
          || Number(left.id) - Number(right.id)
        ).map(sectionCardHtml).join("");
      }
      return `<div class="curriculum-detected-tab-panel" id="${tabId(category.key)}-panel" role="tabpanel" aria-labelledby="${tabId(category.key)}-tab" data-detected-content-panel="${category.key}"${index === 0 ? "" : " hidden"}>${content}</div>`;
    }).join("");
    const bulkToolbar = sections.length
      ? `<div class="curriculum-section-bulk-toolbar"><span data-section-selection-count>0 sections selected</span><button type="button" class="auth-secondary compact-button" data-bulk-verify-sections="${documentId}" disabled>Verify selected sections</button></div>`
      : "";
    return `<div class="curriculum-section-bulk-review" data-section-bulk-review>
      ${bulkToolbar}
      <div class="curriculum-detected-tabs" data-detected-content-tabs>
        <div class="curriculum-detected-tablist" role="tablist" aria-label="Detected curriculum content">${tabs}</div>
        ${panels}
      </div>
    </div>`;
  }
  function weeklyLessonReviewsHtml(lessons, documentId, weekGroups = null) {
    if (!lessons.length) return "<p>No explicit week-by-week lesson allocations were detected. The scanner only records week and topic details that are present in the source; verify any extracted details against the original.</p>";
    const groups = weekGroups || (() => {
      const byWeek = new Map();
      lessons.forEach((lesson) => {
        const semester = lesson.semester_number == null ? "" : String(Number(lesson.semester_number));
        const week = Number(lesson.week_number);
        const key = `${semester}:${week}`;
        if (!byWeek.has(key)) byWeek.set(key, { semester: semester || null, week, lessons: [] });
        byWeek.get(key).lessons.push(lesson);
      });
      return [...byWeek.values()].sort((left, right) =>
        Number(left.semester || 99) - Number(right.semester || 99) || left.week - right.week
      );
    })();
    return `<h3>Weekly lesson suggestions</h3><p>Each week is grouped together. Confirm topics, focal areas, learning targets and assessment against the original resource.</p>${groups.map((group) => `
      <details class="curriculum-content-group">
        <summary><span class="curriculum-content-group-heading"><span>${group.semester ? `Semester ${escapeHtml(group.semester)} · ` : ""}Week ${escapeHtml(group.week)}</span>${previewListHtml(group.lessons.map((lesson) => lesson.topic))}</span><span class="review-badge">${group.lessons.length} ${group.lessons.length === 1 ? "item" : "items"}</span></summary>
        <div class="curriculum-content-group-items">${group.lessons.map((lesson) => `
      <details class="preview-section-review">
        <summary><span>${escapeHtml(lesson.topic)}${lesson.source_page ? ` · page ${escapeHtml(lesson.source_page)}` : ""}</span><span class="review-badge review-${escapeHtml(lesson.review_status)}">${escapeHtml(statusLabel(lesson.review_status))}</span></summary>
        <div class="preview-section-controls" data-weekly-lesson-review="${lesson.id}" data-document-id="${documentId}">
          <div class="curriculum-modal-badge-field"><span>Semester</span><select data-weekly-semester="${lesson.id}"><option value=""${lesson.semester_number == null ? " selected" : ""}>Not specified</option><option value="1"${Number(lesson.semester_number) === 1 ? " selected" : ""}>First semester</option><option value="2"${Number(lesson.semester_number) === 2 ? " selected" : ""}>Second semester</option></select></div>
          <label class="auth-field"><span>Week</span><input type="number" min="1" max="52" data-weekly-week="${lesson.id}" value="${escapeHtml(lesson.week_number)}"></label>
          <label class="auth-field"><span>Topic</span><input maxlength="500" data-weekly-topic="${lesson.id}" value="${escapeHtml(lesson.topic)}"></label>
          <label class="auth-field"><span>Focal areas (one per line)</span><textarea rows="3" maxlength="6000" data-weekly-focal="${lesson.id}">${escapeHtml((lesson.focal_areas || []).join("\n"))}</textarea></label>
          <div class="curriculum-modal-badge-field"><span>Learning indicators captured</span><div>${(lesson.learning_indicators || []).length ? (lesson.learning_indicators || []).map(escapeHtml).join("<br>") : "None detected"}</div></div>
          <div class="curriculum-modal-badge-field"><span>Learning outcomes captured</span><div>${(lesson.learning_outcomes || []).length ? (lesson.learning_outcomes || []).map(escapeHtml).join("<br>") : "None detected"}</div></div>
          <label class="auth-field"><span>Assessment schedule</span><input maxlength="500" data-weekly-assessment="${lesson.id}" value="${escapeHtml(lesson.assessment_mode || "")}"></label>
          <div class="curriculum-modal-badge-field"><span>Review state</span><select data-weekly-status="${lesson.id}">${[["unreviewed", "Needs review"], ["verified", "Verified"], ["rejected", "Rejected"]].map(([value, label]) => `<option value="${value}"${lesson.review_status === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
          <label class="auth-field"><span>Review note (optional)</span><input maxlength="500" data-weekly-note="${lesson.id}" value="${escapeHtml(lesson.review_notes || "")}"></label>
          <button type="button" class="auth-secondary compact-button" data-review-weekly="${lesson.id}" data-document-id="${documentId}">Save weekly lesson review</button>
        </div>
      </details>`).join("")}</div>
      </details>`).join("")}`;
  }
  function readableTextHtml(value) {
    const parsed = new DOMParser().parseFromString(String(value || ""), "text/html");
    parsed.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
    parsed.querySelectorAll("table").forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent.trim())
      ).filter((row) => row.length);
      if (!rows.length) return;
      const lines = [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`];
      rows.slice(1).forEach((row) => lines.push(`| ${rows[0].map((_, index) => row[index] || "").join(" | ")} |`));
      table.replaceWith(document.createTextNode(`\n${lines.join("\n")}\n`));
    });
    parsed.querySelectorAll("br, p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr").forEach((node) => {
      node.insertAdjacentText("beforebegin", "\n");
      node.insertAdjacentText("afterend", "\n");
    });
    parsed.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((node) => node.insertAdjacentText("afterbegin", "## "));
    parsed.querySelectorAll("li").forEach((node) => node.insertAdjacentText("afterbegin", "- "));
    parsed.querySelectorAll("td, th").forEach((node) => node.insertAdjacentText("afterend", " | "));
    let text = (parsed.body.textContent || "").replace(/\r\n?/g, "\n").replace(/([A-Za-z])-\n(?=[a-z])/g, "$1-").replace(/\u00a0/g, " ");
    text = text.split("\n").map((line) => {
      const normalized = line.replace(/[ \t]+/g, " ").trim();
      const letterCount = (normalized.match(/[A-Za-z]/g) || []).length;
      if (normalized.length <= 100 && letterCount >= 3 && !/^#{1,4}\s/.test(normalized)
        && !/^[-*•▪]|\d+[.)]\s/.test(normalized)
        && (normalized.endsWith(":") || /^[A-Z0-9][A-Z0-9 .,:()&/'’-]+$/u.test(normalized))) {
        return `### ${normalized.replace(/:$/, "")}`;
      }
      return normalized;
    }).join("\n");
    return renderMarkdown(text) || "<p>No readable text was extracted.</p>";
  }
  function updateSectionBulkToolbar(scope) {
    const selected = scope.querySelectorAll("[data-select-section]:checked");
    if (!scope.matches("[data-section-bulk-review]")) return;
    const count = selected.length;
    scope.querySelector("[data-section-selection-count]").textContent =
      `${count} section${count === 1 ? "" : "s"} selected`;
    scope.querySelector("[data-bulk-verify-sections]").disabled = count === 0;
  }
  function selectBadgeValue(group, inputSelector, value) {
    const input = group.parentElement.querySelector(inputSelector);
    input.value = value;
    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.value === value));
    });
  }
  function inlinePreview(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
  }
  function renderMarkdown(value) {
    const input = String(value || "").replace(/\r\n?/g, "\n");
    const blocks = [];
    const rows = input.split("\n");
    let paragraph = [];
    let listType = "";
    let listItems = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push(`<p>${paragraph.map(inlinePreview).join("<br>")}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (listItems.length) blocks.push(`<${listType}>${listItems.map((item) => `<li>${inlinePreview(item)}</li>`).join("")}</${listType}>`);
      listItems = [];
      listType = "";
    };
    const tableCells = (line) => {
      const cells = [];
      let cell = "";
      let escaped = false;
      for (const character of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
        if (character === "|" && !escaped) {
          cells.push(cell.trim().replace(/\\\|/g, "|").replace(/\\\\/g, "\\"));
          cell = "";
        } else {
          cell += character;
        }
        escaped = character === "\\" && !escaped;
        if (character !== "\\") escaped = false;
      }
      cells.push(cell.trim().replace(/\\\|/g, "|").replace(/\\\\/g, "\\"));
      return cells;
    };
    for (let index = 0; index < rows.length; index++) {
      const line = rows[index].trim();
      if (!line) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(4, heading[1].length);
        blocks.push(`<h${level}>${inlinePreview(heading[2])}</h${level}>`);
        continue;
      }
      if (/^(?:---+|___+|\*\*\*+)$/.test(line)) {
        flushParagraph();
        flushList();
        blocks.push("<hr>");
        continue;
      }
      const table = line.includes("|") && index + 1 < rows.length
        && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(rows[index + 1]);
      let legacyTableRows = null;
      if (!table && line.includes("|")) {
        const candidateRows = [tableCells(line)];
        let nextIndex = index + 1;
        while (nextIndex < rows.length && rows[nextIndex].trim().includes("|")) {
          const nextRow = tableCells(rows[nextIndex]);
          if (nextRow.length !== candidateRows[0].length) break;
          candidateRows.push(nextRow);
          nextIndex++;
        }
        if (candidateRows.length > 1) legacyTableRows = candidateRows;
      }
      if (table) {
        flushParagraph();
        flushList();
        const headers = tableCells(line);
        index += 2;
        const bodyRows = [];
        while (index < rows.length && rows[index].trim().includes("|")) bodyRows.push(tableCells(rows[index++]));
        index--;
        blocks.push(`<div class="resource-preview-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlinePreview(cell)}</th>`).join("")}</tr></thead><tbody>${bodyRows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inlinePreview(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (legacyTableRows) {
        flushParagraph();
        flushList();
        blocks.push(`<div class="resource-preview-table-wrap"><table><tbody>${legacyTableRows.map((row) => `<tr>${row.map((cell) => `<td>${inlinePreview(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        index += legacyTableRows.length - 1;
        continue;
      }
      const item = line.match(/^(?:[-+*]\s+|\d+[.)]\s+)(.+)$/);
      if (item) {
        flushParagraph();
        const nextType = /^\d/.test(line) ? "ol" : "ul";
        if (listType && nextType !== listType) flushList();
        listType = nextType;
        listItems.push(item[1]);
        continue;
      }
      if (line.startsWith(">")) {
        flushParagraph();
        flushList();
        blocks.push(`<blockquote>${inlinePreview(line.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }
      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    return blocks.join("");
  }
  function openPreview(title, html) {
    previewTitle.textContent = title || "Resource preview";
    previewContent.innerHTML = html;
    if (!previewDialog.open) previewDialog.showModal();
  }
  function cardHtml(documentItem) {
    const url = documentItem.source_url || documentItem.source_home_url || "";
    const notes = documentItem.review_notes || "";
    const reviewState = reviewCheckState(notes);
    const structureOffset = sessionStorage.getItem(`curriculum-structure-offset:${documentItem.id}`) || "0";
    const structureComplete = structureOffset === "done";
    const cover = documentItem.mime_type === "application/pdf"
      ? `<div class="curriculum-cover-pdf" role="group" aria-label="First page cover preview of ${escapeHtml(documentItem.title)}"><canvas data-pdf-cover="${documentItem.id}" aria-hidden="true"></canvas><span class="curriculum-cover-loading" aria-hidden="true"></span></div>`
      : `<div class="curriculum-cover-placeholder"><span>${escapeHtml(documentItem.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "DOCX" : (documentItem.mime_type || "FILE").split("/").pop().slice(0, 5).toUpperCase())}</span><strong>RESOURCE</strong></div>`;
    const selectable = canManageCurriculum && documentItem.extraction_status === "extracted" && documentItem.review_status !== "verified";
    return `<article class="curriculum-card" data-document-id="${documentItem.id}">
      <div class="curriculum-card-head">
        ${cover}
        <div class="curriculum-card-details">
        <div class="curriculum-card-title-row"><div><h2>${escapeHtml(documentItem.title)}</h2><p>${escapeHtml(yearGroupLabel(documentItem.year_group))} · ${escapeHtml(resourceLabel(documentItem.resource_role, documentItem.resource_type_label))} · ${documentItem.chunk_count} text sections${Number(documentItem.classified_section_count) ? ` · ${documentItem.classified_section_count} structured entries` : ""}</p></div>
        ${selectable ? `<label class="curriculum-select-resource"><input type="checkbox" data-select-resource value="${documentItem.id}" aria-label="Select ${escapeHtml(documentItem.title)} for bulk verification"><span>Select</span></label>` : ""}
        <span class="review-badge review-${escapeHtml(documentItem.review_status)}">${escapeHtml(statusLabel(documentItem.review_status))}</span></div>
      <div class="curriculum-status"><span>Text: <strong data-extraction-status="${documentItem.id}" data-state="${escapeHtml(documentItem.extraction_status)}" aria-live="polite">${escapeHtml(extractionStatusLabel(documentItem.extraction_status))}</strong></span><span>Source: ${escapeHtml(documentItem.source_name || "Not recorded")}</span>${Number(documentItem.is_enabled) ? "" : '<span class="resource-disabled-label">Disabled for AI</span>'}</div>
      ${extractionErrorLabel(documentItem) ? `<p class="extraction-quality-note">${escapeHtml(extractionErrorLabel(documentItem))}</p>` : ""}
      <div class="resource-card-actions">
        <button class="preview-button" type="button" data-preview="${documentItem.id}">Preview resource</button>
        <button class="preview-button" type="button" data-read-resource="${documentItem.id}">Read full resource</button>
        ${canManageCurriculum && ["queued", "failed"].includes(documentItem.extraction_status) ? `<button class="preview-button" type="button" data-retry-extraction="${documentItem.id}" data-resource-name="${escapeHtml(documentItem.title)}">Retry text extraction</button>` : ""}
        ${canManageCurriculum && documentItem.mime_type === "application/pdf" ? `<button class="preview-button" type="button" data-ai-preview="${documentItem.id}">AI readable preview</button>` : ""}
        ${canManageCurriculum ? `<button class="preview-button" type="button" data-open-resource-review="${documentItem.id}">Edit details and review source</button><button class="preview-button resource-enable-button" type="button" data-toggle-enabled="${documentItem.id}" data-enabled="${Number(documentItem.is_enabled) ? "true" : "false"}">${Number(documentItem.is_enabled) ? "Disable resource" : "Enable resource"}</button>` : ""}
        <button class="preview-button resource-delete-button" type="button" data-delete-resource="${documentItem.id}">Delete resource</button>
      </div>
      <p class="resource-action-status" data-action-status role="status" aria-live="polite"></p>
      </div></div>
      <dialog class="resource-preview-dialog resource-review-dialog" aria-labelledby="resource-review-title-${documentItem.id}">
        <div class="resource-preview-dialog-header">
          <div><span class="auth-kicker">SOURCE &amp; STRUCTURE REVIEW</span><h2 id="resource-review-title-${documentItem.id}">${escapeHtml(documentItem.title)}</h2></div>
          <button class="resource-preview-close" type="button" data-close-resource-review aria-label="Close source and structure review">&times;</button>
        </div>
        <div class="resource-preview-content resource-review-dialog-content">
        <section class="resource-structure-review">
            <div class="resource-structure-heading"><div><strong>Curriculum structure review</strong><p>Detected content is separated into subject, strand, sub-strand, focal-area, standard, learning-target, topic, section and weekly-plan tabs. Section titles use “SECTION number:” formatting and entries are grouped by section or week number. Review every item against the source before verification.</p></div><button class="preview-button structure-button" type="button" data-structure="${documentItem.id}" data-offset="${structureComplete ? "0" : escapeHtml(structureOffset)}" data-complete="false" data-extraction-status="${escapeHtml(documentItem.extraction_status)}">${structureComplete ? "Extract curriculum sections again" : structureOffset === "0" ? "Extract curriculum sections" : `Extract next batch (from text section ${Number(structureOffset) + 1})`}</button></div>
          <p class="resource-action-status" data-structure-status role="status" aria-live="polite"></p>
          <div data-structure-review-content data-document-id="${documentItem.id}"><p>Expand this resource section to load extracted sections and review items.</p></div>
        </section>
        <div class="review-fields metadata-fields">
          <div class="curriculum-modal-badge-field"><span>SHS year</span><div class="curriculum-modal-badges" role="group" aria-label="SHS year">
            ${[["", "Not identified"], ["SHS1", "SHS 1"], ["SHS2", "SHS 2"], ["SHS3", "SHS 3"]].map(([value, label]) => `<button type="button" class="curriculum-modal-badge" data-metadata-option="year_group" data-value="${value}" aria-pressed="${String(value ? yearGroups(documentItem.year_group).includes(value) : !yearGroups(documentItem.year_group).length)}">${label}</button>`).join("")}
          </div><input type="hidden" data-metadata="year_group" value="${escapeHtml(documentItem.year_group || "")}"></div>
          <label class="auth-field"><span>Subject (optional)</span><input data-metadata="subject_name" maxlength="190" value="${escapeHtml(documentItem.subject_name || "")}" placeholder="e.g. Biology"></label>
          <div class="curriculum-modal-badge-field"><span>Resource type</span><div class="curriculum-modal-badges" role="group" aria-label="Resource type">
            ${[["teacher_manual", "Teacher manual"], ["learner_material", "Learning material"], ["lesson_template", "Lesson template"], ["scheme_template", "Scheme template"], ["curriculum", "Curriculum"], ["other", "Other resource"]].map(([value, label]) => `<button type="button" class="curriculum-modal-badge" data-metadata-option="resource_role" data-value="${value}" aria-pressed="${String(documentItem.resource_role === value)}">${label}</button>`).join("")}
          </div><input type="hidden" data-metadata="resource_role" value="${escapeHtml(documentItem.resource_role)}"></div>
          <label class="auth-field" data-metadata-other-type-wrap ${documentItem.resource_role === "other" ? "" : "hidden"}><span>Specify the resource type</span><input data-metadata="resource_type_label" maxlength="100" value="${escapeHtml(documentItem.resource_type_label || "")}" placeholder="e.g. assessment guide" ${documentItem.resource_role === "other" ? "required" : ""}></label>
          <button type="button" class="auth-secondary compact-button" data-save-metadata="${documentItem.id}">Save resource details</button>
        </div>
        <div class="review-fields">
        <label class="auth-field"><span>Verified publisher/document and version</span><input data-field="source_reference" maxlength="255" value="${escapeHtml(documentItem.source_reference || "")}" placeholder="e.g. Ministry SHS Year 3 Biology learner manual, 2024"></label>
        <label class="auth-field"><span>Public source URL (optional)</span><input data-field="source_url" type="url" value="${escapeHtml(url)}" placeholder="https://curriculumresources.edu.gh/"></label>
        <div class="curriculum-modal-badge-field resource-review-checks">
          <span>What did you check?</span>
          <div class="curriculum-modal-badges" role="group" aria-label="What did you check? Select all that apply">
            ${reviewChecks.map(([value, label]) => `<button type="button" class="curriculum-modal-badge" data-review-check-option data-value="${value}" aria-pressed="${String(reviewState.selected.includes(value))}">${label}</button>`).join("")}
          </div>
          <label class="auth-field resource-review-other" data-review-other-wrap${reviewState.selected.includes("other") ? "" : " hidden"}><span>Other things you checked</span><textarea data-review-other-notes rows="2" maxlength="1000" placeholder="Describe any other checks you completed."${reviewState.selected.includes("other") ? " required" : ""}>${escapeHtml(reviewState.other)}</textarea></label>
        </div>
        </div>
        <p class="review-warning">Check this source, extracted text and licensing evidence before verification. Only verified, relevant resources may be used for curriculum-grounded AI responses.</p>
        <div class="review-actions"><button type="button" class="auth-submit" data-review="verified" data-id="${documentItem.id}">Verify source</button><button type="button" class="auth-secondary compact-button" data-review="rejected" data-id="${documentItem.id}">Reject</button></div>
        </div>
      </dialog>
    </article>`;
  }
  async function load(page = currentPage, { quiet = false } = {}) {
    if (!quiet) currentPage = page;
    const requestVersion = ++listRequestVersion;
    if (!quiet) {
      list.setAttribute("aria-busy", "true");
      list.innerHTML = `<div class="curriculum-card-skeleton" aria-hidden="true"><span class="skeleton-cover"></span><span class="skeleton-copy"><i></i><i></i><i></i><i></i></span></div><div class="curriculum-card-skeleton" aria-hidden="true"><span class="skeleton-cover"></span><span class="skeleton-copy"><i></i><i></i><i></i><i></i></span></div><div class="curriculum-card-skeleton" aria-hidden="true"><span class="skeleton-cover"></span><span class="skeleton-copy"><i></i><i></i><i></i><i></i></span></div>`;
    }
    try {
      const query = new URLSearchParams({ page: String(page) });
      for (const [name, value] of new FormData(filterForm)) {
        if (String(value).trim()) query.set(name, String(value).trim());
      }
      selectedYears.forEach((year) => query.append("year_groups[]", year));
      selectedRoles.forEach((role) => query.append("resource_roles[]", role));
      const result = await api(`${root.dataset.listUrl}?${query}`);
      if (requestVersion !== listRequestVersion) return;
      if (quiet) {
        result.documents.forEach((documentItem) => {
          const status = list.querySelector(`[data-extraction-status="${documentItem.id}"]`);
          if (!status) return;
          status.dataset.state = documentItem.extraction_status;
          status.textContent = extractionStatusLabel(documentItem.extraction_status);
        });
        return result;
      }
      currentPage = result.page;
      const hasFilters = selectedYears.size > 0 || selectedRoles.size > 0
        || Array.from(new FormData(filterForm)).some(([, value]) => String(value).trim() !== "");
      document.getElementById("curriculum-count").textContent = hasFilters
        ? `${result.total} matching resource${result.total === 1 ? "" : "s"}`
        : `${result.total} indexed document${result.total === 1 ? "" : "s"}`;
      list.innerHTML = result.documents.length
        ? result.documents.map(cardHtml).join("")
        : `<div class="curriculum-empty">${result.total ? "No indexed resources match these filters." : "No resources indexed yet. Upload a PDF, TXT, MD or CSV file to get started."}</div>`;
      list.removeAttribute("aria-busy");
      updateBulkToolbar();
      renderPdfCovers();
      const pages = Math.max(1, Math.ceil(result.total / result.per_page));
      const startPage = Math.max(1, Math.min(currentPage - 2, pages - 4));
      const endPage = Math.min(pages, startPage + 4);
      document.getElementById("curriculum-pagination").innerHTML = pages > 1
        ? `<button type="button" data-page="${Math.max(1, currentPage - 1)}" ${currentPage <= 1 ? "disabled" : ""}>${icon("chevron-left")} Previous</button>${Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index).map((pageNumber) => `<button type="button" class="curriculum-page-number${pageNumber === currentPage ? " is-current" : ""}" data-page="${pageNumber}" aria-current="${pageNumber === currentPage ? "page" : "false"}">${pageNumber}</button>`).join("")}<span>of ${pages}</span><button type="button" data-page="${Math.min(pages, currentPage + 1)}" ${currentPage >= pages ? "disabled" : ""}>Next ${icon("chevron-right")}</button>`
        : "";
    } catch (error) {
      if (requestVersion !== listRequestVersion) return;
      if (quiet) return null;
      const message = error instanceof Error ? error.message : "Could not load the resource index.";
      document.getElementById("curriculum-count").textContent = "Resource list unavailable";
      document.getElementById("curriculum-pagination").replaceChildren();
      list.innerHTML = `<div class="curriculum-empty curriculum-list-error" role="alert"><p>${escapeHtml(message)}</p><button class="auth-secondary compact-button" type="button" data-retry-curriculum>Retry loading resources</button></div>`;
      list.removeAttribute("aria-busy");
      updateBulkToolbar();
      show(message);
    }
  }
  async function preview(documentId) {
    const previewVersion = ++previewRequestVersion;
    previewDialog.dataset.documentId = String(documentId);
    openPreview("Loading resource preview…", '<p class="resource-preview-loading">Opening the original resource and extracted text…</p>');
    try {
      const item = await api(`${root.dataset.reviewBase}/${documentId}`);
      if (previewVersion !== previewRequestVersion) return;
      const originalPreview = item.mime_type === "application/pdf"
        ? `<section class="original-resource-preview"><h3>Original PDF</h3><p>The original file retains its exact page layout and is available separately.</p><a href="${root.dataset.reviewBase}/${documentId}/file" target="_blank" rel="noopener noreferrer">Open original PDF in a new tab</a></section>`
        : item.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ? `<section class="original-resource-preview"><h3>Original Word document</h3><p>Rendered from the uploaded DOCX to preserve its page layout, tables and formatting.</p><div class="curriculum-docx-render" data-preview-docx-render role="document" aria-label="Original Word document"></div><a href="${root.dataset.reviewBase}/${documentId}/source?download=1">Download original DOCX</a></section>`
          : "";
      const readablePreviews = (item.previews || []).filter((chunk) => isReadableText(chunk.content));
      const extractionError = extractionErrorLabel(item);
      const extractionNote = extractionError
        ? `<p class="extraction-quality-note">${escapeHtml(extractionError)}</p>`
        : "";
      const sourcePreview = readablePreviews.length ? `${extractionNote}<h3>Readable extracted text · selectable text only</h3>${readablePreviews.map((chunk) =>
        `<section class="preview-chunk"><h4>Extracted content · page ${chunk.page_start || "—"}</h4><div class="preview-text">${readableTextHtml(chunk.content)}</div></section>`
      ).join("")}` : (item.previews || []).length
        ? `${extractionNote}<p class="resource-inline-error">The PDF text extractor returned unreadable characters for these pages. The original PDF above shows the actual document; the app will not substitute guessed text.</p>`
        : "<p>No extracted text is available. Scanned documents need OCR.</p>";
      const detectedSections = item.sections || [];
      const weeklyLessons = item.weekly_lessons || [];
      const suggestions = detectedSections.length || weeklyLessons.length
        ? `<h3>Indexed curriculum content</h3><p>Review each suggested classification against the original resource. Only entries marked verified with the correct type appear as curriculum hierarchy choices; ordinary verified resource text remains searchable as source material.</p>${detectedContentTabsHtml(detectedSections, weeklyLessons, documentId, "", "resource-preview")}`
        : "<p>No sections have been indexed for review yet. Verify the resource to index its extracted text, then extract explicitly labelled curriculum headings. Confirm each detected type before it is exposed as a verified hierarchy choice.</p>";
      openPreview(item.title, `${originalPreview}<div class="resource-preview-extracted">${sourcePreview}</div><div class="extracted-sections">${suggestions}</div>`);
      const docxContainer = previewContent.querySelector("[data-preview-docx-render]");
      if (docxContainer) {
        docxContainer.setAttribute("aria-busy", "true");
        try {
          await window.akademiCurriculumDocxRenderer.render(
            `${root.dataset.reviewBase}/${documentId}/source`,
            docxContainer
          );
          if (previewVersion === previewRequestVersion) docxContainer.removeAttribute("aria-busy");
        } catch (error) {
          if (previewVersion !== previewRequestVersion) return;
          docxContainer.removeAttribute("aria-busy");
          docxContainer.innerHTML = `<p class="resource-inline-error" role="alert">${escapeHtml(error instanceof Error ? error.message : "The original Word document could not be rendered.")}</p>`;
        }
      }
    } catch (error) {
      if (previewVersion !== previewRequestVersion) return;
      openPreview("Resource preview unavailable", `<p class="resource-inline-error">${escapeHtml(error instanceof Error ? error.message : "Resource preview failed.")}</p>`);
    }
  }
  async function loadStructureReview(card, force = false) {
    const panel = card.querySelector("[data-structure-review-content]");
    if (!panel || (panel.dataset.loaded === "true" && !force)) return;
    panel.dataset.loaded = "loading";
    panel.innerHTML = "<p>Loading extracted sections and review items…</p>";
    try {
      const item = await api(`${root.dataset.reviewBase}/${panel.dataset.documentId}`);
      const structureButton = card.querySelector("[data-structure]");
      if (structureButton) structureButton.dataset.extractionStatus = item.extraction_status;
      const extractedText = (item.previews || []).length
        ? `<details class="resource-raw-excerpts"><summary>Extracted source text · first ${item.previews.length} text sections</summary>${item.previews.map((chunk) => `<section class="resource-raw-excerpt"><strong>Page ${escapeHtml(chunk.page_start || "—")}</strong><div class="preview-text">${readableTextHtml(chunk.content)}</div></section>`).join("")}</details>`
        : "";
      const emptyMessage = item.extraction_status !== "extracted"
      ? `<p>${item.extraction_status === "needs_ocr"
        ? "This document has no selectable text. Run OCR and refresh the resource before scanning curriculum sections."
        : item.extraction_status === "failed"
          ? "Text extraction failed. Retry or repair extraction, then refresh this resource before scanning its structure."
          : "Text extraction is still processing. Use “Extract curriculum sections” to check again when source text is ready."}</p>`
      : "<p>No source-derived sections have been stored yet. The deterministic scanner runs automatically when this resource is opened; use “Extract curriculum sections” to retry or continue through the remaining text batches.</p>";
      panel.innerHTML = `<p>The scanner records explicit source labels and week-by-week details without using AI. Confirm classifications against the original resource before verifying them.</p>${detectedContentTabsHtml(item.sections || [], item.weekly_lessons || [], item.id, emptyMessage)}${extractedText}`;
      panel.dataset.loaded = "true";
      panel.dataset.detectedItems = String((item.sections || []).length + (item.weekly_lessons || []).length);
    } catch (error) {
      panel.dataset.loaded = "false";
      panel.innerHTML = `<p class="resource-inline-error">${escapeHtml(error instanceof Error ? error.message : "Could not load curriculum sections.")}</p>`;
    }
  }
  function isReadableText(value) {
    const text = String(value || "");
    const characters = Math.max(1, [...text].length);
    const replacements = (text.match(/\uFFFD/g) || []).length;
    const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
    return replacements / characters <= 0.01 && controls / characters <= 0.01;
  }
  document.addEventListener("click", async (event) => {
    const detectedTab = event.target.closest("[data-detected-content-tab]");
    if (detectedTab) {
      const tabs = detectedTab.closest("[data-detected-content-tabs]");
      tabs.querySelectorAll("[data-detected-content-tab]").forEach((tab) => {
        const active = tab === detectedTab;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      tabs.querySelectorAll("[data-detected-content-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.detectedContentPanel !== detectedTab.dataset.detectedContentTab;
      });
      return;
    }
    const metadataBadge = event.target.closest("[data-metadata-option]");
    if (metadataBadge) {
      const name = metadataBadge.dataset.metadataOption;
      const badgeGroup = metadataBadge.closest(".curriculum-modal-badges");
      const metadataInput = metadataBadge.closest(".metadata-fields").querySelector(`[data-metadata="${name}"]`);
      if (name === "year_group") {
        const selected = new Set(yearGroups(metadataInput.value));
        const value = metadataBadge.dataset.value;
        if (!value) {
          selected.clear();
        } else if (selected.has(value)) {
          selected.delete(value);
        } else {
          selected.add(value);
        }
        metadataInput.value = ["SHS1", "SHS2", "SHS3"].filter((year) => selected.has(year)).join(",");
        badgeGroup.querySelectorAll("button[data-value]").forEach((button) => {
          const active = button.dataset.value ? selected.has(button.dataset.value) : selected.size === 0;
          button.setAttribute("aria-pressed", String(active));
        });
      } else {
        selectBadgeValue(badgeGroup, `[data-metadata="${name}"]`, metadataBadge.dataset.value);
      }
      if (name === "resource_role") {
        const card = metadataBadge.closest(".curriculum-card");
        const wrapper = card.querySelector("[data-metadata-other-type-wrap]");
        const labelInput = card.querySelector('[data-metadata="resource_type_label"]');
        const isOther = metadataBadge.dataset.value === "other";
        wrapper.hidden = !isOther;
        labelInput.required = isOther;
        if (!isOther) labelInput.value = "";
      }
      return;
    }
    const reviewCheckBadge = event.target.closest("[data-review-check-option]");
    if (reviewCheckBadge) {
      const selected = reviewCheckBadge.getAttribute("aria-pressed") !== "true";
      reviewCheckBadge.setAttribute("aria-pressed", String(selected));
      if (reviewCheckBadge.dataset.value === "other") {
        const wrapper = reviewCheckBadge.closest(".resource-review-checks").querySelector("[data-review-other-wrap]");
        const textarea = wrapper.querySelector("[data-review-other-notes]");
        wrapper.hidden = !selected;
        textarea.required = selected;
      }
      return;
    }
    const sectionTypeBadge = event.target.closest("[data-section-type-option]");
    if (sectionTypeBadge) {
      selectBadgeValue(
        sectionTypeBadge.closest(".curriculum-modal-badges"),
        `[data-section-type="${CSS.escape(sectionTypeBadge.dataset.sectionTypeOption)}"]`,
        sectionTypeBadge.dataset.value
      );
      return;
    }
    const sectionStateBadge = event.target.closest("[data-section-status-option]");
    if (sectionStateBadge) {
      selectBadgeValue(
        sectionStateBadge.closest(".curriculum-modal-badges"),
        `[data-section-status="${CSS.escape(sectionStateBadge.dataset.sectionStatusOption)}"]`,
        sectionStateBadge.dataset.value
      );
      return;
    }
    const bulkSectionButton = event.target.closest("[data-bulk-verify-sections]");
    if (bulkSectionButton) {
      const sectionList = bulkSectionButton.closest("[data-section-bulk-review]");
      const selected = Array.from(sectionList.querySelectorAll("[data-select-section]:checked"));
      if (!selected.length) return;
      const documentId = bulkSectionButton.dataset.bulkVerifySections;
      bulkSectionButton.disabled = true;
      bulkSectionButton.textContent = `Verifying ${selected.length} sections…`;
      const outcomes = await Promise.all(selected.map(async (checkbox) => {
        const sectionId = checkbox.dataset.selectSection;
        const controls = checkbox.closest(".preview-section-review");
        const title = controls.querySelector("summary > span:first-child").textContent.trim();
        try {
          const sectionType = controls.querySelector(`[data-section-type="${CSS.escape(sectionId)}"]`).value;
          await api(`${root.dataset.reviewBase}/${documentId}/sections/${sectionId}/review`, "POST", {
            section_type: sectionType,
            status: "verified",
            review_notes: controls.querySelector(`[data-section-note="${CSS.escape(sectionId)}"]`).value
          });
          return { sectionId, title, success: true };
        } catch (error) {
          return { sectionId, title, success: false, message: error instanceof Error ? error.message : "Verification failed." };
        }
      }));
      const succeeded = outcomes.filter((result) => result.success);
      const failed = outcomes.filter((result) => !result.success);
      const card = sectionList.closest(".curriculum-card");
      if (card) {
        await loadStructureReview(card, true);
      } else {
        await preview(documentId);
      }
      const reviewScope = card || previewContent;
      const refreshedSectionList = reviewScope.querySelector("[data-section-bulk-review]");
      if (refreshedSectionList && failed.length) {
        const failedIds = new Set(failed.map((result) => result.sectionId));
        refreshedSectionList.querySelectorAll(".preview-section-review").forEach((section) => {
          const checkbox = section.querySelector("[data-select-section]");
          checkbox.checked = failedIds.has(checkbox.dataset.selectSection);
        });
        updateSectionBulkToolbar(refreshedSectionList);
      }
      if (failed.length) {
        const failures = failed.map((result) => `${result.title}: ${result.message}`).join("\n");
        show(`${succeeded.length} section${succeeded.length === 1 ? "" : "s"} verified; ${failed.length} failed. Failed sections remain selected for retry.\n${failures}`);
      } else {
        show(`${succeeded.length} section${succeeded.length === 1 ? "" : "s"} verified successfully with their selected classifications.`, true);
      }
      return;
    }
    const openReviewButton = event.target.closest("[data-open-resource-review]");
    if (openReviewButton) {
      const card = openReviewButton.closest(".curriculum-card");
      const dialog = card.querySelector(".resource-review-dialog");
      dialog.showModal();
      await loadStructureReview(card);
      const panel = card.querySelector("[data-structure-review-content]");
      const structureButton = card.querySelector("[data-structure]");
      const documentId = structureButton?.dataset.structure;
      const autoKey = `curriculum-structure-auto:${documentId}`;
      if (panel && structureButton && documentId
        && Number(panel.dataset.detectedItems || 0) === 0
        && structureButton.dataset.extractionStatus === "extracted"
        && sessionStorage.getItem(autoKey) !== "started") {
        sessionStorage.setItem(autoKey, "started");
        structureButton.click();
      }
      return;
    }
    const enabledButton = event.target.closest("[data-toggle-enabled]");
    const deleteButton = event.target.closest("[data-delete-resource]");
    if (deleteButton) {
      const card = deleteButton.closest(".curriculum-card");
      const title = card.querySelector("h2")?.textContent.trim() || "this resource";
      if (!(await window.akademiAlert.confirm(
        `Permanently delete “${title}”, its extracted text, classifications and uploaded file? This cannot be undone.`,
        { title: "Delete curriculum resource", confirmText: "Delete permanently" }
      ))) return;
      deleteButton.disabled = true;
      try {
        const result = await api(`${root.dataset.reviewBase}/${deleteButton.dataset.deleteResource}`, "DELETE", {});
        await load(currentPage);
        show(result.cleanup_pending
          ? "Resource record deleted, but private-file cleanup needs administrator attention. The failure was logged."
          : "Resource, extracted content and uploaded file permanently deleted.", !result.cleanup_pending);
      } catch (error) {
        show(error instanceof Error ? error.message : "The curriculum resource could not be deleted.");
        deleteButton.disabled = false;
      }
      return;
    }
    if (enabledButton) {
      const card = enabledButton.closest(".curriculum-card");
      const currentlyEnabled = enabledButton.dataset.enabled === "true";
      const nextEnabled = !currentlyEnabled;
      const documentId = enabledButton.dataset.toggleEnabled;
      const action = nextEnabled ? "enable" : "disable";
      if (!nextEnabled && !(await window.akademiAlert.confirm(
        "This resource will remain in the library but will no longer be used by teacher AI tools until enabled again.",
        { title: "Disable curriculum resource", confirmText: "Disable resource" }
      ))) return;
      enabledButton.disabled = true;
      try {
        await api(`${root.dataset.reviewBase}/${documentId}/enabled`, "POST", { enabled: nextEnabled });
        show(`Resource ${nextEnabled ? "enabled" : "disabled"}${nextEnabled ? " and available to AI tools" : " and excluded from AI search and planning"}.`, true);
        await load(currentPage);
      } catch (error) {
        show(error instanceof Error ? error.message : `Resource could not be ${action}d.`);
        enabledButton.disabled = false;
      }
      return;
    }
    const closeReviewButton = event.target.closest("[data-close-resource-review]");
    if (closeReviewButton) {
      closeReviewButton.closest("dialog").close();
      return;
    }
    const aiPreviewButton = event.target.closest("[data-ai-preview]");
    if (aiPreviewButton) {
      const documentId = aiPreviewButton.dataset.aiPreview;
      const status = aiPreviewButton.closest(".curriculum-card").querySelector("[data-action-status]");
      const title = aiPreviewButton.closest(".curriculum-card").querySelector("h2").textContent;
      openPreview(title, '<p class="resource-preview-loading">AI is preparing a readable explanation from the extracted source text…</p>');
      status.className = "resource-action-status is-loading";
      status.textContent = "Generating a resource guide. Exact page content remains available in the original PDF preview.";
      aiPreviewButton.disabled = true;
      try {
        const result = await api(`${root.dataset.reviewBase}/${documentId}/preview-ai`, "POST", {});
        const fileLink = `<p class="resource-ai-source-link"><a href="${root.dataset.reviewBase}/${documentId}/file" target="_blank" rel="noopener noreferrer">Open original PDF</a></p>`;
        openPreview(title, `<article class="resource-ai-guide">${readableTextHtml(result.preview)}<p class="resource-ai-notice">${escapeHtml(result.notice)}${result.pages_used ? ` · ${result.pages_used} source pages analyzed` : ""}</p>${fileLink}</article>`);
        status.className = "resource-action-status";
        status.textContent = "";
      } catch (error) {
        openPreview(`${title} · AI preview unavailable`, `<p class="resource-inline-error">${escapeHtml(error instanceof Error ? error.message : "AI preview could not be generated.")}</p><p>Open the original PDF to inspect the source content.</p><p><a href="${root.dataset.reviewBase}/${documentId}/file" target="_blank" rel="noopener noreferrer">Open original PDF</a></p>`);
        status.className = "resource-action-status is-error";
        status.textContent = "AI preview was not generated. Open the original PDF for exact resource content.";
      } finally {
        aiPreviewButton.disabled = false;
      }
      return;
    }
    const metadataButton = event.target.closest("[data-save-metadata]");
    if (metadataButton) {
      const card = metadataButton.closest(".curriculum-card");
      metadataButton.disabled = true;
      try {
        await api(`${root.dataset.reviewBase}/${metadataButton.dataset.saveMetadata}/metadata`, "POST", {
          year_groups: yearGroups(card.querySelector('[data-metadata="year_group"]').value),
          subject_name: card.querySelector('[data-metadata="subject_name"]').value,
          resource_role: card.querySelector('[data-metadata="resource_role"]').value,
          resource_type_label: card.querySelector('[data-metadata="resource_type_label"]').value
        });
        show("Resource year, subject and type saved. These details are not a verification.", true);
      } catch (error) {
        show(error instanceof Error ? error.message : "Resource details could not be saved.");
      } finally {
        metadataButton.disabled = false;
      }
      return;
    }
    const previewButton = event.target.closest("[data-preview]");
    if (previewButton) {
      await preview(previewButton.dataset.preview);
      return;
    }
    const readButton = event.target.closest("[data-read-resource]");
    if (readButton) {
      const documentId = readButton.dataset.readResource;
      window.akademiCurriculumReader.open(
        documentId,
        `${root.dataset.reviewBase}/${documentId}/reader`,
        `${root.dataset.reviewBase}/${documentId}/source`
      );
      return;
    }
    const structureButton = event.target.closest("[data-structure]");
    if (structureButton) {
      const card = structureButton.closest(".curriculum-card");
      const status = card.querySelector("[data-structure-status]");
      structureButton.disabled = true;
      structureButton.analysisPromise = (async () => {
        try {
          if (structureButton.dataset.complete === "true") {
            structureButton.dataset.complete = "false";
            structureButton.dataset.offset = "0";
            sessionStorage.setItem(`curriculum-structure-offset:${structureButton.dataset.structure}`, "0");
          }
          status.className = "resource-action-status is-loading";
          status.textContent = "Checking extracted text before scanning its structure…";
          await loadStructureReview(card, true);
          if (structureButton.dataset.extractionStatus !== "extracted") {
            const extractionState = structureButton.dataset.extractionStatus;
            status.className = "resource-action-status is-error";
            status.textContent = extractionState === "needs_ocr"
              ? "This file has no selectable text. Run OCR on the source, then refresh and analyze it."
              : extractionState === "failed"
                ? "Text extraction failed. Retry extraction and refresh this resource before scanning its structure."
                : "Text extraction is still processing. Try extracting the sections again after extraction completes.";
            return;
          }
          let offset = Number(structureButton.dataset.offset || 0);
          let created = 0;
          let existing = 0;
          let weeklyCreated = 0;
          let weeklyExisting = 0;
          let batch = 0;
          while (true) {
            batch++;
            status.textContent = `Scanning source text batch ${batch}… Detected items remain unverified until reviewed.`;
            const result = await api(`${root.dataset.reviewBase}/${structureButton.dataset.structure}/structure`, "POST", { offset });
            created += Number(result.created || 0);
            existing += Number(result.existing || 0);
            weeklyCreated += Number(result.weekly_lessons_created || 0);
            weeklyExisting += Number(result.weekly_lessons_existing || 0);
            if (result.next_offset === null) {
              structureButton.dataset.complete = "true";
              structureButton.dataset.offset = "0";
              sessionStorage.setItem(`curriculum-structure-offset:${structureButton.dataset.structure}`, "done");
              break;
            }
            const nextOffset = Number(result.next_offset);
            if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
              throw new Error("The curriculum scanner returned an invalid next batch offset.");
            }
            offset = nextOffset;
            structureButton.dataset.offset = String(offset);
            structureButton.textContent = `Extract next batch (from text section ${offset + 1})`;
            sessionStorage.setItem(`curriculum-structure-offset:${structureButton.dataset.structure}`, String(offset));
          }
          structureButton.textContent = "Extract curriculum sections again";
          await loadStructureReview(card, true);
          status.className = "resource-action-status is-success";
          status.textContent = `${created} new unverified curriculum section${created === 1 ? "" : "s"} and ${weeklyCreated} new unverified weekly lesson${weeklyCreated === 1 ? "" : "s"} identified; ${existing} sections and ${weeklyExisting} weekly lessons already existed. All extracted text batches were scanned.`;
          show(`Source scan found ${created} unverified curriculum section${created === 1 ? "" : "s"} and ${weeklyCreated} week-by-week lesson${weeklyCreated === 1 ? "" : "s"} across ${batch} batch${batch === 1 ? "" : "es"}. Review them against the source before verifying.`, true);
        } catch (error) {
          sessionStorage.removeItem(`curriculum-structure-auto:${structureButton.dataset.structure}`);
          const reason = error instanceof Error ? error.message : "The source scan failed.";
          status.className = "resource-action-status is-error";
          status.textContent = `Curriculum source scan stopped. ${reason} Any earlier batches remain saved as unverified detected items.`;
          show("Curriculum source scan did not finish. See the message beside the extraction button for details.");
          throw error;
        } finally {
          structureButton.disabled = false;
          delete structureButton.analysisPromise;
        }
      })();
      try {
        await structureButton.analysisPromise;
      } catch {
        return;
      }
      return;
    }
    const sectionReviewButton = event.target.closest("[data-review-section]");
    if (sectionReviewButton) {
      const sectionId = sectionReviewButton.dataset.reviewSection;
      const documentId = sectionReviewButton.dataset.documentId;
      const status = sectionReviewButton.closest(".preview-section-review");
      sectionReviewButton.disabled = true;
      sectionReviewButton.textContent = "Saving section review…";
      try {
        await api(`${root.dataset.reviewBase}/${documentId}/sections/${sectionId}/review`, "POST", {
          section_type: status.querySelector(`[data-section-type="${CSS.escape(sectionId)}"]`).value,
          status: status.querySelector(`[data-section-status="${CSS.escape(sectionId)}"]`).value,
          review_notes: status.querySelector(`[data-section-note="${CSS.escape(sectionId)}"]`).value
        });
        show("Curriculum section type and review decision saved.", true);
        const inlineCard = sectionReviewButton.closest(".curriculum-card");
        if (inlineCard) {
          await loadStructureReview(inlineCard, true);
        } else {
          await preview(documentId);
          await load(currentPage);
        }
      } catch (error) {
        show(error instanceof Error ? error.message : "The curriculum section review could not be saved.");
        sectionReviewButton.disabled = false;
        sectionReviewButton.textContent = "Save section review";
      }
      return;
    }
    const weeklyReviewButton = event.target.closest("[data-review-weekly]");
    if (weeklyReviewButton) {
      const lessonId = weeklyReviewButton.dataset.reviewWeekly;
      const documentId = weeklyReviewButton.dataset.documentId;
      const fields = weeklyReviewButton.closest("[data-weekly-lesson-review]");
      weeklyReviewButton.disabled = true;
      weeklyReviewButton.textContent = "Saving weekly lesson…";
      try {
        await api(`${root.dataset.reviewBase}/${documentId}/weekly-lessons/${lessonId}/review`, "POST", {
          semester_number: fields.querySelector(`[data-weekly-semester="${CSS.escape(lessonId)}"]`).value,
          week_number: fields.querySelector(`[data-weekly-week="${CSS.escape(lessonId)}"]`).value,
          topic: fields.querySelector(`[data-weekly-topic="${CSS.escape(lessonId)}"]`).value,
          focal_areas: fields.querySelector(`[data-weekly-focal="${CSS.escape(lessonId)}"]`).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          assessment_mode: fields.querySelector(`[data-weekly-assessment="${CSS.escape(lessonId)}"]`).value,
          status: fields.querySelector(`[data-weekly-status="${CSS.escape(lessonId)}"]`).value,
          review_notes: fields.querySelector(`[data-weekly-note="${CSS.escape(lessonId)}"]`).value
        });
        show("Weekly lesson review saved.", true);
        await loadStructureReview(weeklyReviewButton.closest(".curriculum-card"), true);
      } catch (error) {
        show(error instanceof Error ? error.message : "The weekly lesson review could not be saved.");
        weeklyReviewButton.disabled = false;
        weeklyReviewButton.textContent = "Save weekly lesson review";
      }
      return;
    }
    const reviewButton = event.target.closest("[data-review]");
    if (!reviewButton) return;
    const card = reviewButton.closest(".curriculum-card");
    if (reviewButton.dataset.review === "rejected" && !(await window.akademiAlert.confirm(
      "Reject this document for curriculum-grounded AI use?",
      { title: "Reject curriculum source", confirmText: "Reject source" }
    ))) return;
    let reviewNotes = "";
    try {
      reviewNotes = reviewNotesFromCard(card, reviewButton.dataset.review === "verified");
    } catch (error) {
      show(error instanceof Error ? error.message : "Select what you checked before verifying.");
      return;
    }
    const payload = {
      status: reviewButton.dataset.review,
      source_reference: card.querySelector('[data-field="source_reference"]').value,
      source_url: card.querySelector('[data-field="source_url"]').value,
      review_notes: reviewNotes
    };
    reviewButton.disabled = true;
    try {
      const result = await api(`${root.dataset.reviewBase}/${reviewButton.dataset.id}/review`, "POST", payload);
      const verifiedWeeklyCount = Array.isArray(result.document?.weekly_lessons)
        ? result.document.weekly_lessons.filter((lesson) => lesson.review_status === "verified").length
        : 0;
      show(payload.status === "verified"
        ? `Source verified. Searchable curriculum excerpts are now eligible for grounded AI requests. ${verifiedWeeklyCount} associated weekly lesson${verifiedWeeklyCount === 1 ? " is" : "s are"} verified.`
        : "Document rejected for curriculum retrieval.", true);
      reviewButton.closest(".resource-review-dialog")?.close();
      await load(currentPage);
    } catch (error) {
      show(error instanceof Error ? error.message : "Review status could not be updated.");
      reviewButton.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    const currentTab = event.target.closest("[data-detected-content-tab]");
    if (!currentTab) return;
    const tabList = currentTab.closest('[role="tablist"]');
    const tabs = Array.from(tabList.querySelectorAll("[data-detected-content-tab]"));
    const index = tabs.indexOf(currentTab);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-select-section]")) return;
    updateSectionBulkToolbar(event.target.closest("[data-section-bulk-review]"));
  });
  document.getElementById("curriculum-pagination").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button && !button.disabled) load(Number(button.dataset.page));
  });
  let filterTimer = 0;
  filterForm.elements.namedItem("q").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => load(1), 250);
  });
  filterForm.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-value]");
    if (!button) return;
    const group = button.closest("[data-filter-badges]");
    const name = group.dataset.filterBadges;
    const selected = selectedFilterValues(name);
    const value = button.dataset.filterValue;
    if (value === "") {
      selected.clear();
    } else if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
    syncFilterBadges(name);
    load(1);
  });
  filterForm.querySelector("[data-clear-filters]").addEventListener("click", () => {
    filterForm.elements.namedItem("q").value = "";
    selectedYears.clear();
    selectedRoles.clear();
    syncFilterBadges("year_groups");
    syncFilterBadges("resource_roles");
    load(1);
  });
  document.getElementById("refresh-curriculum").addEventListener("click", () => load(currentPage));
  list.addEventListener("change", (event) => {
    if (event.target.matches("[data-select-resource]")) updateBulkToolbar();
  });
  bulkToolbar.querySelector("[data-select-visible]").addEventListener("click", () => {
    list.querySelectorAll("[data-select-resource]").forEach((checkbox) => {
      checkbox.checked = true;
    });
    updateBulkToolbar();
  });
  bulkToolbar.querySelector("[data-clear-selection]").addEventListener("click", () => {
    list.querySelectorAll("[data-select-resource]:checked").forEach((checkbox) => {
      checkbox.checked = false;
    });
    updateBulkToolbar();
  });
  bulkToolbar.querySelector("[data-bulk-verify]").addEventListener("click", () => {
    const selected = Array.from(list.querySelectorAll("[data-select-resource]:checked"));
    if (!selected.length) return;
    bulkVerifyDialog.querySelector("[data-bulk-verify-summary]").textContent =
      `${selected.length} selected resource${selected.length === 1 ? "" : "s"} will be verified if each passes the existing source and extraction checks. Review every source before proceeding.`;
    bulkVerifyDialog.querySelector("[data-bulk-verify-status]").textContent = "";
    bulkVerifyDialog.showModal();
    bulkVerifyForm.elements.namedItem("review_notes").focus();
  });
  bulkVerifyDialog.querySelector("[data-close-bulk-verify]").addEventListener("click", () => bulkVerifyDialog.close());
  bulkVerifyDialog.querySelector("[data-cancel-bulk-verify]").addEventListener("click", () => bulkVerifyDialog.close());
  bulkVerifyDialog.addEventListener("cancel", (event) => {
    if (bulkVerifyForm.querySelector("[data-submit-bulk-verify]").disabled) event.preventDefault();
  });
  bulkVerifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = Array.from(list.querySelectorAll("[data-select-resource]:checked"));
    if (!selected.length) {
      bulkVerifyDialog.close();
      return;
    }
    const reviewNotes = bulkVerifyForm.elements.namedItem("review_notes").value.trim();
    const submitButton = bulkVerifyForm.querySelector("[data-submit-bulk-verify]");
    const closeButton = bulkVerifyDialog.querySelector("[data-close-bulk-verify]");
    const cancelButton = bulkVerifyForm.querySelector("[data-cancel-bulk-verify]");
    const status = bulkVerifyForm.querySelector("[data-bulk-verify-status]");
    submitButton.disabled = true;
    closeButton.disabled = true;
    cancelButton.disabled = true;
    status.textContent = `Verifying ${selected.length} resource${selected.length === 1 ? "" : "s"}…`;
    const outcomes = await Promise.all(selected.map(async (checkbox) => {
      const card = checkbox.closest(".curriculum-card");
      const documentId = checkbox.value;
      const title = card.querySelector("h2").textContent.trim();
      const sourceReference = card.querySelector('[data-field="source_reference"]').value.trim() || title;
      const sourceUrl = card.querySelector('[data-field="source_url"]').value.trim();
      try {
        await api(`${root.dataset.reviewBase}/${documentId}/review`, "POST", {
          status: "verified",
          source_reference: sourceReference,
          source_url: sourceUrl,
          review_notes: reviewNotes
        });
        return { title, success: true };
      } catch (error) {
        return { title, success: false, message: error instanceof Error ? error.message : "Verification failed." };
      }
    }));
    const succeeded = outcomes.filter((result) => result.success);
    const failed = outcomes.filter((result) => !result.success);
    await load(currentPage);
    if (failed.length === 0) {
      show(`${succeeded.length} resource${succeeded.length === 1 ? "" : "s"} verified successfully.`, true);
      bulkVerifyForm.reset();
      bulkVerifyDialog.close();
    } else {
      const failures = failed.map((result) => `${result.title}: ${result.message}`).join("\n");
      status.textContent = `${succeeded.length} verified; ${failed.length} could not be verified. Select the failed resources again after resolving the listed issues.\n${failures}`;
      show(`${succeeded.length} verified; ${failed.length} failed. See details in the verification dialog.`);
    }
    submitButton.disabled = false;
    closeButton.disabled = false;
    cancelButton.disabled = false;
  });
  list.addEventListener("click", (event) => {
    if (event.target.matches(".resource-review-dialog")) {
      const bounds = event.target.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) event.target.close();
    }
  });
  previewDialog.querySelector("[data-close-preview]").addEventListener("click", () => previewDialog.close());
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) previewDialog.close();
  });
  list.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-curriculum]")) load(currentPage);
  });
  list.addEventListener("click", async (event) => {
    const retryButton = event.target.closest("[data-retry-extraction]");
    if (!retryButton) return;
    const originalLabel = retryButton.textContent;
    retryButton.disabled = true;
    retryButton.textContent = "Retrying extraction…";
    try {
      await processUploadedResources([{
        document_id: Number(retryButton.dataset.retryExtraction),
        name: retryButton.dataset.resourceName || "Resource",
      }], "Retrying text extraction.", ++uploadAnalysisVersion);
    } finally {
      retryButton.disabled = false;
      retryButton.textContent = originalLabel;
    }
  });
  const uploadForm = document.getElementById("curriculum-upload-form");
  const uploadButton = document.getElementById("curriculum-upload-submit");
  const uploadFiles = document.getElementById("curriculum-upload-files");
  const uploadResourceRole = uploadForm.elements.namedItem("resource_role");
  const uploadOtherType = uploadForm.querySelector("[data-upload-other-type]");
  const uploadOtherTypeInput = uploadForm.elements.namedItem("resource_type_label");
  const uploadResult = document.getElementById("curriculum-upload-result");
  const filePreview = document.getElementById("upload-file-preview");
  const uploadProgress = document.getElementById("curriculum-upload-progress");
  const uploadProgressLabel = document.getElementById("curriculum-upload-progress-label");
  const uploadProgressBar = document.getElementById("curriculum-upload-progress-bar");
  const uploadDialog = document.getElementById("curriculum-upload-dialog");
  const uploadWeeklyResults = document.getElementById("curriculum-upload-weekly-results");
  let uploadAnalysisVersion = 0;
  function renderUploadedWeeklyResults(resources, emptyMessage = "") {
    uploadWeeklyResults.replaceChildren();
    uploadWeeklyResults.hidden = false;
    const heading = document.createElement("h3");
    heading.textContent = "Weekly topics and focal areas";
    uploadWeeklyResults.append(heading);
    const note = document.createElement("p");
    note.textContent = "Source-derived entries are unverified. Check each item against the uploaded resource before using it for planning.";
    uploadWeeklyResults.append(note);
    const lessons = resources.flatMap((resource) => (resource.lessons || []).map((lesson) => ({ resource, lesson })));
    if (!lessons.length) {
      const empty = document.createElement("p");
      empty.className = "upload-weekly-empty";
      empty.textContent = emptyMessage || (resources.length
        ? "No explicit week-by-week topic and focal-area entries were detected in the extracted text. Review the source and its structure panel."
        : "No extracted text resource was available for a weekly topic scan. Scanned PDFs may need OCR; duplicate files were not scanned again.");
      uploadWeeklyResults.append(empty);
      return;
    }
    for (const resource of resources) {
      const resourceLessons = resource.lessons || [];
      if (!resourceLessons.length) continue;
      const section = document.createElement("section");
      section.className = "upload-weekly-resource";
      const resourceHeading = document.createElement("h4");
      resourceHeading.textContent = `${resource.name} · ${resourceLessons.length} weekly lesson${resourceLessons.length === 1 ? "" : "s"}`;
      section.append(resourceHeading);
      const tableWrap = document.createElement("div");
      tableWrap.className = "upload-weekly-table-wrap";
      const table = document.createElement("table");
      const header = document.createElement("thead");
      const headerRow = document.createElement("tr");
      ["Week", "Topic", "Focal areas", "Learning indicators", "Learning outcomes", "Assessment schedule", "Review"].forEach((label) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        headerRow.append(cell);
      });
      header.append(headerRow);
      const body = document.createElement("tbody");
      resourceLessons.forEach((lesson) => {
        const row = document.createElement("tr");
        const values = [
          `${lesson.semester_number ? `Sem ${lesson.semester_number} · ` : ""}Week ${lesson.week_number}`,
          lesson.topic || "—",
          Array.isArray(lesson.focal_areas) && lesson.focal_areas.length ? lesson.focal_areas.join("\n") : "—",
          Array.isArray(lesson.learning_indicators) && lesson.learning_indicators.length ? lesson.learning_indicators.join("\n") : "—",
          Array.isArray(lesson.learning_outcomes) && lesson.learning_outcomes.length ? lesson.learning_outcomes.join("\n") : "—",
          lesson.assessment_mode || "—",
          statusLabel(lesson.review_status || "unreviewed")
        ];
        values.forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        });
        body.append(row);
      });
      table.append(header, body);
      tableWrap.append(table);
      section.append(tableWrap);
      uploadWeeklyResults.append(section);
    }
  }
  async function analyzeUploadedResources(uploadedDocuments, uploadSummary, version) {
    const weeklyResults = [];
    const failures = [];
    for (const [index, uploaded] of uploadedDocuments.entries()) {
      try {
        let offset = 0;
        while (true) {
          const result = await api(`${root.dataset.reviewBase}/${uploaded.document_id}/structure`, "POST", { offset });
          if (result.next_offset === null) break;
          const nextOffset = Number(result.next_offset);
          if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
            throw new Error("The curriculum scanner returned an invalid next batch offset.");
          }
          offset = nextOffset;
        }
        const resource = await api(`${root.dataset.reviewBase}/${uploaded.document_id}`);
        weeklyResults.push({ name: uploaded.name, lessons: resource.weekly_lessons || [] });
        if (version === uploadAnalysisVersion) {
          renderUploadedWeeklyResults(weeklyResults, `Scanning weekly topics · resource ${index + 1} of ${uploadedDocuments.length}…`);
        }
      } catch (error) {
        failures.push(`${uploaded.name}: ${error instanceof Error ? error.message : "source scan failed"}`);
      }
    }
    if (version !== uploadAnalysisVersion) return;
    renderUploadedWeeklyResults(weeklyResults, failures.length
      ? `Automatic weekly topic scan could not finish for ${failures.length} resource${failures.length === 1 ? "" : "s"}. Review each uploaded resource and retry the scan.`
      : "");
    if (failures.length) {
      uploadResult.textContent = `${uploadSummary} Uploads are ready. Weekly topic scan failed for ${failures.length} resource${failures.length === 1 ? "" : "s"}: ${failures.join(" · ")}`;
      show(uploadResult.textContent);
    } else {
      uploadResult.textContent = `${uploadSummary} Uploads are ready. Weekly topic and focal-area scan is complete; review detected entries against the source before verifying them.`;
      show("Resources uploaded and weekly topic scan completed. Review detected entries against the source.", true);
    }
    if (uploadDialog.open) uploadWeeklyResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function processUploadedResources(queuedDocuments, uploadSummary, version) {
    let refreshInProgress = false;
    let lastStatusSummary = "";
    const refreshTimer = window.setInterval(async () => {
      if (document.hidden || refreshInProgress || version !== uploadAnalysisVersion) return;
      refreshInProgress = true;
      try {
        const result = await load(currentPage, { quiet: true });
        if (!result || version !== uploadAnalysisVersion) return;
        const ids = new Set(queuedDocuments.map((item) => Number(item.document_id)));
        const statuses = result.documents.filter((item) => ids.has(Number(item.id)));
        if (!statuses.length) return;
        const processing = statuses.filter((item) => item.extraction_status === "processing").length;
        const queued = statuses.filter((item) => item.extraction_status === "queued").length;
        const statusSummary = `${processing}:${queued}`;
        if (statusSummary !== lastStatusSummary) {
          lastStatusSummary = statusSummary;
          uploadResult.textContent = `${uploadSummary} Text extraction: ${processing} processing, ${queued} queued.`;
        }
      } finally {
        refreshInProgress = false;
      }
    }, 5_000);
    try {
      const result = await api(
        `${root.dataset.listUrl}/process-queued`,
        "POST",
        { document_ids: queuedDocuments.map((item) => Number(item.document_id)) },
        { keepalive: true }
      );
      await load(currentPage);
      if (version !== uploadAnalysisVersion) return;
      const documents = result.documents || [];
      const extractedDocuments = documents.filter((item) => item.status === "extracted");
      const needsOcr = documents.filter((item) => item.status === "needs_ocr").length;
      const failed = documents.filter((item) => item.status === "failed").length;
      const stillProcessing = documents.filter((item) => item.status === "processing" || item.status === "queued").length;
      if (extractedDocuments.length) {
        uploadResult.textContent = `${uploadSummary} Text extraction completed for ${extractedDocuments.length} resource${extractedDocuments.length === 1 ? "" : "s"}.`;
        void analyzeUploadedResources(extractedDocuments, uploadSummary, version).catch((error) => {
          const message = error instanceof Error ? error.message : "source scan failed";
          uploadResult.textContent = `${uploadSummary} Upload is complete, but the weekly scan could not finish: ${message}. Review the resource and retry the scan.`;
          show("Resources uploaded successfully; the weekly scan could not finish. Review the resource to retry.");
        });
      } else if (failed || stillProcessing) {
        const failedDocuments = documents.filter((item) => item.status === "failed");
        const failureDetails = failedDocuments
          .map((item) => item.error ? `${item.name || "Resource"}: ${item.error}` : "")
          .filter(Boolean);
        const message = failed
          ? `Text extraction failed for ${failed} resource${failed === 1 ? "" : "s"}.${failureDetails.length ? ` ${failureDetails.join(" · ")}` : " Use Retry text extraction on its resource card."}`
          : `Text extraction is still processing for ${stillProcessing} resource${stillProcessing === 1 ? "" : "s"}. Refresh the list shortly.`;
        uploadResult.textContent = `${uploadSummary} ${message}`;
        show(message);
      } else {
        const message = needsOcr
          ? `${needsOcr} resource${needsOcr === 1 ? "" : "s"} uploaded but need OCR because they contain no selectable text.`
          : "Resources uploaded successfully.";
        uploadResult.textContent = `${uploadSummary} ${message}`;
        show(message, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Text extraction could not start.";
      if (version === uploadAnalysisVersion) {
        uploadResult.textContent = `${uploadSummary} Upload is complete, but text extraction could not start: ${message}`;
        show(`Resources uploaded; text extraction could not start: ${message}`);
      }
    } finally {
      window.clearInterval(refreshTimer);
    }
  }
  function syncUploadResourceType() {
    const isOther = uploadResourceRole.value === "other";
    uploadOtherType.hidden = !isOther;
    uploadOtherTypeInput.required = isOther;
    if (!isOther) uploadOtherTypeInput.value = "";
  }
  uploadResourceRole.addEventListener("change", syncUploadResourceType);
  syncUploadResourceType();
  document.getElementById("curriculum-upload-open").addEventListener("click", () => uploadDialog.showModal());
  uploadDialog.querySelector("[data-close-upload]").addEventListener("click", () => uploadDialog.close());
  uploadDialog.addEventListener("click", (event) => {
    if (event.target === uploadDialog && !uploadButton.disabled) uploadDialog.close();
  });
  let previewUrls = [];
  let selectionVersion = 0;
  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function releasePreviewUrls() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  }
  async function renderSelectedFiles() {
    const version = ++selectionVersion;
    releasePreviewUrls();
    filePreview.replaceChildren();
    const files = Array.from(uploadFiles.files || []);
    if (!files.length) {
      filePreview.classList.remove("has-files");
      return;
    }
    filePreview.classList.add("has-files");
    const heading = document.createElement("p");
    heading.className = "upload-preview-heading";
    heading.textContent = `${files.length} selected file${files.length === 1 ? "" : "s"} · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))} total`;
    heading.setAttribute("role", "status");
    heading.setAttribute("aria-live", "polite");
    filePreview.append(heading);
    for (const [index, file] of files.entries()) {
      const card = document.createElement("article");
      card.className = "upload-file-card";
      const header = document.createElement("div");
      header.className = "upload-file-head";
      const metadata = document.createElement("div");
      metadata.className = "upload-file-meta";
      const name = document.createElement("strong");
      name.textContent = file.name;
      const size = document.createElement("small");
      size.textContent = `${formatBytes(file.size)} · ${file.type || file.name.split(".").pop().toUpperCase()}`;
      metadata.append(name, size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "upload-file-remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        const transfer = new DataTransfer();
        Array.from(uploadFiles.files || []).forEach((selected, selectedIndex) => {
          if (selectedIndex !== index) transfer.items.add(selected);
        });
        uploadFiles.files = transfer.files;
        renderSelectedFiles();
      });
      header.append(metadata, remove);
      card.append(header);
      const extension = file.name.split(".").pop().toLowerCase();
      if (extension === "pdf") {
        const url = URL.createObjectURL(file);
        previewUrls.push(url);
        const preview = document.createElement("a");
        preview.className = "upload-pdf-preview-link";
        preview.href = url;
        preview.target = "_blank";
        preview.rel = "noopener noreferrer";
        preview.textContent = "Open PDF preview";
        card.append(preview);
      } else if (extension === "docx") {
        const note = document.createElement("p");
        note.className = "upload-text-preview";
        note.textContent = "Word document selected. Its text and table content will be extracted securely after upload.";
        card.append(note);
      } else {
        const text = document.createElement("pre");
        text.className = "upload-text-preview";
        text.textContent = "Loading file preview…";
        card.append(text);
        try {
          const excerpt = await file.slice(0, 24_000).text();
          if (version !== selectionVersion) return;
          text.textContent = `${excerpt.trim() || "This file contains no readable text."}${file.size > 24_000 ? "\n\nPreview limited to the first 24 KB." : ""}`;
        } catch {
          text.textContent = "A preview could not be read. The file can still be uploaded for server-side extraction.";
        }
      }
      filePreview.append(card);
    }
  }
  uploadFiles.addEventListener("change", renderSelectedFiles);
  uploadForm.addEventListener("reset", () => {
    releasePreviewUrls();
    filePreview.replaceChildren();
    filePreview.classList.remove("has-files");
    setTimeout(syncUploadResourceType, 0);
  });

  function uploadWithProgress() {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      let settled = false;
      request.open("POST", `${root.dataset.listUrl}/upload`);
      request.responseType = "json";
      request.timeout = 600_000;
      request.withCredentials = true;
      request.setRequestHeader("Accept", "application/json");
      request.setRequestHeader("X-CSRF-Token", csrf);
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) {
          uploadProgressLabel.textContent = "Uploading selected resources…";
          return;
        }
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        uploadProgressBar.value = percent;
        uploadProgressLabel.textContent = percent < 100
          ? `Uploading resources · ${percent}%`
          : "File transfer complete · saving resources…";
      });
      request.upload.addEventListener("load", () => {
        uploadProgressBar.value = 100;
        uploadProgressLabel.textContent = "File transfer complete · saving resources…";
      });
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      request.addEventListener("readystatechange", () => {
        if (request.readyState !== XMLHttpRequest.DONE) return;
        let body = request.response;
        if (!body || typeof body !== "object") {
          try { body = JSON.parse(request.responseText); } catch { body = {}; }
        }
        if (request.status < 200 || request.status >= 300) {
          const reference = body.request_id ? ` Reference: ${body.request_id}.` : "";
          settle(reject, new Error(`${body.error || "Resource upload failed."} (HTTP ${request.status}).${reference}`));
          return;
        }
        settle(resolve, body);
      });
      request.addEventListener("error", () => settle(reject, new Error("Resource upload could not reach the server. Check your connection and try again.")));
      request.addEventListener("abort", () => settle(reject, new Error("Resource upload was canceled before it completed.")));
      request.addEventListener("timeout", () => settle(reject, new Error("Resource upload timed out. Try again with fewer or smaller files.")));
      request.send(new FormData(uploadForm));
    });
  }

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(uploadFiles.files || []);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (!files.length || files.length > 10) {
      show("Choose between 1 and 10 resource files.");
      return;
    }
    if (files.some((file) => file.size < 1) || totalBytes > 80 * 1024 * 1024) {
      show("The selected files must be non-empty and total 80 MB or less.");
      return;
    }

    const originalLabel = uploadButton.innerHTML;
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading resources…";
    uploadProgress.hidden = false;
    uploadProgressBar.value = 0;
    uploadProgressLabel.textContent = "Starting resource upload…";
    uploadResult.textContent = "";
    uploadWeeklyResults.replaceChildren();
    uploadWeeklyResults.hidden = true;
    const analysisVersion = ++uploadAnalysisVersion;
    try {
      const responseBody = await uploadWithProgress();
      uploadDialog.close();
      const documents = responseBody.result.documents || [];
      const extracted = documents.filter((item) => item.status === "extracted").length;
      const queuedDocuments = documents.filter((item) => item.status === "queued");
      const needsOcr = documents.filter((item) => item.status === "needs_ocr").length;
      const duplicates = documents.filter((item) => item.status === "already_imported").length;
      const failed = documents.filter((item) => item.status === "failed").length;
      const summary = `${extracted} resource${extracted === 1 ? "" : "s"} ready to preview, ${queuedDocuments.length} queued for text extraction, ${needsOcr} need OCR, ${duplicates} duplicate${duplicates === 1 ? "" : "s"}, ${failed} failed. New resources remain unverified.`;
      uploadResult.textContent = summary;
      show(queuedDocuments.length
        ? `Upload complete. ${queuedDocuments.length} resource${queuedDocuments.length === 1 ? "" : "s"} queued for text extraction; you can keep using the library.`
        : summary, failed === 0);
      uploadForm.reset();
      filterForm.elements.namedItem("q").value = "";
      selectedYears.clear();
      selectedRoles.clear();
      syncFilterBadges("year_groups");
      syncFilterBadges("resource_roles");
      const extractedDocuments = documents.filter((item) => item.status === "extracted");
      if (queuedDocuments.length) {
        void processUploadedResources(queuedDocuments, summary, analysisVersion);
      }
      try {
        await load(1);
      } catch (error) {
        uploadResult.textContent = `${summary} The upload completed, but the resource list could not refresh: ${error instanceof Error ? error.message : "request failed"}. Use Refresh to reload it.`;
        show("Resources uploaded successfully, but the list could not refresh. Use Refresh to view them.");
        return;
      }
      if (extractedDocuments.length) {
        uploadResult.textContent = `${summary} Upload complete. Weekly topic and focal-area scanning is running separately; you can review these resources now.`;
        renderUploadedWeeklyResults([], `Scanning ${extractedDocuments.length} extracted resource${extractedDocuments.length === 1 ? "" : "s"} for weekly topics and focal areas…`);
        void analyzeUploadedResources(extractedDocuments, summary, analysisVersion).catch((error) => {
          const message = error instanceof Error ? error.message : "source scan failed";
          uploadResult.textContent = `${summary} Upload is complete, but the weekly scan could not finish: ${message}. Review the resource and retry the scan.`;
          show("Resources uploaded successfully; the weekly scan could not finish. Review the resource to retry.");
        });
      } else {
        renderUploadedWeeklyResults([], "No extracted text resource was available for weekly topic scanning. Scanned PDFs may need OCR.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Curriculum upload failed.";
      uploadResult.textContent = message;
      show(message);
    } finally {
      uploadButton.disabled = false;
      uploadButton.innerHTML = originalLabel;
      uploadProgress.hidden = true;
    }
  });
  const query = new URLSearchParams(window.location.search);
  currentPage = Math.max(1, Number.parseInt(query.get("page") || "1", 10));
  load();
})();
