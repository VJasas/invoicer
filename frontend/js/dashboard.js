(function () {
    const root = document.getElementById("dashboard-root");
    if (!root) return;
  
    const MONTHS = [
      { value: "all", label: "Visi mėnesiai" },
      { value: 1, label: "Sausis" },
      { value: 2, label: "Vasaris" },
      { value: 3, label: "Kovas" },
      { value: 4, label: "Balandis" },
      { value: 5, label: "Gegužė" },
      { value: 6, label: "Birželis" },
      { value: 7, label: "Liepa" },
      { value: 8, label: "Rugpjūtis" },
      { value: 9, label: "Rugsėjis" },
      { value: 10, label: "Spalis" },
      { value: 11, label: "Lapkritis" },
      { value: 12, label: "Gruodis" },
    ];
  
    const currentYear = new Date().getFullYear();
    const YEARS = [currentYear, currentYear - 1];
  
    const STATUS_META = {
      paid: { label: "Apmokėta", cls: "bg-green-100 text-green-700" },
      overdue: { label: "Neapmokėta", cls: "bg-ordinn-red/10 text-ordinn-red" },
      draft: { label: "Juodraštis", cls: "bg-amber-100 text-amber-700" },
      sent: { label: "Išsiųsta", cls: "bg-blue-100 text-blue-700" },
    };
  
    const state = {
      year: currentYear,
      month: "all",
      chart: null,
    };
  
    const fmtCurrency = (num) =>
      `${new Intl.NumberFormat("lt-LT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(num || 0))} €`;
  
    const fmtDate = (value) => {
      if (!value) return "—";
      const d = new Date(value);
      return d.toLocaleDateString("lt-LT", { year: "numeric", month: "short", day: "numeric" });
    };
  
    const percentChange = (current, prev) => {
      if (prev === 0 || prev === null || prev === undefined) return null;
      const diff = ((current - prev) / prev) * 100;
      return Math.round(diff * 10) / 10;
    };
  
    const withIcon = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
    const renderIcons = () => {
      if (window.lucide && window.lucide.icons) {
        window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide" });
      }
    };
  
    function renderSkeleton() {
      root.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div class="space-y-2">
            <div class="skeleton h-5 w-48"></div>
            <div class="skeleton h-4 w-64"></div>
          </div>
          <div class="flex gap-4 items-center">
            <div class="skeleton h-10 w-32"></div>
            <div class="skeleton h-10 w-40"></div>
          </div>
        </div>
  
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          ${["", "", "", ""]
            .map(
              () => `
            <div class="bg-white border border-ghost-concrete rounded-lg p-4 shadow-sm">
              <div class="flex items-center justify-between mb-3">
                <div class="skeleton h-4 w-28"></div>
                <div class="skeleton h-6 w-6 rounded-full"></div>
              </div>
              <div class="skeleton h-7 w-24 mb-2"></div>
              <div class="skeleton h-4 w-32"></div>
            </div>`
            )
            .join("")}
        </section>
  
        <section class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 bg-white border border-ghost-concrete rounded-lg p-4 shadow-sm space-y-4">
            <div class="skeleton h-5 w-40"></div>
            <div class="skeleton h-80 w-full"></div>
          </div>
          <div class="bg-white border border-ghost-concrete rounded-lg p-4 shadow-sm space-y-4">
            <div class="skeleton h-5 w-40"></div>
            <div class="space-y-3">
              ${["", "", "", ""]
                .map(() => `<div class="skeleton h-12 w-full"></div>`)
                .join("")}
            </div>
          </div>
        </section>
      `;
    }
  
    function buildCards(stats, monthly) {
      const prevMonthValue = (() => {
        if (!monthly || !Array.isArray(monthly.months)) return null;
        const m = Number(state.month);
        const idx = state.month === "all" ? monthly.months.length - 1 : m - 1;
        if (idx < 1 || !monthly.months[idx - 1]) return null;
        return monthly.months[idx - 1].total_issued || 0;
      })();
  
      const change = percentChange(stats.total_issued || 0, prevMonthValue || 0);
      const changeLabel =
        change === null ? "–" : `${change > 0 ? "+" : ""}${change}% vs praėjusį mėnesį`;
      const changeColor =
        change > 0 ? "text-green-600" : change < 0 ? "text-ordinn-red" : "text-graphite-steel/60";
  
      const cards = [
        {
          title: "Išrašytos sąskaitos",
          icon: "file-text",
          value: fmtCurrency(stats.total_issued || 0),
          change: changeLabel,
          changeCls: changeColor,
        },
        {
          title: "Gauti mokėjimai",
          icon: "check-circle",
          value: fmtCurrency(stats.total_received || 0),
          change: "+",
          changeCls: "text-green-600",
        },
        {
          title: "Neapmokėtos sąskaitos",
          icon: "alert-circle",
          value: fmtCurrency(stats.total_unpaid || 0),
          change: "",
          changeCls: "text-ordinn-red",
        },
        {
          title: "Grynasis pelnas",
          icon: "trending-up",
          value: fmtCurrency(stats.net_profit || 0),
          change: "",
          changeCls: "text-graphite-steel/60",
        },
      ];
  
      return `
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          ${cards
            .map(
              (card) => `
            <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm hover:shadow-lg transition-shadow">
              <div class="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <p class="text-sm font-medium text-graphite-steel/70">${card.title}</p>
                ${withIcon(card.icon, "h-4 w-4 text-graphite-steel/40")}
              </div>
              <div class="px-4 pb-4">
                <div class="text-2xl font-bold text-graphite-steel">${card.value}</div>
                ${
                  card.change !== ""
                    ? `<p class="text-xs text-graphite-steel/60 mt-1"><span class="${card.changeCls}">${card.change}</span></p>`
                    : ""
                }
              </div>
            </div>`
            )
            .join("")}
        </section>
      `;
    }
  
    function buildSelectors() {
      const yearOptions = YEARS.map(
        (y) => `<option value="${y}" ${y === state.year ? "selected" : ""}>${y}</option>`
      ).join("");
      const monthOptions = MONTHS.map(
        (m) => `<option value="${m.value}" ${String(m.value) === String(state.month) ? "selected" : ""}>${m.label}</option>`
      ).join("");
  
      return `
        <div class="flex gap-4 items-center">
          <select id="dashboard-year" class="input-field w-32 h-10">
            ${yearOptions}
          </select>
          <select id="dashboard-month" class="input-field w-40 h-10">
            ${monthOptions}
          </select>
        </div>
      `;
    }
  
    function buildChart(monthly) {
      const canvas = root.querySelector("#monthlyChart");
      if (!canvas || typeof Chart === "undefined") return;
  
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
  
      const isAll = state.month === "all";
      const monthMeta = MONTHS.find((m) => String(m.value) === String(state.month));
      const datasetMonths =
        isAll || !monthly?.months?.length
          ? monthly.months
          : monthly.months.filter(
              (m) =>
                m.month === state.month ||
                m.month_number === state.month ||
                (m.month_name && monthMeta && m.month_name.toLowerCase() === monthMeta.label.toLowerCase())
            );

      const monthsForChart = datasetMonths && datasetMonths.length ? datasetMonths : monthly.months;
      const labels = monthsForChart.map((m) => m.month_name);
      const issued = monthsForChart.map((m) => m.total_issued || 0);
      const received = monthsForChart.map((m) => m.total_received || 0);
      const unpaid = monthsForChart.map((m) => m.total_unpaid || 0);
      const trend = monthsForChart.map((m) => m.total_received || 0);
  
      state.chart = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Išrašytos",
              data: issued,
              backgroundColor: "#CD1C1840",
              borderColor: "#CD1C18",
              borderWidth: 1,
              borderRadius: 6,
            },
            {
              label: "Gauti mokėjimai",
              data: received,
              backgroundColor: "#10B981",
              borderColor: "#059669",
              borderWidth: 1,
              borderRadius: 6,
            },
            {
              label: "Neapmokėtos",
              data: unpaid,
              backgroundColor: "#CD1C18",
              borderColor: "#CD1C18",
              borderWidth: 1,
              borderRadius: 6,
            },
            {
              label: "Tendencija",
              data: trend,
              type: "line",
              borderColor: "#2C3E50",
              borderWidth: 2,
              pointRadius: 3,
              tension: 0.35,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "bottom", labels: { color: "#2C3E50" } },
            tooltip: {
              backgroundColor: "#FFFFFF",
              titleColor: "#2C3E50",
              bodyColor: "#2C3E50",
              borderColor: "#E0E5EC",
              borderWidth: 1,
              displayColors: true,
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y)}`,
              },
              padding: 12,
              boxPadding: 6,
            },
          },
          scales: {
            x: {
              ticks: { color: "#2C3E50" },
              grid: { display: false },
            },
            y: {
              ticks: {
                color: "#2C3E50",
                callback: (value) => fmtCurrency(value).replace(" €", ""),
              },
              grid: { color: "rgba(44,62,80,0.08)" },
            },
          },
        },
      });
    }
  
    function buildActivity(activity) {
      if (!activity || activity.length === 0) {
        return `
          <div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ghost-concrete p-6 text-center bg-ghost-concrete/20">
            <div class="h-14 w-14 rounded-full bg-ghost-concrete flex items-center justify-center">
              ${withIcon("inbox", "h-6 w-6 text-graphite-steel/50")}
            </div>
            <p class="text-graphite-steel/60">Šiuo metu nėra veiklos.</p>
          </div>
        `;
      }
  
      const rows = activity
        .map((item) => {
          const meta = STATUS_META[item.status] || {
            label: item.status || "Nežinoma",
            cls: "bg-ghost-concrete text-graphite-steel",
          };
          return `
          <tr class="cursor-pointer hover:bg-ghost-concrete/30">
            <td class="px-4 py-3 text-sm text-graphite-steel/80">${fmtDate(item.invoice_date)}</td>
            <td class="px-4 py-3 text-sm text-graphite-steel">${item.client_name || "–"}</td>
            <td class="px-4 py-3 text-sm font-medium text-graphite-steel">${item.number || "–"}</td>
            <td class="px-4 py-3 text-sm text-right text-graphite-steel">${fmtCurrency(item.amount)}</td>
            <td class="px-4 py-3 text-sm">
              <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}">
                ${meta.label}
              </span>
            </td>
          </tr>`;
        })
        .join("");
  
      return `
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-ghost-concrete text-graphite-steel">
              <tr>
                <th class="px-4 py-3 text-left">Data</th>
                <th class="px-4 py-3 text-left">Klientas</th>
                <th class="px-4 py-3 text-left">Numeris</th>
                <th class="px-4 py-3 text-right">Suma</th>
                <th class="px-4 py-3 text-left">Statusas</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ghost-concrete">
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }
  
    function renderDashboard(stats, monthly, activity) {
      root.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 class="text-2xl font-semibold text-graphite-steel">Sąskaitų apžvalga</h2>
            <p class="text-sm text-graphite-steel/70">Sekite išrašytas, gautas ir neapmokėtas sąskaitas.</p>
          </div>
          ${buildSelectors()}
        </div>

        ${buildCards(stats, monthly)}

        <section class="grid gap-6 lg:grid-cols-2">
          <div class="lg:col-span-2">
            <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
              <div class="p-4 border-b border-ghost-concrete">
                <p class="text-lg font-semibold text-graphite-steel">Metų statistika</p>
                <p class="text-sm text-graphite-steel/70">${stats.year} m. apžvalga</p>
              </div>
              <div class="p-4">
                <div class="h-80">
                  <canvas id="monthlyChart" class="w-full h-full"></canvas>
                </div>
              </div>
            </div>
          </div>

          <div class="lg:col-span-2 bg-white border border-ghost-concrete rounded-lg shadow-sm">
            <div class="p-4 border-b border-ghost-concrete">
              <p class="text-lg font-semibold text-graphite-steel">Paskutinė veikla</p>
              <p class="text-sm text-graphite-steel/70">Naujausios sąskaitos ir būsenos.</p>
            </div>
            <div class="p-2">
              ${buildActivity(activity)}
            </div>
          </div>
        </section>
      `;
  
      root.querySelector("#dashboard-year")?.addEventListener("change", (e) => {
        state.year = Number(e.target.value);
        loadData();
      });
      root.querySelector("#dashboard-month")?.addEventListener("change", (e) => {
        const val = e.target.value;
        state.month = val === "all" ? "all" : Number(val);
        loadData();
      });
  
      renderIcons();
      buildChart(monthly);
    }
  
    async function loadData() {
      renderSkeleton();
      try {
        const [stats, monthly, activity] = await Promise.all([
          api.getDashboardStatistics(state.year, state.month === "all" ? null : state.month),
          api.getMonthlyData(state.year),
          api.getRecentActivity(),
        ]);
        renderDashboard(stats, monthly, activity || []);
      } catch (err) {
        console.error("Dashboard load failed", err);
        root.innerHTML = `
          <div class="bg-ordinn-red/5 border border-ordinn-red/20 text-ordinn-red rounded-lg p-4 space-y-2">
            <div class="flex items-center gap-2">
              ${withIcon("alert-octagon", "h-5 w-5")}
              <p class="font-semibold">Nepavyko užkrauti duomenų</p>
            </div>
            <p class="text-sm">Patikrinkite ryšį ir bandykite dar kartą.</p>
            <button id="dashboard-retry" class="btn-ghost inline-flex items-center gap-2">
              ${withIcon("rotate-cw", "h-4 w-4")}
              Bandyti dar kartą
            </button>
          </div>
        `;
        root.querySelector("#dashboard-retry")?.addEventListener("click", loadData);
      }
    }
  
    document.addEventListener("DOMContentLoaded", loadData);
  })();