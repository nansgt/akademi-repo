(() => {
  "use strict";

  const base = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const host = document.createElement("div");
  host.id = "akademi-ai-assistant";
  host.innerHTML = `
    <button class="ai-assistant-launch" type="button" aria-expanded="false" aria-controls="ai-assistant-panel">
      <svg class="icon" aria-hidden="true"><use href="${base}/assets/icons.svg#fa-lightbulb"></use></svg> Ask Akademi
    </button>
    <section class="ai-assistant-panel" id="ai-assistant-panel" aria-label="Akademi teaching assistant" hidden>
      <header class="ai-assistant-header">
        <div><strong>Ask Akademi</strong><small>Ghana SHS teaching assistant</small></div>
        <button type="button" class="ai-assistant-close" aria-label="Close teaching assistant">&times;</button>
      </header>
      <div class="ai-assistant-disclaimer">Curriculum answers use reviewed resources when available. Check important details against the source.</div>
      <div class="ai-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <form class="ai-assistant-form">
        <label class="sr-only" for="ai-assistant-question">Ask a teaching question</label>
        <textarea id="ai-assistant-question" rows="2" maxlength="3000" placeholder="Ask about planning, teaching, or this page…" required></textarea>
        <button type="submit">Ask</button>
      </form>
      <p class="ai-assistant-status" role="status" aria-live="polite">Each reply uses 1 AI credit for teachers.</p>
    </section>`;
  document.body.append(host);

  const launch = host.querySelector(".ai-assistant-launch");
  const panel = host.querySelector(".ai-assistant-panel");
  const close = host.querySelector(".ai-assistant-close");
  const messagesElement = host.querySelector(".ai-assistant-messages");
  const form = host.querySelector(".ai-assistant-form");
  const questionInput = host.querySelector("#ai-assistant-question");
  const status = host.querySelector(".ai-assistant-status");
  const messages = [];

  function toggle(open) {
    panel.hidden = !open;
    launch.setAttribute("aria-expanded", String(open));
    if (open) questionInput.focus();
    else launch.focus();
  }

  function currentContext() {
    const activePage = document.querySelector(".page.active");
    const pageName = activePage?.querySelector("h1")?.textContent
      || document.querySelector(".breadcrumb strong")?.textContent
      || document.title;
    const yearInput = activePage?.querySelector('[name="year"], [name="year_group"]');
    const match = String(yearInput?.value || "").match(/([123])$/);
    return {
      page_context: String(pageName || "Akademi workspace").trim().slice(0, 200),
      year_group: match ? `SHS${match[1]}` : ""
    };
  }

  function appendMessage(role, text, sources = []) {
    const bubble = document.createElement("article");
    bubble.className = `ai-assistant-message is-${role}`;
    const label = document.createElement("strong");
    label.textContent = role === "user" ? "You" : "Akademi";
    const content = document.createElement("div");
    content.className = "ai-assistant-markdown";
    content.innerHTML = markdownToHtml(text);
    bubble.append(label, content);
    if (sources.length) {
      const sourceList = document.createElement("small");
      sourceList.className = "ai-assistant-sources";
      sourceList.textContent = `Reviewed sources: ${sources.map((source) =>
        `${source.title}${source.page ? ` · page ${source.page}` : ""}`
      ).join("; ")}`;
      bubble.append(sourceList);
    }
    messagesElement.append(bubble);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function safeHttpUrl(value, image = false) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || (!image && url.protocol === "http:") ? url.href : "";
    } catch {
      return "";
    }
  }

  function inlineMarkdown(value) {
    const token = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]*)")?\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]*)")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g;
    let result = "";
    let lastIndex = 0;
    for (const match of value.matchAll(token)) {
      result += escapeHtml(value.slice(lastIndex, match.index));
      if (match[1] !== undefined) {
        const source = safeHttpUrl(match[2], true);
        result += source
          ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(match[1])}" loading="lazy" referrerpolicy="no-referrer">`
          : escapeHtml(match[0]);
      } else if (match[4] !== undefined) {
        const href = safeHttpUrl(match[5]);
        result += href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[4])}</a>`
          : escapeHtml(match[0]);
      } else if (match[7] !== undefined) {
        result += `<code>${escapeHtml(match[7])}</code>`;
      } else if (match[8] !== undefined || match[9] !== undefined) {
        result += `<strong>${escapeHtml(match[8] ?? match[9])}</strong>`;
      } else if (match[10] !== undefined) {
        result += `<del>${escapeHtml(match[10])}</del>`;
      } else {
        result += `<em>${escapeHtml(match[11] ?? match[12])}</em>`;
      }
      lastIndex = match.index + match[0].length;
    }
    return result + escapeHtml(value.slice(lastIndex));
  }

  function markdownToHtml(value) {
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    let listType = "";
    let listItems = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (listItems.length) blocks.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`);
      listItems = [];
      listType = "";
    };
    const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        flushParagraph();
        flushList();
        const code = [];
        index++;
        while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }
      const tableHeader = trimmed.includes("|") && index + 1 < lines.length
        && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
      if (tableHeader) {
        flushParagraph();
        flushList();
        const headers = cells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].trim().includes("|")) rows.push(cells(lines[index++]));
        index--;
        blocks.push(`<div class="ai-assistant-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(4, heading[1].length);
        blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (/^(?:---+|___+|\*\*\*+)$/.test(trimmed)) {
        flushParagraph();
        flushList();
        blocks.push("<hr>");
        continue;
      }
      const listMatch = trimmed.match(/^(?:[-+*]\s+|\d+[.)]\s+)(.+)$/);
      if (listMatch) {
        flushParagraph();
        const type = /^\d/.test(trimmed) ? "ol" : "ul";
        if (listType && listType !== type) flushList();
        listType = type;
        listItems.push(listMatch[1]);
        continue;
      }
      if (trimmed.startsWith(">")) {
        flushParagraph();
        flushList();
        const quote = [];
        while (index < lines.length && lines[index].trim().startsWith(">")) quote.push(lines[index++].trim().replace(/^>\s?/, ""));
        index--;
        blocks.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
        continue;
      }
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }
      flushList();
      paragraph.push(trimmed);
    }
    flushParagraph();
    flushList();
    return blocks.join("");
  }

  launch.addEventListener("click", () => toggle(panel.hidden));
  close.addEventListener("click", () => toggle(false));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = questionInput.value.trim();
    if (!question) return;
    messages.push({ role: "user", content: question });
    appendMessage("user", question);
    questionInput.value = "";
    questionInput.disabled = true;
    const sendButton = form.querySelector("button");
    sendButton.disabled = true;
    status.textContent = "Akademi is preparing a reply…";
    try {
      const response = await fetch(`${base}/api/ai/assist`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrf
        },
        body: JSON.stringify({ ...currentContext(), messages: messages.slice(-8) })
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`The teaching assistant returned an unreadable response (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        const reference = result.request_id ? ` Reference: ${result.request_id}.` : "";
        throw new Error(`${result.error || "Akademi could not answer this question."}${reference}`);
      }
      messages.push({ role: "assistant", content: result.reply });
      appendMessage("assistant", result.reply, result.sources || []);
      if (result.credits && document.getElementById("credit-balance")) {
        document.getElementById("credit-balance").textContent = `${result.credits.remaining} remaining`;
        document.getElementById("credit-reset").textContent = `Resets ${result.credits.next_reset_utc.slice(0, 10)}`;
      }
      status.textContent = result.sources?.length
        ? "Reply grounded in reviewed curriculum excerpts where relevant."
        : "No matching reviewed curriculum excerpts were found; verify curriculum-specific details.";
    } catch (error) {
      messages.pop();
      showError(error instanceof Error ? error.message : "Akademi could not answer this question.");
      status.textContent = "Try again, or check the AI provider and your available credits.";
    } finally {
      questionInput.disabled = false;
      sendButton.disabled = false;
      questionInput.focus();
    }
  });

  function showError(message) {
    appendMessage("assistant", message);
  }
  appendMessage("assistant", "Ask me for help with a lesson, assessment, scheme, classroom activity, or the page you are working on.");
})();
