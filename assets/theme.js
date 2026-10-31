(() => {
  "use strict";

  const root = document.documentElement;
  const scriptPath = new URL(document.currentScript.src).pathname;
  const basePath = scriptPath.slice(0, scriptPath.lastIndexOf("/assets/"));
  const defaultColors = { primary_color: "#143c32", secondary_color: "#c69b3c" };
  const validColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  let colors = { ...defaultColors };
  let theme = "light";

  try {
    const savedTheme = localStorage.getItem("akademi-theme");
    theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (error) {
    console.warn("Theme preference could not be read from local storage.", error);
  }

  function applyTheme() {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const button = document.getElementById("theme-toggle");
    if (button) {
      const nextTheme = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
      button.title = `Switch to ${nextTheme} mode`;
      button.innerHTML = theme === "dark"
        ? `<svg class="icon" aria-hidden="true"><use href="${basePath}/assets/icons.svg#fa-sun"></use></svg>`
        : `<svg class="icon" aria-hidden="true"><use href="${basePath}/assets/icons.svg#fa-moon"></use></svg>`;
    }
  }

  function applyBrand(nextColors) {
    if (validColor(nextColors?.primary_color)) colors.primary_color = nextColors.primary_color.toLowerCase();
    if (validColor(nextColors?.secondary_color)) colors.secondary_color = nextColors.secondary_color.toLowerCase();
    const textColorFor = (hex) => {
      const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
      const luminance = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      return luminance > 0.45 ? "#17211b" : "#ffffff";
    };
    root.style.setProperty("--brand-primary", colors.primary_color);
    root.style.setProperty("--brand-secondary", colors.secondary_color);
    root.style.setProperty("--brand-primary-contrast", textColorFor(colors.primary_color));
    root.style.setProperty("--brand-secondary-contrast", textColorFor(colors.secondary_color));
    root.style.setProperty("--forest", colors.primary_color);
    root.style.setProperty("--forest-2", colors.primary_color);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) metaThemeColor.content = colors.primary_color;
  }

  const toggle = document.getElementById("theme-toggle") || document.createElement("button");
  toggle.id = "theme-toggle";
  toggle.classList.add("theme-toggle");
  if (!toggle.isConnected) {
    toggle.classList.add("floating");
    toggle.type = "button";
    document.body.append(toggle);
  }
  toggle.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("akademi-theme", theme);
    } catch (error) {
      console.warn("Theme preference could not be saved to local storage.", error);
    }
    applyTheme();
  });
  applyTheme();

  fetch(`${basePath}/api/brand`, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`Brand settings request failed (HTTP ${response.status}).`);
      return response.json();
    })
    .then(applyBrand)
    .catch((error) => console.warn("Shared brand colors could not be loaded; using defaults.", error));

  window.akademiTheme = { applyBrand, applyTheme };
})();
