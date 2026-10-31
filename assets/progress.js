(() => {
  "use strict";

  const host = document.createElement("dialog");
  host.className = "request-progress";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-label", "Request progress");
  host.innerHTML = '<span class="request-progress-spinner" aria-hidden="true"></span><span class="request-progress-copy"></span><span class="request-progress-stage"></span><span class="request-progress-percent"></span><span class="request-progress-track"><span></span></span><span class="request-progress-steps" aria-hidden="true"><span>Prepare</span><span>Send</span><span>Process</span><span>Finish</span></span>';
  document.body.append(host);

  const copy = host.querySelector(".request-progress-copy");
  const stageCopy = host.querySelector(".request-progress-stage");
  const percent = host.querySelector(".request-progress-percent");
  const fill = host.querySelector(".request-progress-track span");
  const steps = Array.from(host.querySelectorAll(".request-progress-steps span"));
  const active = new Map();
  let nextId = 0;
  let hideTimer;
  let animationTimer;
  let hostIsModal = false;

  function isPresentationActive() {
    return document.body.classList.contains("presentation-follow-page")
      || Boolean(document.querySelector(".presentation-viewer-dialog[open]"));
  }

  function isPresentationRequest(url) {
    return /\/api\/(?:teacher\/)?presentation-simulations(?:\/|[?#]|$)/i.test(url);
  }

  function muteProgress() {
    active.clear();
    clearTimeout(hideTimer);
    clearInterval(animationTimer);
    animationTimer = undefined;
    if (host.open) host.close();
    hostIsModal = false;
  }

  function openProgress(promote = false) {
    const anotherModalIsOpen = Array.from(document.querySelectorAll("dialog[open]"))
      .some((dialog) => dialog !== host);
    if (anotherModalIsOpen) {
      if (!host.open || !hostIsModal || promote) {
        if (host.open) host.close();
        hostIsModal = true;
        nativeShowModal.call(host);
      }
      return;
    }
    if (hostIsModal) {
      host.close();
      hostIsModal = false;
    }
    if (!host.open) {
      host.show();
    }
  }

  function render(promote = false) {
    clearTimeout(hideTimer);
    if (isPresentationActive()) {
      muteProgress();
      return;
    }
    if (active.size === 0) {
      clearInterval(animationTimer);
      animationTimer = undefined;
      hideTimer = setTimeout(() => {
        if (active.size === 0 && host.open) host.close();
      }, 350);
      return;
    }
    openProgress(promote);
    const request = Array.from(active.values()).pop();
    const [message, explicitProgress, startedAt, xhrStage] = request;
    const elapsed = Date.now() - startedAt;
    const stage = xhrStage ?? (elapsed < 700 ? 0 : elapsed < 2200 ? 1 : 2);
    const animatedProgress = Math.min(94, 8 + 86 * (1 - Math.exp(-elapsed / 10000)));
    const progress = Number.isFinite(explicitProgress)
      ? (xhrStage === 3 ? 100 : xhrStage === 2 ? 88 : 8 + (Math.max(0, Math.min(explicitProgress, 100)) * 0.8))
      : animatedProgress;
    copy.textContent = message;
    stageCopy.textContent = ["Preparing", "Sending", "Processing", "Finishing"][stage];
    percent.textContent = `${Math.round(progress)}%`;
    fill.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
    steps.forEach((step, index) => {
      step.classList.toggle("is-complete", index < stage);
      step.classList.toggle("is-current", index === stage);
    });
    if (!animationTimer) {
      animationTimer = setInterval(() => render(), 180);
    }
  }

  function start(message) {
    if (isPresentationActive()) {
      muteProgress();
      return 0;
    }
    const id = ++nextId;
    active.set(id, [message, null, Date.now(), null]);
    render(true);
    return id;
  }

  function update(id, message, progress = null) {
    if (!active.has(id)) return;
    const current = active.get(id);
    active.set(id, [message, progress, current[2], Number.isFinite(progress) && progress >= 100 ? 3 : 1]);
    render();
  }

  function finish(id, message = "") {
    if (!active.delete(id)) return;
    const completedId = ++nextId;
    active.set(completedId, [message || "Request complete.", 100, Date.now(), 3]);
    render();
    setTimeout(() => {
      active.delete(completedId);
      render();
    }, 650);
  }

  function messageFor(url, method) {
    if (/\/upload(?:\?|$)/i.test(url)) return "Uploading resources…";
    if (/\/api\/workspace\/profile\/logo(?:\?|$)/i.test(url)) return "Uploading school logo…";
    if (/\/api\/workspace\/profile(?:\?|$)/i.test(url)) return "Saving workspace profile…";
    if (/\/api\/workspace\/documents(?:\?|$)/i.test(url)) return "Saving teaching draft…";
    if (/\/structure(?:\?|$)/i.test(url)) return "Analyzing resource for curriculum links…";
    if (/\/ai\/generate(?:\?|$)/i.test(url)) return "Preparing your AI draft…";
    if (/\/api\/admin\/ai\/test(?:\?|$)/i.test(url)) return "Testing AI provider connection…";
    if (/\/api\/admin\/mail\/test(?:\?|$)/i.test(url)) return "Sending test email…";
    if (/\/api\/auth\/(?:login|password-login|register|resend|verify)(?:\?|$)/i.test(url)) return "Processing your sign-in…";
    if (/\/api\/account\/password(?:\?|$)/i.test(url)) return "Updating your password…";
    if (/\/review(?:\?|$)/i.test(url)) return "Saving review decision…";
    if (/\/logout(?:\?|$)/i.test(url)) return "Signing out…";
    if (method === "DELETE") return "Removing item…";
    return "Saving your changes…";
  }

  window.akademiProgress = { start, update, finish };

  const nativeShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) {
    const result = nativeShowModal.apply(this, args);
    if (active.size > 0) render(true);
    return result;
  };
  host.addEventListener("cancel", (event) => event.preventDefault());

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const options = init || {};
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return originalFetch(input, init);
    const url = typeof input === "string" ? input : input.url;
    if (isPresentationActive() || isPresentationRequest(url)) {
      muteProgress();
      return originalFetch(input, init);
    }
    const id = start(messageFor(url, method));
    return originalFetch(input, init).finally(() => finish(id));
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const method = String(this.__akademiMethod || "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH"].includes(method)) return originalSend.call(this, body);
    const url = this.__akademiUrl || "";
    if (isPresentationActive() || isPresentationRequest(url)) {
      muteProgress();
      return originalSend.call(this, body);
    }
    const id = start(messageFor(url, method));
    if (this.upload && body instanceof FormData) {
      this.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          const current = active.get(id);
          if (!current) return;
          active.set(id, [
            progress >= 100 ? "Upload received. Processing resources…" : "Uploading resources…",
            progress,
            current[2],
            progress >= 100 ? 2 : 1
          ]);
          render();
        }
      });
    }
    this.addEventListener("loadend", () => finish(id), { once: true });
    try {
      return originalSend.call(this, body);
    } catch (error) {
      finish(id);
      throw error;
    }
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this.__akademiMethod = method;
    this.__akademiUrl = String(url);
    return originalOpen.call(this, method, url, ...args);
  };
})();
