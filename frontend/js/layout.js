(function () {
  document.addEventListener("DOMContentLoaded", () => {
    // Sidebar stats from dashboard
    const sidebarTotals = {
      year: document.getElementById("sidebar-year"),
      unpaid: document.getElementById("sidebar-unpaid"),
      paid: document.getElementById("sidebar-paid"),
      drafts: document.getElementById("sidebar-drafts"),
      total: document.getElementById("sidebar-total"),
    };

    const fmtCurrency = (num) =>
      `${new Intl.NumberFormat("lt-LT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(num || 0))} €`;

    const loadSidebarStats = async () => {
      if (!window.api || !sidebarTotals.year) return;
      try {
        const year = new Date().getFullYear();
        const stats = await api.getDashboardStatistics(year, null);
        sidebarTotals.year.textContent = year;
        sidebarTotals.unpaid.textContent = fmtCurrency(stats.total_unpaid || 0);
        sidebarTotals.paid.textContent = fmtCurrency(stats.total_received || 0);
        sidebarTotals.drafts.textContent = stats.total_drafts ?? "0";
        sidebarTotals.total.textContent = fmtCurrency(stats.total_issued || 0);
      } catch (err) {
        sidebarTotals.year.textContent = "—";
        sidebarTotals.unpaid.textContent = "—";
        sidebarTotals.paid.textContent = "—";
        sidebarTotals.drafts.textContent = "—";
        sidebarTotals.total.textContent = "—";
        console.warn("Nepavyko užkrauti šoninės suvestinės", err);
      }
    };
    if (window.lucide && window.lucide.icons) {
      window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide" });
    }

    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const openButton = document.getElementById("sidebar-open");
    const closeButton = document.getElementById("sidebar-close");
    const collapseButton = document.getElementById("sidebar-collapse");
    const layout = document.querySelector("main");
    const body = document.body;

    const toggleSidebar = (open) => {
      if (!sidebar || !backdrop) return;
      if (open) {
        sidebar.classList.remove("-translate-x-full");
        backdrop.classList.remove("hidden");
      } else {
        sidebar.classList.add("-translate-x-full");
        backdrop.classList.add("hidden");
      }
    };

    openButton?.addEventListener("click", () => toggleSidebar(true));
    closeButton?.addEventListener("click", () => toggleSidebar(false));
    backdrop?.addEventListener("click", () => toggleSidebar(false));

    const applyLayoutShift = () => {
      const isCollapsed = sidebar?.classList.contains("sidebar-collapsed");
      layout?.classList.toggle("layout-shifted", !isCollapsed);
      layout?.classList.toggle("layout-shifted-collapsed", isCollapsed);
      body?.classList.toggle("has-collapsed-sidebar", isCollapsed);

      // Hide branding/stats labels when collapsed
      const brandText = sidebar?.querySelector(".brand-text");
      const statLabels = sidebar?.querySelectorAll(".sidebar-stat-text");
      const statsCard = document.getElementById("sidebar-stats");
      [brandText, ...(statLabels || [])].forEach((el) => {
        if (!el) return;
        el.classList.toggle("hidden", isCollapsed);
      });
      if (statsCard) {
        statsCard.classList.toggle("hidden", isCollapsed);
      }
    };

    collapseButton?.addEventListener("click", () => {
      sidebar?.classList.toggle("sidebar-collapsed");
      applyLayoutShift();
    });

    const dialog = document.getElementById("invoice-dialog");
    const openDialogBtn = document.querySelector("[data-open-dialog='invoice']");
    const closeDialogBtns = dialog?.querySelectorAll("[data-close-dialog]");
    const showDialog = () => dialog?.classList.remove("hidden");
    const hideDialog = () => dialog?.classList.add("hidden");

    openDialogBtn?.addEventListener("click", () => {
      showDialog();
      toggleSidebar(false);
    });
    closeDialogBtns?.forEach((btn) => btn.addEventListener("click", hideDialog));
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) hideDialog();
    });

    const navLinks = document.querySelectorAll("[data-nav]");
    const path = window.location.pathname.split("/").pop() || "index.html";
    const pageKey = (() => {
      if (path === "" || path === "index.html") return "dashboard";
      return path.replace(".html", "");
    })();

    navLinks.forEach((link) => {
      const key = link.dataset.nav;
      const isActive = key === pageKey;
      if (link.classList.contains("sidebar-link")) {
        link.classList.toggle("sidebar-link-active", isActive);
      }
      if (link.closest("nav.fixed")) {
        link.classList.toggle("text-ordinn-red", isActive);
        link.classList.toggle("text-graphite-steel/80", !isActive);
      }
      link.addEventListener("click", () => toggleSidebar(false));
    });

    const currentDate = document.getElementById("current-date");
    if (currentDate) {
      const now = new Date();
      currentDate.textContent = now.toLocaleDateString("lt-LT", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    loadSidebarStats();
    applyLayoutShift();
  });
})();

