"use strict";

(() => {
  const actionIcons = [
    [/\b(delete|remove|discard|erase)\b/, "fa-trash"],
    [/\b(archive)\b/, "fa-box-archive"],
    [/\b(restore|unarchive)\b/, "fa-box-open"],
    [/\b(save|store|finali[sz]e)\b/, "fa-floppy-disk"],
    [/\b(download|export|backup)\b/, "fa-download"],
    [/\b(upload|import|attach)\b/, "fa-upload"],
    [/\b(copy|duplicate)\b/, "fa-copy"],
    [/\b(search|find)\b/, "fa-magnifying-glass"],
    [/\b(filter)\b/, "fa-filter"],
    [/\b(clear|reset)\b/, "fa-eraser"],
    [/\b(verify|approve|confirm|review answers)\b/, "fa-circle-check"],
    [/\b(review instructions|review resources)\b/, "fa-clipboard-check"],
    [/\b(edit|change|update|revise)\b/, "fa-pen-to-square"],
    [/\b(print)\b/, "fa-print"],
    [/\b(reply|respond)\b/, "fa-reply"],
    [/\b(send|email)\b/, "fa-paper-plane"],
    [/\b(sign out|log out|logout)\b/, "fa-right-from-bracket"],
    [/\b(sign in|log in|login)\b/, "fa-right-to-bracket"],
    [/\b(create account|register)\b/, "fa-user-plus"],
    [/\b(password)\b/, "fa-key"],
    [/\b(publish|share)\b/, "fa-share-nodes"],
    [/\b(join)\b/, "fa-right-to-bracket"],
    [/\b(start|begin|proceed)\b/, "fa-play"],
    [/\b(submit|finish|complete)\b/, "fa-paper-plane"],
    [/\b(generate|build|create|draft)\b/, "fa-wand-magic-sparkles"],
    [/\b(add|new)\b/, "fa-plus"],
    [/\b(next|continue|forward)\b/, "fa-arrow-right"],
    [/\b(previous|back|return)\b/, "fa-arrow-left"],
    [/\b(cancel|close|dismiss)\b/, "fa-xmark"],
    [/\b(retry|try again|reload)\b/, "fa-rotate"],
    [/\b(test|check connection)\b/, "fa-plug"],
    [/\b(full ?screen|expand)\b/, "fa-expand"],
    [/\b(collapse)\b/, "fa-compress"],
    [/\b(hide)\b/, "fa-eye-slash"],
    [/\b(show|view|open)\b/, "fa-eye"],
    [/\b(manage)\b/, "fa-sliders"],
    [/\b(help|about)\b/, "fa-circle-question"],
    [/\b(identify|student details)\b/, "fa-user"],
    [/\b(week|calendar|schedule)\b/, "fa-calendar-days"],
    [/\b(class|learner|student)\b/, "fa-users"],
    [/\b(result|score|performance)\b/, "fa-chart-column"],
    [/\b(resource|curriculum)\b/, "fa-book-open"],
    [/\b(poll|vote)\b/, "fa-square-poll-vertical"],
    [/\b(question|assessment)\b/, "fa-clipboard-question"],
    [/\b(today)\b/, "fa-calendar-day"],
    [/\b(pdf)\b/, "fa-file-pdf"],
    [/\b(docx|word)\b/, "fa-file-word"],
    [/\b(theme|color scheme)\b/, "fa-circle-half-stroke"],
    [/\b(select eligible|select all)\b/, "fa-list-check"],
    [/\b(refresh|sync)\b/, "fa-rotate"]
  ];

  const excluded = [
    ".nav-item",
    ".profile-link",
    ".mobile-menu",
    ".theme-toggle",
    ".error-theme-toggle",
    ".curriculum-filter-badge",
    ".assessment-badge",
    ".scheme-topic-option",
    ".schedule-view-switch button",
    "[role='tab']",
    "[data-page]",
    "[data-filter-value]",
    "[data-assessment-value]",
    "[data-scheme-period]",
    "[data-theme-toggle]"
  ].join(",");

  function decorate(button) {
    if (!(button instanceof HTMLButtonElement) || button.matches(excluded)) return;

    const label = String(button.getAttribute("aria-label") || button.title || button.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!label) return;

    const match = actionIcons.find(([pattern]) => pattern.test(label));
    const currentIcon = button.querySelector(":scope > i.action-button-icon");
    if (button.dataset.actionIconLabel === label && currentIcon) return;
    currentIcon?.remove();

    if (!match || button.querySelector("svg, i.fa-solid, i.fa-regular")) {
      delete button.dataset.actionIcon;
      delete button.dataset.actionIconLabel;
      return;
    }

    const icon = document.createElement("i");
    icon.className = `fa-solid ${match[1]} action-button-icon`;
    icon.setAttribute("aria-hidden", "true");
    button.prepend(icon);
    button.dataset.actionIcon = match[1];
    button.dataset.actionIconLabel = label;
  }

  function scan(node) {
    if (node instanceof HTMLButtonElement) decorate(node);
    node.querySelectorAll?.("button").forEach(decorate);
  }

  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
      if (record.target instanceof HTMLButtonElement) decorate(record.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
