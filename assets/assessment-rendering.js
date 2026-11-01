(() => {
  "use strict";

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function mathMarkup(value) {
    let output = escape(value);
    output = output
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="assessment-fraction"><span>$1</span><span>$2</span></span>')
      .replace(/\\sqrt\{([^{}]+)\}/g, '<span class="assessment-root"><span>√</span><span>$1</span></span>')
      .replace(/\\(?:times|cdot)\b/g, " × ")
      .replace(/\\div\b/g, " ÷ ")
      .replace(/\\(?:leq|le)\b/g, " ≤ ")
      .replace(/\\(?:geq|ge)\b/g, " ≥ ")
      .replace(/\\neq\b/g, " ≠ ")
      .replace(/\\pm\b/g, " ± ")
      .replace(/\\infty\b/g, "∞")
      .replace(/\\pi\b/g, "π")
      .replace(/\\theta\b/g, "θ")
      .replace(/\\left|\\right/g, "");
    output = output
      .replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>")
      .replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>")
      .replace(/\^([A-Za-z0-9])/g, "<sup>$1</sup>")
      .replace(/_([A-Za-z0-9])/g, "<sub>$1</sub>");
    return output;
  }

  function formatPlainText(value) {
    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    let output = "";
    let previousIndex = 0;
    for (const match of value.matchAll(imagePattern)) {
      output += mathMarkup(value.slice(previousIndex, match.index));
      let url;
      try {
        url = new URL(match[2], window.location.href);
      } catch {
        output += mathMarkup(match[0]);
        previousIndex = match.index + match[0].length;
        continue;
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        output += mathMarkup(match[0]);
      } else {
        output += `<span class="assessment-inline-image-wrap"><img class="assessment-prompt-image" src="${escape(url.href)}" alt="${escape(match[1])}"${match[3] ? ` title="${escape(match[3])}"` : ""} loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
      }
      previousIndex = match.index + match[0].length;
    }
    return output + mathMarkup(value.slice(previousIndex));
  }

  function formatText(value) {
    return String(value ?? "").split(/(\$[^$\n]+\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\])/g).map((part) => {
      if ((part.startsWith("$") && part.endsWith("$"))
        || (part.startsWith("\\(") && part.endsWith("\\)"))
        || (part.startsWith("\\[") && part.endsWith("\\]"))) {
        const expression = part.startsWith("$") ? part.slice(1, -1) : part.slice(2, -2);
        return `<span class="assessment-math" role="math">${mathMarkup(expression)}</span>`;
      }
      return formatPlainText(part);
    }).join("");
  }

  function parseQuestionTable(prompt, structuredTable) {
    const normalizeRows = (value) => {
      const rows = Array.isArray(value) ? value : value?.rows;
      if (!Array.isArray(rows)) return [];
      const header = Array.isArray(value?.headers) ? [value.headers] : [];
      return [...header, ...rows]
        .filter(Array.isArray)
        .map((row) => row.map((cell) => String(cell ?? "").trim()))
        .filter((row) => row.some(Boolean));
    };
    const structuredRows = normalizeRows(structuredTable);
    if (structuredRows.length > 1) return { text: String(prompt ?? ""), rows: structuredRows };

    const source = String(prompt ?? "");
    const lines = source.split(/\r?\n/);
    const tableLines = lines.map((line) => line.trim()).filter((line) => line.includes("|"));
    if (tableLines.length >= 2) {
      const rows = tableLines
        .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
        .filter((row) => row.some(Boolean) && !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
      const columnCount = rows[0]?.length || 0;
      if (rows.length > 1 && columnCount > 1 && rows.every((row) => row.length === columnCount)) {
        return { text: lines.filter((line) => !line.includes("|")).join("\n").trim(), rows };
      }
    }

    const cells = source.split("|");
    const separators = [];
    cells.forEach((cell, index) => {
      if (/^\s*:?-{2,}:?\s*$/.test(cell)) separators.push(index);
    });
    if (separators.length >= 2) {
      const start = separators[0];
      let endPosition = 0;
      while (endPosition + 1 < separators.length && separators[endPosition + 1] === separators[endPosition] + 1) endPosition++;
      const end = separators[endPosition];
      const columnCount = endPosition + 1;
      const headerCells = [];
      let promptPrefix = "";
      let headerStart = start;
      for (let index = start - 1; index >= 0 && headerCells.length < columnCount; index--) {
        let cell = cells[index].trim();
        if (headerCells.length === columnCount - 1) {
          const lastLineBreak = cell.lastIndexOf("\n");
          const prefix = lastLineBreak >= 0 ? cell.slice(0, lastLineBreak).trim() : "";
          const trailingLine = lastLineBreak >= 0 ? cell.slice(lastLineBreak + 1).trim() : cell;
          if (prefix && trailingLine) {
            promptPrefix = prefix;
            cell = trailingLine;
          } else {
            const colon = cell.lastIndexOf(":");
            if (colon >= 0 && cell.slice(colon + 1).trim()) {
              promptPrefix = cell.slice(0, colon).trim();
              cell = cell.slice(colon + 1).trim();
            }
          }
        }
        if (cell) {
          headerCells.unshift(cell);
          headerStart = index;
        }
      }
      if (headerCells.length === columnCount) {
        const values = cells.slice(end + 1).map((cell) => cell.trim());
        while (values[0] === "") values.shift();
        while (values[values.length - 1] === "") values.pop();
        const rows = [headerCells];
        for (let offset = 0; offset + columnCount <= values.length; offset += columnCount) {
          rows.push(values.slice(offset, offset + columnCount));
        }
        if (rows.length > 1) {
          const promptText = [cells.slice(0, headerStart).join("|").trim(), promptPrefix].filter(Boolean).join(" ");
          return { text: promptText.replace(/[:\s]+$/, ""), rows };
        }
      }
    }

    return { text: source, rows: [] };
  }

  function formatQuestionPrompt(prompt, structuredTable) {
    const parsed = parseQuestionTable(prompt, structuredTable);
    const paragraphs = parsed.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      .map((line) => `<p>${formatText(line)}</p>`).join("");
    const table = parsed.rows.length
      ? `<div class="assessment-table-wrap"><table class="assessment-question-table"><thead><tr>${parsed.rows[0].map((cell) => `<th scope="col">${formatText(cell)}</th>`).join("")}</tr></thead><tbody>${parsed.rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${formatText(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : "";
    return { html: `${paragraphs}${table}`, ...parsed };
  }

  function renderCoordinateGeometry(visual) {
    const bounds = ["x_min", "x_max", "y_min", "y_max"].map((key) => Number(visual[key]));
    const shapes = Array.isArray(visual.shapes) ? visual.shapes : [];
    if (bounds.some((value) => !Number.isFinite(value)) || bounds[0] >= bounds[1] || bounds[2] >= bounds[3]
      || !shapes.length || shapes.length > 8) return null;
    const [xMin, xMax, yMin, yMax] = bounds;
    const width = 760, height = 420;
    const plot = { left: 68, right: 24, top: 40, bottom: 346 };
    const scale = Math.min((width - plot.left - plot.right) / (xMax - xMin), (plot.bottom - plot.top) / (yMax - yMin));
    const plotWidth = (xMax - xMin) * scale, plotHeight = (yMax - yMin) * scale;
    const offsetX = plot.left + ((width - plot.left - plot.right) - plotWidth) / 2;
    const offsetY = plot.top + ((plot.bottom - plot.top) - plotHeight) / 2;
    const px = (value) => offsetX + (value - xMin) * scale;
    const py = (value) => offsetY + (yMax - value) * scale;
    const n = (value) => Number(value.toFixed(2));
    const colors = ["#247456", "#d0a64a", "#277da1", "#c85845", "#7256a8", "#4d7c78", "#bf6b40", "#5572a8"];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", String(visual.title || "Geometry diagram"));
    svg.classList.add("assessment-geometry");
    const add = (name, attributes, text) => {
      const element = document.createElementNS(svg.namespaceURI, name);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
      if (text !== undefined) element.textContent = String(text);
      svg.append(element);
      return element;
    };
    add("text", { x: width / 2, y: 22, "text-anchor": "middle", class: "graph-title" }, visual.title || "Geometry diagram");
    for (let tick = 0; tick <= 4; tick++) {
      const x = offsetX + plotWidth * tick / 4, y = offsetY + plotHeight * tick / 4;
      add("line", { x1: n(x), y1: n(offsetY), x2: n(x), y2: n(offsetY + plotHeight), class: "graph-grid" });
      add("line", { x1: n(offsetX), y1: n(y), x2: n(offsetX + plotWidth), y2: n(y), class: "graph-grid" });
      add("text", { x: n(x), y: n(offsetY + plotHeight + 16), "text-anchor": "middle", class: "graph-tick" }, n(xMin + (xMax - xMin) * tick / 4));
      add("text", { x: n(offsetX - 8), y: n(y + 4), "text-anchor": "end", class: "graph-tick" }, n(yMax - (yMax - yMin) * tick / 4));
    }
    const axisX = xMin <= 0 && xMax >= 0 ? px(0) : offsetX;
    const axisY = yMin <= 0 && yMax >= 0 ? py(0) : offsetY + plotHeight;
    add("line", { x1: n(axisX), y1: n(offsetY), x2: n(axisX), y2: n(offsetY + plotHeight), class: "graph-axis" });
    add("line", { x1: n(offsetX), y1: n(axisY), x2: n(offsetX + plotWidth), y2: n(axisY), class: "graph-axis" });
    const clipId = `assessment-geometry-${Math.random().toString(36).slice(2)}`;
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    const clip = document.createElementNS(svg.namespaceURI, "clipPath");
    clip.id = clipId;
    const clipRect = document.createElementNS(svg.namespaceURI, "rect");
    Object.entries({ x: n(offsetX), y: n(offsetY), width: n(plotWidth), height: n(plotHeight) })
      .forEach(([key, value]) => clipRect.setAttribute(key, String(value)));
    clip.append(clipRect);
    defs.append(clip);
    svg.append(defs);
    const drawing = document.createElementNS(svg.namespaceURI, "g");
    drawing.setAttribute("clip-path", `url(#${clipId})`);
    const draw = (tag, attributes) => {
      const element = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
      drawing.append(element);
    };
    shapes.forEach((shape, index) => {
      if (!shape || typeof shape !== "object") return;
      const color = colors[index % colors.length];
      if (shape.shape === "circle" || shape.shape === "ellipse") {
        const center = Array.isArray(shape.center) ? shape.center.map(Number) : [];
        const radii = shape.shape === "circle" ? [Number(shape.radius), Number(shape.radius)]
          : Array.isArray(shape.radii) ? shape.radii.map(Number) : [];
        if (center.length !== 2 || radii.length !== 2 || ![...center, ...radii].every(Number.isFinite)) return;
        draw("ellipse", {
          cx: n(px(center[0])), cy: n(py(center[1])), rx: n(radii[0] * scale), ry: n(radii[1] * scale),
          fill: color, "fill-opacity": ".14", stroke: color, "stroke-width": "2.5"
        });
      } else if (shape.shape === "parabola") {
        const coefficients = Array.isArray(shape.coefficients) ? shape.coefficients.map(Number) : [];
        const from = Number(shape.x_min), to = Number(shape.x_max);
        if (coefficients.length !== 3 || !coefficients.every(Number.isFinite) || !Number.isFinite(from)
          || !Number.isFinite(to) || from >= to) return;
        const [a, b, c] = coefficients, segments = 12;
        const yAt = (x) => a * x * x + b * x + c;
        let path = `M ${n(px(from))} ${n(py(yAt(from)))}`;
        for (let step = 0; step < segments; step++) {
          const x0 = from + (to - from) * step / segments, x1 = from + (to - from) * (step + 1) / segments;
          const y0 = yAt(x0), y1 = yAt(x1), dx = (x1 - x0) * scale / 3;
          const control1 = { x: px(x0) + dx, y: py(y0) - (2 * a * x0 + b) * (x1 - x0) * scale / 3 };
          const control2 = { x: px(x1) - dx, y: py(y1) + (2 * a * x1 + b) * (x1 - x0) * scale / 3 };
          path += ` C ${n(control1.x)} ${n(control1.y)} ${n(control2.x)} ${n(control2.y)} ${n(px(x1))} ${n(py(y1))}`;
        }
        draw("path", { d: path, fill: "none", stroke: color, "stroke-width": "3", "stroke-linecap": "round" });
      } else if (shape.shape === "rectangle") {
        const left = Number(shape.x_min), right = Number(shape.x_max), top = Number(shape.y_max), bottom = Number(shape.y_min);
        if (![left, right, top, bottom].every(Number.isFinite) || left >= right || bottom >= top) return;
        draw("rect", {
          x: n(px(left)), y: n(py(top)), width: n((right - left) * scale), height: n((top - bottom) * scale),
          fill: color, "fill-opacity": ".14", stroke: color, "stroke-width": "2.5"
        });
      } else if (shape.shape === "line" || shape.shape === "triangle") {
        const points = Array.isArray(shape.points) ? shape.points : [];
        const count = shape.shape === "line" ? 2 : 3;
        if (points.length !== count || points.some((point) => !Array.isArray(point) || point.length !== 2
          || point.some((value) => !Number.isFinite(Number(value))))) return;
        const pointString = points.map(([x, y]) => `${n(px(Number(x)))},${n(py(Number(y)))}`).join(" ");
        draw(shape.shape === "line" ? "polyline" : "polygon", {
          points: pointString, fill: shape.shape === "line" ? "none" : color,
          "fill-opacity": ".14", stroke: color, "stroke-width": "2.5"
        });
      }
    });
    svg.append(drawing);
    if (visual.x_label) add("text", { x: n(offsetX + plotWidth / 2), y: 382, "text-anchor": "middle", class: "graph-label" }, visual.x_label);
    if (visual.y_label) add("text", {
      x: 14, y: n(offsetY + plotHeight / 2), "text-anchor": "middle", class: "graph-label",
      transform: `rotate(-90 14 ${n(offsetY + plotHeight / 2)})`
    }, visual.y_label);
    const figure = document.createElement("figure");
    figure.className = "assessment-vector-figure";
    figure.append(svg);
    const labeled = shapes.map((shape, index) => ({ shape, index }))
      .filter(({ shape }) => typeof shape?.label === "string" && shape.label.trim());
    if (labeled.length) {
      const legend = document.createElement("figcaption");
      legend.className = "assessment-vector-legend";
      labeled.forEach(({ shape, index }) => {
        const item = document.createElement("span");
        const marker = document.createElement("i");
        marker.style.setProperty("--shape-color", colors[index % colors.length]);
        item.append(marker, document.createTextNode(shape.label));
        legend.append(item);
      });
      figure.append(legend);
    }
    return figure;
  }

  function renderVisual(visual) {
    if (!visual || !["graph", "bar_chart", "geometry"].includes(visual.type)) return null;
    if (visual.type === "geometry") {
      if (["x_min", "x_max", "y_min", "y_max"].some((key) => key in visual)) {
        return renderCoordinateGeometry(visual);
      }
      if (!Array.isArray(visual.shapes) || !visual.shapes.length || visual.shapes.length > 4) return null;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 520 250");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", String(visual.title || "Geometry diagram"));
      svg.classList.add("assessment-geometry");
      const add = (name, attributes, text) => {
        const element = document.createElementNS(svg.namespaceURI, name);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) element.textContent = String(text);
        svg.append(element);
        return element;
      };
      add("text", { x: 260, y: 25, "text-anchor": "middle", class: "graph-title" }, visual.title || "Geometry diagram");
      visual.shapes.forEach((item, index) => {
        const offsetX = 35 + index * 125;
        const shape = item.shape;
        if (shape === "triangle") {
          add("polygon", { points: `${offsetX + 20},190 ${offsetX + 55},65 ${offsetX + 95},190`, class: "geometry-shape" });
          [[offsetX + 20, 205, 0], [offsetX + 55, 54, 1], [offsetX + 95, 205, 2]].forEach(([x, y, labelIndex]) => {
            add("text", { x, y, "text-anchor": "middle", class: "geometry-label" }, item.labels?.[labelIndex] || "");
          });
        } else if (shape === "rectangle") {
          add("rect", { x: offsetX + 15, y: 90, width: 85, height: 80, rx: 2, class: "geometry-shape" });
          [0, 1, 2, 3].forEach((labelIndex) => add("text", {
            x: labelIndex === 0 || labelIndex === 3 ? offsetX + 8 : offsetX + 108,
            y: labelIndex < 2 ? 85 : 185,
            "text-anchor": labelIndex === 0 || labelIndex === 3 ? "end" : "start",
            class: "geometry-label"
          }, item.labels?.[labelIndex] || ""));
        } else if (shape === "circle") {
          add("circle", { cx: offsetX + 58, cy: 130, r: 42, class: "geometry-shape" });
          add("text", { x: offsetX + 58, y: 190, "text-anchor": "middle", class: "geometry-label" }, item.labels?.[0] || "");
        } else if (shape === "line") {
          add("line", { x1: offsetX + 15, y1: 145, x2: offsetX + 100, y2: 95, class: "geometry-shape" });
          add("text", { x: offsetX + 10, y: 163, class: "geometry-label" }, item.labels?.[0] || "");
          add("text", { x: offsetX + 105, y: 90, class: "geometry-label" }, item.labels?.[1] || "");
        }
      });
      return svg;
    }
    if (visual.type === "bar_chart") {
      if (!Array.isArray(visual.labels) || !Array.isArray(visual.values)
        || !visual.labels.length || visual.labels.length > 12
        || visual.labels.length !== visual.values.length) return null;
      const values = visual.values.map(Number);
      if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
      const width = 560;
      const height = 320;
      const left = 58;
      const right = 24;
      const top = 32;
      const bottom = 58;
      const max = Math.max(...values, 1);
      const plotHeight = height - top - bottom;
      const slot = (width - left - right) / visual.labels.length;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", String(visual.title || "Bar chart"));
      svg.classList.add("assessment-chart");
      const add = (name, attributes, text) => {
        const element = document.createElementNS(svg.namespaceURI, name);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) element.textContent = String(text);
        svg.append(element);
      };
      add("text", { x: width / 2, y: 20, "text-anchor": "middle", class: "graph-title" }, visual.title || "Chart");
      add("line", { x1: left, y1: top + plotHeight, x2: width - right, y2: top + plotHeight, class: "graph-axis" });
      visual.labels.forEach((label, index) => {
        const barHeight = values[index] / max * plotHeight;
        const barWidth = Math.min(46, slot * 0.62);
        const barX = left + index * slot + (slot - barWidth) / 2;
        add("rect", { x: barX, y: top + plotHeight - barHeight, width: barWidth, height: barHeight, rx: 3, class: "chart-bar" });
        add("text", { x: barX + barWidth / 2, y: top + plotHeight - barHeight - 6, "text-anchor": "middle", class: "graph-tick" }, values[index]);
        add("text", { x: barX + barWidth / 2, y: height - 25, "text-anchor": "middle", class: "graph-tick" }, label);
      });
      return svg;
    }
    const values = ["x_min", "x_max", "y_min", "y_max"].map((key) => Number(visual[key]));
    const [xMin, xMax, yMin, yMax] = values;
    if (!values.every(Number.isFinite) || xMin >= xMax || yMin >= yMax
      || !Array.isArray(visual.points) || !visual.points.length) return null;
    const width = 560;
    const height = 320;
    const padding = { left: 58, right: 24, top: 30, bottom: 48 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const x = (value) => padding.left + (value - xMin) / (xMax - xMin) * plotWidth;
    const y = (value) => padding.top + (yMax - value) / (yMax - yMin) * plotHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", String(visual.title || "Coordinate graph"));
    svg.classList.add("assessment-graph");
    const add = (name, attributes, text) => {
      const element = document.createElementNS(svg.namespaceURI, name);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
      if (text !== undefined) element.textContent = String(text);
      svg.append(element);
      return element;
    };
    add("text", { x: width / 2, y: 20, "text-anchor": "middle", class: "graph-title" }, visual.title || "Graph");
    for (let index = 0; index <= 5; index++) {
      const tickX = x(xMin + (xMax - xMin) * index / 5);
      const tickY = y(yMin + (yMax - yMin) * index / 5);
      add("line", { x1: tickX, y1: padding.top, x2: tickX, y2: height - padding.bottom, class: "graph-grid" });
      add("line", { x1: padding.left, y1: tickY, x2: width - padding.right, y2: tickY, class: "graph-grid" });
      add("text", { x: tickX, y: height - padding.bottom + 17, "text-anchor": "middle", class: "graph-tick" }, Number((xMin + (xMax - xMin) * index / 5).toFixed(2)));
      add("text", { x: padding.left - 8, y: tickY + 3, "text-anchor": "end", class: "graph-tick" }, Number((yMin + (yMax - yMin) * index / 5).toFixed(2)));
    }
    const axisX = xMin <= 0 && xMax >= 0 ? x(0) : padding.left;
    const axisY = yMin <= 0 && yMax >= 0 ? y(0) : height - padding.bottom;
    add("line", { x1: axisX, y1: padding.top, x2: axisX, y2: height - padding.bottom, class: "graph-axis" });
    add("line", { x1: padding.left, y1: axisY, x2: width - padding.right, y2: axisY, class: "graph-axis" });
    const points = visual.points.map((point) => [Number(point[0]), Number(point[1])]);
    if (points.some((point) => !point.every(Number.isFinite)
      || point[0] < xMin || point[0] > xMax || point[1] < yMin || point[1] > yMax)) return null;
    if (points.length > 1) {
      add("polyline", {
        points: points.map(([px, py]) => `${x(px)},${y(py)}`).join(" "),
        class: "graph-series"
      });
    }
    points.forEach(([px, py]) => add("circle", { cx: x(px), cy: y(py), r: 4, class: "graph-point" }));
    add("text", { x: width / 2, y: height - 7, "text-anchor": "middle", class: "graph-label" }, visual.x_label || "x");
    const yLabel = add("text", { x: 15, y: height / 2, "text-anchor": "middle", class: "graph-label", transform: `rotate(-90 15 ${height / 2})` }, visual.y_label || "y");
    yLabel.setAttribute("aria-hidden", "true");
    return svg;
  }

  window.akademiAssessmentRendering = { formatText, formatQuestionPrompt, parseQuestionTable, renderVisual };
})();
