(() => {
  "use strict";

  const root = document.getElementById("users-management");
  if (!root) return;
  const body = document.getElementById("users-table-body");
  const alertBox = document.getElementById("users-alert");
  const filterForm = document.getElementById("users-filter-form");
  const pagination = document.getElementById("users-pagination");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const canManageRoles = root.dataset.canManageRoles === "1";
  let currentPage = 1;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function show(message, success = false) {
    window.akademiAlert.toast(message, success ? "success" : "error");
  }

  function formatDate(value) {
    if (!value) return "Not verified";
    const date = new Date(`${value.replace(" ", "T")}Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  async function request(url, method = "GET", data = null) {
    const options = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (data !== null) {
      options.headers["Content-Type"] = "application/json";
      options.headers["X-CSRF-Token"] = csrf;
      options.body = JSON.stringify(data);
    }
    const response = await fetch(url, options);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`The user service returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const reference = result.request_id ? ` Reference: ${result.request_id}.` : "";
      throw new Error(`${result.error || "User management request failed."}${reference}`);
    }
    return result;
  }

  function rowHtml(user) {
    const roleLabels = user.roles.map((role) => ({
      teacher: "Teacher",
      admin: "Administrator",
      superadmin: "Super Admin"
    })[role] || role);
    const protectedAccount = user.roles.includes("superadmin");
    const adminTarget = user.roles.includes("admin");
    const canEditStatus = user.status === "active" || user.status === "suspended";
    const canEditTarget = !protectedAccount && (canManageRoles || (!adminTarget && user.roles.includes("teacher")));
    const nextStatus = user.status === "active" ? "suspended" : "active";
    const statusControl = canEditTarget && canEditStatus
      ? `<button type="button" class="auth-secondary compact-button" data-user-action="status" data-user-id="${user.id}" data-next-status="${nextStatus}">${nextStatus === "active" ? "Reactivate" : "Suspend"}</button>`
      : "";
    const roleControl = canManageRoles && !protectedAccount && user.roles.includes("teacher")
      ? `<div class="user-role-control"><label for="user-role-${user.id}">Administrator access</label><select id="user-role-${user.id}" data-user-role="${user.id}"><option value="teacher" ${adminTarget ? "" : "selected"}>Teacher</option><option value="admin" ${adminTarget ? "selected" : ""}>Teacher + Administrator</option></select><button type="button" class="auth-secondary compact-button" data-user-action="role" data-user-id="${user.id}">Save role</button></div>`
      : "";
    const passwordControl = canEditTarget
      ? `<button type="button" class="auth-secondary compact-button" data-user-action="password" data-user-id="${user.id}" data-user-name="${escapeHtml(user.display_name)}">Reset password</button>`
      : "";
    const hasActions = Boolean(statusControl || roleControl || passwordControl);
    const actions = hasActions
      ? `<div class="user-actions"><button type="button" class="auth-secondary compact-button user-actions-trigger" data-user-actions-toggle="${user.id}" aria-expanded="false" aria-controls="user-actions-${user.id}">Actions <span aria-hidden="true">▾</span></button><div class="user-actions-menu" id="user-actions-${user.id}" popover="auto" aria-label="Actions for ${escapeHtml(user.display_name)}">${statusControl}${roleControl}${passwordControl}</div></div>`
      : protectedAccount ? '<small class="protected-user-note">Protected account</small>' : '<small class="protected-user-note">No actions available</small>';
    return `<tr>
      <td data-label="User"><strong>${escapeHtml(user.display_name)}</strong><small>${escapeHtml(user.email)}</small><small>Account #${user.id}</small></td>
      <td data-label="School / region">${escapeHtml(user.school_name || "Not provided")}<small>${escapeHtml(user.region || "")}</small></td>
      <td data-label="Status"><span class="user-status user-status-${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
      <td data-label="Roles"><span class="user-role-list">${roleLabels.map(escapeHtml).join(", ") || "No assigned role"}</span></td>
      <td data-label="Joined / verified"><span>Joined ${escapeHtml(formatDate(user.created_at))}</span><small>${user.email_verified_at ? `Email verified ${escapeHtml(formatDate(user.email_verified_at))}` : "Email not verified"}</small></td>
      <td data-label="Actions">${actions}</td>
    </tr>`;
  }

  async function load(page = currentPage) {
    currentPage = page;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<tr class="users-skeleton-row" aria-hidden="true"><td><i></i><i></i></td><td><i></i></td><td><i></i></td><td><i></i></td><td><i></i><i></i></td><td><i></i></td></tr><tr class="users-skeleton-row" aria-hidden="true"><td><i></i><i></i></td><td><i></i></td><td><i></i></td><td><i></i></td><td><i></i><i></i></td><td><i></i></td></tr><tr class="users-skeleton-row" aria-hidden="true"><td><i></i><i></i></td><td><i></i></td><td><i></i></td><td><i></i></td><td><i></i><i></i></td><td><i></i></td></tr>';
    const query = new URLSearchParams(new FormData(filterForm));
    query.set("page", String(page));
    try {
      const result = await request(`${root.dataset.apiUrl}?${query.toString()}`);
      body.innerHTML = result.users.length
        ? result.users.map(rowHtml).join("")
        : '<tr><td colspan="6">No users match these filters.</td></tr>';
      body.removeAttribute("aria-busy");
      pagination.replaceChildren();
      const pages = Math.max(1, Math.ceil(result.total / result.per_page));
      if (pages > 1) {
        const previous = document.createElement("button");
        previous.type = "button";
        previous.className = "auth-secondary compact-button";
        previous.textContent = "Previous";
        previous.disabled = page <= 1;
        previous.addEventListener("click", () => load(page - 1));
        const label = document.createElement("span");
        label.textContent = `Page ${page} of ${pages} · ${result.total} users`;
        const next = document.createElement("button");
        next.type = "button";
        next.className = "auth-secondary compact-button";
        next.textContent = "Next";
        next.disabled = page >= pages;
        next.addEventListener("click", () => load(page + 1));
        pagination.append(previous, label, next);
      } else {
        const label = document.createElement("span");
        label.textContent = `${result.total} user${result.total === 1 ? "" : "s"}`;
        pagination.append(label);
      }
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6"><p class="settings-load-error">${escapeHtml(error instanceof Error ? error.message : "Could not load users.")}</p><button class="auth-secondary compact-button" type="button" data-user-action="retry">Retry</button></td></tr>`;
      body.removeAttribute("aria-busy");
    }
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    load(1);
  });
  body.addEventListener("click", async (event) => {
    const menuToggle = event.target.closest("[data-user-actions-toggle]");
    if (menuToggle) {
      const menu = document.getElementById(`user-actions-${menuToggle.dataset.userActionsToggle}`);
      if (!menu) return;
      if (menu.matches(":popover-open")) {
        menu.hidePopover();
        menuToggle.setAttribute("aria-expanded", "false");
      } else {
        const bounds = menuToggle.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(bounds.right - 190, window.innerWidth - 198))}px`;
        menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 5, window.innerHeight - 220))}px`;
        menu.showPopover();
        menuToggle.setAttribute("aria-expanded", "true");
      }
      return;
    }
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    if (button.dataset.userAction === "retry") {
      load(currentPage);
      return;
    }
    button.disabled = true;
    try {
      let payload;
      if (button.dataset.userAction === "password") {
        const confirmed = window.confirm(`Reset ${button.dataset.userName}'s password? Their current password will stop working and all active sessions will be signed out.`);
        if (!confirmed) {
          button.disabled = false;
          return;
        }
        const result = await request(`${root.dataset.apiUrl}/${button.dataset.userId}/password`, "POST", {});
        alertBox.classList.remove("hidden");
        alertBox.classList.add("user-password-reset-result");
        alertBox.innerHTML = `<strong>Password reset for ${escapeHtml(button.dataset.userName)}</strong><p>Share this temporary password with the user privately. It is shown only once here.</p><code>${escapeHtml(result.temporary_password)}</code><div><button type="button" class="auth-secondary compact-button" data-copy-reset-password>Copy temporary password</button><button type="button" class="auth-secondary compact-button" data-dismiss-reset-password>Dismiss</button></div>`;
        alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
        button.closest("[popover]")?.hidePopover();
        button.disabled = false;
        show("The user's password was reset and active sessions were revoked.", true);
        return;
      } else if (button.dataset.userAction === "status") {
        const status = button.dataset.nextStatus;
        const confirmed = window.confirm(status === "suspended"
          ? "Suspend this account? The user will be signed out and will not be able to access Akademi."
          : "Reactivate this account? The user will need to sign in again.");
        if (!confirmed) {
          button.disabled = false;
          return;
        }
        payload = { status };
      } else {
        const roleSelect = body.querySelector(`[data-user-role="${button.dataset.userId}"]`);
        payload = { roles: roleSelect.value === "admin" ? ["teacher", "admin"] : ["teacher"] };
      }
      await request(`${root.dataset.apiUrl}/${button.dataset.userId}`, "PUT", payload);
      show("User account updated.", true);
      await load(currentPage);
    } catch (error) {
      show(error instanceof Error ? error.message : "The user account could not be updated.");
      button.disabled = false;
    }
  });
  body.addEventListener("toggle", (event) => {
    const menu = event.target.closest?.(".user-actions-menu");
    if (!menu) return;
    const trigger = body.querySelector(`[data-user-actions-toggle="${menu.id.replace("user-actions-", "")}"]`);
    trigger?.setAttribute("aria-expanded", String(menu.matches(":popover-open")));
  }, true);
  document.addEventListener("click", (event) => {
    body.querySelectorAll(".user-actions-menu:popover-open").forEach((menu) => {
      if (menu.contains(event.target) || event.target.closest?.(`[data-user-actions-toggle="${menu.id.replace("user-actions-", "")}"]`)) return;
      menu.hidePopover();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    body.querySelectorAll(".user-actions-menu:popover-open").forEach((menu) => menu.hidePopover());
  });
  alertBox.addEventListener("click", async (event) => {
    if (event.target.closest("[data-dismiss-reset-password]")) {
      alertBox.classList.add("hidden");
      alertBox.replaceChildren();
      return;
    }
    if (!event.target.closest("[data-copy-reset-password]")) return;
    const password = alertBox.querySelector("code")?.textContent || "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
      } else {
        const field = document.createElement("textarea");
        field.value = password;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Clipboard access is unavailable.");
      }
      show("Temporary password copied. Share it with the user privately.", true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not copy the temporary password.");
    }
  });
  load();
})();
