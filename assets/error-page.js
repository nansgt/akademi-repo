(() => {
  "use strict";

  const root = document.documentElement;
  let theme = "light";
  const appBase = document.querySelector('meta[name="app-base-path"]')?.content || "";
  try {
    const saved = localStorage.getItem("akademi-theme");
    theme = saved === "light" || saved === "dark"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (error) {
    console.warn("Theme preference could not be read from local storage.", error);
  }
  root.dataset.theme = theme;

  const themeButton = document.querySelector("[data-theme-toggle]");
  function updateThemeButton() {
    if (!themeButton) return;
    const nextTheme = theme === "dark" ? "light" : "dark";
    themeButton.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
    themeButton.title = `Switch to ${nextTheme} mode`;
    themeButton.querySelector("use")?.setAttribute("href", `${appBase}/assets/icons.svg#fa-${theme === "dark" ? "sun" : "moon"}`);
    themeButton.querySelector("span:last-child").textContent = `Switch to ${nextTheme} mode`;
  }
  updateThemeButton();

  themeButton?.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    root.dataset.theme = theme;
    updateThemeButton();
    try {
      localStorage.setItem("akademi-theme", theme);
    } catch (error) {
      console.warn("Theme preference could not be saved to local storage.", error);
    }
  });

  document.querySelector("[data-copy-reference]")?.addEventListener("click", async (event) => {
    const reference = document.getElementById("error-reference-value")?.textContent;
    if (!reference) return;
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(reference);
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = "Copy"; }, 1800);
    } catch (error) {
      console.warn("Error reference could not be copied.", error);
      button.textContent = "Select code";
    }
  });
})();
