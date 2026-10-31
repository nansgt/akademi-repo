(() => {
  "use strict";

  const library = document.querySelector("[data-verified-resource-library]");
  if (!library) return;
  const list = library.querySelector("[data-resource-list]");
  const count = library.querySelector("[data-resource-count]");
  const pagination = library.querySelector("[data-resource-pagination]");
  const filterForm = library.querySelector("[data-resource-filters]");
  const basePath = document.querySelector('meta[name="app-base-path"]')?.content || "";
  const apiUrl = `${basePath}/api/curriculum/resources`;
  let page = 1;
  let requestVersion = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function renderSkeletons() {
    list.innerHTML = Array.from({ length: 3 }, () => (
      '<article class="verified-resource-card verified-resource-skeleton" aria-hidden="true"><span></span><div><i></i><i></i><i></i></div></article>'
    )).join("");
  }

  function renderDocuments(documents) {
    if (!documents.length) {
      list.innerHTML = '<p class="verified-resource-empty">No verified resources match these filters. Try another search or SHS year.</p>';
      return;
    }
    list.innerHTML = documents.map((item) => {
      const subject = item.subject_name || "Subject not specified";
      const year = item.year_group ? item.year_group.replace("SHS", "SHS Year ") : "SHS year not specified";
      const kind = item.resource_role === "other" && item.resource_type_label
        ? item.resource_type_label
        : item.resource_role === "curriculum" ? "Curriculum"
        : item.resource_role ? item.resource_role.replaceAll("_", " ") : "curriculum resource";
      return `<article class="verified-resource-card">
        <div class="verified-resource-mark" aria-hidden="true">${escapeHtml(subject.slice(0, 2).toUpperCase())}</div>
        <div class="verified-resource-copy"><div class="eyebrow">${escapeHtml(year)} · ${escapeHtml(kind)}</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(subject)} · ${Number(item.chunk_count)} text sections</p></div>
        <button class="button button-primary" type="button" data-read-verified-resource="${Number(item.id)}">Read resource</button>
      </article>`;
    }).join("");
  }

  async function load(requestedPage = page) {
    page = requestedPage;
    const version = ++requestVersion;
    const parameters = new URLSearchParams(new FormData(filterForm));
    parameters.set("page", String(page));
    list.setAttribute("aria-busy", "true");
    count.textContent = "Loading verified resources…";
    pagination.replaceChildren();
    renderSkeletons();
    try {
      const response = await fetch(`${apiUrl}?${parameters}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Verified resources could not be loaded.");
      if (version !== requestVersion) return;
      page = result.page;
      renderDocuments(result.documents);
      count.textContent = `${result.total} verified resource${result.total === 1 ? "" : "s"}`;
      const pages = Math.ceil(result.total / result.per_page);
      if (pages > 1) {
        pagination.innerHTML = `<button type="button" data-resource-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${pages}</span><button type="button" data-resource-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Next</button>`;
      }
      list.setAttribute("aria-busy", "false");
    } catch (error) {
      if (version !== requestVersion) return;
      const message = error instanceof Error ? error.message : "Verified resources could not be loaded.";
      count.textContent = "Resource library unavailable";
      list.innerHTML = `<p class="verified-resource-empty" role="alert">${escapeHtml(message)}</p><button type="button" class="button button-secondary" data-retry-verified-resources>Retry</button>`;
      list.setAttribute("aria-busy", "false");
    }
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    load(1);
  });
  filterForm.elements.year_group.addEventListener("change", () => load(1));
  library.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-resource-page]");
    if (pageButton) {
      load(Number(pageButton.dataset.resourcePage));
      return;
    }
    if (event.target.closest("[data-retry-verified-resources]")) {
      load(page);
      return;
    }
    const readButton = event.target.closest("[data-read-verified-resource]");
    if (readButton) {
      const id = readButton.dataset.readVerifiedResource;
      window.akademiCurriculumReader.open(id, `${apiUrl}/${id}`, `${apiUrl}/${id}/source`);
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="curriculum"]') && document.getElementById("page-curriculum")?.classList.contains("active")) {
      load(1);
    }
  });
})();
