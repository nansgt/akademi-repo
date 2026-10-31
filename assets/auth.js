(() => {
  "use strict";

  let csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const csrfEndpoint = document.querySelector('meta[name="csrf-endpoint"]')?.content || "";
  const alertBox = document.getElementById("auth-alert");
  const forms = ["login-form", "password-login-form", "register-form", "verify-form", "resend-form", "logout-form"]
    .map((id) => document.getElementById(id)).filter(Boolean);

  function showMessage(message, success = false) {
    if (!alertBox) return;
    alertBox.classList.add("hidden");
    window.akademiAlert.toast(message, success ? "success" : "error");
  }
  if (alertBox && !alertBox.classList.contains("hidden")) {
    window.akademiAlert.toast(alertBox.textContent, "error");
    alertBox.classList.add("hidden");
  }

  async function post(form, payload) {
    const request = () => fetch(form.dataset.endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload)
    });
    let response = await request();
    if (response.status === 419) {
      if (!csrfEndpoint) {
        throw new Error("Your session security token expired. Refresh the page and try again.");
      }
      const tokenResponse = await fetch(csrfEndpoint, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      let tokenResult;
      try {
        tokenResult = await tokenResponse.json();
      } catch {
        throw new Error("The server returned an unreadable response. Refresh and try again.");
      }
      if (!tokenResponse.ok) {
        throw new Error(tokenResult.error || "A fresh security token could not be obtained.");
      }
      if (typeof tokenResult.csrf_token !== "string" || tokenResult.csrf_token === "") {
        throw new Error("The server did not return a valid security token. Refresh and try again.");
      }
      csrf = tokenResult.csrf_token;
      response = await request();
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response. Refresh and try again.");
    }
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
  }

  forms.forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]') || form.querySelector("button");
    if (button) button.disabled = true;
    try {
      if (form.id === "resend-form") {
        const result = await post(form, {});
        showMessage(result.message, true);
        return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await post(form, data);
      if (form.id === "verify-form") {
        window.location.assign(result.redirect);
        return;
      }
      if (form.id === "logout-form") {
        window.location.assign(result.redirect);
        return;
      }
      if (form.id === "password-login-form") {
        window.location.assign(result.redirect);
        return;
      }
      if (result.redirect) {
        window.location.assign(result.redirect);
        return;
      }
      showMessage(result.message || "If an account is available, a verification code has been sent.", true);
      if (form.id === "login-form") {
        const url = new URL(window.location.href);
        url.pathname = result.verify_path;
        window.location.assign(url.toString());
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "The request failed.");
    } finally {
      if (button) button.disabled = false;
    }
  }));

  const codePanel = document.getElementById("code-login-panel");
  const passwordLoginForm = document.getElementById("password-login-form");
  const codeLoginForm = document.getElementById("login-form");
  document.getElementById("show-code-login")?.addEventListener("click", () => {
    codePanel.classList.remove("hidden");
    passwordLoginForm.classList.add("hidden");
    const passwordEmail = passwordLoginForm.elements.namedItem("email");
    const codeEmail = codeLoginForm.elements.namedItem("email");
    codeEmail.value = passwordEmail.value;
    codeEmail.focus();
  });
  document.getElementById("show-password-login")?.addEventListener("click", () => {
    codePanel.classList.add("hidden");
    passwordLoginForm.classList.remove("hidden");
    const codeEmail = codeLoginForm.elements.namedItem("email");
    const passwordEmail = passwordLoginForm.elements.namedItem("email");
    passwordEmail.value = codeEmail.value;
    passwordLoginForm.elements.namedItem("password").focus();
  });
})();
