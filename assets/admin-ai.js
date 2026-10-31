(() => {
  "use strict";

  const form = document.getElementById("ai-settings-form");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const alertBox = document.getElementById("settings-alert");
  const keyStatus = document.getElementById("key-status");
  const testButton = document.getElementById("test-ai");
  const creditsForm = document.getElementById("credit-settings-form");
  const creditUsage = document.getElementById("credit-usage");
  const mailForm = document.getElementById("mail-settings-form");
  const mailPasswordStatus = document.getElementById("mail-password-status");
  const mailTestButton = document.getElementById("test-mail");
  const oauthGoogleForm = document.getElementById("oauth-google-form");
  const oauthAppleForm = document.getElementById("oauth-apple-form");
  const brandForm = document.getElementById("brand-settings-form");
  const settingsStatus = document.getElementById("settings-status");
  const setupStatusTrigger = document.getElementById("setup-status-trigger");
  const setupStatusLabel = document.getElementById("setup-status-label");
  const setupStatusDialog = document.getElementById("setup-status-dialog");
  const settingsCard = document.querySelector(".settings-card");
  const signinEditors = document.getElementById("signin-settings-editors");
  const costStatus = document.getElementById("ai-cost-status");
  const providerHelp = document.getElementById("ai-provider-help");
  const tabs = Array.from(document.querySelectorAll("[role='tab'][data-tab]"));
  let providerOptions = [];

  function show(message, success = false) {
    alertBox.classList.add("hidden");
    window.akademiAlert.toast(message, success ? "success" : "error");
  }
  async function request(url, method = "GET", data = null, label = "Platform settings") {
    const options = { method, credentials: "same-origin", headers: { "Accept": "application/json" } };
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
      throw new Error(`${label} returned an unreadable response. Refresh the page and try again.`);
    }
    if (!response.ok) {
      const reference = result.request_id ? ` Reference: ${result.request_id}.` : "";
      const message = response.status >= 500
        ? `${label} could not be loaded. ${result.error || "Check the database connection, .env settings and applied migrations."}${reference}`
        : `${label}: ${result.error || "The request could not be completed."}${reference}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function renderSetupStatus(items) {
    const requiredItems = items.filter((item) => !item.optional);
    const completeCount = requiredItems.filter((item) => item.complete).length;
    const ready = completeCount === requiredItems.length;
    setupStatusLabel.textContent = ready ? "Setup status · ready" : "Setup status · action needed";
    setupStatusTrigger.classList.toggle("is-ready", ready);
    setupStatusTrigger.classList.toggle("needs-attention", !ready);
    setupStatusTrigger.setAttribute("aria-label", `${setupStatusLabel.textContent}. Open setup details.`);
    settingsStatus.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = ready ? "Required configuration · ready" : "Required configuration · action needed";
    settingsStatus.append(heading);
    const list = document.createElement("ul");
    for (const item of items) {
      const row = document.createElement("li");
      row.classList.toggle("is-complete", item.complete);
      row.classList.toggle("is-error", Boolean(item.error));
      const label = document.createElement("span");
      label.textContent = `${item.optional ? "Optional" : item.complete ? "Complete" : "Incomplete"} · ${item.label}`;
      row.append(label);
      const detail = item.error || item.detail;
      if (detail) {
        const note = document.createElement("span");
        note.className = "status-detail";
        note.textContent = detail;
        row.append(note);
      }
      list.append(row);
    }
    settingsStatus.append(list);
  }

  function serverErrorFor(label, error) {
    if (error instanceof Error && error.message.includes("Reference:")) return error.message;
    if (error instanceof Error && error.status >= 500) return error.message;
    if (error instanceof Error && error.status === 401) return `${label} could not be loaded because your sign-in has expired. Sign in again and reopen Platform settings.`;
    if (error instanceof Error && error.status === 403) return `${label} could not be loaded because this account is not authorized as a Super Admin.`;
    if (error instanceof TypeError) return `${label} is unreachable. Check that Apache and MySQL are running, then refresh the page.`;
    return `${label} could not be loaded. ${error instanceof Error ? error.message : "Refresh the page and try again."}`;
  }

  function renderSavedView(container, entries, actions = []) {
    container.replaceChildren();
    const details = document.createElement("dl");
    details.className = "settings-saved-details";
    for (const [label, value] of entries) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value || "Not configured";
      details.append(term, description);
    }
    container.append(details);
    const actionRow = document.createElement("div");
    actionRow.className = "settings-saved-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary ? "auth-submit" : "auth-secondary";
      button.dataset.settingsAction = action.action;
      button.textContent = action.label;
      actionRow.append(button);
    }
    container.append(actionRow);
  }

  function renderSettingsError(container, message) {
    container.replaceChildren();
    const error = document.createElement("p");
    error.className = "settings-load-error";
    error.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "auth-secondary";
    retry.dataset.settingsAction = "retry";
    retry.textContent = "Retry loading settings";
    container.append(error, retry);
  }

  function setSettingsState(key, configured, entries, error = "") {
    const view = document.getElementById(`${key}-settings-view`);
    const editor = document.querySelector(`[data-settings-editor="${key}"]`);
    view.hidden = false;
    if (error) {
      renderSettingsError(view, error);
      if (editor) editor.hidden = true;
      return;
    }
    if (configured) {
      editor.hidden = true;
      view.hidden = false;
      renderSavedView(view, entries, [
        ...(key === "ai" ? [{ action: "test-ai", label: "Test AI connection" }] : []),
        ...(key === "mail" ? [{ action: "test-mail", label: "Send test email" }] : []),
        { action: `edit-${key}`, label: "Edit settings", primary: true },
      ]);
      return;
    }
    view.hidden = true;
    editor.hidden = false;
  }

  function setSigninState(configured, entries, error = "") {
    const view = document.getElementById("signin-settings-view");
    view.hidden = false;
    if (error) {
      signinEditors.hidden = true;
      renderSettingsError(view, error);
      return;
    }
    if (configured) {
      signinEditors.hidden = true;
      renderSavedView(view, entries, [{ action: "edit-signin", label: "Edit sign-in settings", primary: true }]);
      return;
    }
    view.hidden = true;
    signinEditors.hidden = false;
    oauthGoogleForm.hidden = false;
    oauthAppleForm.hidden = false;
  }

  settingsCard.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-action]");
    if (!button) return;
    const action = button.dataset.settingsAction;
    if (action === "retry") {
      load();
    } else if (action === "edit-signin") {
      document.getElementById("signin-settings-view").hidden = true;
      signinEditors.hidden = false;
      oauthGoogleForm.hidden = false;
      oauthAppleForm.hidden = false;
    } else if (action.startsWith("edit-")) {
      const key = action.slice("edit-".length);
      document.getElementById(`${key}-settings-view`).hidden = true;
      document.querySelector(`[data-settings-editor="${key}"]`).hidden = false;
    } else if (action === "test-ai") {
      testButton.click();
    } else if (action === "test-mail") {
      mailTestButton.click();
    }
  });

  function updateCostStatus() {
    const provider = form.elements.namedItem("provider").value;
    const option = providerOptions.find((item) => item.id === provider);
    const info = option?.cost_info;
    costStatus.textContent = info
      ? `${info.label}: ${info.note}${option?.setup_url ? ` Set up or check access: ${option.setup_url}` : ""}`
      : "Pricing information is unavailable for this provider. Check the provider’s pricing before saving.";
    const setupLinks = {
      xai: "Create an xAI API key at console.x.ai. An xAI/Grok key works only with the Grok (xAI API) provider.",
      groq: "Create a Groq Cloud API key at console.groq.com. A Groq key is different from an xAI/Grok key.",
      openai: "Create an OpenAI API key at platform.openai.com. OpenAI keys only work with the OpenAI provider.",
      openrouter: "Create an OpenRouter API key at openrouter.ai. OpenRouter keys only work with the OpenRouter provider."
    };
    providerHelp.textContent = `${setupLinks[provider] || "Create the API key in the selected provider’s console."} Never put an API key in source code or browser storage.`;
  }

  function activateTab(tab, moveFocus = false) {
    const selected = tab.dataset.tab;
    for (const item of tabs) {
      const isActive = item === tab;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      item.tabIndex = isActive ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== selected;
    }
    if (moveFocus) tab.focus();
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[nextIndex], true);
    });
  }

  async function load() {
    const loadSection = async (label, callback) => {
      try {
        return { label, data: await callback() };
      } catch (error) {
        return { label, error: serverErrorFor(label, error) };
      }
    };
    const [aiResult, creditsResult, mailResult, oauthResult, brandResult] = await Promise.all([
      loadSection("AI provider", async () => {
        const config = await request(form.dataset.configUrl, "GET", null, "AI provider settings");
        providerOptions = Array.isArray(config.providers) ? config.providers : [];
        if (config.configured) form.elements.namedItem("provider").value = config.provider;
        keyStatus.textContent = config.api_key_usable
          ? "Key stored encrypted"
          : config.api_key_configured
            ? "Cannot decrypt — re-enter key"
            : "Not configured";
        form.elements.namedItem("api_key").placeholder = config.api_key_configured && !config.api_key_usable
          ? "Re-enter provider key to replace the unreadable key"
          : "Paste key from the selected provider";
        updateCostStatus();
        return config;
      }),
      loadSection("Teacher AI credits", async () => {
        const credits = await request(form.dataset.creditsUrl, "GET", null, "Teacher credit settings");
        creditsForm.elements.namedItem("monthly_allowance").value = credits.monthly_allowance;
        creditUsage.textContent = `${credits.month} usage: ${credits.usage.requests} AI requests · ${credits.usage.credits} credits charged.`;
        return credits;
      }),
      loadSection("Email delivery", async () => {
        const mail = await request(form.dataset.mailUrl, "GET", null, "Email delivery settings");
        for (const field of ["host", "port", "username", "encryption", "from_address", "from_name"]) {
          mailForm.elements.namedItem(field).value = mail[field] ?? "";
        }
        mailPasswordStatus.textContent = mail.password_configured ? "Password stored securely" : "Not configured";
        return mail;
      }),
      loadSection("Social sign-in", async () => {
        const oauths = await request(oauthGoogleForm.dataset.configUrl, "GET", null, "Social sign-in settings");
        if (Array.isArray(oauths)) {
          for (const row of oauths) {
            if (row.provider === "google") {
              oauthGoogleForm.elements.namedItem("client_id").value = row.client_id || "";
              oauthGoogleForm.elements.namedItem("redirect_uri").value = row.redirect_uri || "";
              oauthGoogleForm.elements.namedItem("enabled").value = row.enabled ? "1" : "0";
            }
            if (row.provider === "apple") {
              oauthAppleForm.elements.namedItem("client_id").value = row.client_id || "";
              oauthAppleForm.elements.namedItem("redirect_uri").value = row.redirect_uri || "";
              oauthAppleForm.elements.namedItem("enabled").value = row.enabled ? "1" : "0";
            }
          }
        }
        return oauths;
      }),
      loadSection("Brand & theme", async () => {
        const brand = await request(form.dataset.brandUrl, "GET", null, "Brand and theme settings");
        brandForm.elements.namedItem("primary_color").value = brand.primary_color;
        brandForm.elements.namedItem("secondary_color").value = brand.secondary_color;
        window.akademiTheme.applyBrand(brand);
        return brand;
      }),
    ]);
    setSettingsState("ai", Boolean(aiResult.data?.configured && aiResult.data?.api_key_usable), [
      ["Provider", aiResult.data?.provider_label || aiResult.data?.provider],
      ["Default model", aiResult.data?.model],
      ["API key", aiResult.data?.api_key_usable
        ? "Stored encrypted and decryptable"
        : aiResult.data?.api_key_configured
          ? "Cannot decrypt with the current APP_KEY; replace the provider key here"
          : "Not configured"],
      ["Plan", aiResult.data?.cost_info?.label],
      ["Last updated", aiResult.data?.updated_at],
    ], aiResult.error);
    setSettingsState("mail", Boolean(mailResult.data?.configured), [
      ["SMTP server", mailResult.data?.host],
      ["Port and security", mailResult.data ? `${mailResult.data.port} · ${mailResult.data.encryption}` : ""],
      ["SMTP username", mailResult.data?.username],
      ["Sender", mailResult.data?.from_name
        ? `${mailResult.data.from_name} <${mailResult.data.from_address}>`
        : mailResult.data?.from_address],
      ["Password", mailResult.data?.password_configured ? "Stored securely" : "Not configured"],
    ], mailResult.error);
    setSettingsState("credits", Boolean(creditsResult.data?.configured), [
      ["Monthly teacher allowance", creditsResult.data ? `${creditsResult.data.monthly_allowance} AI credits` : ""],
      ["Usage this month", creditsResult.data
        ? `${creditsResult.data.usage.requests} requests · ${creditsResult.data.usage.credits} credits charged`
        : ""],
    ], creditsResult.error);
    setSettingsState("brand", Boolean(brandResult.data?.configured), [
      ["Primary color", brandResult.data?.primary_color],
      ["Secondary color", brandResult.data?.secondary_color],
    ], brandResult.error);
    const oauthRows = Array.isArray(oauthResult.data) ? oauthResult.data : [];
    const oauthConfigured = oauthRows.some((row) =>
      row.client_id || row.redirect_uri || row.secret_configured || row.enabled
    );
    const oauthEntries = ["google", "apple"].flatMap((provider) => {
      const row = oauthRows.find((item) => item.provider === provider);
      const label = provider === "google" ? "Google" : "Apple";
      if (!row) return [[label, "Not configured"]];
      return [
        [`${label} sign-in`, row.enabled ? "Enabled" : "Disabled"],
        [`${label} client ID`, row.client_id || "Not configured"],
        [`${label} callback`, row.redirect_uri || "Not configured"],
        [`${label} secret`, row.secret_configured ? "Stored securely" : "Not configured"],
      ];
    });
    setSigninState(oauthConfigured, oauthEntries, oauthResult.error);
    const failures = [aiResult, creditsResult, mailResult, oauthResult, brandResult].filter((item) => item.error);
    const aiReady = aiResult.data?.configured && aiResult.data?.api_key_usable;
    const mail = mailResult.data;
    const mailReady = mail?.configured && mail.host && mail.from_address
      && (!mail.username || mail.password_configured);
    const oauthReady = oauthResult.data?.some((item) => item.enabled && item.secret_configured && item.redirect_uri);
    const statusItems = [
      {
        label: "AI provider and encrypted API key",
        complete: Boolean(aiReady),
        detail: aiReady ? "AI drafting is configured." : aiResult.data?.api_key_configured
          ? "The saved key cannot be decrypted. Replace the provider key here. Other encrypted settings may also need to be re-entered if APP_KEY changed."
          : "Choose a provider, save its API key, and test the connection.",
        error: aiResult.error,
      },
      {
        label: "SMTP sender and delivery credentials",
        complete: Boolean(mailReady),
        detail: mailReady ? `Verification mail will use ${mail.from_address} as its configured sender.` : "Set the SMTP host, sender email, and password when SMTP authentication is enabled; save and send a test.",
        error: mailResult.error,
      },
      {
        label: "Teacher credit allowance",
        complete: Boolean(creditsResult.data),
        detail: creditsResult.data ? `${creditsResult.data.monthly_allowance} credits per teacher each month.` : "",
        error: creditsResult.error,
      },
      {
        label: "Google / Apple sign-in (optional)",
        complete: Boolean(oauthReady),
        detail: oauthReady ? "At least one identity provider is enabled." : "Optional. Email-code and password sign-in remain available.",
        error: oauthResult.error,
        optional: true,
      },
      {
        label: "Brand colors",
        complete: Boolean(brandResult.data),
        detail: brandResult.data ? "Shared primary and secondary colors are loaded." : "",
        error: brandResult.error,
      },
    ];
    renderSetupStatus(statusItems);
    if (failures.length) {
      show("Some settings could not be checked. Open Setup status for details.");
    }
    return failures.length === 0;
  }
  form.elements.namedItem("provider").addEventListener("change", () => {
    updateCostStatus();
  });
  setupStatusTrigger.addEventListener("click", () => setupStatusDialog.showModal());
  setupStatusDialog.querySelector("[data-close-setup-status]").addEventListener("click", () => setupStatusDialog.close());
  setupStatusDialog.addEventListener("click", (event) => {
    if (event.target === setupStatusDialog) setupStatusDialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await request(form.dataset.configUrl, "PUT", data);
      form.elements.namedItem("api_key").value = "";
      keyStatus.textContent = result.api_key_usable ? "Key stored encrypted" : "Not configured";
      providerOptions = Array.isArray(result.providers) ? result.providers : providerOptions;
      updateCostStatus();
      if (!await load()) {
        show("AI settings were saved, but some settings could not be reloaded. Refresh the page to confirm the current values.");
        return;
      }
      show("AI provider settings saved. The API key is not displayed again.", true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not save AI settings.");
    } finally {
      button.disabled = false;
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    try {
      const result = await request(form.dataset.testUrl, "POST", {});
      show(`Connection successful: ${result.provider} · ${result.model}`, true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Provider test failed.");
    } finally {
      testButton.disabled = false;
    }
  });
  for (const input of brandForm.querySelectorAll('input[type="color"]')) {
    input.addEventListener("input", () => {
      window.akademiTheme.applyBrand({
        primary_color: brandForm.elements.namedItem("primary_color").value,
        secondary_color: brandForm.elements.namedItem("secondary_color").value
      });
    });
  }
  brandForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = brandForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(brandForm).entries());
      const colors = await request(form.dataset.brandSaveUrl, "PUT", data);
      window.akademiTheme.applyBrand(colors);
      if (!await load()) {
        show("Brand colors were saved, but some settings could not be reloaded. Refresh the page to confirm the current values.");
        return;
      }
      show("Brand colors saved and applied across Akademi.", true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not save brand colors.");
    } finally {
      button.disabled = false;
    }
  });
  mailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = mailForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(mailForm).entries());
      data.port = Number(data.port);
      const result = await request(form.dataset.mailUrl, "PUT", data);
      mailForm.elements.namedItem("password").value = "";
      mailPasswordStatus.textContent = result.password_configured ? "Password stored securely" : "Not configured";
      if (!await load()) {
        show("Email settings were saved, but some settings could not be reloaded. Refresh the page to confirm the current values.");
        return;
      }
      show("Email delivery settings saved securely.", true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not save email settings.");
    } finally {
      button.disabled = false;
    }
  });
  mailTestButton.addEventListener("click", async () => {
    const recipient = mailForm.elements.namedItem("test_recipient").value.trim();
    mailTestButton.disabled = true;
    try {
      const result = await request(form.dataset.mailTestUrl, "POST", recipient ? { recipient } : {});
      show(`SMTP accepted the test from ${result.sender} to ${result.recipient}. Check the recipient inbox and spam folder; SMTP acceptance does not confirm final delivery.`, true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not send the SMTP test message.");
    } finally {
      mailTestButton.disabled = false;
    }
  });
  creditsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = creditsForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(creditsForm).entries());
      const result = await request(form.dataset.creditsUrl, "PUT", {
        monthly_allowance: Number(data.monthly_allowance)
      });
      creditsForm.elements.namedItem("monthly_allowance").value = result.monthly_allowance;
      if (!await load()) {
        show("The credit allowance was saved, but some settings could not be reloaded. Refresh the page to confirm the current values.");
        return;
      }
      show(`Monthly teacher allowance saved: ${result.monthly_allowance} AI credits.`, true);
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not save the credit allowance.");
    } finally {
      button.disabled = false;
    }
  });

  // OAuth forms handlers
  if (oauthGoogleForm) {
    oauthGoogleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = oauthGoogleForm.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(oauthGoogleForm).entries());
        data.enabled = data.enabled === '1' ? 1 : 0;
        const provider = oauthGoogleForm.dataset.provider;
        const url = oauthGoogleForm.dataset.configUrl + '/' + provider;
        await request(url, 'PUT', data);
        oauthGoogleForm.elements.namedItem('client_secret').value = '';
        if (!await load()) {
          show('Google settings were saved, but some settings could not be reloaded. Refresh the page to confirm the current values.');
          return;
        }
        show('Google OAuth settings saved.', true);
      } catch (err) {
        show(err instanceof Error ? err.message : 'Could not save Google settings.');
      } finally { btn.disabled = false; }
    });
  }
  if (oauthAppleForm) {
    oauthAppleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = oauthAppleForm.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(oauthAppleForm).entries());
        data.enabled = data.enabled === '1' ? 1 : 0;
        const provider = oauthAppleForm.dataset.provider;
        const url = oauthAppleForm.dataset.configUrl + '/' + provider;
        await request(url, 'PUT', data);
        oauthAppleForm.elements.namedItem('client_secret').value = '';
        if (!await load()) {
          show('Apple settings were saved, but some settings could not be reloaded. Refresh the page to confirm the current values.');
          return;
        }
        show('Apple OAuth settings saved.', true);
      } catch (err) {
        show(err instanceof Error ? err.message : 'Could not save Apple settings.');
      } finally { btn.disabled = false; }
    });
  }

  load();
})();
