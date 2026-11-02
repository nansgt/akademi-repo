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
  const pollDialog = document.querySelector('[data-follow-dialog="poll"]');
  const pollDialogTrigger = document.querySelector('[data-follow-dialog-open="poll"]');
  const reactions = document.querySelector("[data-follow-reactions]");
  const paceCountBadge = document.querySelector("[data-follow-pace-count]");
  const dialogTriggers = document.querySelectorAll("[data-follow-dialog-open]");
  const dialogs = document.querySelectorAll("[data-follow-dialog]");
  const fullscreenButton = document.querySelector("[data-follow-fullscreen]");
  const joinGate = document.querySelector("[data-follow-join]");
  const experience = document.querySelector("[data-follow-experience]");
  const joinForm = document.querySelector("[data-follow-join-form]");
  const questionForm = document.querySelector("[data-follow-question-form]");
  const questionList = document.querySelector("[data-follow-questions]");
  const questionCount = document.querySelector("[data-follow-question-count]");
  const directForm = document.querySelector("[data-follow-direct-form]");
  const directRecipient = document.querySelector("[data-follow-direct-recipient]");
  const directMessages = document.querySelector("[data-follow-direct-messages]");
  const directDialog = document.querySelector('[data-follow-dialog="direct"]');
  const directStatus = document.querySelector("[data-follow-direct-status]");
  const directCount = document.querySelector("[data-follow-direct-count]");
  const directNotification = document.querySelector("[data-follow-direct-notification]");
  const themes = new Set(["modern", "editorial", "vibrant", "data", "minimal"]);
  let timer = null;
  let presenceTimer = null;
  let directRefreshTimer = null;
  let directNotificationTimer = null;
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
  let presencePending = false;
  let participantId = "";
  let participantName = "";
  let lastQuestionsKey = "";
  let lastDirectMessagesKey = "";
  let lastDirectParticipantsKey = "";
  let latestDirectParticipants = [];
  let latestDirectMessages = [];
  let directMessagesPending = false;
  let lastDirectUnreadByPeer = null;
  const ownAnswers = new Map();
  const ownReactions = new Map();
  const reactionNames = {
    understood: "😊 I understand",
    confused: "🤔 I’m confused",
    slower: "🐢 Please slow down",
    faster: "🚀 We can go faster"
  };
  const colors = new Set(["#e5484d", "#2f80ed", "#27ae60", "#f2c94c", "#ffffff"]);

  dialogTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const dialog = document.querySelector(`[data-follow-dialog="${trigger.dataset.followDialogOpen}"]`);
      if (!dialog || typeof dialog.showModal !== "function") {
        status.textContent = "This browser does not support classroom panels.";
        return;
      }
      try {
        dialog.showModal();
        if (trigger.dataset.followDialogOpen === "direct") {
          void refreshDirectMessages(directRecipient.value || "teacher");
          if (directRefreshTimer === null) {
            directRefreshTimer = window.setInterval(() => void refreshDirectMessages(), 3000);
          }
        }
      } catch (error) {
        status.textContent = error instanceof Error ? `The classroom panel could not be opened: ${error.message}` : "The classroom panel could not be opened.";
      }
    });
  });
  dialogs.forEach((dialog) => {
    dialog.querySelector("[data-follow-dialog-close]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    directDialog.addEventListener("close", () => {
      if (directRefreshTimer !== null) window.clearInterval(directRefreshTimer);
      directRefreshTimer = null;
    });
  });

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

  function renderGeometryVisual(visual) {
    const bounds = ["x_min", "x_max", "y_min", "y_max"].map((key) => Number(visual[key]));
    const shapes = Array.isArray(visual.shapes) ? visual.shapes.slice(0, 8) : [];
    if (bounds.some((value) => !Number.isFinite(value)) || bounds[0] >= bounds[1] || bounds[2] >= bounds[3] || !shapes.length) return null;
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
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", String(visual.title || "Geometry diagram"));
    svg.classList.add("presentation-follow-geometry");
    const add = (tag, attributes, text) => {
      const element = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
      if (text !== undefined) element.textContent = String(text);
      svg.append(element);
      return element;
    };
    const clipId = "follow-geometry-clip";
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    const clip = document.createElementNS(svg.namespaceURI, "clipPath");
    clip.id = clipId;
    const clipRect = document.createElementNS(svg.namespaceURI, "rect");
    Object.entries({ x: n(offsetX), y: n(offsetY), width: n(plotWidth), height: n(plotHeight) }).forEach(([key, value]) => clipRect.setAttribute(key, String(value)));
    clip.append(clipRect);
    defs.append(clip);
    svg.append(defs);
    for (let index = 0; index <= 4; index++) {
      const x = offsetX + plotWidth * index / 4, y = offsetY + plotHeight * index / 4;
      add("line", { x1: n(x), y1: n(offsetY), x2: n(x), y2: n(offsetY + plotHeight), class: "presentation-follow-geometry-grid" });
      add("line", { x1: n(offsetX), y1: n(y), x2: n(offsetX + plotWidth), y2: n(y), class: "presentation-follow-geometry-grid" });
      add("text", { x: n(x), y: n(offsetY + plotHeight + 16), "text-anchor": "middle", class: "presentation-follow-geometry-label" }, n(xMin + rangeX * index / 4));
      add("text", { x: n(offsetX - 8), y: n(y + 4), "text-anchor": "end", class: "presentation-follow-geometry-label" }, n(yMax - rangeY * index / 4));
    }
    const axisX = xMin <= 0 && xMax >= 0 ? px(0) : offsetX;
    const axisY = yMin <= 0 && yMax >= 0 ? py(0) : offsetY + plotHeight;
    add("line", { x1: n(axisX), y1: n(offsetY), x2: n(axisX), y2: n(offsetY + plotHeight), class: "presentation-follow-geometry-axis" });
    add("line", { x1: n(offsetX), y1: n(axisY), x2: n(offsetX + plotWidth), y2: n(axisY), class: "presentation-follow-geometry-axis" });
    const colors = ["#247456", "#d0a64a", "#277da1", "#c85845", "#7256a8", "#4d7c78", "#bf6b40", "#5572a8"];
    const labels = shapes.map((shape, index) => {
      if (!shape || typeof shape.label !== "string" || !shape.label.trim()) return null;
      const item = document.createElement("span");
      const swatch = document.createElement("i");
      swatch.style.setProperty("--shape-color", colors[index % colors.length]);
      item.append(swatch, document.createTextNode(shape.label));
      return item;
    }).filter(Boolean);
    const drawing = document.createElementNS(svg.namespaceURI, "g");
    drawing.setAttribute("clip-path", `url(#${clipId})`);
    shapes.forEach((shape, index) => {
      if (!shape || typeof shape !== "object") return;
      const color = colors[index % colors.length];
      const addToDrawing = (tag, attributes, text) => {
        const element = document.createElementNS(svg.namespaceURI, tag);
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
        if (text !== undefined) element.textContent = String(text);
        drawing.append(element);
        return element;
      };
      if (shape.shape === "circle" || shape.shape === "ellipse") {
        const center = Array.isArray(shape.center) ? shape.center.map(Number) : [];
        const radii = shape.shape === "circle" ? [Number(shape.radius), Number(shape.radius)] : (Array.isArray(shape.radii) ? shape.radii.map(Number) : []);
        if (center.length !== 2 || radii.length !== 2 || ![...center, ...radii].every(Number.isFinite) || radii.some((value) => value <= 0)) return;
        addToDrawing("ellipse", {
          cx: n(px(center[0])), cy: n(py(center[1])), rx: n(radii[0] * scale), ry: n(radii[1] * scale),
          fill: color, "fill-opacity": ".12", stroke: color, "stroke-width": "2.5"
        });
      } else if (shape.shape === "parabola") {
        const coefficients = Array.isArray(shape.coefficients) ? shape.coefficients.map(Number) : [];
        const from = Number(shape.x_min), to = Number(shape.x_max);
        if (coefficients.length !== 3 || !coefficients.every(Number.isFinite) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
        const [a, b, c] = coefficients, segments = 12;
        let d = `M ${n(px(from))} ${n(py(a * from * from + b * from + c))}`;
        for (let step = 0; step < segments; step++) {
          const x0 = from + (to - from) * step / segments, x1 = from + (to - from) * (step + 1) / segments;
          const y0 = a * x0 * x0 + b * x0 + c, y1 = a * x1 * x1 + b * x1 + c;
          const dx = (x1 - x0) * scale / 3;
          const control1 = { x: px(x0) + dx, y: py(y0) - (2 * a * x0 + b) * (x1 - x0) * scale / 3 };
          const control2 = { x: px(x1) - dx, y: py(y1) + (2 * a * x1 + b) * (x1 - x0) * scale / 3 };
          d += ` C ${n(control1.x)} ${n(control1.y)} ${n(control2.x)} ${n(control2.y)} ${n(px(x1))} ${n(py(y1))}`;
        }
        addToDrawing("path", { d, fill: "none", stroke: color, "stroke-width": "3", "stroke-linecap": "round" });
      } else if (shape.shape === "rectangle") {
        const left = Number(shape.x_min), right = Number(shape.x_max), top = Number(shape.y_max), bottom = Number(shape.y_min);
        if (![left, right, top, bottom].every(Number.isFinite) || left >= right || bottom >= top) return;
        addToDrawing("rect", {
          x: n(px(left)), y: n(py(top)), width: n((right - left) * scale), height: n((top - bottom) * scale),
          fill: color, "fill-opacity": ".12", stroke: color, "stroke-width": "2.5"
        });
      } else if (shape.shape === "line" || shape.shape === "triangle") {
        const points = Array.isArray(shape.points) ? shape.points.filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value)))) : [];
        const needed = shape.shape === "line" ? 2 : 3;
        if (points.length !== needed) return;
        const pointString = points.map(([x, y]) => `${n(px(Number(x)))},${n(py(Number(y)))}`).join(" ");
        addToDrawing(shape.shape === "line" ? "polyline" : "polygon", {
          points: pointString, fill: shape.shape === "line" ? "none" : color,
          "fill-opacity": shape.shape === "line" ? "0" : ".12", stroke: color, "stroke-width": "2.5"
        });
      }
    });
    svg.append(drawing);
    if (visual.x_label) add("text", { x: n(offsetX + plotWidth / 2), y: height - 3, "text-anchor": "middle", class: "presentation-follow-geometry-label" }, visual.x_label);
    if (visual.y_label) add("text", { x: 12, y: n(offsetY + plotHeight / 2), "text-anchor": "middle", class: "presentation-follow-geometry-label", transform: `rotate(-90 12 ${n(offsetY + plotHeight / 2)})` }, visual.y_label);
    const frame = visualFrame(visual, "geometry");
    frame.setAttribute("role", "group");
    frame.append(svg);
    if (labels.length) {
      const legend = document.createElement("div");
      legend.className = "presentation-follow-geometry-legend";
      legend.append(...labels);
      frame.append(legend);
    }
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
        add("polyline", {
          points: coordinates,
          fill: "none",
          stroke: color,
          "stroke-width": 4,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "vector-effect": "non-scaling-stroke",
          class: "presentation-follow-chart-line"
        });
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
    if (type === "geometry") return renderGeometryVisual(visual);
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
    pollPanel.hidden = !poll || selected !== undefined;
    pollDialogTrigger.hidden = pollPanel.hidden;
    if (pollPanel.hidden && pollDialog.open) pollDialog.close();
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
    reactions.replaceChildren();
    const paceCount = Object.values(counts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    if (paceCountBadge) {
      paceCountBadge.textContent = String(paceCount);
      paceCountBadge.hidden = paceCount === 0;
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
    questionCount.setAttribute("aria-label", `${questions.length} chat messages sent`);
    const submitButton = questionForm.querySelector("button[type='submit']");
    const submitCount = submitButton?.querySelector(".presentation-follow-counter");
    if (submitCount) {
      submitCount.textContent = String(questions.length);
      submitCount.hidden = questions.length === 0;
      submitButton.setAttribute("aria-label", `Send message, ${questions.length} chat messages sent`);
    }
    questions.forEach((question) => {
      const card = document.createElement("article");
      card.className = "presentation-follow-question-item";
      const studentMessage = document.createElement("p");
      studentMessage.className = "presentation-follow-chat-message presentation-follow-chat-student";
      studentMessage.append(
        textElement("small", "You"),
        textElement("span", question.question)
      );
      card.append(studentMessage);
      const replies = Array.isArray(question.teacher_replies) && question.teacher_replies.length
        ? question.teacher_replies
        : question.teacher_feedback ? [{ feedback: question.teacher_feedback }] : [];
      if (replies.length) {
        replies.forEach((reply) => {
          const teacherMessage = document.createElement("p");
          teacherMessage.className = "presentation-follow-chat-message presentation-follow-chat-teacher";
          teacherMessage.append(
            textElement("small", "Teacher"),
            textElement("span", reply.feedback)
          );
          card.append(teacherMessage);
        });
      } else {
        card.append(textElement("small", "Waiting for a reply…"));
      }
      questionList.append(card);
    });
  }

  function renderDirectChat(participants = [], messages = []) {
    const recipientKey = JSON.stringify(participants);
    if (recipientKey !== lastDirectParticipantsKey) {
      const selected = directRecipient.value || "teacher";
      directRecipient.replaceChildren(...participants.map((participant) => {
        const option = document.createElement("option");
        option.value = String(participant.id);
        const unread = Number(participant.unread_count) || 0;
        const presence = participant.role === "student" ? (participant.online ? " · online" : " · away") : "";
        option.textContent = `${participant.name}${presence}${unread ? ` · ${unread} new` : ""}`;
        return option;
      }));
      if (participants.some((participant) => String(participant.id) === selected)) directRecipient.value = selected;
      lastDirectParticipantsKey = recipientKey;
      lastDirectMessagesKey = "";
    }
    const recipientId = directRecipient.value || "teacher";
    const unreadTotal = participants.reduce((sum, participant) => sum + Math.max(0, Number(participant.unread_count) || 0), 0);
    directCount.textContent = unreadTotal > 99 ? "99+" : String(unreadTotal);
    directCount.hidden = unreadTotal === 0;
    const directButton = document.querySelector('[data-follow-dialog-open="direct"]');
    directButton?.setAttribute("aria-label", `Private chat${unreadTotal ? `, ${unreadTotal} unread messages` : ""}`);
    const conversation = messages.filter((message) => String(message.peer_id) === recipientId);
    const messagesKey = `${recipientId}:${JSON.stringify(conversation)}`;
    if (messagesKey === lastDirectMessagesKey) return;
    lastDirectMessagesKey = messagesKey;
    directMessages.replaceChildren();
    if (!conversation.length) {
      directMessages.append(textElement("p", "Start a private conversation.", "presentation-follow-chat-empty"));
      return;
    }
    conversation.forEach((message) => {
      const card = document.createElement("article");
      card.className = `presentation-follow-chat-message${message.mine ? " presentation-follow-chat-teacher" : ""}`;
      card.append(
        textElement("small", message.sender_name || (message.mine ? "You" : "Participant")),
        textElement("span", message.message || "")
      );
      directMessages.append(card);
    });
    directMessages.scrollTop = directMessages.scrollHeight;
  }

  async function refreshDirectMessages(peerId = directDialog.open ? directRecipient.value : null) {
    if (!participantId || directMessagesPending || document.hidden || stopped) return;
    directMessagesPending = true;
    try {
      const query = new URLSearchParams({ participant_id: participantId });
      if (peerId) query.set("peer_id", peerId);
      const response = await fetch(
        `${basePath}/api/presentation-simulations/${encodeURIComponent(token)}/messages?${query}`,
        { credentials: "same-origin", headers: { Accept: "application/json" } }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Private messages could not be refreshed.");
      latestDirectParticipants = Array.isArray(data.participants) ? data.participants : [];
      latestDirectMessages = Array.isArray(data.messages) ? data.messages : [];
      const unreadByPeer = new Map(latestDirectParticipants.map((person) => [
        String(person.id),
        Math.max(0, Number(person.unread_count) || 0)
      ]));
      const newMessages = lastDirectUnreadByPeer === null ? [] : latestDirectParticipants.filter((person) => (
        (unreadByPeer.get(String(person.id)) || 0) > (lastDirectUnreadByPeer.get(String(person.id)) || 0)
      ));
      if (newMessages.length) {
        const sender = newMessages[0];
        directNotification.textContent = sender
          ? `New private message from ${sender.name}.`
          : "You have a new private message.";
        if (directNotificationTimer !== null) window.clearTimeout(directNotificationTimer);
        directNotificationTimer = window.setTimeout(() => {
          directNotification.textContent = "";
          directNotificationTimer = null;
        }, 7000);
      }
      lastDirectUnreadByPeer = unreadByPeer;
      directStatus.textContent = "";
      renderDirectChat(latestDirectParticipants, latestDirectMessages);
    } catch (error) {
      directStatus.textContent = error instanceof Error ? error.message : "Private messages could not be refreshed.";
    } finally {
      directMessagesPending = false;
    }
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
    if (interaction.type === "direct_message") directStatus.textContent = "";
    status.textContent = ["question", "direct_message"].includes(interaction.type) ? "Sending your message…" : "Sending your response…";
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
      if (interaction.type === "direct_message") directForm.elements.namedItem("message").value = "";
      latestState = data;
      renderState(data);
      if (interaction.type === "direct_message") await refreshDirectMessages();
      status.textContent = interaction.type === "poll"
        ? "✅ Your answer has been sent!"
        : interaction.type === "question" ? "✅ Your question has been sent!"
          : interaction.type === "direct_message" ? "✅ Your private message has been sent!" : "✅ Response received";
      submitted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Your response could not be sent. Please try again.";
      if (interaction.type === "direct_message") directStatus.textContent = message;
      else status.textContent = message;
    } finally {
      interactionPending = false;
      if (!submitted && latestState) {
        renderPoll(latestState.active_poll);
        renderReactions(latestState.reaction_counts);
      }
    }
  }

  async function sendPresence() {
    if (stopped || !participantId || !participantName || presencePending) return;
    presencePending = true;
    try {
      const response = await fetch(`${basePath}/api/presentation-simulations/${encodeURIComponent(token)}/join`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: participantId, participant_name: participantName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your teacher could not be notified that you joined.");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Your teacher could not be notified that you joined.";
    } finally {
      presencePending = false;
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
    if (presenceTimer !== null) window.clearInterval(presenceTimer);
    if (directRefreshTimer !== null) window.clearInterval(directRefreshTimer);
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    status.textContent = message;
    stage.replaceChildren(textElement("p", message, "presentation-follow-placeholder"));
    count.textContent = "";
    pollPanel.hidden = true;
    pollDialogTrigger.hidden = true;
    reactions.hidden = true;
    dialogs.forEach((dialog) => {
      if (dialog.open) dialog.close();
    });
    questionForm.querySelector("textarea").disabled = true;
    questionForm.querySelector("button").disabled = true;
    directForm.querySelector("textarea").disabled = true;
    directForm.querySelector("button").disabled = true;
    directRecipient.disabled = true;
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
      const embeddedImage = String(slide.image.url || "");
      if (embeddedImage.length <= 100000 && /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(embeddedImage)) {
        image = document.createElement("figure");
        image.className = "presentation-slide-image";
        const imageElement = document.createElement("img");
        imageElement.src = embeddedImage;
        imageElement.alt = String(slide.image.alt || "Teacher-uploaded slide image");
        imageElement.loading = "lazy";
        const caption = document.createElement("figcaption");
        caption.textContent = String(slide.image.license || "Teacher-provided image");
        image.append(imageElement, caption);
      }
      if (!image) {
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
    }
    if (image && visual) {
      const media = document.createElement("div");
      media.className = "presentation-media-column";
      media.append(image, visual);
      article.append(media);
    } else if (image || visual) {
      article.append(image || visual);
    }
    if (slide.activity) {
      const activity = document.createElement("section");
      activity.className = "presentation-slide-activity";
      const activityHeading = document.createElement("strong");
      const activityIcon = document.createElement("i");
      activityIcon.className = "fa-solid fa-people-group";
      activityIcon.setAttribute("aria-hidden", "true");
      activityHeading.append(activityIcon, document.createTextNode(" Classroom activity"));
      activity.append(activityHeading, textElement("p", String(slide.activity)));
      article.append(activity);
    }
    if (slide.visual_suggestion) {
      const detail = document.createElement("p");
      detail.className = "presentation-slide-visual-suggestion";
      const label = document.createElement("b");
      label.textContent = "Visual:";
      detail.append(label, document.createTextNode(` ${String(slide.visual_suggestion)}`));
      article.append(detail);
    }
    if (mode !== "all" && Number(data.reveal_total) > 0) {
      article.append(textElement("small", `Content ${Math.min(Number(data.reveal_step) || 0, Number(data.reveal_total))} of ${data.reveal_total}`, "presentation-follow-reveal-progress"));
    }
    if (animateNewReveal) {
      const revealSelectors = [
        "li",
        ".presentation-slide-image",
        ".presentation-slide-activity",
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
      const detail = article.querySelector(":scope > .presentation-slide-visual-suggestion");
      const previousDetail = previousArticle?.querySelector(":scope > .presentation-slide-visual-suggestion");
      if (detail?.textContent.trim() && detail.textContent !== previousDetail?.textContent) {
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
    ? new ResizeObserver(() => requestAnimationFrame(() => fitSlideToStage()))
    : null;
  stageResizeObserver?.observe(stage);

  function renderState(data) {
    if (data.status !== "active") {
      showEnded("The teacher has ended this presentation.");
      return;
    }
    reactions.hidden = false;
    Object.entries(data.own_poll_answers || {}).forEach(([pollId, answerIndex]) => ownAnswers.set(pollId, Number(answerIndex)));
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
    renderDirectChat(latestDirectParticipants, latestDirectMessages);
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
      const initialRead = latestState === null;
      const stateUrl = initialRead
        ? `${basePath}/api/presentation-simulations/${encodeURIComponent(token)}?${query}`
        : `${basePath}/api/presentation-simulations/${encodeURIComponent(token)}/updates?${query}&since=${encodeURIComponent(latestState.state_version || 0)}`;
      const response = await fetch(stateUrl, {
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
      if (!initialRead && data.changed === false) {
        connected = true;
        timer = window.setTimeout(poll, 0);
        return;
      }
      const state = initialRead ? data : data.state;
      if (!state || typeof state !== "object") {
        throw new Error("The live presentation update was empty. Reconnecting…");
      }
      if (state.status !== "active") {
        showEnded("The teacher has ended this presentation.");
        return;
      }
      if (revision !== interactionRevision) {
        timer = window.setTimeout(poll, 50);
        return;
      }
      const reconnected = !connected;
      connected = true;
      latestState = state;
      renderState(state);
      if (reconnected && lastSlideKey) status.textContent = "Connection restored · following your teacher";
    } catch (error) {
      connected = false;
      status.textContent = error instanceof Error ? `Reconnecting… ${error.message}` : "Reconnecting to the live presentation…";
    } finally {
      pollInFlight = false;
    }
    if (!stopped) timer = window.setTimeout(poll, document.hidden ? 4000 : 180);
  }

  function participantStorageKey(kind) {
    return `akademi-presentation-${kind}-${token}`;
  }

  function readParticipantValue(kind) {
    const key = participantStorageKey(kind);
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const value = storage.getItem(key);
        if (value) return value;
      } catch (error) {
        console.warn("A stored student identity could not be read.", error);
      }
    }
    const cookieName = `akademi_presentation_${kind}_${token}`;
    const cookie = document.cookie.split("; ").find((item) => item.startsWith(`${cookieName}=`));
    if (!cookie) return "";
    try {
      return decodeURIComponent(cookie.slice(cookieName.length + 1));
    } catch (error) {
      console.warn("The saved student identity cookie is invalid.", error);
      return "";
    }
  }

  function saveParticipantValue(kind, value) {
    const key = participantStorageKey(kind);
    let saved = false;
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        storage.setItem(key, value);
        saved = storage.getItem(key) === value || saved;
      } catch (error) {
        console.warn("A student identity could not be saved in browser storage.", error);
      }
    }
    const cookieName = `akademi_presentation_${kind}_${token}`;
    const cookiePath = basePath || "/";
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    try {
      document.cookie = `${cookieName}=${encodeURIComponent(value)}; Max-Age=43200; Path=${cookiePath}; SameSite=Lax${secure}`;
      saved = readParticipantCookie(cookieName) === value || saved;
    } catch (error) {
      console.warn("The student identity could not be saved in a browser cookie.", error);
    }
    if (!saved) throw new Error("This browser could not save your presentation identity. Enable browser storage and try again.");
  }

  function readParticipantCookie(cookieName) {
    const cookie = document.cookie.split("; ").find((item) => item.startsWith(`${cookieName}=`));
    if (!cookie) return "";
    try {
      return decodeURIComponent(cookie.slice(cookieName.length + 1));
    } catch {
      return "";
    }
  }

  function getParticipantId() {
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
    const stored = readParticipantValue("participant");
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
    const created = createId();
    saveParticipantValue("participant", created);
    return created;
  }

  function storedParticipantName() {
    return readParticipantValue("name");
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
    void sendPresence().then(() => refreshDirectMessages());
    if (presenceTimer !== null) window.clearInterval(presenceTimer);
    presenceTimer = window.setInterval(() => void sendPresence(), 20_000);
    if (directRefreshTimer !== null) window.clearInterval(directRefreshTimer);
    directRefreshTimer = window.setInterval(() => void refreshDirectMessages(), 3000);
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
      saveParticipantValue("name", participantName);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Your name could not be saved. Enable browser storage and try again.";
      return;
    }
    startFollowing();
  });
  questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const question = questionForm.elements.namedItem("question").value.trim();
    if (question) void submitInteraction({ type: "question", question });
  });
  directRecipient.addEventListener("change", () => {
    void refreshDirectMessages(directRecipient.value);
  });
  directForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const message = directForm.elements.namedItem("message").value.trim();
    const recipientId = directRecipient.value;
    if (message && recipientId) void submitInteraction({ type: "direct_message", recipient_id: recipientId, message });
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
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) {
      if (timer !== null) window.clearTimeout(timer);
      void sendPresence();
      void refreshDirectMessages();
      void poll();
    }
  });
  window.addEventListener("resize", () => requestAnimationFrame(() => fitSlideToStage()));
  window.visualViewport?.addEventListener("resize", () => requestAnimationFrame(() => fitSlideToStage()));
})();
