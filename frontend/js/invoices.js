(function () {
  const root = document.getElementById("invoices-root");
  if (!root || typeof window.api === "undefined") return;

  const STATUS_META = {
    draft: { label: "Juodraštis", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700" },
    sent: { label: "Išsiųsta", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700" },
    paid: { label: "Apmokėta", dot: "bg-green-600", badge: "bg-green-100 text-green-700" },
    overdue: { label: "Vėluojama", dot: "bg-ordinn-red", badge: "bg-ordinn-red/10 text-ordinn-red" },
    default: { label: "Nežinoma", dot: "bg-graphite-steel", badge: "bg-ghost-concrete text-graphite-steel" },
  };

  const UNIT_OPTIONS = ["vnt", "val", "kg", "komplektas", "diena"];
  const SORT_OPTIONS = [
    { value: "-date", label: "Data (naujausios)" },
    { value: "date", label: "Data (seniausios)" },
    { value: "-number", label: "Numeris (didelis → mažas)" },
    { value: "number", label: "Numeris (mažas → didelis)" },
    { value: "-total", label: "Suma (didelė → maža)" },
    { value: "total", label: "Suma (maža → didelė)" },
    { value: "status", label: "Statusas" },
  ];

  const state = {
    filters: {
      search: "",
      status: "all",
      dateFrom: "",
      dateTo: "",
      seriesId: "",
      sortBy: "-date",
    },
    pagination: { page: 1, limit: 10, total: 0 },
    invoices: [],
    grouped: [],
    summary: { invoice_count: 0, total_invoiced: 0, total_paid: 0, total_unpaid: 0 },
    clients: [],
    series: [],
    bankAccounts: [],
    company: null,
    loading: false,
    listLoading: false,
    detailCache: new Map(),
    openedRows: new Set(),
    modalMode: "create",
    form: createEmptyForm(),
  };

  const els = {};
  let toastContainer = null;
  let modalKeydownHandler = null;
  let lastFocusedElement = null;
  const focusableSelector =
    'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const getFocusable = () =>
    Array.from(els.modal?.root?.querySelectorAll(focusableSelector) || []).filter(
      (el) => el.offsetParent !== null && !el.hasAttribute("disabled")
    );

  const trapModalFocus = (event) => {
    if (event.key !== "Tab" || !els.modal?.root || els.modal.root.classList.contains("hidden")) return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first || document.activeElement === els.modal.root) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function createEmptyForm() {
    const today = new Date();
    const due = new Date(today);
    due.setDate(today.getDate() + 5);
    return {
      id: null,
      series_id: "",
      invoice_number: "",
      invoice_date: today.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      client_id: "",
      clientSearch: "",
      status: "draft",
      bank_account_id: "",
      items: [{ description: "", unit: "vnt", quantity: 1, price: 0, discount: 0 }],
      description: "",
      notes: "",
      issuer: "",
      receiver: "",
      addNote: false,
      addComment: false,
      comment: "",
      showAllTotals: true,
      additionalDiscountEnabled: false,
      additionalDiscount: 0,
      addBank: false,
      newBank: { bank_name: "", account_number: "", is_default: false },
      updateCompanyToggle: false,
      addNewClient: false,
      newClient: { company_name: "", registration_code: "", address: "", vat_code: "", phone: "", email: "" },
      attachments: [],
      showSignature: false,
      allowESign: true,
    };
  }

  const fmtCurrency = (num) =>
    `${new Intl.NumberFormat("lt-LT", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(num || 0))}`;

  const fmtDate = (value, opts = { year: "numeric", month: "long", day: "numeric" }) => {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString("lt-LT", opts);
  };

  const renderIcons = () => {
    if (window.lucide && window.lucide.icons) {
      window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide" });
    }
  };

  function showToast(type, message) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.id = "invoice-toast";
      toastContainer.className = "fixed top-4 right-4 z-50 space-y-2";
      document.body.appendChild(toastContainer);
    }
    const colors =
      type === "error"
        ? "toast toast-error"
        : type === "info"
        ? "toast toast-info"
        : "toast toast-success";
    const el = document.createElement("div");
    el.className = `${colors} flex items-start gap-3`;
    el.innerHTML = `
      <div class="pt-0.5">${icon(type === "error" ? "alert-octagon" : type === "info" ? "info" : "check-circle")}</div>
      <div class="text-sm">${message}</div>
    `;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4200);
    renderIcons();
  }

  const confirmDialog = (message) => window.confirm(message);
  const icon = (name) => `<i data-lucide="${name}" class="h-4 w-4"></i>`;

  function calculateLineTotal(quantity, price, discount, extraDiscount = 0) {
    const qty = Number(quantity) || 0;
    const unitPrice = Number(price) || 0;
    const base = qty * unitPrice;
    const percent = Math.min(100, Math.max(0, (Number(discount) || 0) + (Number(extraDiscount) || 0)));
    const total = base - (base * percent) / 100;
    return Math.max(0, Number.isFinite(total) ? total : 0);
  }

  function calculateInvoiceTotal(items) {
    const extra = state.form.additionalDiscountEnabled ? Number(state.form.additionalDiscount) || 0 : 0;
    let subtotal = 0;
    let discountValue = 0;
    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const base = qty * price;
      const percent = Math.min(100, Math.max(0, (Number(item.discount) || 0) + extra));
      const lineTotal = calculateLineTotal(qty, price, percent, 0);
      subtotal += lineTotal;
      discountValue += base - lineTotal;
    });
    return { subtotal, discount: discountValue, total: subtotal };
  }

  function groupInvoicesByMonth(invoices) {
    const groups = new Map();
    invoices.forEach((inv) => {
      const dateValue = inv.invoice_date || inv.created_at || new Date().toISOString();
      const date = new Date(dateValue);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: fmtDate(date, { year: "numeric", month: "long" }),
          invoices: [],
          totalIssued: 0,
          totalUnpaid: 0,
        });
      }
      const group = groups.get(key);
      group.invoices.push(inv);
      const total = Number(inv.total || 0);
      group.totalIssued += total;
      group.totalUnpaid += inv.status === "paid" ? 0 : total;
    });
    return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  function buildLayout() {
    root.innerHTML = `
      <section class="bg-white border border-ghost-concrete rounded-lg shadow-sm p-4 space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <div class="relative">
              <input id="invoice-search" class="input-field pl-9 w-64" placeholder="Paieška: klientas ar numeris">
              <div class="absolute left-3 top-2.5 text-graphite-steel/40 pointer-events-none">${icon("search")}</div>
            </div>
            <select id="invoice-status" class="input-field w-40">
              <option value="all">Visi statusai</option>
              <option value="draft">Juodraštis</option>
              <option value="sent">Išsiųsta</option>
              <option value="paid">Apmokėta</option>
              <option value="overdue">Vėluojama</option>
            </select>
            <div class="flex items-center gap-2">
              <input type="date" id="invoice-date-from" class="input-field w-40" />
              <span class="text-sm text-graphite-steel/60">–</span>
              <input type="date" id="invoice-date-to" class="input-field w-40" />
            </div>
            <select id="invoice-series" class="input-field w-40">
              <option value="">Visos serijos</option>
            </select>
            <select id="invoice-sort" class="input-field w-48">
              ${SORT_OPTIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="invoice-summary" class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"></div>
      </section>
      <section class="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div class="flex items-center gap-2 flex-wrap">
          <button id="invoice-export" class="btn-secondary">
            ${icon("download")} Eksportuoti
          </button>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="invoice-create" class="btn-primary whitespace-nowrap">
            ${icon("plus")} Nauja sąskaita
          </button>
        </div>
      </section>
      <section id="invoice-list" class="space-y-4"></section>
      <section id="invoice-pagination" class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"></section>
    `;

    els.search = root.querySelector("#invoice-search");
    els.status = root.querySelector("#invoice-status");
    els.dateFrom = root.querySelector("#invoice-date-from");
    els.dateTo = root.querySelector("#invoice-date-to");
    els.seriesFilter = root.querySelector("#invoice-series");
    els.sort = root.querySelector("#invoice-sort");
    els.list = root.querySelector("#invoice-list");
    els.pagination = root.querySelector("#invoice-pagination");
    els.summary = root.querySelector("#invoice-summary");

    let searchTimer;
    els.search.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        state.pagination.page = 1;
        loadInvoices();
      }, 250);
    });
    els.status.addEventListener("change", (e) => {
      state.filters.status = e.target.value;
      state.pagination.page = 1;
      loadInvoices();
    });
    els.dateFrom.addEventListener("change", (e) => {
      state.filters.dateFrom = e.target.value;
      state.pagination.page = 1;
      loadInvoices();
    });
    els.dateTo.addEventListener("change", (e) => {
      state.filters.dateTo = e.target.value;
      state.pagination.page = 1;
      loadInvoices();
    });
    els.seriesFilter.addEventListener("change", (e) => {
      state.filters.seriesId = e.target.value;
      state.pagination.page = 1;
      loadInvoices();
    });
    els.sort.addEventListener("change", (e) => {
      state.filters.sortBy = e.target.value;
      state.pagination.page = 1;
      loadInvoices();
    });

    root.querySelector("#invoice-export").addEventListener("click", exportInvoices);
    root.querySelector("#invoice-create").addEventListener("click", () => openModal("create"));
    root.addEventListener("click", handleListClick);
  }

  async function loadReferenceData() {
    try {
      const [clientsRes, series, bankAccounts, company] = await Promise.all([
        api.getClients({ limit: 100 }),
        api.getInvoiceSeries(),
        api.getBankAccounts(),
        api.getCompanyInfo(),
      ]);
      state.clients = clientsRes?.clients || [];
      state.series = series || [];
      state.bankAccounts = bankAccounts || [];
      state.company = company || null;
      renderFilterOptions();
    } catch (error) {
      console.error("Nepavyko užkrauti pagalbinių duomenų", error);
      showToast("error", error?.message || "Nepavyko užkrauti nustatymų.");
    }
  }

  function renderFilterOptions() {
    if (els.seriesFilter) {
      const options =
        `<option value="">Visos serijos</option>` +
        state.series.map((s) => `<option value="${s.id}">${s.series_code}</option>`).join("");
      els.seriesFilter.innerHTML = options;
    }
  }

  async function loadInvoices(filters = {}) {
    state.listLoading = true;
    renderSkeleton();
    try {
      const params = {
        limit: state.pagination.limit,
        offset: (state.pagination.page - 1) * state.pagination.limit,
        sort_by: state.filters.sortBy,
        ...filters,
      };
      if (state.filters.status && state.filters.status !== "all") params.status = state.filters.status;
      if (state.filters.seriesId) params.series_id = state.filters.seriesId;
      if (state.filters.dateFrom) params.date_from = state.filters.dateFrom;
      if (state.filters.dateTo) params.date_to = state.filters.dateTo;

      const res = await api.getInvoices(params);
      let list = res?.invoices || [];
      if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        list = list.filter(
          (i) =>
            i.number?.toLowerCase().includes(term) ||
            i.client_name?.toLowerCase().includes(term) ||
            i.series_code?.toLowerCase().includes(term)
        );
      }

      state.summary = res?.summary || state.summary;
      state.pagination.total = res?.total || list.length || 0;
      state.invoices = list;
      state.grouped = groupInvoicesByMonth(list);
      renderSummary();
      renderInvoicesList();
      renderPagination();
      renderIcons();
    } catch (error) {
      console.error("Klaida kraunant sąskaitas", error);
      els.list.innerHTML = `
        <div class="bg-ordinn-red/5 border border-ordinn-red/20 text-ordinn-red rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">${icon("alert-octagon")} <p class="font-semibold">Nepavyko užkrauti sąskaitų</p></div>
          <p class="text-sm">Patikrinkite interneto ryšį ir bandykite dar kartą.</p>
          <button class="btn-secondary" id="invoice-retry">Bandyti iš naujo</button>
        </div>`;
      els.list.querySelector("#invoice-retry")?.addEventListener("click", () => loadInvoices());
      showToast("error", error?.message || "Nepavyko užkrauti sąskaitų.");
    } finally {
      state.listLoading = false;
    }
  }

  function renderSkeleton() {
    if (!els.list) return;
    const skeletonCards = Array.from({ length: 2 })
      .map(
        () => `
        <div class="card-shell p-4 space-y-3">
          <div class="flex justify-between items-center">
            <div class="skeleton h-5 w-40"></div>
            <div class="skeleton h-5 w-24"></div>
          </div>
          <div class="space-y-2">
            ${["", "", ""]
              .map(
                () => `
              <div class="grid grid-cols-8 gap-2 items-center">
                <div class="skeleton h-5 w-full col-span-2"></div>
                <div class="skeleton h-5 w-full col-span-2"></div>
                <div class="skeleton h-5 w-full col-span-1"></div>
                <div class="skeleton h-5 w-full col-span-1"></div>
                <div class="skeleton h-5 w-full col-span-1"></div>
                <div class="skeleton h-5 w-full col-span-1"></div>
              </div>`
              )
              .join("")}
          </div>
        </div>`
      )
      .join("");
    els.list.innerHTML = skeletonCards;
  }

  function renderSummary() {
    if (!els.summary) return;
    const cards = [
      { label: "Išrašyta", value: fmtCurrency(state.summary.total_invoiced || 0), icon: "file-text" },
      { label: "Apmokėta", value: fmtCurrency(state.summary.total_paid || 0), icon: "check-circle" },
      { label: "Neapmokėta", value: fmtCurrency(state.summary.total_unpaid || 0), icon: "alert-triangle" },
      { label: "Sąskaitų sk.", value: state.summary.invoice_count || 0, icon: "list" },
    ];
    els.summary.innerHTML = cards
                .map(
        (c) => `
        <div class="card-shell p-3 flex items-center justify-between">
          <div>
            <p class="text-xs uppercase tracking-wide text-graphite-steel/60">${c.label}</p>
            <p class="text-lg font-semibold text-graphite-steel">${c.value}</p>
          </div>
          <div class="h-10 w-10 rounded-full bg-ghost-concrete flex items-center justify-center text-graphite-steel/60">
            ${icon(c.icon)}
          </div>
        </div>`
                )
                .join("");
  }

  function renderInvoicesList() {
    if (!els.list) return;
    if (!state.grouped.length) {
      els.list.innerHTML = `
        <div class="bg-ghost-concrete/40 border border-dashed border-ghost-concrete rounded-lg p-6 text-center">
          <p class="text-graphite-steel font-medium">Dar nėra sąskaitų.</p>
          <p class="text-sm text-graphite-steel/70 mt-1">Sukurkite pirmąją sąskaitą ir stebėkite jos būseną.</p>
          <button class="btn-primary mt-4" id="invoice-empty-create">${icon("plus")} Nauja sąskaita</button>
        </div>`;
      els.list.querySelector("#invoice-empty-create")?.addEventListener("click", () => openModal("create"));
      return;
    }

    const content = state.grouped
      .map((group) => {
        const rows = group.invoices
          .map((inv) => {
            const meta = STATUS_META[inv.status] || STATUS_META.default;
            const isOpen = state.openedRows.has(inv.id);
            const actionsMenuId = `menu-${inv.id}`;
            return `
              <tbody class="divide-y divide-ghost-concrete">
                <tr class="table-row align-top" data-invoice-row="${inv.id}">
                  <td class="px-3 py-3">
                    <button data-expand="${inv.id}" class="btn-ghost h-9 w-9 p-0" aria-label="Išskleisti">
                      <i data-lucide="${isOpen ? "chevron-up" : "chevron-down"}" class="h-4 w-4"></i>
                    </button>
                  </td>
                  <td class="px-3 py-3 text-sm text-graphite-steel/90">${fmtDate(inv.invoice_date)}</td>
                  <td class="px-3 py-3">
                    <div class="inline-flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full ${meta.dot}"></span>
                      <span class="badge ${meta.badge}">${meta.label}</span>
                    </div>
                  </td>
                  <td class="px-3 py-3 text-sm text-graphite-steel/90">Sąskaita faktūra</td>
                  <td class="px-3 py-3 text-sm font-semibold text-graphite-steel">${inv.series_code || "–"} ${inv.invoice_number ?? ""}</td>
                  <td class="px-3 py-3 text-sm text-graphite-steel">${inv.client_name || "—"}</td>
                  <td class="px-3 py-3 text-right text-sm font-semibold text-graphite-steel">${fmtCurrency(inv.total)}</td>
                  <td class="px-3 py-3 text-right">
                    <div class="relative inline-block text-left" data-menu-wrapper="${actionsMenuId}">
                      <button class="btn-ghost h-9 w-9 p-0" data-menu-trigger="${actionsMenuId}" aria-label="Veiksmai">
                        <i data-lucide="more-vertical" class="h-4 w-4"></i>
                      </button>
                      <div class="hidden absolute right-0 mt-2 w-48 rounded-md border border-ghost-concrete bg-white shadow-lg z-20" data-menu-panel="${actionsMenuId}">
                        <div class="py-1 text-sm text-graphite-steel">
                          <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="view" data-id="${inv.id}">${icon("eye")} Peržiūrėti / redaguoti</button>
                          <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="download" data-id="${inv.id}">${icon("download")} Atsisiųsti PDF</button>
                          <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="duplicate" data-id="${inv.id}">${icon("copy")} Dubliuoti</button>
                          <div class="border-t border-ghost-concrete my-1"></div>
                          <div class="px-3 py-2">
                            <p class="text-xs text-graphite-steel/60 mb-2">Keisti statusą</p>
                            <div class="grid grid-cols-2 gap-2">
                              ${["draft", "sent", "paid", "overdue"]
                                .map(
                                  (st) => `<button class="btn-secondary h-9 text-xs" data-action="status" data-status="${st}" data-id="${inv.id}">${STATUS_META[st]?.label || st}</button>`
                                )
                                .join("")}
                            </div>
                          </div>
                          <div class="border-t border-ghost-concrete my-1"></div>
                          <button class="w-full text-left px-3 py-2 text-ordinn-red hover:bg-ghost-concrete/50" data-action="delete" data-id="${inv.id}">${icon("trash")} Ištrinti</button>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
                ${
                  isOpen
                    ? `<tr class="bg-ghost-concrete/20">
                        <td colspan="8" class="px-6 py-4">
                          ${renderInvoiceDetails(inv)}
                        </td>
                      </tr>`
                    : ""
                }
              </tbody>
            `;
          })
          .join("");
        return `
          <div class="card-shell p-4 space-y-3">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div class="flex flex-wrap items-center gap-3">
                <p class="text-lg font-semibold text-graphite-steel capitalize">${group.label}</p>
                <span class="badge badge-success">Išrašyta: ${fmtCurrency(group.totalIssued)}</span>
                <span class="badge badge-error">Neapmokėta: ${fmtCurrency(group.totalUnpaid)}</span>
              </div>
              <p class="text-sm text-graphite-steel/60">${group.invoices.length} sąskaitos</p>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="table-head">
                  <tr>
                    <th class="px-3 py-2 text-left w-12"></th>
                    <th class="px-3 py-2 text-left">Data</th>
                    <th class="px-3 py-2 text-left">Statusas</th>
                    <th class="px-3 py-2 text-left">Tipas</th>
                    <th class="px-3 py-2 text-left">Serija / Nr.</th>
                    <th class="px-3 py-2 text-left">Klientas</th>
                    <th class="px-3 py-2 text-right">Suma</th>
                    <th class="px-3 py-2 text-right w-12"></th>
                  </tr>
                </thead>
                ${rows}
              </table>
            </div>
          </div>
        `;
      })
      .join("");
    els.list.innerHTML = content;
  }

  function renderInvoiceDetails(inv) {
    const full = state.detailCache.get(inv.id);
    if (!full) {
      fetchInvoiceDetails(inv.id);
      return `<div class="text-sm text-graphite-steel/70">Kraunama...</div>`;
    }
    const items = full.items
      .map(
        (item) => `
          <div class="flex justify-between text-sm text-graphite-steel/90">
            <div class="flex-1">
              <p class="font-medium">${item.description}</p>
              <p class="text-xs text-graphite-steel/60">${item.quantity} ${item.unit} × ${fmtCurrency(item.unit_price)} (${item.discount_percent || 0}% nuolaida)</p>
            </div>
            <div class="font-semibold">${fmtCurrency(item.line_total)}</div>
          </div>`
      )
      .join("");
    return `
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <p class="text-sm font-semibold text-graphite-steel">Klientas</p>
          <p class="text-sm text-graphite-steel/80">${full.client?.company_name || inv.client_name || "—"}</p>
          <p class="text-xs text-graphite-steel/60">${full.client?.address || ""}</p>
          <p class="text-xs text-graphite-steel/60">${full.client?.email || ""} ${full.client?.phone ? " • " + full.client.phone : ""}</p>
          <p class="text-xs text-graphite-steel/60">Serija: ${full.series?.series_code || inv.series_code || "—"}</p>
        </div>
        <div class="space-y-2">
          <p class="text-sm font-semibold text-graphite-steel">Suma</p>
          <p class="text-lg font-semibold text-graphite-steel">${fmtCurrency(full.total)}</p>
          <p class="text-xs text-graphite-steel/60">Išrašyta: ${fmtDate(full.invoice_date)} • Terminas: ${fmtDate(full.due_date)}</p>
        </div>
      </div>
      <div class="mt-3 space-y-2">
        <p class="text-sm font-semibold text-graphite-steel">Eilutės</p>
        <div class="space-y-2">${items}</div>
      </div>
      ${full.notes ? `<p class="mt-3 text-sm text-graphite-steel/80">Pastabos: ${full.notes}</p>` : ""}
    `;
  }

  async function fetchInvoiceDetails(id) {
    try {
      const full = await api.getInvoice(id);
      state.detailCache.set(id, full);
      renderInvoicesList();
      renderIcons();
    } catch (error) {
      console.error("Nepavyko gauti sąskaitos detalių", error);
      showToast("error", error?.message || "Nepavyko gauti sąskaitos duomenų.");
    }
  }

  function renderPagination() {
    if (!els.pagination) return;
    const totalPages = Math.max(1, Math.ceil((state.pagination.total || 0) / state.pagination.limit));
    const page = Math.min(state.pagination.page, totalPages);
    state.pagination.page = page;
    els.pagination.innerHTML = `
      <div class="text-sm text-graphite-steel/70">Rodoma ${(page - 1) * state.pagination.limit + 1}-${Math.min(
      page * state.pagination.limit,
      state.pagination.total
    )} iš ${state.pagination.total}</div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary h-9 px-3" data-page="prev" ${page <= 1 ? "disabled" : ""}>${icon("chevron-left")} Atgal</button>
        <span class="text-sm text-graphite-steel">Puslapis ${page} / ${totalPages}</span>
        <button class="btn-secondary h-9 px-3" data-page="next" ${page >= totalPages ? "disabled" : ""}>Pirmyn ${icon("chevron-right")}</button>
      </div>
    `;
    els.pagination.querySelector("[data-page='prev']")?.addEventListener("click", () => {
      if (state.pagination.page > 1) {
        state.pagination.page -= 1;
        loadInvoices();
      }
    });
    els.pagination.querySelector("[data-page='next']")?.addEventListener("click", () => {
      if (state.pagination.page < totalPages) {
        state.pagination.page += 1;
            loadInvoices();
      }
    });
  }

  function handleListClick(event) {
    const expandId = event.target.closest?.("[data-expand]")?.dataset.expand;
    if (expandId) {
      const idNum = Number(expandId);
      if (state.openedRows.has(idNum)) state.openedRows.delete(idNum);
      else state.openedRows.add(idNum);
      renderInvoicesList();
      renderIcons();
      return;
    }

    const trigger = event.target.closest?.("[data-menu-trigger]");
    if (trigger) {
      const id = trigger.dataset.menuTrigger;
      const panel = root.querySelector(`[data-menu-panel="${id}"]`);
      panel?.classList.toggle("hidden");
      document.addEventListener(
        "click",
        (e) => {
          if (!panel?.contains(e.target) && e.target !== trigger) {
            panel?.classList.add("hidden");
          }
        },
        { once: true }
      );
    }

    const actionBtn = event.target.closest?.("[data-action]");
    if (actionBtn) {
      const id = Number(actionBtn.dataset.id);
      const action = actionBtn.dataset.action;
      if (action === "view") openModal("edit", id);
      if (action === "download") downloadInvoicePDF(id);
      if (action === "duplicate") duplicateInvoice(id);
      if (action === "delete") deleteInvoice(id);
      if (action === "status") changeInvoiceStatus(id, actionBtn.dataset.status);
    }
  }

  function addLineItem() {
    state.form.items.push({ description: "", unit: "vnt", quantity: 1, price: 0, discount: 0 });
    renderLineItems();
    updateTotals();
  }

  function removeLineItem(index) {
    state.form.items.splice(index, 1);
    if (!state.form.items.length) {
      state.form.items.push({ description: "", unit: "vnt", quantity: 1, price: 0, discount: 0 });
    }
    renderLineItems();
    updateTotals();
  }

  function renderLineItems() {
    const m = els.modal;
    if (!m?.lineItemsBody) return;
    const tbody = m.lineItemsBody;
    tbody.innerHTML = state.form.items
      .map(
        (item, idx) => `
        <tr class="border-b border-ghost-concrete align-top" data-line-index="${idx}">
          <td class="px-2 py-2">
            <input class="input-field" data-line-field="description" value="${item.description || ""}" placeholder="Pavadinimas">
          </td>
          <td class="px-2 py-2">
            <select class="input-field" data-line-field="unit">
              ${UNIT_OPTIONS.map((u) => `<option value="${u}" ${u === item.unit ? "selected" : ""}>${u}</option>`).join("")}
            </select>
          </td>
          <td class="px-2 py-2">
            <input type="number" step="0.001" min="0" class="input-field" data-line-field="quantity" value="${item.quantity || 0}">
          </td>
          <td class="px-2 py-2">
            <input type="number" step="0.01" min="0" class="input-field" data-line-field="price" value="${item.price || 0}">
          </td>
          <td class="px-2 py-2">
            <input type="number" step="0.01" min="0" max="100" class="input-field" data-line-field="discount" value="${item.discount || 0}">
          </td>
          <td class="px-2 py-2 text-right">
            <div class="text-sm font-semibold text-graphite-steel" data-line-total>${fmtCurrency(
              calculateLineTotal(item.quantity, item.price, item.discount, state.form.additionalDiscountEnabled ? state.form.additionalDiscount : 0)
            )}</div>
          </td>
          <td class="px-2 py-2 text-right">
            <button type="button" class="btn-ghost h-9 w-9 p-0" data-remove-line aria-label="Pašalinti eilutę">
              ${icon("trash")}
            </button>
          </td>
        </tr>`
      )
      .join("");
  }

  function updateTotals() {
    const m = els.modal;
    if (!m) return;
    const totals = calculateInvoiceTotal(state.form.items);
    const subtotalEl = m.totalsBox?.querySelector('[data-total="subtotal"]');
    const discountEl = m.totalsBox?.querySelector('[data-total="discount"]');
    const totalEl = m.totalsBox?.querySelector('[data-total="total"]');
    if (m.totalsBox) {
      m.totalsBox.classList.toggle("hidden", !state.form.showAllTotals);
    }
    if (subtotalEl) subtotalEl.textContent = fmtCurrency(totals.subtotal);
    if (discountEl) discountEl.textContent = fmtCurrency(totals.discount);
    if (totalEl) totalEl.textContent = fmtCurrency(totals.total);

    m.lineItemsBody?.querySelectorAll("tr").forEach((row, idx) => {
      const item = state.form.items[idx];
      const target = row.querySelector("[data-line-total]");
      if (target) {
        target.textContent = fmtCurrency(
          calculateLineTotal(item.quantity, item.price, item.discount, state.form.additionalDiscountEnabled ? state.form.additionalDiscount : 0)
        );
      }
    });
  }

  function renderClientDetails() {
    const container = els.modal?.clientDetails;
    if (!container) return;
    const client = state.clients.find((c) => String(c.id) === String(state.form.client_id));
    if (!client) {
      container.innerHTML = `<p class="text-sm text-graphite-steel/70">Klientas nepasirinktas.</p>`;
      return;
    }
    container.innerHTML = `
      <p class="text-sm font-semibold text-graphite-steel">${client.company_name}</p>
      <p class="text-xs text-graphite-steel/70">${client.address || "Adresas nenurodytas"}</p>
      <p class="text-xs text-graphite-steel/60">Įmonės kodas: ${client.registration_code || "—"} ${client.vat_code ? " • PVM: " + client.vat_code : ""}</p>
      <p class="text-xs text-graphite-steel/60">${client.email || ""} ${client.phone ? " • " + client.phone : ""}</p>
    `;
  }

  function renderClientSuggestions(term) {
    const container = els.modal?.clientSuggestions;
    if (!container) return;
    const trimmed = term.trim().toLowerCase();
    if (!trimmed) {
      container.innerHTML = "";
      return;
    }
    const matches = state.clients
      .filter(
        (c) =>
          c.company_name?.toLowerCase().includes(trimmed) ||
          c.registration_code?.toLowerCase().includes(trimmed) ||
          c.vat_code?.toLowerCase().includes(trimmed)
      )
      .slice(0, 5);
    container.innerHTML = matches
      .map(
        (c) => `
          <button type="button" class="w-full text-left px-3 py-2 bg-white border border-ghost-concrete rounded-md hover:bg-ghost-concrete/40 transition" data-select-client="${c.id}">
            <p class="text-sm font-medium text-graphite-steel">${c.company_name}</p>
            <p class="text-xs text-graphite-steel/60">${c.registration_code || ""} ${c.vat_code ? " • " + c.vat_code : ""}</p>
          </button>`
      )
      .join("");
  }

  function renderAttachments() {
    const list = els.modal?.attachmentsList;
    if (!list) return;
    if (!state.form.attachments.length) {
      list.innerHTML = `<p class="text-xs text-graphite-steel/60">Failai nepasirinkti. Maks. 10 MB.</p>`;
      return;
    }
    list.innerHTML = state.form.attachments
      .map((file) => `<li class="text-sm text-graphite-steel flex items-center gap-2">${icon("paperclip")} ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</li>`)
      .join("");
  }

  function buildModalShell() {
    const modal = document.createElement("div");
    modal.id = "invoice-modal";
    modal.className = "fixed inset-0 z-50 hidden";
    modal.tabIndex = -1;
    modal.innerHTML = `
      <div class="absolute inset-0 bg-graphite-steel/60 backdrop-blur-sm" data-invoice-overlay="true"></div>
      <div class="relative z-10 flex min-h-full items-center justify-center px-4 py-6">
        <div class="bg-white border border-ghost-concrete rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col" role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ghost-concrete">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Sąskaitų kūrimas</p>
              <h3 id="invoice-modal-title" class="text-lg font-semibold text-graphite-steel">Nauja sąskaita</h3>
            </div>
            <button class="btn-ghost h-10 w-10 p-0" id="invoice-modal-close" aria-label="Uždaryti">${icon("x")}</button>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <form id="invoice-form" class="space-y-6">
              <section class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label class="space-y-1 text-sm">
                  <span class="text-graphite-steel">Serija</span>
                  <select id="form-series" class="input-field"></select>
                </label>
                <label class="space-y-1 text-sm">
                  <span class="text-graphite-steel">Numeris</span>
                  <input id="form-number" class="input-field bg-ghost-concrete/60" readonly>
                </label>
                <label class="space-y-1 text-sm">
                  <span class="text-graphite-steel">Išrašymo data</span>
                  <input type="date" id="form-date" class="input-field">
                </label>
                <label class="space-y-1 text-sm">
                  <span class="text-graphite-steel">Apmokėjimo terminas</span>
                  <input type="date" id="form-due" class="input-field">
                </label>
              </section>

              <section class="grid gap-4 lg:grid-cols-2">
                <div class="card-shell p-4 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-semibold text-graphite-steel">Pardavėjas</p>
                      <p class="text-xs text-graphite-steel/70">Įmonės duomenys iš nustatymų</p>
                    </div>
                  </div>
                  <div id="seller-info" class="space-y-1 text-sm text-graphite-steel/80"></div>
                  <label class="space-y-1 text-sm">
                    <span>Banko sąskaita</span>
                    <select id="form-bank" class="input-field"></select>
                  </label>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-new-bank" class="h-4 w-4 text-ordinn-red">
                    <span>Pridėti naują banko sąskaitą</span>
                  </label>
                  <div id="new-bank-fields" class="grid gap-3 md:grid-cols-2 hidden">
                    <input class="input-field" data-new-bank="bank_name" placeholder="Banko pavadinimas">
                    <input class="input-field" data-new-bank="account_number" placeholder="Sąskaitos numeris">
                    <label class="flex items-center gap-2 text-sm md:col-span-2">
                      <input type="checkbox" class="h-4 w-4" data-new-bank="is_default">
                      <span>Nustatyti kaip numatytąją</span>
                    </label>
                  </div>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-company-update" class="h-4 w-4 text-ordinn-red">
                    <span>Atnaujinti veiklos informaciją nustatymuose</span>
                  </label>
                </div>

                <div class="card-shell p-4 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-semibold text-graphite-steel">Pirkėjas</p>
                      <p class="text-xs text-graphite-steel/70">Pasirinkite klientą arba pridėkite naują</p>
                    </div>
                    <button type="button" class="btn-secondary h-9 text-xs" id="toggle-new-client">${icon("user-plus")} Naujas klientas</button>
                  </div>
                  <label class="space-y-1 text-sm">
                    <span>Klientas</span>
                    <select id="form-client" class="input-field"></select>
                  </label>
                  <label class="space-y-1 text-sm">
                    <span>Paieška</span>
                    <input id="form-client-search" class="input-field" placeholder="Įveskite pavadinimą, kodą ar PVM">
                  </label>
                  <div id="client-suggestions" class="space-y-2"></div>
                  <div id="client-details" class="bg-ghost-concrete/40 border border-ghost-concrete rounded-lg p-3 text-sm"></div>
                  <div id="new-client-form" class="hidden space-y-3">
                    <div class="grid gap-3 md:grid-cols-2">
                      <input class="input-field" data-new-client="company_name" placeholder="Įmonės pavadinimas" required>
                      <input class="input-field" data-new-client="registration_code" placeholder="Įmonės kodas" required>
                      <input class="input-field" data-new-client="vat_code" placeholder="PVM kodas (pasirinktinai)">
                      <input class="input-field" data-new-client="email" type="email" placeholder="El. paštas">
                      <input class="input-field" data-new-client="phone" placeholder="Telefonas">
                      <input class="input-field md:col-span-2" data-new-client="address" placeholder="Adresas" required>
                    </div>
                    <button type="button" class="btn-primary" id="save-new-client">${icon("save")} Išsaugoti klientą ir parinkti</button>
                  </div>
                </div>
              </section>

              <section class="card-shell p-4 space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-semibold text-graphite-steel">Prekės / paslaugos</p>
                    <p class="text-xs text-graphite-steel/70">Skaičiavimai atsinaujina realiu laiku</p>
                  </div>
                  <button type="button" class="btn-secondary h-9" id="add-line">${icon("plus")} Pridėti prekę/paslaugą</button>
                </div>
                <div class="overflow-x-auto">
                  <table class="min-w-full text-sm">
                    <thead class="table-head">
                      <tr>
                        <th class="px-2 py-2 text-left">Pavadinimas</th>
                        <th class="px-2 py-2 text-left w-24">Matas</th>
                        <th class="px-2 py-2 text-left w-28">Kiekis</th>
                        <th class="px-2 py-2 text-left w-32">Kaina</th>
                        <th class="px-2 py-2 text-left w-28">Nuolaida %</th>
                        <th class="px-2 py-2 text-right w-32">Iš viso</th>
                        <th class="px-2 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody id="line-items-body"></tbody>
                  </table>
                </div>
                <label class="space-y-1 text-sm">
                  <span>Aprašymas</span>
                  <textarea id="line-description" rows="3" class="input-field" placeholder="Papildoma informacija apie prekes / paslaugas"></textarea>
                </label>
              </section>

              <section class="grid gap-4 lg:grid-cols-2">
                <div class="card-shell p-4 space-y-3">
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-totals" class="h-4 w-4" checked>
                    <span>Rodyti visus bendrus rodiklius sąskaitoje</span>
                  </label>
                  <div class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-extra-discount" class="h-4 w-4">
                    <span>Papildoma nuolaida</span>
                    <input type="number" id="extra-discount" class="input-field w-24" min="0" max="100" step="0.1" disabled value="0">
                    <span class="text-graphite-steel/70">% visoms eilutėms</span>
                  </div>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-note" class="h-4 w-4">
                    <span>Pridėti pastabą klientui</span>
                  </label>
                  <textarea id="form-notes" class="input-field hidden" rows="3" placeholder="Pastaba klientui"></textarea>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="toggle-comment" class="h-4 w-4">
                    <span>Pridėti vidinį komentarą</span>
                  </label>
                  <textarea id="form-comment" class="input-field hidden" rows="2" placeholder="Komentaras tik vidiniam naudojimui"></textarea>
                  <div class="flex flex-wrap gap-3 text-sm">
                    <label class="flex items-center gap-2">
                      <input type="checkbox" id="toggle-signature" class="h-4 w-4">
                      <span>Elektroninis parašas</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <input type="checkbox" id="toggle-esign" class="h-4 w-4" checked>
                      <span>Gauti kliento patvirtinimą el. paštu</span>
                    </label>
                  </div>
                </div>

                <div class="card-shell p-4 space-y-3" id="totals-box">
                  <div class="flex items-center justify-between text-sm text-graphite-steel/80">
                    <span>Tarpinė suma</span>
                    <span data-total="subtotal" class="font-semibold text-graphite-steel">€0,00</span>
                  </div>
                  <div class="flex items-center justify-between text-sm text-graphite-steel/80">
                    <span>Nuolaidos</span>
                    <span data-total="discount" class="font-semibold text-graphite-steel">€0,00</span>
                  </div>
                  <div class="border-t border-ghost-concrete pt-3 flex items-center justify-between text-lg font-semibold">
                    <span>Viso</span>
                    <span data-total="total" class="text-ordinn-red">€0,00</span>
                  </div>
                </div>
              </section>

              <section class="card-shell p-4 space-y-3">
                <div class="grid gap-3 md:grid-cols-2">
                  <label class="space-y-1 text-sm">
                    <span>Išrašė</span>
                    <input id="form-issuer" class="input-field" placeholder="Vardas, pareigos">
                  </label>
                  <label class="space-y-1 text-sm">
                    <span>Gavėjas / atsakingas</span>
                    <input id="form-receiver" class="input-field" placeholder="Gavėjas arba atsakingas asmuo">
                  </label>
                </div>
                <div class="border border-dashed border-ghost-concrete rounded-lg p-4 bg-ghost-concrete/20">
                  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p class="text-sm font-semibold text-graphite-steel">Prisegti dokumentus</p>
                      <p class="text-xs text-graphite-steel/60">Maks. 10 MB, PDF ar vaizdo failai</p>
                    </div>
                    <div class="space-x-2">
                      <input id="form-attachments" type="file" multiple class="hidden" />
                      <button type="button" class="btn-secondary h-9" id="trigger-attachments">${icon("paperclip")} Pasirinkti failus</button>
                    </div>
                  </div>
                  <ul id="attachments-list" class="mt-3 space-y-2 text-sm"></ul>
                </div>
              </section>
            </form>
          </div>
          <div class="border-t border-ghost-concrete px-6 py-4 flex flex-wrap items-center justify-end gap-2">
            <button class="btn-ghost" id="modal-cancel">Atšaukti</button>
            <button class="btn-secondary" id="modal-draft">Išsaugoti kaip juodraštį</button>
            <button class="btn-secondary" id="modal-send">Sukurti ir išsiųsti</button>
            <button class="btn-primary" id="modal-save">Išsaugoti sąskaitą</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.setAttribute("aria-hidden", "true");
    modal.addEventListener("click", (event) => {
      if (event.target?.dataset?.invoiceOverlay === "true") {
        closeModal();
      }
    });

    els.modal = {
      root: modal,
      title: modal.querySelector("#invoice-modal-title"),
      close: modal.querySelector("#invoice-modal-close"),
      form: modal.querySelector("#invoice-form"),
      series: modal.querySelector("#form-series"),
      number: modal.querySelector("#form-number"),
      date: modal.querySelector("#form-date"),
      due: modal.querySelector("#form-due"),
      bank: modal.querySelector("#form-bank"),
      toggleNewBank: modal.querySelector("#toggle-new-bank"),
      newBankFields: modal.querySelector("#new-bank-fields"),
      toggleCompanyUpdate: modal.querySelector("#toggle-company-update"),
      clientSelect: modal.querySelector("#form-client"),
      clientSearch: modal.querySelector("#form-client-search"),
      clientSuggestions: modal.querySelector("#client-suggestions"),
      clientDetails: modal.querySelector("#client-details"),
      toggleNewClient: modal.querySelector("#toggle-new-client"),
      newClientForm: modal.querySelector("#new-client-form"),
      saveNewClient: modal.querySelector("#save-new-client"),
      lineItemsBody: modal.querySelector("#line-items-body"),
      addLine: modal.querySelector("#add-line"),
      lineDescription: modal.querySelector("#line-description"),
      toggleTotals: modal.querySelector("#toggle-totals"),
      toggleExtraDiscount: modal.querySelector("#toggle-extra-discount"),
      extraDiscount: modal.querySelector("#extra-discount"),
      toggleNote: modal.querySelector("#toggle-note"),
      notes: modal.querySelector("#form-notes"),
      toggleComment: modal.querySelector("#toggle-comment"),
      comment: modal.querySelector("#form-comment"),
      toggleSignature: modal.querySelector("#toggle-signature"),
      toggleESign: modal.querySelector("#toggle-esign"),
      issuer: modal.querySelector("#form-issuer"),
      receiver: modal.querySelector("#form-receiver"),
      attachments: modal.querySelector("#form-attachments"),
      triggerAttachments: modal.querySelector("#trigger-attachments"),
      attachmentsList: modal.querySelector("#attachments-list"),
      totalsBox: modal.querySelector("#totals-box"),
      sellerInfo: modal.querySelector("#seller-info"),
      modalDraft: modal.querySelector("#modal-draft"),
      modalSend: modal.querySelector("#modal-send"),
      modalSave: modal.querySelector("#modal-save"),
      modalCancel: modal.querySelector("#modal-cancel"),
    };
  }

  function hydrateFormFields() {
    const m = els.modal;
    if (!m) return;
    m.title.textContent = state.modalMode === "edit" ? "Redaguoti sąskaitą" : "Nauja sąskaita";
    m.series.innerHTML =
      `<option value="">Pasirinkite seriją</option>` +
      state.series.map((s) => `<option value="${s.id}" ${String(s.id) === String(state.form.series_id) ? "selected" : ""}>${s.series_code}</option>`).join("");
    m.number.value = state.form.invoice_number || "Bus parinktas automatiškai";
    m.date.value = state.form.invoice_date || "";
    m.due.value = state.form.due_date || "";
    m.bank.innerHTML =
      `<option value="">Pasirinkite sąskaitą</option>` +
      state.bankAccounts.map((b) => `<option value="${b.id}" ${String(b.id) === String(state.form.bank_account_id) ? "selected" : ""}>${b.bank_name} ${b.account_number}</option>`).join("");
    m.toggleNewBank.checked = state.form.addBank;
    m.newBankFields.classList.toggle("hidden", !state.form.addBank);
    m.toggleCompanyUpdate.checked = state.form.updateCompanyToggle;
    m.clientSelect.innerHTML =
      `<option value="">Pasirinkite klientą</option>` +
      state.clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(state.form.client_id) ? "selected" : ""}>${c.company_name}</option>`).join("");
    m.clientSearch.value = state.form.clientSearch || "";
    m.newClientForm.classList.toggle("hidden", !state.form.addNewClient);
    m.toggleNewClient.textContent = state.form.addNewClient ? "Atšaukti" : "Naujas klientas";
    m.lineDescription.value = state.form.description || "";
    m.toggleTotals.checked = !!state.form.showAllTotals;
    m.toggleExtraDiscount.checked = !!state.form.additionalDiscountEnabled;
    m.extraDiscount.disabled = !state.form.additionalDiscountEnabled;
    m.extraDiscount.value = state.form.additionalDiscount || 0;
    m.toggleNote.checked = !!state.form.addNote;
    m.notes.classList.toggle("hidden", !state.form.addNote);
    m.notes.value = state.form.notes || "";
    m.toggleComment.checked = !!state.form.addComment;
    m.comment.classList.toggle("hidden", !state.form.addComment);
    m.comment.value = state.form.comment || "";
    m.toggleSignature.checked = !!state.form.showSignature;
    m.toggleESign.checked = !!state.form.allowESign;
    m.issuer.value = state.form.issuer || "";
    m.receiver.value = state.form.receiver || "";

    if (state.company) {
      m.sellerInfo.innerHTML = `
        <p class="font-semibold">${state.company.company_name || "—"}</p>
        <p>${state.company.address || "Adresas nenurodytas"}</p>
        <p class="text-xs text-graphite-steel/70">Mokesčių ID: ${state.company.tax_id || "—"}</p>
        <p class="text-xs text-graphite-steel/70">${state.company.email || ""} ${state.company.phone ? "• " + state.company.phone : ""}</p>
      `;
    }

    renderClientDetails();
    renderClientSuggestions(state.form.clientSearch || "");
    renderLineItems();
    renderAttachments();
    updateTotals();
  }

  function attachModalEvents() {
    const m = els.modal;
    if (!m) return;
    m.close.addEventListener("click", closeModal);
    m.modalCancel.addEventListener("click", closeModal);
    m.form.addEventListener("submit", (e) => e.preventDefault());

    m.series.addEventListener("change", async (e) => {
      state.form.series_id = e.target.value;
      if (state.form.series_id && state.modalMode === "create") {
        await updateNextInvoiceNumber(state.form.series_id);
      }
    });
    m.date.addEventListener("change", (e) => {
      state.form.invoice_date = e.target.value;
      if (!state.form.due_date || new Date(state.form.due_date) < new Date(state.form.invoice_date)) {
        const due = new Date(state.form.invoice_date);
        due.setDate(due.getDate() + 5);
        state.form.due_date = due.toISOString().slice(0, 10);
        m.due.value = state.form.due_date;
      }
    });
    m.due.addEventListener("change", (e) => (state.form.due_date = e.target.value));
    m.bank.addEventListener("change", (e) => (state.form.bank_account_id = e.target.value));
    m.toggleNewBank.addEventListener("change", (e) => {
      state.form.addBank = e.target.checked;
      m.newBankFields.classList.toggle("hidden", !state.form.addBank);
    });
    m.newBankFields.addEventListener("input", (e) => {
      const key = e.target.dataset.newBank;
      if (!key) return;
      state.form.newBank[key] = key === "is_default" ? e.target.checked : e.target.value;
    });
    m.toggleCompanyUpdate.addEventListener("change", (e) => (state.form.updateCompanyToggle = e.target.checked));

    m.clientSelect.addEventListener("change", (e) => {
      state.form.client_id = e.target.value;
      renderClientDetails();
    });
    m.clientSearch.addEventListener("input", (e) => {
      state.form.clientSearch = e.target.value;
      renderClientSuggestions(e.target.value);
    });
    m.clientSuggestions.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-select-client]");
      if (!btn) return;
      state.form.client_id = btn.dataset.selectClient;
      m.clientSelect.value = state.form.client_id;
      renderClientDetails();
      renderClientSuggestions("");
      m.clientSearch.value = "";
    });
    m.toggleNewClient.addEventListener("click", () => {
      state.form.addNewClient = !state.form.addNewClient;
      m.newClientForm.classList.toggle("hidden", !state.form.addNewClient);
      m.toggleNewClient.textContent = state.form.addNewClient ? "Atšaukti" : "Naujas klientas";
    });
    m.saveNewClient.addEventListener("click", saveNewClient);

    m.addLine.addEventListener("click", addLineItem);
    m.lineItemsBody.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-line]")) {
        const idx = Number(e.target.closest("tr")?.dataset.lineIndex);
        removeLineItem(idx);
      }
    });
    m.lineItemsBody.addEventListener("input", (e) => {
      const row = e.target.closest("tr");
      if (!row) return;
      const idx = Number(row.dataset.lineIndex);
      const field = e.target.dataset.lineField;
      if (field) {
        state.form.items[idx][field] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
        updateTotals();
      }
    });

    m.lineDescription.addEventListener("input", (e) => (state.form.description = e.target.value));
    m.toggleTotals.addEventListener("change", (e) => {
      state.form.showAllTotals = e.target.checked;
      updateTotals();
    });
    m.toggleExtraDiscount.addEventListener("change", (e) => {
      state.form.additionalDiscountEnabled = e.target.checked;
      m.extraDiscount.disabled = !e.target.checked;
      updateTotals();
    });
    m.extraDiscount.addEventListener("input", (e) => {
      state.form.additionalDiscount = Number(e.target.value) || 0;
      updateTotals();
    });
    m.toggleNote.addEventListener("change", (e) => {
      state.form.addNote = e.target.checked;
      m.notes.classList.toggle("hidden", !e.target.checked);
    });
    m.notes.addEventListener("input", (e) => (state.form.notes = e.target.value));
    m.toggleComment.addEventListener("change", (e) => {
      state.form.addComment = e.target.checked;
      m.comment.classList.toggle("hidden", !e.target.checked);
    });
    m.comment.addEventListener("input", (e) => (state.form.comment = e.target.value));
    m.toggleSignature.addEventListener("change", (e) => (state.form.showSignature = e.target.checked));
    m.toggleESign.addEventListener("change", (e) => (state.form.allowESign = e.target.checked));
    m.issuer.addEventListener("input", (e) => (state.form.issuer = e.target.value));
    m.receiver.addEventListener("input", (e) => (state.form.receiver = e.target.value));

    m.triggerAttachments.addEventListener("click", () => m.attachments.click());
    m.attachments.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []).filter((f) => f.size <= 10 * 1024 * 1024);
      if (files.length !== (e.target.files || []).length) {
        showToast("info", "Kai kurie failai viršijo 10 MB ir nebuvo pridėti.");
      }
      state.form.attachments = files;
      renderAttachments();
    });

    m.modalDraft.addEventListener("click", () => handleSubmit("draft"));
    m.modalSend.addEventListener("click", () => handleSubmit("send"));
    m.modalSave.addEventListener("click", () => handleSubmit("save"));
  }

  function closeModal() {
    els.modal?.root.classList.add("hidden");
    els.modal?.root.setAttribute("aria-hidden", "true");
    if (modalKeydownHandler) {
      document.removeEventListener("keydown", modalKeydownHandler);
      modalKeydownHandler = null;
    }
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  async function openModal(mode = "create", invoiceId = null) {
    lastFocusedElement = document.activeElement;
    state.modalMode = mode;
    state.form = createEmptyForm();
    if (mode === "edit" && invoiceId) {
      try {
        const inv = await api.getInvoice(invoiceId);
        state.form = {
          ...state.form,
          id: inv.id,
          series_id: inv.series_id,
          invoice_number: inv.invoice_number || inv.number,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          client_id: inv.client_id,
          status: inv.status,
          notes: inv.notes || "",
          description: "",
          issuer: inv.issued_by || "",
          receiver: inv.received_by || "",
          items: (inv.items || []).map((item) => ({
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            price: item.unit_price,
            discount: item.discount_percent,
          })),
        };
      } catch (error) {
        console.error("Nepavyko atidaryti sąskaitos", error);
        showToast("error", error?.message || "Nepavyko atidaryti sąskaitos.");
        return;
      }
    } else if (mode === "create" && state.series.length === 1) {
      state.form.series_id = state.series[0].id;
      await updateNextInvoiceNumber(state.form.series_id);
    }
    hydrateFormFields();
    els.modal.root.classList.remove("hidden");
    els.modal.root.setAttribute("aria-hidden", "false");
    modalKeydownHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
      trapModalFocus(e);
    };
    document.addEventListener("keydown", modalKeydownHandler);
    const focusable = getFocusable();
    if (focusable.length) {
      focusable[0].focus();
    } else {
      els.modal.root.focus();
    }
    renderIcons();
  }

  async function updateNextInvoiceNumber(seriesId) {
    if (!seriesId) return;
    try {
      const res = await api.getNextInvoiceNumber(seriesId);
      state.form.invoice_number = res?.full_number || res?.next_number || "";
      if (els.modal?.number) els.modal.number.value = state.form.invoice_number;
    } catch (error) {
      console.error("Nepavyko gauti numerio", error);
    }
  }

  async function saveNewClient() {
    const data = { ...state.form.newClient };
    if (!data.company_name || !data.registration_code || !data.address) {
      showToast("error", "Įrašykite privalomus naujo kliento laukus.");
      return;
    }
    try {
      const created = await api.createClient(data);
      state.clients.unshift(created);
      state.form.client_id = created.id;
      state.form.addNewClient = false;
      if (els.modal) {
        els.modal.newClientForm.classList.add("hidden");
        els.modal.clientSelect.innerHTML =
          `<option value="">Pasirinkite klientą</option>` +
          state.clients.map((c) => `<option value="${c.id}" ${c.id === created.id ? "selected" : ""}>${c.company_name}</option>`).join("");
      }
      renderClientDetails();
      showToast("success", "Klientas sėkmingai sukurtas ir priskirtas.");
    } catch (error) {
      console.error("Nepavyko sukurti kliento", error);
      showToast("error", error?.message || "Nepavyko sukurti kliento.");
    }
  }

  function validateInvoiceForm() {
    const errors = [];
    if (!state.form.series_id) errors.push("Pasirinkite sąskaitų seriją.");
    if (!state.form.client_id) errors.push("Pasirinkite klientą.");
    if (!state.form.invoice_date) errors.push("Įveskite išrašymo datą.");
    if (!state.form.due_date) errors.push("Įveskite apmokėjimo terminą.");
    if (state.form.invoice_date && state.form.due_date && new Date(state.form.due_date) < new Date(state.form.invoice_date)) {
      errors.push("Terminas negali būti ankstesnis nei išrašymo data.");
    }
    const validItems = state.form.items.filter((i) => i.description && Number(i.quantity) > 0);
    if (!validItems.length) errors.push("Pridėkite bent vieną eilutę su kiekiu.");
    return errors;
  }

  async function handleSubmit(intent) {
    const errors = validateInvoiceForm();
    if (errors.length) {
      showToast("error", errors.join(" "));
      return;
    }

    let clientId = state.form.client_id;
    if (!clientId && state.form.addNewClient) {
      const data = state.form.newClient;
      if (data.company_name && data.registration_code && data.address) {
        try {
          const created = await api.createClient(data);
          state.clients.unshift(created);
          clientId = created.id;
          state.form.client_id = clientId;
        } catch (error) {
          showToast("error", "Nepavyko sukurti kliento.");
          return;
        }
      }
    }

    if (state.form.addBank && (state.form.newBank.bank_name || state.form.newBank.account_number)) {
      try {
        const createdBank = await api.createBankAccount({
          bank_name: state.form.newBank.bank_name,
          account_number: state.form.newBank.account_number,
          is_default: !!state.form.newBank.is_default,
        });
        state.bankAccounts.unshift(createdBank);
        state.form.bank_account_id = createdBank.id;
      } catch (error) {
        showToast("error", "Nepavyko pridėti banko sąskaitos.");
        return;
      }
    }

    const payload = {
      client_id: Number(clientId),
      series_id: Number(state.form.series_id),
      invoice_date: state.form.invoice_date,
      due_date: state.form.due_date,
      notes: state.form.addNote ? state.form.notes : "",
      issued_by: state.form.issuer,
      received_by: state.form.receiver,
      items: state.form.items.map((item, idx) => {
        const extra = state.form.additionalDiscountEnabled ? Number(state.form.additionalDiscount) || 0 : 0;
        const discount = Math.min(100, Math.max(0, Number(item.discount) || 0) + extra);
        return {
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.price) || 0,
          discount_percent: discount,
          unit: item.unit || "vnt",
          sort_order: idx,
        };
      }),
    };

    if (state.modalMode === "create") {
      payload.status = intent === "draft" ? "draft" : "sent";
      await createInvoice(payload);
    } else if (state.modalMode === "edit" && state.form.id) {
      await editInvoice(state.form.id, payload, intent);
    }
  }

  async function createInvoice(payload) {
    try {
      await api.createInvoice(payload);
      showToast("success", "Sąskaita sukurta.");
      closeModal();
      loadInvoices();
    } catch (error) {
      console.error("Nepavyko sukurti sąskaitos", error);
      showToast("error", error?.message || "Nepavyko sukurti sąskaitos.");
    }
  }

  async function editInvoice(id, payload, intent) {
    try {
      await api.updateInvoice(id, payload);
      if (intent === "send" && state.form.status !== "sent") {
        await changeInvoiceStatus(id, "sent", { silent: true });
      }
      showToast("success", "Sąskaita atnaujinta.");
      closeModal();
      loadInvoices();
    } catch (error) {
      console.error("Nepavyko atnaujinti sąskaitos", error);
      showToast("error", error?.message || "Nepavyko atnaujinti sąskaitos.");
    }
  }

  async function deleteInvoice(id) {
    const ok = await confirmDialog("Ar tikrai norite ištrinti sąskaitą?");
    if (!ok) return;
    try {
      await api.deleteInvoice(id);
      showToast("success", "Sąskaita ištrinta.");
      loadInvoices();
    } catch (error) {
      console.error("Nepavyko ištrinti", error);
      showToast("error", error?.message || "Nepavyko ištrinti sąskaitos.");
    }
  }

  async function downloadInvoicePDF(id) {
    try {
      const blob = await api.getInvoicePDF(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Nepavyko parsisiųsti PDF", error);
      showToast("error", error?.message || "Nepavyko parsisiųsti PDF.");
    }
  }

  async function duplicateInvoice(id) {
    try {
      await api.duplicateInvoice(id);
      showToast("success", "Sąskaita dubliuota.");
      loadInvoices();
    } catch (error) {
      console.error("Nepavyko dubliuoti", error);
      showToast("error", error?.message || "Nepavyko dubliuoti sąskaitos.");
    }
  }

  async function changeInvoiceStatus(id, newStatus, options = {}) {
    const ok = options.silent || (await confirmDialog("Keisti sąskaitos statusą?"));
    if (!ok) return;
    try {
      await api.updateInvoiceStatus(id, newStatus);
      showToast("success", "Statusas atnaujintas.");
      loadInvoices();
    } catch (error) {
      console.error("Nepavyko pakeisti statuso", error);
      showToast("error", error?.message || "Nepavyko pakeisti statuso.");
    }
  }

  async function openInvoiceForClient(clientId) {
    if (!clientId) return;
    if (!state.clients.length || !state.series.length || !state.bankAccounts.length) {
      await loadReferenceData();
    }
    openModal("create");
    state.form.client_id = String(clientId);
    hydrateFormFields();
  }

  function exportInvoices() {
    if (!state.invoices.length) {
      showToast("info", "Nėra duomenų eksportui.");
      return;
    }
    const header = ["Data", "Numeris", "Serija", "Klientas", "Statusas", "Suma"];
    const rows = state.invoices.map((i) => [
      fmtDate(i.invoice_date),
      i.invoice_number ?? i.number,
      i.series_code || "",
      i.client_name || "",
      STATUS_META[i.status]?.label || i.status || "",
      Number(i.total || 0).toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoices.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function init() {
    buildLayout();
    buildModalShell();
    hydrateFormFields();
    attachModalEvents();
    document.addEventListener("open-invoice-for-client", (event) => {
      const clientId = event.detail?.clientId;
      if (clientId) openInvoiceForClient(clientId);
    });
    loadReferenceData().then(() => loadInvoices());
  }

  document.addEventListener("DOMContentLoaded", init);

  // Expose for debugging in console if needed
  window.invoiceUI = {
    loadInvoices,
    createInvoice,
    editInvoice,
    deleteInvoice,
    downloadInvoicePDF,
    duplicateInvoice,
    changeInvoiceStatus,
    calculateLineTotal,
    calculateInvoiceTotal,
    addLineItem,
    removeLineItem,
    validateInvoiceForm,
    groupInvoicesByMonth,
    openInvoiceForClient,
  };
})();
