(() => {
  "use strict";

  const form = document.getElementById("account-password-form");
  const alertBox = document.getElementById("password-alert");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch(form.dataset.endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Accept": "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your password.");
      form.reset();
      window.akademiAlert.toast(result.message, "success");
    } catch (error) {
      window.akademiAlert.toast(error instanceof Error ? error.message : "Could not save your password.", "error");
    } finally {
      button.disabled = false;
    }
  });
})();
