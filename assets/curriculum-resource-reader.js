(() => {
  "use strict";

  const dialog = document.getElementById("curriculum-resource-reader");
  if (!dialog) return;
  const title = document.getElementById("curriculum-reader-title");
  const meta = dialog.querySelector("[data-reader-meta]");
  const fileType = dialog.querySelector(".curriculum-reader-filetype");
  const toolbar = dialog.querySelector("[data-reader-toolbar]");
  const content = dialog.querySelector("[data-reader-content]");
  const pagination = dialog.querySelector("[data-reader-pagination]");
  const appBase = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="${appBase}/assets/icons.svg?v=2#fa-${name}"></use></svg>`;
  let active = null;
  let pdfLibraryPromise = null;
  let pdfLoadingTask = null;
  let pdfDocument = null;
  const renderTasks = new Map();
  const renderJobs = new Map();
  let requestVersion = 0;
  let currentPage = 1;
  let zoom = 1;
  let fitScale = 1;
  let resizeObserver = null;
  let pageObserver = null;
  let continuousScrollFrame = 0;
  let touchStart = null;
  let readerMode = "page";
  try {
    const savedMode = localStorage.getItem("akademi-curriculum-reader-mode");
    if (savedMode === "continuous" || savedMode === "page") readerMode = savedMode;
  } catch (error) {
    console.warn("PDF reader preference could not be read from local storage.", error);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function pdfLibrary() {
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = import(`${appBase}/assets/pdfjs/pdf.min.mjs`).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${appBase}/assets/pdfjs/pdf.worker.min.mjs`;
        return pdfjs;
      });
    }
    return pdfLibraryPromise;
  }

  function setStatus(message, isError = false) {
    content.innerHTML = `<div class="curriculum-reader-state${isError ? " is-error" : ""}" role="${isError ? "alert" : "status"}"><span class="curriculum-reader-state-icon">${icon(isError ? "circle-info" : "book-open")}</span><strong>${escapeHtml(message)}</strong>${isError ? '<button class="curriculum-reader-retry" type="button" data-reader-retry>Try again</button>' : '<span class="curriculum-reader-spinner" aria-hidden="true"></span>'}</div>`;
    content.setAttribute("aria-busy", isError ? "false" : "true");
  }

  async function clearDocument() {
    const jobs = Array.from(renderJobs.values());
    jobs.forEach((job) => {
      job.cancelled = true;
      job.task?.cancel();
    });
    await Promise.all(jobs.map((job) => job.promise.catch((error) => {
      if (error?.name !== "RenderingCancelledException") throw error;
    })));
    renderTasks.clear();
    renderJobs.clear();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }
    if (continuousScrollFrame) {
      cancelAnimationFrame(continuousScrollFrame);
      continuousScrollFrame = 0;
    }
    if (pdfLoadingTask) {
      const task = pdfLoadingTask;
      pdfLoadingTask = null;
      pdfDocument = null;
      await task.destroy();
    }
  }

  function metaText(documentItem) {
    return [
      documentItem.subject_name,
      documentItem.year_group ? documentItem.year_group.replace("SHS", "SHS Year ") : "",
      documentItem.resource_role === "other" && documentItem.resource_type_label
        ? documentItem.resource_type_label
        : documentItem.resource_role === "curriculum" ? "Curriculum"
        : documentItem.resource_role ? documentItem.resource_role.replaceAll("_", " ") : "",
      documentItem.review_status === "verified" ? "Verified source" : `Admin review · ${documentItem.review_status || "unreviewed"}`
    ].filter(Boolean).join("  ·  ");
  }

  function readerFileType(documentItem) {
    if (documentItem.mime_type === "application/pdf") return "PDF";
    if (documentItem.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
    return "TEXT";
  }

  function markdownTableCells(line) {
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
  }

  function renderTextContent(value) {
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push(`<p>${escapeHtml(paragraph.join("\n"))}</p>`);
      paragraph = [];
    };
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      const isTable = line.includes("|") && index + 1 < lines.length
        && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
      let legacyTableRows = null;
      if (!isTable && line.includes("|")) {
        const candidateRows = [markdownTableCells(line)];
        let nextIndex = index + 1;
        while (nextIndex < lines.length && lines[nextIndex].trim().includes("|")) {
          const nextRow = markdownTableCells(lines[nextIndex]);
          if (nextRow.length !== candidateRows[0].length) break;
          candidateRows.push(nextRow);
          nextIndex++;
        }
        if (candidateRows.length > 1) legacyTableRows = candidateRows;
      }
      if (isTable) {
        flushParagraph();
        const headers = markdownTableCells(line);
        index += 2;
        const bodyRows = [];
        while (index < lines.length && lines[index].trim().includes("|")) {
          bodyRows.push(markdownTableCells(lines[index]));
          index++;
        }
        index--;
        blocks.push(`<div class="curriculum-reader-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${bodyRows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${escapeHtml(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      } else if (legacyTableRows) {
        flushParagraph();
        blocks.push(`<div class="curriculum-reader-table-wrap"><table><tbody>${legacyTableRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        index += legacyTableRows.length - 1;
      } else if (line) {
        paragraph.push(lines[index]);
      } else {
        flushParagraph();
      }
    }
    flushParagraph();
    return blocks.join("");
  }

  function toolbarMarkup(downloadUrl) {
    const download = downloadUrl ? `<a class="reader-tool-button reader-download" href="${escapeHtml(downloadUrl)}" download aria-label="Download original PDF" title="Download original PDF">${icon("file-lines")}<span>Download</span></a>` : "";
    return `<div class="reader-toolbar-group reader-page-controls">
      <button type="button" class="reader-tool-button reader-icon-button" data-reader-prev-page aria-label="Previous page" title="Previous page">${icon("chevron-left")}</button>
      <label class="reader-page-entry"><span class="sr-only">Current page</span><input type="number" min="1" value="1" inputmode="numeric" data-reader-page aria-label="Current page number"><span>/ <b data-reader-page-count>—</b></span></label>
      <button type="button" class="reader-tool-button reader-icon-button" data-reader-next-page aria-label="Next page" title="Next page">${icon("chevron-right")}</button>
    </div>
    <span class="reader-toolbar-divider" aria-hidden="true"></span>
    <div class="reader-mode-switch" role="group" aria-label="Choose reading layout">
      <button type="button" class="reader-mode-button" data-reader-mode="page" aria-pressed="${readerMode === "page"}" title="Show one PDF page at a time">${icon("file-lines")}<span>Page by page</span></button>
      <button type="button" class="reader-mode-button" data-reader-mode="continuous" aria-pressed="${readerMode === "continuous"}" title="Scroll through the full PDF">${icon("bars")}<span>Continuous scroll</span></button>
    </div>
    <span class="reader-toolbar-divider reader-mode-divider" aria-hidden="true"></span>
    <div class="reader-toolbar-group reader-zoom-controls">
      <button type="button" class="reader-tool-button reader-icon-button" data-reader-zoom-out aria-label="Zoom out" title="Zoom out">${icon("minus")}</button>
      <span class="reader-zoom-value" data-reader-zoom-value aria-live="polite">Fit width</span>
      <button type="button" class="reader-tool-button reader-icon-button" data-reader-zoom-in aria-label="Zoom in" title="Zoom in">${icon("plus")}</button>
      <button type="button" class="reader-tool-button reader-fit-button" data-reader-fit title="Fit page to the reading area">${icon("book-open")}<span>Fit width</span></button>
    </div>
    ${download}`;
  }

  function updateToolbar() {
    if (!pdfDocument) return;
    const pageInput = toolbar.querySelector("[data-reader-page]");
    const pageCount = toolbar.querySelector("[data-reader-page-count]");
    const zoomLabel = toolbar.querySelector("[data-reader-zoom-value]");
    const previous = toolbar.querySelector("[data-reader-prev-page]");
    const next = toolbar.querySelector("[data-reader-next-page]");
    pageInput.value = String(currentPage);
    pageInput.max = String(pdfDocument.numPages);
    pageCount.textContent = String(pdfDocument.numPages);
    zoomLabel.textContent = zoom === 1 ? "Fit width" : `${Math.round(zoom * 100)}%`;
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pdfDocument.numPages;
    const pageHint = pagination.querySelector("[data-reader-page-hint-text]");
    if (pageHint) pageHint.textContent = `Page ${currentPage} of ${pdfDocument.numPages} · Use the arrows or page field to navigate`;
  }

  function canvasRenderKey(version) {
    const stage = content.querySelector("[data-reader-pdf-stage]");
    return `${version}:${readerMode}:${zoom}:${stage?.clientWidth || 0}:${window.devicePixelRatio || 1}`;
  }

  async function renderCanvas(pageNumber, canvas, version = requestVersion) {
    if (!pdfDocument || !active || !canvas.isConnected) return;
    const key = canvasRenderKey(version);
    const previousJob = renderJobs.get(canvas);
    if (previousJob) {
      if (previousJob.key === key && !previousJob.cancelled) return previousJob.promise;
      previousJob.cancelled = true;
      previousJob.task?.cancel();
      await previousJob.promise.catch((error) => {
        if (error?.name !== "RenderingCancelledException") throw error;
      });
      if (version !== requestVersion || !canvas.isConnected) return false;
      return renderCanvas(pageNumber, canvas, version);
    }
    const job = { key, task: null, cancelled: false, promise: null };
    renderJobs.set(canvas, job);
    job.promise = (async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (job.cancelled || version !== requestVersion || !canvas.isConnected) return false;
      const currentStage = content.querySelector("[data-reader-pdf-stage]");
      if (!currentStage) return false;
      const availableWidth = Math.max(180, currentStage.clientWidth - (readerMode === "continuous" ? 44 : 52));
      const baseViewport = page.getViewport({ scale: 1 });
      const pageFitScale = Math.max(0.1, Math.min(3, availableWidth / baseViewport.width));
      const scale = Math.max(0.1, Math.min(3, pageFitScale * zoom));
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const wrapper = canvas.closest(".curriculum-reader-page");
      if (wrapper) {
        wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        wrapper.classList.add("is-rendered");
      }
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Your browser could not prepare the PDF page for display.");
      context.setTransform(1, 0, 0, 1, 0, 0);
      const task = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
      });
      job.task = task;
      renderTasks.set(canvas, task);
      try {
        await task.promise;
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") throw error;
        return false;
      } finally {
        if (renderTasks.get(canvas) === task) renderTasks.delete(canvas);
      }
      if (!job.cancelled && version === requestVersion && canvas.isConnected) {
        canvas.dataset.rendered = "true";
        canvas.dataset.renderKey = job.key;
        canvas.closest(".reader-continuous-page")?.classList.add("is-rendered");
        return true;
      }
      return false;
    })();
    try {
      return await job.promise;
    } finally {
      if (renderJobs.get(canvas) === job) renderJobs.delete(canvas);
    }
  }

  async function renderPage(pageNumber = currentPage, resetScroll = true) {
    if (!pdfDocument || !active) return;
    currentPage = Math.min(pdfDocument.numPages, Math.max(1, pageNumber));
    const version = requestVersion;
    if (readerMode === "continuous") {
      const wrapper = content.querySelector(`[data-reader-page-wrapper="${currentPage}"]`);
      if (wrapper) {
        wrapper.scrollIntoView({ block: "start", behavior: "smooth" });
        const canvas = wrapper.querySelector("canvas");
        if (canvas && (canvas.dataset.rendered !== "true" || canvas.dataset.renderKey !== canvasRenderKey(version))) {
          canvas.dataset.rendered = "false";
          wrapper.classList.remove("is-rendered");
          canvas.closest(".curriculum-reader-page")?.classList.remove("is-rendered");
          await renderCanvas(currentPage, canvas, version);
        }
      }
      updateToolbar();
      return;
    }
    const canvas = content.querySelector("[data-reader-pdf-canvas]");
    if (!canvas) return;
    content.setAttribute("aria-busy", "true");
    await renderCanvas(currentPage, canvas, version);
    if (version !== requestVersion) return;
    if (resetScroll) {
      content.scrollTop = 0;
      content.scrollLeft = 0;
    }
    content.removeAttribute("aria-busy");
    updateToolbar();
  }

  function observeContinuousPages(version) {
    const stage = content.querySelector("[data-reader-pdf-stage]");
    pageObserver?.disconnect();
    pageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const wrapper = entry.target;
        const pageNumber = Number(wrapper.dataset.readerPageWrapper);
        const canvas = wrapper.querySelector("canvas");
        if (entry.isIntersecting) {
          if (canvas.dataset.rendered !== "true" || canvas.dataset.renderKey !== canvasRenderKey(version)) {
            canvas.dataset.rendered = "false";
            wrapper.classList.remove("is-rendered");
            canvas.closest(".curriculum-reader-page")?.classList.remove("is-rendered");
            renderCanvas(pageNumber, canvas, version).catch(showPdfError);
          }
          return;
        }
        const pendingJob = renderJobs.get(canvas);
        if (pendingJob) {
          pendingJob.cancelled = true;
          pendingJob.task?.cancel();
          return;
        }
        if (canvas.dataset.rendered === "true") {
          const task = renderTasks.get(canvas);
          if (task) return;
          canvas.width = 0;
          canvas.height = 0;
          canvas.style.removeProperty("width");
          canvas.style.removeProperty("height");
          canvas.dataset.rendered = "false";
          delete canvas.dataset.renderKey;
          canvas.closest(".curriculum-reader-page")?.classList.remove("is-rendered");
          wrapper.classList.remove("is-rendered");
        }
      });
    }, { root: content, rootMargin: "700px 0px", threshold: 0 });
    stage.querySelectorAll(".reader-continuous-page").forEach((wrapper) => pageObserver.observe(wrapper));
  }

  function updateContinuousCurrentPage() {
    if (readerMode !== "continuous" || !pdfDocument) return;
    const contentTop = content.getBoundingClientRect().top;
    const pages = Array.from(content.querySelectorAll(".reader-continuous-page"));
    const visible = pages.find((wrapper) => wrapper.getBoundingClientRect().bottom > contentTop + 45);
    if (visible) {
      currentPage = Number(visible.dataset.readerPageWrapper);
      updateToolbar();
    }
  }

  function renderContinuousDocument(version) {
    const pages = Array.from({ length: pdfDocument.numPages }, (_, index) => {
      const pageNumber = index + 1;
      return `<section class="reader-continuous-page" data-reader-page-wrapper="${pageNumber}" aria-label="Page ${pageNumber}"><div class="curriculum-reader-page"><canvas aria-label="PDF page ${pageNumber}" data-reader-pdf-canvas data-rendered="false"></canvas></div><span class="reader-continuous-page-number">Page ${pageNumber}</span></section>`;
    }).join("");
    content.innerHTML = `<div class="curriculum-reader-pdf-stage is-continuous" data-reader-pdf-stage>${pages}</div>`;
    content.removeAttribute("aria-busy");
    content.scrollTop = 0;
    observeContinuousPages(version);
    const firstCanvas = content.querySelector('[data-reader-page-wrapper="1"] canvas');
    if (firstCanvas) renderCanvas(1, firstCanvas, version).catch(showPdfError);
    updateToolbar();
  }

  async function setReaderMode(mode) {
    if (!pdfDocument || !["page", "continuous"].includes(mode) || mode === readerMode) return;
    readerMode = mode;
    try {
      localStorage.setItem("akademi-curriculum-reader-mode", readerMode);
    } catch (error) {
      console.warn("PDF reader preference could not be saved to local storage.", error);
    }
    toolbar.querySelectorAll("[data-reader-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.readerMode === readerMode));
    });
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }
    renderJobs.forEach((job) => {
      job.cancelled = true;
      job.task?.cancel();
    });
    if (readerMode === "continuous") {
      renderContinuousDocument(requestVersion);
    } else {
      content.innerHTML = '<div class="curriculum-reader-pdf-stage is-single" data-reader-pdf-stage><div class="curriculum-reader-page" aria-label="PDF page"><canvas data-reader-pdf-canvas aria-label="Rendered PDF page"></canvas></div></div>';
      await renderPage(currentPage);
    }
    updateToolbar();
  }

  async function loadPdf(version) {
    setStatus("Preparing your PDF reader…");
    try {
      const pdfjs = await pdfLibrary();
      if (version !== requestVersion || !active) return;
      toolbar.hidden = false;
      toolbar.innerHTML = toolbarMarkup(`${active.fileUrl}?download=1`);
      pagination.innerHTML = `<span class="curriculum-reader-page-hint" data-reader-page-hint>${icon("file-lines")}<span>Loading page 1…</span></span>`;
      pdfLoadingTask = pdfjs.getDocument({ url: active.fileUrl, withCredentials: true });
      pdfDocument = await pdfLoadingTask.promise;
      if (version !== requestVersion || !active) return;
      toolbar.querySelector("[data-reader-page-count]").textContent = String(pdfDocument.numPages);
      pagination.innerHTML = `<span class="curriculum-reader-page-hint">${icon("circle-info")}<span data-reader-page-hint-text>Page ${currentPage} of ${pdfDocument.numPages} · Use the arrows or page field to navigate</span></span><span class="curriculum-reader-shortcuts">Keyboard: ← → to turn pages · Esc to close</span>`;
      toolbar.querySelectorAll("[data-reader-mode]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.readerMode === readerMode));
      });
      if (readerMode === "continuous") {
        renderContinuousDocument(version);
      } else {
        content.innerHTML = '<div class="curriculum-reader-pdf-stage is-single" data-reader-pdf-stage><div class="curriculum-reader-page" aria-label="PDF page"><canvas data-reader-pdf-canvas aria-label="Rendered PDF page"></canvas></div></div>';
        await renderPage(1);
      }
      resizeObserver = new ResizeObserver(() => {
        if (!pdfDocument) return;
        if (readerMode === "continuous") {
          content.querySelectorAll(".reader-continuous-page.is-rendered canvas").forEach((canvas) => {
            canvas.dataset.rendered = "false";
            canvas.closest(".reader-continuous-page")?.classList.remove("is-rendered");
            const pageNumber = Number(canvas.closest(".reader-continuous-page")?.dataset.readerPageWrapper);
            if (pageNumber) renderCanvas(pageNumber, canvas, version).catch(showPdfError);
          });
        } else {
          renderPage(currentPage, false).catch(showPdfError);
        }
      });
      resizeObserver.observe(content);
    } catch (error) {
      if (version !== requestVersion) return;
      showPdfError(error);
    }
  }

  function showPdfError(error) {
    toolbar.hidden = true;
    const message = error instanceof Error ? error.message : "The PDF could not be displayed.";
    content.innerHTML = `<div class="curriculum-reader-state is-error" role="alert"><span class="curriculum-reader-state-icon">${icon("circle-info")}</span><strong>This PDF could not be opened</strong><p>${escapeHtml(message)}</p><button class="curriculum-reader-retry" type="button" data-reader-retry>Try again</button></div>`;
    content.setAttribute("aria-busy", "false");
  }

  async function loadText(offset = 0, version = requestVersion) {
    if (!active) return;
    toolbar.hidden = true;
    setStatus("Loading readable text…");
    pagination.replaceChildren();
    try {
      const response = await fetch(`${active.readerUrl}?offset=${encodeURIComponent(offset)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The resource text could not be loaded.");
      if (version !== requestVersion || !active) return;
      const documentItem = result.document;
      title.textContent = documentItem.title || "Curriculum resource";
      meta.textContent = metaText(documentItem);
      fileType.textContent = readerFileType(documentItem);
      const action = active.fileUrl
        ? `<a class="reader-tool-button reader-download" href="${escapeHtml(`${active.fileUrl}?download=1`)}" download>${icon("file-lines")}<span>Download original file</span></a>`
        : "";
      if (result.chunks.length) {
        content.innerHTML = `<div class="curriculum-reader-text-view">${result.chunks.map((chunk, index) => {
          const pageStart = chunk.page_start || "—";
          const pageEnd = chunk.page_end && chunk.page_end !== chunk.page_start ? `–${escapeHtml(chunk.page_end)}` : "";
          return `<article class="curriculum-reader-section"><h3><span>Text section ${result.offset + index + 1}</span><span class="reader-source-page">${icon("file-lines")} Page ${escapeHtml(pageStart)}${pageEnd}</span></h3><div class="curriculum-reader-text">${renderTextContent(chunk.content)}</div></article>`;
        }).join("")}${action ? `<div class="reader-text-download">${action}</div>` : ""}</div>`;
      } else {
        const notice = documentItem.extraction_error || (
          documentItem.extraction_status === "needs_ocr"
            ? "This document appears to be scanned. Ask an administrator to run OCR before reading extracted text."
            : "No extracted text is available for this resource yet."
        );
        content.innerHTML = `<div class="curriculum-reader-state"><span class="curriculum-reader-state-icon">${icon("circle-info")}</span><strong>Readable text is not available</strong><p>${escapeHtml(notice)}</p>${action}</div>`;
      }
      content.removeAttribute("aria-busy");
      const pageNumber = Math.floor(result.offset / 10) + 1;
      const pageCount = Math.max(1, Math.ceil(result.total_chunks / 10));
      if (pageCount > 1) {
        pagination.innerHTML = `<button type="button" class="reader-page-button" data-reader-offset="${Math.max(0, result.offset - 10)}" ${result.has_previous ? "" : "disabled"}>${icon("chevron-left")}<span>Previous sections</span></button><span class="curriculum-reader-page-hint">${icon("file-lines")}<span>Sections ${result.offset + 1}–${Math.min(result.offset + result.chunks.length, result.total_chunks)} of ${result.total_chunks} · Page ${pageNumber} of ${pageCount}</span></span><button type="button" class="reader-page-button" data-reader-offset="${result.offset + 10}" ${result.has_next ? "" : "disabled"}><span>Next sections</span>${icon("chevron-right")}</button>`;
      }
    } catch (error) {
      if (version !== requestVersion) return;
      content.innerHTML = `<div class="curriculum-reader-state is-error" role="alert"><span class="curriculum-reader-state-icon">${icon("circle-info")}</span><strong>Resource text could not be loaded</strong><p>${escapeHtml(error instanceof Error ? error.message : "The resource text could not be loaded.")}</p><button type="button" class="curriculum-reader-retry" data-reader-retry>Try again</button></div>`;
      content.setAttribute("aria-busy", "false");
    }
  }

  async function loadDocx(version) {
    toolbar.hidden = false;
    toolbar.innerHTML = `<a class="reader-tool-button reader-download" href="${escapeHtml(`${active.fileUrl}?download=1`)}" download>${icon("file-lines")}<span>Download original file</span></a>`;
    pagination.replaceChildren();
    content.classList.add("is-docx-content");
    content.innerHTML = '<div class="curriculum-docx-render" data-reader-docx-render role="document" aria-label="Original Word document"></div>';
    content.setAttribute("aria-busy", "true");
    try {
      await window.akademiCurriculumDocxRenderer.render(
        active.fileUrl,
        content.querySelector("[data-reader-docx-render]")
      );
      if (version !== requestVersion || !active) return;
      content.removeAttribute("aria-busy");
    } catch (error) {
      if (version !== requestVersion || !active) return;
      content.classList.remove("is-docx-content");
      content.innerHTML = `<div class="curriculum-reader-state is-error" role="alert"><span class="curriculum-reader-state-icon">${icon("circle-info")}</span><strong>The original Word document could not be rendered</strong><p>${escapeHtml(error instanceof Error ? error.message : "The document could not be rendered.")}</p><a class="reader-tool-button reader-download" href="${escapeHtml(`${active.fileUrl}?download=1`)}" download>${icon("file-lines")}<span>Download original file</span></a><button class="curriculum-reader-retry" type="button" data-reader-retry>Try again</button></div>`;
      content.setAttribute("aria-busy", "false");
    }
  }

  async function open(documentId, readerUrl, fileUrl = "") {
    requestVersion += 1;
    const version = requestVersion;
    await clearDocument();
    content.classList.remove("is-docx-content");
    active = { documentId: String(documentId), readerUrl, fileUrl };
    currentPage = 1;
    zoom = 1;
    title.textContent = "Opening resource…";
    meta.textContent = "Preparing your document";
    fileType.textContent = "FILE";
    toolbar.hidden = true;
    toolbar.replaceChildren();
    pagination.replaceChildren();
    setStatus("Opening your resource…");
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`${readerUrl}?offset=0`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This resource could not be opened.");
      if (version !== requestVersion || !active) return;
      const documentItem = result.document;
      title.textContent = documentItem.title || "Curriculum resource";
      meta.textContent = metaText(documentItem);
      fileType.textContent = readerFileType(documentItem);
      if (documentItem.mime_type === "application/pdf" && active.fileUrl) {
        await loadPdf(version);
      } else if (documentItem.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && active.fileUrl) {
        await loadDocx(version);
      } else {
        await loadText(0, version);
      }
    } catch (error) {
      if (version !== requestVersion) return;
      toolbar.hidden = true;
      content.innerHTML = `<div class="curriculum-reader-state is-error" role="alert"><span class="curriculum-reader-state-icon">${icon("circle-info")}</span><strong>Resource could not be opened</strong><p>${escapeHtml(error instanceof Error ? error.message : "This resource could not be opened.")}</p><button type="button" class="curriculum-reader-retry" data-reader-retry>Try again</button></div>`;
      content.setAttribute("aria-busy", "false");
    }
  }

  async function closeReader() {
    requestVersion += 1;
    active = null;
    await clearDocument();
    toolbar.replaceChildren();
    content.classList.remove("is-docx-content");
    content.replaceChildren();
    pagination.replaceChildren();
  }

  window.akademiCurriculumReader = { open };

  dialog.addEventListener("click", async (event) => {
    if (event.target.closest("[data-reader-close]")) {
      dialog.close();
      return;
    }
    const pageButton = event.target.closest("[data-reader-offset]");
    if (pageButton && active) {
      loadText(Number(pageButton.dataset.readerOffset));
      return;
    }
    if (event.target.closest("[data-reader-retry]") && active) {
      await open(active.documentId, active.readerUrl, active.fileUrl);
      return;
    }
    const modeButton = event.target.closest("[data-reader-mode]");
    if (modeButton && pdfDocument) {
      await setReaderMode(modeButton.dataset.readerMode);
      return;
    }
    if (!pdfDocument) return;
    if (event.target.closest("[data-reader-prev-page]")) renderPage(currentPage - 1).catch(showPdfError);
    if (event.target.closest("[data-reader-next-page]")) renderPage(currentPage + 1).catch(showPdfError);
    if (event.target.closest("[data-reader-zoom-in]")) {
      zoom = Math.min(2.5, Math.round((zoom + 0.15) * 100) / 100);
      renderPage(currentPage, false).catch(showPdfError);
    }
    if (event.target.closest("[data-reader-zoom-out]")) {
      zoom = Math.max(0.5, Math.round((zoom - 0.15) * 100) / 100);
      renderPage(currentPage, false).catch(showPdfError);
    }
    if (event.target.closest("[data-reader-fit]")) {
      zoom = 1;
      renderPage(currentPage).catch(showPdfError);
    }
  });

  dialog.addEventListener("change", (event) => {
    const pageField = event.target.closest("[data-reader-page]");
    if (pageField && pdfDocument) {
      const targetPage = Number.parseInt(pageField.value, 10);
      renderPage(Number.isFinite(targetPage) ? targetPage : currentPage).catch(showPdfError);
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (!pdfDocument || event.target.matches("input, button, a")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      renderPage(currentPage - 1).catch(showPdfError);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      renderPage(currentPage + 1).catch(showPdfError);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom = Math.min(2.5, Math.round((zoom + 0.15) * 100) / 100);
      renderPage(currentPage, false).catch(showPdfError);
    } else if (event.key === "-") {
      event.preventDefault();
      zoom = Math.max(0.5, Math.round((zoom - 0.15) * 100) / 100);
      renderPage(currentPage, false).catch(showPdfError);
    }
  });

  content.addEventListener("touchstart", (event) => {
    if (readerMode !== "page" || event.touches.length !== 1) {
      touchStart = null;
      return;
    }
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });

  content.addEventListener("touchend", (event) => {
    if (!touchStart || readerMode !== "page" || !pdfDocument || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - touchStart.x;
    const deltaY = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    renderPage(currentPage + (deltaX < 0 ? 1 : -1)).catch(showPdfError);
  }, { passive: true });

  content.addEventListener("scroll", () => {
    if (readerMode !== "continuous" || continuousScrollFrame) return;
    continuousScrollFrame = requestAnimationFrame(() => {
      continuousScrollFrame = 0;
      updateContinuousCurrentPage();
    });
  }, { passive: true });

  dialog.addEventListener("close", () => closeReader());
})();
