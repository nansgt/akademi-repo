(() => {
  "use strict";

  const sidebar = document.getElementById("sidebar");
  const collapseButton = document.getElementById("sidebar-collapse");
  const mobileMenu = document.getElementById("mobile-menu");
  let collapsed = false;
  try {
    collapsed = localStorage.getItem("akademi-sidebar") === "collapsed";
  } catch (error) {
    console.warn("Sidebar preference could not be read from local storage.", error);
  }
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  collapseButton.addEventListener("click", () => {
    collapsed = document.body.classList.toggle("sidebar-collapsed");
    try {
      localStorage.setItem("akademi-sidebar", collapsed ? "collapsed" : "expanded");
    } catch (error) {
      console.warn("Sidebar preference could not be saved to local storage.", error);
    }
    collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  });
  mobileMenu.addEventListener("click", (event) => {
    const open = sidebar.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      sidebar.classList.remove("open");
      mobileMenu.setAttribute("aria-expanded", "false");
    }
  });
})();
