(() => {
  "use strict";

  let stack;

  function getStack() {
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "akademi-alert-stack";
      stack.setAttribute("popover", "manual");
      stack.setAttribute("aria-live", "polite");
      stack.setAttribute("aria-relevant", "additions");
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showStack() {
    if (!stack || typeof stack.showPopover !== "function") return;
    try {
      if (!stack.matches(":popover-open")) stack.showPopover();
    } catch {
      // Keep ordinary fixed positioning as a fallback on older browsers.
    }
  }

  function removeToast(item) {
    if (!item?.isConnected) return;
    item.remove();
    if (stack?.childElementCount === 0 && typeof stack.hidePopover === "function") {
      try {
        if (stack.matches(":popover-open")) stack.hidePopover();
      } catch {
        // Ignore a popover that the browser has already closed.
      }
    }
    if (stack?.childElementCount === 0) {
      const emptyStack = stack;
      stack = null;
      emptyStack.remove();
    }
  }

  function toast(message, type = "success") {
    const kind = ["success", "error", "info"].includes(type) ? type : "info";
    const titles = { success: "Success", error: "Something went wrong", info: "Notice" };
    const icons = { success: "clipboard-check", error: "circle-info", info: "circle-info" };
    const item = document.createElement("section");
    item.className = "akademi-alert-toast";
    item.dataset.type = kind;
    item.setAttribute("role", kind === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "akademi-alert-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg class="icon"><use href="${document.querySelector('meta[name="app-base-path"]')?.content || ""}/assets/icons.svg#fa-${icons[kind]}"></use></svg>`;
    const copy = document.createElement("div");
    copy.className = "akademi-alert-copy";
    const title = document.createElement("strong");
    title.textContent = titles[kind];
    const body = document.createElement("p");
    body.textContent = String(message);
    copy.append(title, body);
    const close = document.createElement("button");
    close.className = "akademi-alert-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${document.querySelector('meta[name="app-base-path"]')?.content || ""}/assets/icons.svg#fa-xmark"></use></svg>`;
    close.addEventListener("click", () => removeToast(item));
    item.append(icon, copy, close);
    getStack().appendChild(item);
    showStack();
    window.setTimeout(() => removeToast(item), kind === "error" ? 8000 : 5000);
  }

  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("dialog");
      backdrop.className = "akademi-alert-confirm";
      const dialog = document.createElement("section");
      dialog.className = "akademi-alert-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-labelledby", "akademi-alert-title");
      dialog.setAttribute("aria-describedby", "akademi-alert-message");

      const icon = document.createElement("span");
      icon.className = "akademi-alert-dialog-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = `<svg class="icon"><use href="${document.querySelector('meta[name="app-base-path"]')?.content || ""}/assets/icons.svg#fa-circle-info"></use></svg>`;
      const title = document.createElement("h2");
      title.id = "akademi-alert-title";
      title.textContent = options.title || "Are you sure?";
      const body = document.createElement("p");
      body.id = "akademi-alert-message";
      body.textContent = String(message);
      const actions = document.createElement("div");
      actions.className = "akademi-alert-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = options.cancelText || "Cancel";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = options.confirmText || "Continue";

      let settled = false;
      const finish = (accepted) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeydown);
        if (backdrop.open) backdrop.close();
        backdrop.remove();
        resolve(accepted);
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
        if (event.key === "Tab") {
          event.preventDefault();
          (document.activeElement === approve ? cancel : approve).focus();
        }
      };
      cancel.addEventListener("click", () => finish(false));
      approve.addEventListener("click", () => finish(true));
      backdrop.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      actions.append(cancel, approve);
      dialog.append(icon, title, body, actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      backdrop.showModal();
      document.addEventListener("keydown", onKeydown);
      cancel.focus();
    });
  }

  window.akademiAlert = { toast, confirm };
})();
