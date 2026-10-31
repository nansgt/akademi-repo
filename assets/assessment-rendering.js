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

  function renderVisual(visual) {
    if (!visual || !["graph", "bar_chart", "geometry"].includes(visual.type)) return null;
    if (visual.type === "geometry") {
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
