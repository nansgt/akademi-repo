(() => {
  "use strict";

  const basePath = document.querySelector('meta[name="app-base-path"]')?.content || "";
  let libraryPromise;

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("The DOCX layout renderer could not be loaded."));
      document.head.append(script);
    });
  }

  function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = loadScript(`${basePath}/assets/docx/jszip.min.js`)
        .then(() => loadScript(`${basePath}/assets/docx/docx-preview.min.js`))
        .then(() => {
          if (typeof window.docx?.renderAsync !== "function") {
            throw new Error("The DOCX layout renderer did not initialize correctly.");
          }
          return window.docx;
        })
        .catch((error) => {
          libraryPromise = null;
          throw error;
        });
    }
    return libraryPromise;
  }

  async function render(url, container) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
    });
    if (!response.ok) {
      throw new Error(`The original Word document could not be loaded (HTTP ${response.status}).`);
    }
    const file = await response.blob();
    if (file.size === 0) throw new Error("The original Word document is empty.");
    const renderer = await loadLibrary();
    await renderer.renderAsync(file, container, container, {
      className: "akademi-docx",
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      useBase64URL: true
    });
  }

  window.akademiCurriculumDocxRenderer = { render };
})();
