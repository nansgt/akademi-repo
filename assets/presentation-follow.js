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
  const fullscreenButton = document.querySelector("[data-follow-fullscreen]");
  const themes = new Set(["modern", "editorial", "vibrant", "data", "minimal"]);
  let timer = null;
  let countdownTimer = null;
  let lastSlideKey = "";
  let stopped = false;
  let connected = false;
  let latestState = null;
  let participantId = "";
  const ownAnswers = new Map();
  const reactionNames = { understood: "I understand", confused: "I’m confused", slower: "Please slow down", faster: "We can go faster" };
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
    frame.append(table);
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
    if (!series.some((item) => item.points.length > 1)) return null;

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
      if (item.points.length < 2) return;
      const color = colors[index % colors.length];
      const coordinates = item.points.map(([x, y]) => `${pointX(x)},${pointY(y)}`).join(" ");
      add("polyline", { points: coordinates, class: "presentation-follow-chart-line", style: `--chart-color:${color}` });
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

  function contentUnits(slide, mode) {
    const points = Array.isArray(slide.key_points)
      ? slide.key_points.filter((point) => typeof point === "string" && point.trim()).slice(0, 12)
      : [];
    const size = mode === "item" || mode === "timed" ? 1 : 2;
    const units = [];
    for (let index = 0; index < points.length; index += size) units.push({ type: "points", value: points.slice(index, index + size) });
    if (slide.visual) units.push({ type: "visual", value: slide.visual });
    if (slide.visual_suggestion) units.push({ type: "suggestion", value: slide.visual_suggestion });
    if (slide.activity) units.push({ type: "activity", value: slide.activity });
    return units;
  }

  function renderAnnotations(article, data) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("presentation-follow-annotations");
    (Array.isArray(data.annotations) ? data.annotations : []).forEach((stroke) => {
      if (!stroke || !Array.isArray(stroke.points) || !colors.has(stroke.color)) return;
      const points = stroke.points
        .filter((point) => Array.isArray(point) && point.length === 2
          && point.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1))
        .map(([x, y]) => `${Number(x) * 1000},${Number(y) * 1000}`)
        .join(" ");
      if (!points) return;
      const polyline = document.createElementNS(svg.namespaceURI, "polyline");
      polyline.setAttribute("points", points);
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", colors.has(stroke.color) ? stroke.color : "#e5484d");
      polyline.setAttribute("stroke-width", stroke.tool === "highlighter" ? "22" : "8");
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      if (stroke.tool === "highlighter") polyline.setAttribute("stroke-opacity", ".28");
      svg.append(polyline);
    });
    article.append(svg);

    const pointer = data.pointer;
    if (pointer?.active && Number.isFinite(Number(pointer.x)) && Number.isFinite(Number(pointer.y))
      && colors.has(pointer.color)) {
      const laser = document.createElement("span");
      laser.className = "presentation-follow-laser";
      laser.setAttribute("aria-hidden", "true");
      laser.style.left = `${Math.max(0, Math.min(1, Number(pointer.x))) * 100}%`;
      laser.style.top = `${Math.max(0, Math.min(1, Number(pointer.y))) * 100}%`;
      laser.style.setProperty("--laser-color", pointer.color);
      article.append(laser);
    }
  }

  function renderPoll(poll) {
    pollPanel.replaceChildren();
    pollPanel.hidden = !poll;
    if (!poll) return;
    pollPanel.append(textElement("h2", poll.question, "presentation-follow-poll-question"));
    const options = Array.isArray(poll.options) ? poll.options : [];
    const selected = ownAnswers.get(poll.id);
    const results = poll.results || {};
    options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "presentation-follow-poll-option";
      const button = textElement("button", String(option), "presentation-follow-poll-choice");
      button.type = "button";
      button.disabled = !poll.open || selected !== undefined;
      if (selected === index) button.setAttribute("aria-pressed", "true");
      button.addEventListener("click", () => void submitInteraction({
        type: "poll", poll_id: poll.id, answer_index: index
      }));
      row.append(button);
      if (selected !== undefined || !poll.open) {
        row.append(textElement("span", `${Number(results[index] || 0)} votes`, "presentation-follow-poll-votes"));
      }
      pollPanel.append(row);
    });
    if (!poll.open) pollPanel.append(textElement("p", "This check-in is closed."));
  }

  function renderReactions(counts = {}) {
    reactions.replaceChildren(textElement("span", "How is the pace?", "presentation-follow-reaction-label"));
    Object.entries(reactionNames).forEach(([reaction, label]) => {
      const button = textElement("button", `${label} · ${Number(counts[reaction] || 0)}`, "presentation-follow-reaction");
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => void submitInteraction({ type: "reaction", reaction }));
      reactions.append(button);
    });
    reactions.hidden = false;
  }

  async function submitInteraction(interaction) {
    try {
      const response = await fetch(`${basePath}/api/presentation-simulations/${encodeURIComponent(token)}/interaction`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ ...interaction, participant_id: participantId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your response could not be sent.");
      if (interaction.type === "poll") ownAnswers.set(interaction.poll_id, interaction.answer_index);
      latestState = data;
      renderState(data);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Your response could not be sent. Please try again.";
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
    if (timer !== null) window.clearTimeout(timer);
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    status.textContent = message;
    stage.replaceChildren(textElement("p", message, "presentation-follow-placeholder"));
    count.textContent = "";
    pollPanel.hidden = true;
    reactions.hidden = true;
    progress.style.width = "0";
  }

  function renderSlide(data) {
    title.textContent = data.title || "Live classroom presentation";
    count.textContent = `Slide ${data.active_slide + 1} of ${data.slide_count}`;
    progress.style.width = `${Math.round((data.active_slide + 1) / Math.max(data.slide_count, 1) * 100)}%`;
    status.textContent = data.subject
      ? `Following your teacher · ${data.subject}${data.year ? ` · ${data.year}` : ""}`
      : "Following your teacher's presentation";
    const theme = themes.has(data.visual_theme) ? data.visual_theme : "modern";
    const template = ["lesson", "inquiry", "worked", "discussion", "project", "revision", "flipped"].includes(data.template)
      ? data.template
      : "lesson";
    const slide = data.slide || {};
    const article = document.createElement("article");
    article.className = `presentation-slide-preview presentation-theme-${theme} presentation-template-${template}`;
    article.append(textElement("h1", String(slide.title || "Presentation slide")));
    const mode = ["all", "group", "item", "timed"].includes(data.reveal_mode) ? data.reveal_mode : "all";
    const units = contentUnits(slide, mode);
    const visibleCount = units.length;
    units.forEach((unit) => {
      if (unit.type === "points") {
      const list = document.createElement("ul");
        unit.value.forEach((point) => list.append(textElement("li", point)));
      article.append(list);
      } else if (unit.type === "visual") {
        const visual = renderPresentationVisual(unit.value);
        if (visual) article.append(visual);
      } else if (unit.type === "suggestion") {
        article.append(textElement("p", `Visual: ${String(unit.value)}`));
      } else if (unit.type === "activity") {
        article.append(textElement("p", String(unit.value)));
      }
    });
    if (mode !== "all" && Number(data.reveal_total) > 0) {
      article.append(textElement("small", `Content ${Math.min(Number(data.reveal_step) || 0, Number(data.reveal_total))} of ${data.reveal_total}`, "presentation-follow-reveal-progress"));
    }
    renderAnnotations(article, data);
    stage.replaceChildren(article);
    renderPoll(data.active_poll);
    renderReactions(data.reaction_counts);
    updateTimer(data);
  }

  function renderState(data) {
    if (data.status !== "active") {
      showEnded("The teacher has ended this presentation.");
      return;
    }
    const slideKey = JSON.stringify([
      data.active_slide, data.slide_count, data.title, data.reveal_mode, data.reveal_step,
      data.annotations, data.pointer, data.active_poll, data.reaction_counts, data.timer_ends_at
    ]);
    if (slideKey !== lastSlideKey) {
      renderSlide(data);
      lastSlideKey = slideKey;
    } else {
      title.textContent = data.title || "Live classroom presentation";
    }
  }

  async function poll() {
    if (stopped || document.hidden) return;
    try {
      const response = await fetch(`${basePath}/api/presentation-simulations/${encodeURIComponent(token)}`, {
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
      const reconnected = !connected;
      connected = true;
      renderState(data);
      if (reconnected && lastSlideKey) status.textContent = "Connection restored · following your teacher";
    } catch (error) {
      connected = false;
      status.textContent = error instanceof Error ? `Reconnecting… ${error.message}` : "Reconnecting to the live presentation…";
    }
    if (!stopped) timer = window.setTimeout(poll, document.hidden ? 4000 : 1000);
  }

  function getParticipantId() {
    const key = `akademi-presentation-participant-${token}`;
    const cryptoApi = window.crypto;
    const createId = () => {
      if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
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

  if (!/^[a-fA-F0-9]{64}$/.test(token)) {
    showEnded("This presentation link is missing a valid sharing token.");
    return;
  }
  try {
    participantId = getParticipantId();
  } catch (error) {
    console.error("A secure student response identity could not be created.", error);
    showEnded("This browser could not create a secure response identity. Refresh and try again.");
    return;
  }
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector(".presentation-follow-shell").requestFullscreen();
    } catch (error) {
      status.textContent = error instanceof Error ? `Full screen is unavailable: ${error.message}` : "Full screen is unavailable in this browser.";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) {
      if (timer !== null) window.clearTimeout(timer);
      void poll();
    }
  });
  void poll();
})();
