(() => {
  "use strict";

  const basePath = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const status = document.querySelector("[data-follow-status]");
  const stage = document.querySelector("[data-follow-stage]");
  const title = document.querySelector("[data-follow-title]");
  const count = document.querySelector("[data-follow-count]");
  const timerLabel = document.querySelector("[data-follow-timer]");
  const progress = document.querySelector("[data-follow-progress]");
  const pollPanel = document.querySelector("[data-follow-poll]");
  const reactions = document.querySelector("[data-follow-reactions]");
  const paceToggle = document.querySelector("[data-follow-pace-toggle]");
  const fullscreenButton = document.querySelector("[data-follow-fullscreen]");
  const joinGate = document.querySelector("[data-follow-join]");
  const experience = document.querySelector("[data-follow-experience]");
  const joinForm = document.querySelector("[data-follow-join-form]");
  const questionPanel = document.querySelector("[data-follow-question-panel]");
  const questionForm = document.querySelector("[data-follow-question-form]");
  const questionList = document.querySelector("[data-follow-questions]");
  const questionCount = document.querySelector("[data-follow-question-count]");
  const themes = new Set(["modern", "editorial", "vibrant", "data", "minimal"]);
  let timer = null;
  let countdownTimer = null;
  let lastSlideKey = "";
  let lastRevealRender = null;
  let lastTimerKey = "";
  let lastPollKey = "";
  let lastReactionKey = "";
  let stopped = false;
  let connected = false;
  let pollInFlight = false;
  let latestState = null;
  let interactionRevision = 0;
  let interactionPending = false;
  let participantId = "";
  let participantName = "";
  let lastQuestionsKey = "";
  const ownAnswers = new Map();
  const ownReactions = new Map();
  const reactionNames = {
    understood: "😊 I understand",
    confused: "🤔 I’m confused",
    slower: "🐢 Please slow down",
    faster: "🚀 We can go faster"
  };
  const colors = new Set(["#e5484d", "#2f80ed", "#27ae60", "#f2c94c", "#ffffff"]);

  const textElement = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };

  function visualFrame(visual, kind) {
    const frame = document.createElement("div");
    frame.className = `presentation-visual presentation-visual-${kind}`;
    frame.setAttribute("aria-label", String(visual.title || "Lesson visual"));
    frame.append(textElement("strong", String(visual.title || "Lesson visual")));
    return frame;
  }

  function renderTableVisual(visual) {
    const headers = Array.isArray(visual.headers) ? visual.headers.slice(0, 6) : [];
    const rows = Array.isArray(visual.rows) ? visual.rows.filter(Array.isArray).slice(0, 12) : [];
    if (!headers.length || !rows.length) return null;

    const frame = visualFrame(visual, "table");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((value) => headerRow.append(textElement("th", String(value ?? ""))));
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      headers.forEach((_, index) => tr.append(textElement("td", String(row[index] ?? ""))));
      body.append(tr);
    });
    table.append(head, body);
    const scroll = document.createElement("div");
    scroll.className = "presentation-visual-table-scroll";
    scroll.append(table);
    frame.append(scroll);
    return frame;
  }

  function renderBarChart(visual) {
    const labels = Array.isArray(visual.labels) ? visual.labels.slice(0, 8).map(String) : [];
    const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length).map(Number) : [];
    if (!labels.length || values.length !== labels.length || values.some((value) => !Number.isFinite(value))) return null;

    const frame = visualFrame(visual, "chart");
    frame.setAttribute("role", "img");
    const bars = document.createElement("div");
    bars.className = "presentation-chart-bars";
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    labels.forEach((label, index) => {
      const column = document.createElement("div");
      column.className = "presentation-chart-column";
      column.append(textElement("span", String(values[index])));
      const bar = document.createElement("i");
      bar.style.setProperty("--bar-size", `${Math.max(3, Math.round(Math.abs(values[index]) / max * 100))}%`);
      column.append(bar, textElement("small", label));
      bars.append(column);
    });
    frame.append(bars);
    if (visual.value_label) frame.append(textElement("small", String(visual.value_label), "presentation-chart-unit"));
    return frame;
  }

  function renderLineChart(visual, type) {
    const series = type === "graph"
      ? [{
        name: "",
        points: (Array.isArray(visual.points) ? visual.points : [])
          .filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value))))
          .slice(0, 30)
          .map(([x, y]) => [Number(x), Number(y)])
      }]
      : (Array.isArray(visual.series) ? visual.series : [])
        .filter((item) => item && Array.isArray(item.values))
        .slice(0, 4)
        .map((item) => ({
          name: String(item.name || ""),
          points: item.values.slice(0, 30).map((value, index) => [index, Number(value)])
            .filter((point) => Number.isFinite(point[1]))
        }));
    const allPoints = series.flatMap((item) => item.points);
    if (!series.some((item) => item.points.length > 0)) return null;

    const width = 720;
    const height = 380;
    const bounds = { left: 70, right: 24, top: 38, bottom: 56 };
    const xMin = Math.min(...allPoints.map(([x]) => x));
    const xMax = Math.max(...allPoints.map(([x]) => x));
    const yMin = Math.min(...allPoints.map(([, y]) => y));
    const yMax = Math.max(...allPoints.map(([, y]) => y));
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const plotWidth = width - bounds.left - bounds.right;
    const plotHeight = height - bounds.top - bounds.bottom;
    const pointX = (value) => bounds.left + (value - xMin) / xRange * plotWidth;
    const pointY = (value) => bounds.top + (yMax - value) / yRange * plotHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", String(visual.title || "Presentation chart"));
    svg.classList.add("presentation-follow-line-chart");
    const add = (tag, attributes, text) => {
      const element = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
      if (text !== undefined) element.textContent = String(text);
      svg.append(element);
      return element;
    };

    for (let index = 0; index <= 4; index++) {
      const y = bounds.top + plotHeight * index / 4;
      const value = yMax - yRange * index / 4;
      add("line", { x1: bounds.left, y1: y, x2: width - bounds.right, y2: y, class: "presentation-follow-chart-grid" });
      add("text", { x: bounds.left - 10, y: y + 5, "text-anchor": "end", class: "presentation-follow-chart-label" }, Number(value.toFixed(2)));
    }
    add("line", {
      x1: bounds.left, y1: bounds.top + plotHeight,
      x2: width - bounds.right, y2: bounds.top + plotHeight,
      class: "presentation-follow-chart-axis"
    });
    add("text", {
      x: bounds.left, y: height - 18, "text-anchor": "start",
      class: "presentation-follow-chart-label"
    }, Number(xMin.toFixed(2)));
    add("text", {
      x: width - bounds.right, y: height - 18, "text-anchor": "end",
      class: "presentation-follow-chart-label"
    }, Number(xMax.toFixed(2)));
    const colors = ["#247456", "#d0a64a", "#277da1", "#c85845"];
    series.forEach((item, index) => {
      if (!item.points.length) return;
      const color = colors[index % colors.length];
      if (item.points.length > 1) {
        const coordinates = item.points.map(([x, y]) => `${pointX(x)},${pointY(y)}`).join(" ");
        add("polyline", { points: coordinates, pathLength: 1, class: "presentation-follow-chart-line", style: `--chart-color:${color}` });
      }
      item.points.forEach(([x, y]) => {
        add("circle", {
          cx: pointX(x), cy: pointY(y), r: 5,
          class: "presentation-follow-chart-point",
          style: `--chart-color:${color}`
        });
      });
    });
    const frame = visualFrame(visual, "graph");
    frame.append(svg);
    const namedSeries = series.filter((item) => item.name);
    if (namedSeries.length > 1) {
      const legend = document.createElement("div");
      legend.className = "presentation-follow-chart-legend";
      namedSeries.forEach((item) => {
        const index = series.indexOf(item);
        const entry = document.createElement("span");
        const marker = document.createElement("i");
        marker.style.setProperty("--chart-color", colors[index % colors.length]);
        entry.append(marker, document.createTextNode(item.name));
        legend.append(entry);
      });
      frame.append(legend);
    }
    const axisLabels = [visual.x_label || "Relationship", visual.y_label].filter(Boolean).map(String).join(" · ");
    if (axisLabels) frame.append(textElement("small", axisLabels, "presentation-chart-unit"));
    return frame;
  }

  function renderCardVisual(visual) {
    const rawItems = Array.isArray(visual.steps) ? visual.steps : Array.isArray(visual.items) ? visual.items : [];
    const items = rawItems.map((item) => typeof item === "string"
      ? item
      : String(item?.label || item?.title || item?.details || "")).filter((item) => item.trim()).slice(0, 8);
    if (!items.length && !visual.description) return null;

    const frame = visualFrame(visual, "cards");
    const list = document.createElement("div");
    items.forEach((item, index) => {
      const card = document.createElement("span");
      card.append(textElement("b", String(index + 1).padStart(2, "0")), document.createTextNode(item));
      list.append(card);
    });
    if (!items.length) list.append(textElement("span", String(visual.description)));
    frame.append(list);
    return frame;
  }

  function renderPresentationVisual(visual) {
    if (!visual || typeof visual !== "object" || Array.isArray(visual)) return null;
    const type = String(visual.type || "").toLowerCase();
    if (type === "table") return renderTableVisual(visual);
    if (type === "bar_chart" || type === "chart") return renderBarChart(visual);
    if (type === "graph" || type === "line_chart") return renderLineChart(visual, type);
    if (["process", "timeline", "cards", "comparison"].includes(type)) return renderCardVisual(visual);
    if (visual.description) return renderCardVisual(visual);
    return null;
  }

  function renderPointer(pointer) {
    const article = stage.querySelector(".presentation-slide-preview");
    if (!article) return;
    let laser = article.querySelector(".presentation-follow-laser");
    const valid = pointer?.active
      && Number.isFinite(Number(pointer.x)) && Number.isFinite(Number(pointer.y))
      && colors.has(pointer.color);
    if (!valid) {
      laser?.remove();
      return;
    }
    if (!laser) {
      laser = document.createElement("span");
      laser.className = "presentation-follow-laser";
      laser.setAttribute("aria-hidden", "true");
      article.append(laser);
    }
    laser.style.left = `${Math.max(0, Math.min(1, Number(pointer.x))) * 100}%`;
    laser.style.top = `${Math.max(0, Math.min(1, Number(pointer.y))) * 100}%`;
    laser.style.setProperty("--laser-color", pointer.color);
  }

  function renderPoll(poll) {
    pollPanel.replaceChildren();
    const selected = poll ? ownAnswers.get(poll.id) : undefined;
    pollPanel.hidden = !poll;
    if (!poll) return;
    pollPanel.append(textElement("h2", poll.question, "presentation-follow-poll-question"));
    const options = Array.isArray(poll.options) ? poll.options : [];
    const results = poll.results || {};
    options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "presentation-follow-poll-option";
      const button = document.createElement("button");
      button.className = "presentation-follow-poll-choice";
      button.type = "button";
      button.disabled = !poll.open || selected !== undefined;
      if (selected === index) button.setAttribute("aria-pressed", "true");
      button.append(textElement("span", `🗳️ ${String(option)}`, "presentation-follow-poll-label"));
      if (selected !== undefined || !poll.open) {
        const votes = Number(results[index] || 0);
        button.append(textElement("span", String(votes), "presentation-follow-counter"));
        button.setAttribute("aria-label", `${String(option)}, ${votes} votes`);
      }
      button.addEventListener("click", () => void submitInteraction({
        type: "poll", poll_id: poll.id, answer_index: index
      }));
      row.append(button);
      pollPanel.append(row);
    });
    if (!poll.open) pollPanel.append(textElement("p", "This check-in is closed."));
  }

  function renderReactions(counts = {}) {
    reactions.replaceChildren(textElement("span", "How is the pace?", "presentation-follow-reaction-label"));
    const paceCount = Object.values(counts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    const paceCountBadge = paceToggle.querySelector("[data-follow-pace-count]");
    if (paceCountBadge) {
      paceCountBadge.textContent = String(paceCount);
      paceCountBadge.hidden = paceCount === 0;
      paceToggle.setAttribute("aria-label", `Show pace responses, ${paceCount} total`);
    }
    Object.entries(reactionNames).forEach(([reaction, label]) => {
      const total = Number(counts[reaction] || 0);
      const button = document.createElement("button");
      button.className = "presentation-follow-reaction";
      button.type = "button";
      button.append(textElement("span", label, "presentation-follow-reaction-text"));
      button.append(textElement("span", String(total), "presentation-follow-counter"));
      button.setAttribute("aria-label", `${label}, ${total} responses`);
      button.setAttribute("aria-pressed", String(ownReactions.get("reaction") === reaction));
      button.addEventListener("click", () => void submitInteraction({ type: "reaction", reaction }));
      reactions.append(button);
    });
  }

  function renderQuestions(questions = []) {
    questionList.replaceChildren();
    questionCount.textContent = String(questions.length);
    questionCount.hidden = questions.length === 0;
    questionCount.setAttribute("aria-label", `${questions.length} questions sent`);
    const submitButton = questionForm.querySelector("button[type='submit']");
    const submitCount = submitButton?.querySelector(".presentation-follow-counter");
    if (submitCount) {
      submitCount.textContent = String(questions.length);
      submitCount.hidden = questions.length === 0;
      submitButton.setAttribute("aria-label", `Send question, ${questions.length} questions sent`);
    }
    questions.forEach((question) => {
      const card = document.createElement("article");
      card.className = "presentation-follow-question-item";
      card.append(textElement("p", question.question));
      card.append(textElement("small", question.teacher_feedback
        ? `👩‍🏫 Teacher: ${question.teacher_feedback}`
        : "Waiting for your teacher's reply"));
      questionList.append(card);
    });
  }

  async function submitInteraction(interaction) {
    if (interactionPending) return;
    interactionPending = true;
    interactionRevision++;
    if (interaction.type === "poll") pollPanel.hidden = true;
    let submitted = false;
    [...pollPanel.querySelectorAll("button"), ...reactions.querySelectorAll("button")].forEach((button) => {
      button.disabled = true;
    });
    status.textContent = interaction.type === "question" ? "Sending your question…" : "Sending your response…";
    try {
      const response = await fetch(`${basePath}/api/presentation-simulations/${encodeURIComponent(token)}/interaction`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          ...interaction,
          participant_id: participantId,
          participant_name: participantName
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your response could not be sent.");
      if (interaction.type === "poll") {
        ownAnswers.set(interaction.poll_id, interaction.answer_index);
        lastPollKey = "";
      }
      if (interaction.type === "reaction") ownReactions.set("reaction", interaction.reaction);
      if (interaction.type === "question") questionForm.elements.namedItem("question").value = "";
      latestState = data;
      renderState(data);
      status.textContent = interaction.type === "poll"
        ? "✅ Your answer has been sent!"
        : interaction.type === "question" ? "✅ Your question has been sent!" : "✅ Response received";
      submitted = true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Your response could not be sent. Please try again.";
    } finally {
      interactionPending = false;
      if (!submitted && latestState) {
        renderPoll(latestState.active_poll);
        renderReactions(latestState.reaction_counts);
      }
    }
  }

  function updateTimer(data) {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    const endsAt = data.timer_ends_at ? Date.parse(data.timer_ends_at) : NaN;
    const update = () => {
      if (!Number.isFinite(endsAt)) {
        timerLabel.textContent = "";
        return;
      }
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      timerLabel.textContent = `Time ${remaining === 0 ? "ended" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}`;
    };
    update();
    if (Number.isFinite(endsAt)) countdownTimer = window.setInterval(update, 1000);
  }

  function showEnded(message) {
    stopped = true;
    joinGate.hidden = true;
    experience.hidden = false;
    if (timer !== null) window.clearTimeout(timer);
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    status.textContent = message;
    stage.replaceChildren(textElement("p", message, "presentation-follow-placeholder"));
    count.textContent = "";
    pollPanel.hidden = true;
    reactions.hidden = true;
    questionForm.querySelector("textarea").disabled = true;
    questionForm.querySelector("button").disabled = true;
    paceToggle.hidden = true;
    progress.style.width = "0";
    stageResizeObserver?.disconnect();
  }

  function renderSlide(data) {
    title.textContent = data.title || "Live classroom presentation";
    count.textContent = `Slide ${data.active_slide + 1} of ${data.slide_count}`;
    progress.style.width = `${Math.round((data.active_slide + 1) / Math.max(data.slide_count, 1) * 100)}%`;
    status.textContent = data.subject
      ? `Following your teacher · ${data.subject}${data.year ? ` · ${data.year}` : ""}`
      : "Following your teacher's presentation";
    const previousArticle = stage.querySelector(".presentation-slide-preview");
    const theme = themes.has(data.visual_theme) ? data.visual_theme : "modern";
    const template = ["lesson", "inquiry", "worked", "discussion", "project", "revision", "flipped"].includes(data.template)
      ? data.template
      : "lesson";
    const slide = data.slide || {};
    const article = document.createElement("article");
    article.className = `presentation-slide-preview presentation-theme-${theme} presentation-template-${template}`;
    const header = document.createElement("header");
    const slideNumber = textElement("span", `SLIDE ${String(data.active_slide + 1).padStart(2, "0")}`);
    const metadata = textElement("small", `${data.subject || ""} · ${data.year || ""}`);
    header.append(slideNumber, metadata);
    article.append(header, textElement("h4", String(slide.title || "Presentation slide")));
    const mode = ["all", "group", "item", "timed"].includes(data.reveal_mode) ? data.reveal_mode : "all";
    const revealStep = Number(data.reveal_step) || 0;
    const animateNewReveal = lastRevealRender?.slide === data.active_slide
      && lastRevealRender.mode === mode
      && revealStep > lastRevealRender.step;
    const points = Array.isArray(slide.key_points)
      ? slide.key_points.filter((point) => typeof point === "string" && point.trim()).slice(0, 12)
      : [];
    if (points.length) {
      const list = document.createElement("ul");
      points.forEach((point) => list.append(textElement("li", point)));
      article.append(list);
    }
    const visual = slide.visual ? renderPresentationVisual(slide.visual) : null;
    let image = null;
    if (slide.image && typeof slide.image === "object") {
      try {
        const imageUrl = new URL(String(slide.image.url || ""));
        const sourceUrl = new URL(String(slide.image.source_url || ""));
        if (imageUrl.protocol === "https:"
          && ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(imageUrl.hostname)
          && sourceUrl.protocol === "https:" && sourceUrl.hostname === "commons.wikimedia.org") {
          image = document.createElement("figure");
          image.className = "presentation-slide-image";
          const imageElement = document.createElement("img");
          imageElement.src = imageUrl.href;
          imageElement.alt = String(slide.image.alt || "Curriculum-related classroom image");
          imageElement.loading = "lazy";
          imageElement.referrerPolicy = "no-referrer";
          const caption = document.createElement("figcaption");
          const sourceLink = document.createElement("a");
          sourceLink.href = sourceUrl.href;
          sourceLink.target = "_blank";
          sourceLink.rel = "noopener noreferrer";
          sourceLink.textContent = "Wikimedia Commons";
          caption.append(sourceLink);
          if (slide.image.attribution) caption.append(document.createTextNode(` · ${String(slide.image.attribution)}`));
          try {
            const licenseUrl = new URL(String(slide.image.license_url || ""));
            if (licenseUrl.protocol === "https:" && ["creativecommons.org", "www.gnu.org"].includes(licenseUrl.hostname)) {
              const licenseLink = document.createElement("a");
              licenseLink.href = licenseUrl.href;
              licenseLink.target = "_blank";
              licenseLink.rel = "noopener noreferrer";
              licenseLink.textContent = String(slide.image.license || "License");
              caption.append(document.createTextNode(" · "), licenseLink);
            } else if (slide.image.license) {
              caption.append(document.createTextNode(` · ${String(slide.image.license)}`));
            }
          } catch {
            if (slide.image.license) caption.append(document.createTextNode(` · ${String(slide.image.license)}`));
          }
          image.append(imageElement, caption);
        }
      } catch {
        image = null;
      }
    }
    if (image && visual) {
      const media = document.createElement("div");
      media.className = "presentation-media-column";
      media.append(image, visual);
      article.append(media);
    } else if (image || visual) {
      article.append(image || visual);
    }
    const detail = document.createElement("p");
    if (slide.activity) detail.append(document.createTextNode(String(slide.activity)));
    if (slide.activity && slide.visual_suggestion) detail.append(document.createElement("br"));
    if (slide.visual_suggestion) {
      const label = document.createElement("b");
      label.textContent = "Visual:";
      detail.append(label, document.createTextNode(` ${String(slide.visual_suggestion)}`));
    }
    article.append(detail);
    if (mode !== "all" && Number(data.reveal_total) > 0) {
      article.append(textElement("small", `Content ${Math.min(Number(data.reveal_step) || 0, Number(data.reveal_total))} of ${data.reveal_total}`, "presentation-follow-reveal-progress"));
    }
    if (animateNewReveal) {
      const revealSelectors = [
        "li",
        ".presentation-slide-image",
        ".presentation-visual-cards > div > span",
        ".presentation-visual-table tbody tr",
        ".presentation-chart-column",
        ".presentation-follow-chart-point",
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
      if (detail.textContent.trim() && detail.textContent !== previousDetail?.textContent) {
        detail.classList.add("presentation-item-zoom-in");
      }
    }
    lastRevealRender = { slide: data.active_slide, mode, step: revealStep };
    stage.replaceChildren(article);
    renderPointer(data.pointer);
    requestAnimationFrame(() => fitSlideToStage(article));
  }

  function fitSlideToStage(article = stage.querySelector(".presentation-slide-preview")) {
    if (!article || !stage.clientWidth || !stage.clientHeight) return;
    const width = Math.min(1100, stage.clientWidth, stage.clientHeight * 16 / 9);
    article.style.width = `${width}px`;
    article.style.height = `${width * 9 / 16}px`;
  }
  const stageResizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => requestAnimationFrame(fitSlideToStage))
    : null;
  stageResizeObserver?.observe(stage);

  function renderState(data) {
    if (data.status !== "active") {
      showEnded("The teacher has ended this presentation.");
      return;
    }
    Object.entries(data.own_poll_answers || {}).forEach(([pollId, answerIndex]) => ownAnswers.set(pollId, Number(answerIndex)));
    paceToggle.hidden = false;
    const slideKey = JSON.stringify([
      data.active_slide, data.slide_count, data.title, data.subject, data.year, data.template,
      data.visual_theme, data.reveal_mode, data.reveal_step, data.slide
    ]);
    if (slideKey !== lastSlideKey) {
      renderSlide(data);
      lastSlideKey = slideKey;
    } else {
      title.textContent = data.title || "Live classroom presentation";
    }
    renderPointer(data.pointer);
    const pollKey = JSON.stringify(data.active_poll);
    if (pollKey !== lastPollKey) {
      lastPollKey = pollKey;
      renderPoll(data.active_poll);
    }
    const reactionKey = JSON.stringify(data.reaction_counts || {});
    if (reactionKey !== lastReactionKey) {
      lastReactionKey = reactionKey;
      renderReactions(data.reaction_counts);
    }
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const questionsKey = JSON.stringify(questions);
    if (questionsKey !== lastQuestionsKey) {
      lastQuestionsKey = questionsKey;
      renderQuestions(questions);
    }
    if (data.timer_ends_at !== lastTimerKey) {
      lastTimerKey = data.timer_ends_at || "";
      updateTimer(data);
    }
  }

  async function poll() {
    if (stopped || document.hidden) return;
    if (interactionPending) {
      timer = window.setTimeout(poll, 200);
      return;
    }
    if (pollInFlight) return;
    pollInFlight = true;
    const revision = interactionRevision;
    try {
      const query = new URLSearchParams({ participant_id: participantId });
      const response = await fetch(`${basePath}/api/presentation-simulations/${encodeURIComponent(token)}?${query}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          showEnded(data.error || "This presentation link is invalid or no longer available.");
          return;
        }
        throw new Error(data.error || `The presentation could not be refreshed (HTTP ${response.status}).`);
      }
      if (data.status !== "active") {
        showEnded("The teacher has ended this presentation.");
        return;
      }
      if (revision !== interactionRevision) {
        timer = window.setTimeout(poll, 50);
        return;
      }
      const reconnected = !connected;
      connected = true;
      latestState = data;
      renderState(data);
      if (reconnected && lastSlideKey) status.textContent = "Connection restored · following your teacher";
    } catch (error) {
      connected = false;
      status.textContent = error instanceof Error ? `Reconnecting… ${error.message}` : "Reconnecting to the live presentation…";
    } finally {
      pollInFlight = false;
    }
    if (!stopped) timer = window.setTimeout(poll, document.hidden ? 4000 : 180);
  }

  function getParticipantId() {
    const key = `akademi-presentation-participant-${token}`;
    const createId = () => {
      const cryptoApi = window.crypto;
      if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
      const bytes = new Uint8Array(16);
      if (typeof cryptoApi?.getRandomValues === "function") {
        cryptoApi.getRandomValues(bytes);
      } else {
        for (let index = 0; index < bytes.length; index++) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
      const created = createId();
      window.sessionStorage.setItem(key, created);
      return created;
    } catch (error) {
      console.warn("A temporary student response identity could not be saved.", error);
      return createId();
    }
  }

  function storedParticipantName() {
    try {
      return window.sessionStorage.getItem(`akademi-presentation-name-${token}`) || "";
    } catch (error) {
      console.warn("The student name could not be restored from this browser session.", error);
      return "";
    }
  }

  if (!/^[a-fA-F0-9]{64}$/.test(token)) {
    showEnded("This presentation link is missing a valid sharing token.");
    return;
  }
  try {
    participantId = getParticipantId();
    const savedName = storedParticipantName().trim();
    participantName = savedName.length <= 80 && !/[\u0000-\u001f\u007f]/.test(savedName) ? savedName : "";
  } catch (error) {
    console.error("A secure student response identity could not be created.", error);
    showEnded("This browser could not create a secure response identity. Refresh and try again.");
    return;
  }
  const joinName = joinForm.elements.namedItem("name");
  if (participantName) joinName.value = participantName;
  else status.textContent = "Enter your name to join the presentation.";
  const startFollowing = () => {
    joinGate.hidden = true;
    experience.hidden = false;
    if (latestState) renderState(latestState);
    void poll();
  };
  if (participantName) startFollowing();
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = joinName.value.trim();
    if (!name || name.length > 80) {
      joinName.setCustomValidity("Enter a name using 1 to 80 characters.");
      joinName.reportValidity();
      return;
    }
    joinName.setCustomValidity("");
    participantName = name;
    try {
      window.sessionStorage.setItem(`akademi-presentation-name-${token}`, participantName);
    } catch (error) {
      console.warn("The student name could not be saved for this browser session.", error);
    }
    startFollowing();
  });
  questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const question = questionForm.elements.namedItem("question").value.trim();
    if (question) void submitInteraction({ type: "question", question });
  });
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector(".presentation-follow-shell").requestFullscreen();
    } catch (error) {
      status.textContent = error instanceof Error ? `Full screen is unavailable: ${error.message}` : "Full screen is unavailable in this browser.";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.setAttribute("aria-pressed", String(active));
    fullscreenButton.innerHTML = active
      ? '<i class="fa-solid fa-compress" aria-hidden="true"></i><span>Exit full screen</span>'
      : '<i class="fa-solid fa-expand" aria-hidden="true"></i><span>Full screen</span>';
  });
  paceToggle.addEventListener("click", () => {
    const expanded = paceToggle.getAttribute("aria-expanded") !== "true";
    paceToggle.setAttribute("aria-expanded", String(expanded));
    reactions.hidden = !expanded;
    paceToggle.querySelector("span").textContent = expanded ? "Hide pace" : "Show pace";
    paceToggle.querySelector("i").className = `fa-solid ${expanded ? "fa-eye-slash" : "fa-gauge-high"}`;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) {
      if (timer !== null) window.clearTimeout(timer);
      void poll();
    }
  });
  window.addEventListener("resize", () => requestAnimationFrame(() => fitSlideToStage()));
  window.visualViewport?.addEventListener("resize", () => requestAnimationFrame(() => fitSlideToStage()));
})();
