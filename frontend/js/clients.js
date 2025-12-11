// Klientų modulio UI ir logika: sąrašas, paieška, filtrai, modalai ir
// išplėstinės detalės. Atitinka dizaino sistemą (Tailwind + shadcn/ui).
(function () {
  const root = document.getElementById("clients-root");
  if (!root || typeof window.api === "undefined") return;

  const TYPE_META = {
    client: { label: "Klientas", badge: "bg-blue-100 text-blue-700" },
    supplier: { label: "Tiekėjas", badge: "bg-amber-100 text-amber-700" },
    default: { label: "Nežinomas", badge: "bg-ghost-concrete text-graphite-steel" },
  };
  const STATUS_META = {
    paid: { label: "Apmokėta", cls: "bg-green-100 text-green-700" },
    overdue: { label: "Vėluojama", cls: "bg-ordinn-red/10 text-ordinn-red" },
    sent: { label: "Išsiųsta", cls: "bg-blue-100 text-blue-700" },
    draft: { label: "Juodraštis", cls: "bg-amber-100 text-amber-700" },
    default: { label: "Nežinoma", cls: "bg-ghost-concrete text-graphite-steel" },
  };
  const SORT_OPTIONS = [
    { value: "name", label: "Pavadinimas (A–Z)" },
    { value: "-name", label: "Pavadinimas (Z–A)" },
    { value: "-total_invoiced", label: "Išrašyta (didelė → maža)" },
    { value: "total_invoiced", label: "Išrašyta (maža → didelė)" },
    { value: "-total_unpaid", label: "Neapmokėta (didelė → maža)" },
    { value: "total_unpaid", label: "Neapmokėta (maža → didelė)" },
  ];

  const state = {
    filters: { search: "", clientType: "all", sortBy: "name" },
    pagination: { page: 1, limit: 8, total: 0 },
    clients: [],
    expanded: new Set(),
    cache: new Map(),
    selectedId: null,
    detailTab: "info",
    modalMode: "create",
    form: createEmptyForm(),
    listLoading: false,
    inlineEditing: null,
  };

  const els = {};
  let toastContainer = null;
  let searchTimer;

  const icon = (name, cls = "") => `<i data-lucide="${name}" class="h-4 w-4 ${cls}"></i>`;
  const renderIcons = () => {
    if (window.lucide && window.lucide.icons) {
      window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide" });
    }
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

  function createEmptyForm() {
    return {
      id: null,
      company_name: "",
      registration_code: "",
      vat_code: "",
      address: "",
      phone: "",
      email: "",
      client_type: "client",
      notes: "",
    };
  }

  function showToast(type, message) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.id = "clients-toast";
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
    el.innerHTML = `<div class="pt-0.5">${icon(
      type === "error" ? "alert-octagon" : type === "info" ? "info" : "check-circle"
    )}</div><div class="text-sm">${message}</div>`;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4200);
    renderIcons();
  }

  function buildLayout() {
    root.innerHTML = `
      <section class="bg-white border border-ghost-concrete rounded-lg shadow-sm p-4 space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 class="text-2xl font-semibold text-graphite-steel">Klientai</h2>
            <p class="text-sm text-graphite-steel/70">Stebėkite klientus, sąskaitas ir greitai kurkite naujas.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button id="clients-export" class="btn-secondary h-10 px-4">
              ${icon("download")} Eksportuoti
            </button>
            <button id="clients-create" class="btn-primary h-10 px-4">
              ${icon("plus")} Naujas klientas
            </button>
          </div>
        </div>
        <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div class="relative md:col-span-2">
            <input id="clients-search" class="input-field w-full pl-10" placeholder="Paieška: pavadinimas ar įmonės kodas">
            <div class="absolute left-3 top-2.5 text-graphite-steel/40 pointer-events-none">${icon("search")}</div>
          </div>
          <select id="clients-type" class="input-field">
            <option value="all">Visi tipai</option>
            <option value="client">Klientas</option>
            <option value="supplier">Tiekėjas</option>
          </select>
          <select id="clients-sort" class="input-field">
            ${SORT_OPTIONS.map((s) => `<option value="${s.value}" ${s.value === state.filters.sortBy ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>
      </section>
      <section id="clients-list" class="space-y-3 mt-4"></section>
      <section id="clients-pagination" class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2"></section>
      <section id="client-detail" class="hidden mt-6"></section>
    `;

    els.search = root.querySelector("#clients-search");
    els.type = root.querySelector("#clients-type");
    els.sort = root.querySelector("#clients-sort");
    els.list = root.querySelector("#clients-list");
    els.pagination = root.querySelector("#clients-pagination");
    els.detail = root.querySelector("#client-detail");

    root.querySelector("#clients-create")?.addEventListener("click", () => openModal("create"));
    root.querySelector("#clients-export")?.addEventListener("click", exportClients);

    els.search.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchClients(e.target.value.trim()), 250);
    });
    els.type.addEventListener("change", (e) => {
      state.filters.clientType = e.target.value;
      state.pagination.page = 1;
      loadClients();
    });
    els.sort.addEventListener("change", (e) => {
      state.filters.sortBy = e.target.value;
      state.pagination.page = 1;
      loadClients();
    });

    root.addEventListener("click", handleRootClick);
  }

  function buildModal() {
    const modal = document.createElement("div");
    modal.id = "client-modal";
    modal.className = "fixed inset-0 z-50 hidden";
    modal.innerHTML = `
      <div class="absolute inset-0 bg-graphite-steel/60 backdrop-blur-sm"></div>
      <div class="relative z-10 flex min-h-full items-center justify-center px-4 py-6">
        <div class="bg-white border border-ghost-concrete rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ghost-concrete">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Kliento kortelė</p>
              <h3 id="client-modal-title" class="text-lg font-semibold text-graphite-steel">Naujas klientas</h3>
            </div>
            <button class="btn-ghost h-10 w-10 p-0" id="client-modal-close" aria-label="Uždaryti">${icon("x")}</button>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <form id="client-form" class="space-y-4">
              <div id="client-form-errors" class="hidden bg-ordinn-red/5 border border-ordinn-red/30 text-ordinn-red rounded-lg p-3 text-sm"></div>
              <div class="grid gap-3 md:grid-cols-2">
                <label class="space-y-1 text-sm">
                  <span>Įmonės pavadinimas *</span>
                  <input name="company_name" class="input-field" required placeholder="UAB Pavyzdys">
                </label>
                <label class="space-y-1 text-sm">
                  <span>Įmonės kodas *</span>
                  <input name="registration_code" class="input-field" required placeholder="123456789">
                </label>
                <label class="space-y-1 text-sm">
                  <span>PVM kodas</span>
                  <input name="vat_code" class="input-field" placeholder="LT123456789">
                </label>
                <label class="space-y-1 text-sm">
                  <span>El. paštas *</span>
                  <input name="email" type="email" class="input-field" required placeholder="info@imone.lt">
                </label>
                <label class="space-y-1 text-sm">
                  <span>Telefonas</span>
                  <input name="phone" class="input-field" placeholder="+3706...">
                </label>
                <div class="space-y-2 text-sm">
                  <span>Kliento tipas *</span>
                  <div class="flex items-center gap-4">
                    <label class="inline-flex items-center gap-2">
                      <input type="radio" name="client_type" value="client" class="h-4 w-4" checked>
                      <span>Klientas</span>
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input type="radio" name="client_type" value="supplier" class="h-4 w-4">
                      <span>Tiekėjas</span>
                    </label>
                  </div>
                </div>
                <label class="space-y-1 text-sm md:col-span-2">
                  <span>Adresas *</span>
                  <textarea name="address" rows="3" class="input-field" required placeholder="Gatvė, miestas, šalis"></textarea>
                </label>
                <label class="space-y-1 text-sm md:col-span-2">
                  <span>Pastabos</span>
                  <textarea name="notes" rows="3" class="input-field" placeholder="Papildoma informacija (neprivaloma)"></textarea>
                </label>
              </div>
            </form>
          </div>
          <div class="border-t border-ghost-concrete px-6 py-4 flex items-center justify-end gap-2">
            <button class="btn-ghost" id="client-modal-cancel">Atšaukti</button>
            <button class="btn-primary" id="client-modal-save">${icon("save")} Išsaugoti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    els.modal = {
      root: modal,
      title: modal.querySelector("#client-modal-title"),
      form: modal.querySelector("#client-form"),
      close: modal.querySelector("#client-modal-close"),
      cancel: modal.querySelector("#client-modal-cancel"),
      save: modal.querySelector("#client-modal-save"),
      errors: modal.querySelector("#client-form-errors"),
    };

    els.modal.close.addEventListener("click", closeModal);
    els.modal.cancel.addEventListener("click", closeModal);
    els.modal.save.addEventListener("click", handleModalSubmit);
    els.modal.form.addEventListener("input", syncFormFromInputs);
    els.modal.form.addEventListener("submit", (e) => e.preventDefault());
  }

  function syncFormFromInputs() {
    if (!els.modal?.form) return;
    const formData = new FormData(els.modal.form);
    state.form = {
      ...state.form,
      company_name: formData.get("company_name")?.trim() || "",
      registration_code: formData.get("registration_code")?.trim() || "",
      vat_code: formData.get("vat_code")?.trim() || "",
      address: formData.get("address")?.trim() || "",
      phone: formData.get("phone")?.trim() || "",
      email: formData.get("email")?.trim() || "",
      notes: formData.get("notes")?.trim() || "",
      client_type: formData.get("client_type") || "client",
    };
  }

  function openModal(mode = "create", client) {
    state.modalMode = mode;
    state.form = client
      ? {
          id: client.id,
          company_name: client.company_name || client.name || "",
          registration_code: client.registration_code || "",
          vat_code: client.vat_code || "",
          address: client.address || "",
          phone: client.phone || "",
          email: client.email || "",
          client_type: client.client_type || "client",
          notes: client.notes || "",
        }
      : createEmptyForm();

    if (els.modal?.form) {
      els.modal.form.company_name.value = state.form.company_name;
      els.modal.form.registration_code.value = state.form.registration_code;
      els.modal.form.vat_code.value = state.form.vat_code;
      els.modal.form.address.value = state.form.address;
      els.modal.form.phone.value = state.form.phone;
      els.modal.form.email.value = state.form.email;
      els.modal.form.notes.value = state.form.notes;
      els.modal.form.querySelectorAll('input[name="client_type"]').forEach((input) => {
        input.checked = input.value === state.form.client_type;
      });
    }

    if (els.modal?.errors) {
      els.modal.errors.classList.add("hidden");
      els.modal.errors.innerHTML = "";
    }

    if (els.modal?.title) {
      els.modal.title.textContent = mode === "edit" ? "Redaguoti klientą" : "Naujas klientas";
    }

    els.modal?.root.classList.remove("hidden");
    renderIcons();
  }

  function closeModal() {
    els.modal?.root.classList.add("hidden");
  }

  function validateClientForm(data) {
    const errors = [];
    if (!data.company_name) errors.push("Įrašykite įmonės pavadinimą.");
    if (!data.registration_code) errors.push("Įrašykite įmonės kodą.");
    if (!/^\d{7,9}$/.test(data.registration_code || "")) {
      errors.push("Įmonės kodas turi būti 7-9 skaitmenų.");
    }
    if (!data.address) errors.push("Įveskite adresą.");
    if (!data.email) errors.push("Įveskite el. paštą.");
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push("Netinkamas el. pašto formatas.");
    }
    if (data.vat_code && !/^(LT)?\d{9,12}$/.test(data.vat_code)) {
      errors.push("Netinkamas PVM kodo formatas.");
    }
    if (!["client", "supplier"].includes(data.client_type)) {
      errors.push("Pasirinkite kliento tipą.");
    }
    return errors;
  }

  async function handleModalSubmit() {
    const errors = validateClientForm(state.form);
    if (errors.length) {
      if (els.modal?.errors) {
        els.modal.errors.innerHTML = errors.map((e) => `<p>• ${e}</p>`).join("");
        els.modal.errors.classList.remove("hidden");
      }
      return;
    }
    try {
      if (state.modalMode === "edit" && state.form.id) {
        await editClient(state.form.id, state.form);
      } else {
        await createClient(state.form);
      }
      closeModal();
      loadClients();
    } catch (error) {
      console.error("Client save failed", error);
      showToast("error", error?.message || "Nepavyko išsaugoti kliento.");
    }
  }

  async function loadClients(filters = {}) {
    state.listLoading = true;
    renderSkeleton();
    try {
      const params = {
        limit: state.pagination.limit,
        offset: (state.pagination.page - 1) * state.pagination.limit,
        sort_by: state.filters.sortBy,
        ...filters,
      };
      if (state.filters.search) params.search = state.filters.search;
      if (state.filters.clientType !== "all") params.client_type = state.filters.clientType;

      const res = await api.getClients(params);
      state.clients = res?.clients || [];
      state.pagination.total = res?.total || state.clients.length;
      renderClientsList();
      renderPagination();
      renderIcons();
    } catch (error) {
      console.error("Klaida kraunant klientus", error);
      els.list.innerHTML = `
        <div class="bg-ordinn-red/5 border border-ordinn-red/20 text-ordinn-red rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">${icon("alert-octagon")} <p class="font-semibold">Nepavyko užkrauti klientų</p></div>
          <p class="text-sm">Patikrinkite ryšį ir bandykite dar kartą.</p>
          <button class="btn-secondary" id="clients-retry">Bandyti iš naujo</button>
        </div>`;
      els.list.querySelector("#clients-retry")?.addEventListener("click", () => loadClients());
      showToast("error", error?.message || "Nepavyko užkrauti klientų.");
    } finally {
      state.listLoading = false;
    }
  }

  function renderSkeleton() {
    if (!els.list) return;
    const skeletonCards = Array.from({ length: 3 })
      .map(
        () => `
        <div class="card-shell p-4 space-y-3">
          <div class="flex justify-between items-center">
            <div class="skeleton h-5 w-40"></div>
            <div class="skeleton h-5 w-20"></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="skeleton h-4 w-full"></div>
            <div class="skeleton h-4 w-full"></div>
            <div class="skeleton h-4 w-full"></div>
          </div>
        </div>`
      )
      .join("");
    els.list.innerHTML = skeletonCards;
  }

  function renderClientsList() {
    if (!els.list) return;
    if (!state.clients.length) {
      els.list.innerHTML = `
        <div class="bg-ghost-concrete/40 border border-dashed border-ghost-concrete rounded-lg p-6 text-center">
          <p class="text-graphite-steel font-medium">Dar nėra klientų.</p>
          <p class="text-sm text-graphite-steel/70 mt-1">Pridėkite pirmą klientą ir kurkite sąskaitas.</p>
          <button class="btn-primary mt-4" id="clients-empty-create">${icon("plus")} Naujas klientas</button>
        </div>`;
      els.list.querySelector("#clients-empty-create")?.addEventListener("click", () => openModal("create"));
      return;
    }

    const content = state.clients
      .map((client) => renderClientCard(client))
      .join("");
    els.list.innerHTML = content;
  }

  function renderClientCard(client) {
    const meta = TYPE_META[client.client_type] || TYPE_META.default;
    const cached = state.cache.get(client.id);
    const lastInvoiceDate =
      cached?.invoices?.[0]?.invoice_date || cached?.client?.updated_at || client.updated_at || null;
    const unpaid = (client.total_unpaid ?? 0).toFixed ? client.total_unpaid : Number(client.total_unpaid || 0);
    const isOpen = state.expanded.has(client.id);
    const menuId = `client-menu-${client.id}`;
    return `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm hover:shadow-md transition-shadow">
        <div class="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3">
          <div class="flex items-start gap-3 flex-1">
            <button data-expand="${client.id}" class="btn-ghost h-9 w-9 p-0" aria-label="Išskleisti">
              <i data-lucide="${isOpen ? "chevron-up" : "chevron-down"}" class="h-4 w-4"></i>
            </button>
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-lg font-semibold text-graphite-steel">${client.company_name}</p>
                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}">${meta.label}</span>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-sm text-graphite-steel/70">
                <span>Įm. kodas: ${client.registration_code || "—"}</span>
                ${client.vat_code ? `<span>PVM: ${client.vat_code}</span>` : ""}
                ${client.email ? `<span class="flex items-center gap-1">${icon("mail")} ${client.email}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-6 text-sm">
            <div class="text-right">
              <p class="text-xs text-graphite-steel/60">Išrašyta</p>
              <p class="text-base font-semibold text-graphite-steel">${fmtCurrency(client.total_invoiced || 0)}</p>
            </div>
            <div class="text-right">
              <p class="text-xs text-graphite-steel/60">Neapmokėta</p>
              <p class="text-base font-semibold ${unpaid > 0 ? "text-ordinn-red" : "text-graphite-steel"}">${fmtCurrency(unpaid)}</p>
            </div>
            <div class="text-right">
              <p class="text-xs text-graphite-steel/60">Sąskaitų</p>
              <p class="text-base font-semibold text-graphite-steel">${client.invoice_count || 0}</p>
            </div>
            <div class="text-right">
              <p class="text-xs text-graphite-steel/60">Pask. sąskaita</p>
              <p class="text-base font-semibold text-graphite-steel">${fmtDate(lastInvoiceDate)}</p>
            </div>
          </div>
          <div class="relative text-left">
            <button class="btn-ghost h-10 w-10 p-0" data-menu-trigger="${menuId}" aria-label="Veiksmai">
              <i data-lucide="more-vertical" class="h-4 w-4"></i>
            </button>
            <div class="hidden absolute right-0 mt-2 w-48 rounded-md border border-ghost-concrete bg-white shadow-lg z-20" data-menu-panel="${menuId}">
              <div class="py-1 text-sm text-graphite-steel">
                <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="edit" data-id="${client.id}">${icon("pencil")} Redaguoti</button>
                <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="inline" data-id="${client.id}">${icon("edit")} Tiesioginis redagavimas</button>
                <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="invoice" data-id="${client.id}">${icon("file-plus")} Nauja sąskaita</button>
                <button class="w-full text-left px-3 py-2 hover:bg-ghost-concrete/50" data-action="detail" data-id="${client.id}">${icon("panel-right")} Atidaryti detales</button>
                <div class="border-t border-ghost-concrete my-1"></div>
                <button class="w-full text-left px-3 py-2 text-ordinn-red hover:bg-ghost-concrete/50" data-action="delete" data-id="${client.id}">${icon("trash")} Ištrinti</button>
              </div>
            </div>
          </div>
        </div>
        ${isOpen ? renderExpanded(client) : ""}
      </div>
    `;
  }

  function renderExpanded(client) {
    const detail = state.cache.get(client.id);
    const summary = detail?.financial_summary || {
      invoice_count: client.invoice_count || 0,
      paid_invoice_count: 0,
      total_invoiced: client.total_invoiced || 0,
      total_paid: client.total_paid || 0,
      total_unpaid: client.total_unpaid || 0,
    };
    const invoices = (detail?.invoices || []).slice(0, 5);
    const loading = state.listLoading && !detail;
    const inline = state.inlineEditing === client.id;
    return `
      <div class="border-t border-ghost-concrete bg-ghost-concrete/20 px-4 py-3 space-y-4">
        ${loading ? `<p class="text-sm text-graphite-steel/70">Kraunama...</p>` : ""}
        <div class="grid gap-3 lg:grid-cols-3">
          <div class="card-shell p-3 space-y-2">
            <p class="text-sm font-semibold text-graphite-steel">Sąskaitų santrauka</p>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="bg-ghost-concrete/40 rounded-lg p-2">
                <p class="text-xs text-graphite-steel/60">Išrašyta</p>
                <p class="font-semibold text-graphite-steel">${summary.invoice_count}</p>
              </div>
              <div class="bg-ghost-concrete/40 rounded-lg p-2">
                <p class="text-xs text-graphite-steel/60">Apmokėta</p>
                <p class="font-semibold text-graphite-steel">${summary.paid_invoice_count || 0}</p>
              </div>
              <div class="bg-ghost-concrete/40 rounded-lg p-2">
                <p class="text-xs text-graphite-steel/60">Suma</p>
                <p class="font-semibold text-graphite-steel">${fmtCurrency(summary.total_invoiced)}</p>
              </div>
              <div class="bg-ghost-concrete/40 rounded-lg p-2">
                <p class="text-xs text-graphite-steel/60">Neapmokėta</p>
                <p class="font-semibold text-ordinn-red">${fmtCurrency(summary.total_unpaid)}</p>
              </div>
            </div>
          </div>

          <div class="card-shell p-3 space-y-2">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-graphite-steel">Paskutinės sąskaitos</p>
              <button class="text-xs text-ordinn-red hover:underline" data-action="invoices" data-id="${client.id}">Peržiūrėti visas</button>
            </div>
            ${
              invoices.length
                ? `<div class="space-y-2 text-sm">
                    ${invoices
                      .map((inv) => {
                        const meta = STATUS_META[inv.status] || STATUS_META.default;
                        return `
                          <div class="flex items-center justify-between bg-ghost-concrete/40 rounded-lg px-3 py-2">
                            <div>
                              <p class="font-semibold text-graphite-steel">${inv.number || inv.full_invoice_number || "—"}</p>
                              <p class="text-xs text-graphite-steel/60">${fmtDate(inv.invoice_date)}</p>
                            </div>
                            <div class="text-right space-y-1">
                              <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}">${meta.label}</span>
                              <p class="text-sm font-semibold text-graphite-steel">${fmtCurrency(inv.total)}</p>
                            </div>
                          </div>
                        `;
                      })
                      .join("")}
                  </div>`
                : `<p class="text-sm text-graphite-steel/70">Sąskaitų dar nėra.</p>`
            }
          </div>

          <div class="card-shell p-3 space-y-2">
            <p class="text-sm font-semibold text-graphite-steel">Kontaktai</p>
            ${
              inline
                ? renderInlineContactForm(client)
                : `
              <p class="text-sm text-graphite-steel/90">${client.address || "Adresas nenurodytas"}</p>
              <p class="text-xs text-graphite-steel/60">Įm. kodas: ${client.registration_code || "—"} ${
                    client.vat_code ? "• PVM: " + client.vat_code : ""
                  }</p>
              <p class="text-xs text-graphite-steel/60">${client.email || ""} ${client.phone ? "• " + client.phone : ""}</p>
              <div class="flex flex-wrap gap-2">
                <button class="btn-secondary h-9 text-xs" data-action="inline" data-id="${client.id}">${icon("edit")} Redaguoti kontaktus</button>
                <button class="btn-secondary h-9 text-xs" data-action="detail" data-id="${client.id}">${icon("panel-right")} Detali peržiūra</button>
              </div>
              `
            }
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary h-9" data-action="edit" data-id="${client.id}">${icon("pencil")} Redaguoti</button>
          <button class="btn-secondary h-9" data-action="invoice" data-id="${client.id}">${icon("file-plus")} Kurti sąskaitą</button>
          <button class="btn-secondary h-9" data-action="invoices" data-id="${client.id}">${icon("list")} Visos sąskaitos</button>
          <button class="btn-ghost h-9 text-ordinn-red" data-action="delete" data-id="${client.id}">${icon("trash")} Ištrinti</button>
        </div>
      </div>
    `;
  }

  function renderInlineContactForm(client) {
    return `
      <div class="space-y-2 text-sm" data-inline-form="${client.id}">
        <input class="input-field" data-inline-field="address" value="${client.address || ""}" placeholder="Adresas">
        <div class="grid grid-cols-2 gap-2">
          <input class="input-field" data-inline-field="email" value="${client.email || ""}" placeholder="El. paštas">
          <input class="input-field" data-inline-field="phone" value="${client.phone || ""}" placeholder="Telefonas">
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input class="input-field" data-inline-field="registration_code" value="${client.registration_code || ""}" placeholder="Įm. kodas">
          <input class="input-field" data-inline-field="vat_code" value="${client.vat_code || ""}" placeholder="PVM kodas">
        </div>
        <div class="flex gap-2">
          <button class="btn-primary h-9 flex-1" data-action="inline-save" data-id="${client.id}">${icon("save")} Išsaugoti</button>
          <button class="btn-ghost h-9 flex-1" data-action="inline-cancel" data-id="${client.id}">Atšaukti</button>
        </div>
      </div>
    `;
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
        loadClients();
      }
    });
    els.pagination.querySelector("[data-page='next']")?.addEventListener("click", () => {
      if (state.pagination.page < totalPages) {
        state.pagination.page += 1;
            loadClients();
      }
    });
  }

  async function toggleExpanded(id) {
    const numericId = Number(id);
    if (state.expanded.has(numericId)) {
      state.expanded.delete(numericId);
      renderClientsList();
      renderIcons();
      return;
    }
    state.expanded.add(numericId);
    renderClientsList();
    await viewClientDetails(numericId);
  }

  async function viewClientDetails(id) {
    try {
      const detail = await api.getClient(id);
      state.cache.set(id, detail);
      renderClientsList();
      if (state.selectedId === id) renderDetailView();
      renderIcons();
    } catch (error) {
      console.error("Nepavyko gauti kliento informacijos", error);
      showToast("error", error?.message || "Nepavyko gauti kliento informacijos.");
    }
  }

  async function createClient(data) {
    const payload = {
      company_name: data.company_name,
      registration_code: data.registration_code,
      vat_code: data.vat_code || undefined,
      address: data.address,
      phone: data.phone || undefined,
      email: data.email,
      client_type: data.client_type || "client",
    };
    const created = await api.createClient(payload);
    state.cache.set(created.id, { client: created, invoices: [], financial_summary: {} });
    showToast("success", "Klientas sukurtas.");
  }

  async function editClient(id, updates = {}) {
    const existing = state.clients.find((c) => c.id === id) || {};
    const payload = {
      company_name: updates.company_name ?? existing.company_name,
      registration_code: updates.registration_code ?? existing.registration_code,
      vat_code: updates.vat_code ?? existing.vat_code,
      address: updates.address ?? existing.address,
      phone: updates.phone ?? existing.phone,
      email: updates.email ?? existing.email,
      client_type: updates.client_type ?? existing.client_type,
    };
    const errors = validateClientForm(payload);
    if (errors.length) {
      showToast("error", errors.join(" "));
      return;
    }
    const updated = await api.updateClient(id, payload);
    state.cache.set(id, { ...(state.cache.get(id) || {}), client: updated });
    showToast("success", "Klientas atnaujintas.");
    await loadClients();
  }

  async function deleteClient(id) {
    const client = state.clients.find((c) => c.id === id);
    const detail = state.cache.get(id);
    const invoiceCount = detail?.financial_summary?.invoice_count ?? client?.invoice_count ?? 0;
    if (invoiceCount > 0) {
      const hard = window.confirm(
        `Šis klientas turi ${invoiceCount} sąskaitas. Ar tikrai norite ištrinti?`
      );
      if (!hard) return;
      await api.deleteClient(id, { hard: true });
      showToast("info", "Klientas ištrintas kartu su sąskaitomis.");
    } else {
      const ok = window.confirm("Ar tikrai norite ištrinti klientą?");
      if (!ok) return;
      await api.deleteClient(id);
      showToast("success", "Klientas ištrintas.");
    }
    state.cache.delete(id);
    state.expanded.delete(id);
    state.selectedId = state.selectedId === id ? null : state.selectedId;
    await loadClients();
    renderDetailView();
  }

  async function loadClientInvoices(clientId, filters = {}) {
    try {
      const res = await api.getClientInvoices(clientId, filters);
      const detail = state.cache.get(clientId) || {};
      state.cache.set(clientId, { ...detail, invoices: res?.invoices || [] });
      if (state.expanded.has(clientId)) renderClientsList();
      if (state.selectedId === clientId) renderDetailView();
    } catch (error) {
      console.error("Nepavyko gauti sąskaitų", error);
      showToast("error", error?.message || "Nepavyko gauti kliento sąskaitų.");
    }
  }

  async function loadClientStatistics(clientId) {
    try {
      const stats = await api.getClientStatistics(clientId);
      const detail = state.cache.get(clientId) || {};
      state.cache.set(clientId, { ...detail, financial_summary: stats });
      if (state.expanded.has(clientId)) renderClientsList();
      if (state.selectedId === clientId) renderDetailView();
    } catch (error) {
      console.error("Nepavyko gauti statistikos", error);
      showToast("error", error?.message || "Nepavyko gauti kliento statistikos.");
    }
  }

  function createInvoiceForClient(clientId) {
    document.dispatchEvent(new CustomEvent("open-invoice-for-client", { detail: { clientId } }));
    if (window.invoiceUI?.openInvoiceForClient) {
      window.invoiceUI.openInvoiceForClient(clientId);
      return;
    }
    showToast("info", "Sąskaitų modulio langas atidaromas.");
  }

  function searchClients(query) {
    state.filters.search = query;
    state.pagination.page = 1;
    loadClients();
  }

  function exportClients() {
    if (!state.clients.length) {
      showToast("info", "Nėra duomenų eksportui.");
      return;
    }
    const header = [
      "Pavadinimas",
      "Tipas",
      "Įmonės kodas",
      "PVM kodas",
      "El. paštas",
      "Telefonas",
      "Adresas",
      "Išrašyta",
      "Neapmokėta",
      "Sąskaitų sk.",
    ];
    const rows = state.clients.map((c) => [
      c.company_name || c.name || "",
      TYPE_META[c.client_type]?.label || c.client_type || "",
      c.registration_code || "",
      c.vat_code || "",
      c.email || "",
      c.phone || "",
      (c.address || "").replace(/\n/g, " "),
      Number(c.total_invoiced || 0).toFixed(2),
      Number(c.total_unpaid || 0).toFixed(2),
      c.invoice_count || 0,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clients.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRootClick(event) {
    const expandTarget = event.target.closest?.("[data-expand]");
    if (expandTarget) {
      toggleExpanded(expandTarget.dataset.expand);
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
      return;
    }

    const actionBtn = event.target.closest?.("[data-action]");
    if (actionBtn) {
      const id = Number(actionBtn.dataset.id);
      const action = actionBtn.dataset.action;
      if (action === "edit") {
        const client = state.clients.find((c) => c.id === id) || state.cache.get(id)?.client;
        openModal("edit", client);
      }
      if (action === "delete") deleteClient(id);
      if (action === "invoice") createInvoiceForClient(id);
      if (action === "invoices") {
        loadClientInvoices(id, { limit: 50 });
        state.selectedId = id;
        state.detailTab = "invoices";
        renderDetailView();
      }
      if (action === "detail") {
        state.selectedId = id;
        state.detailTab = "info";
        renderDetailView();
      }
      if (action === "detail-close") {
        state.selectedId = null;
        renderDetailView();
      }
      if (action === "inline") {
        state.inlineEditing = id;
        renderClientsList();
        renderIcons();
      }
      if (action === "inline-cancel") {
        state.inlineEditing = null;
        renderClientsList();
      }
      if (action === "inline-save") {
        saveInlineEdits(id, actionBtn.closest("[data-inline-form]"));
      }
      if (action === "refresh-stats") {
        loadClientStatistics(id);
      }
      return;
    }

    const pageBtn = event.target.closest?.("[data-page]");
    if (pageBtn) return; // tvarkoma renderPagination

    const tabBtn = event.target.closest?.("[data-tab]");
    if (tabBtn) {
      state.detailTab = tabBtn.dataset.tab;
      renderDetailView();
    }
  }

  function saveInlineEdits(id, container) {
    const holder = container || root.querySelector(`[data-inline-form="${id}"]`);
    if (!holder) return;
    const updates = {};
    holder.querySelectorAll("[data-inline-field]").forEach((input) => {
      updates[input.dataset.inlineField] = input.value.trim();
    });
    editClient(id, updates).then(() => {
      state.inlineEditing = null;
      renderClientsList();
    });
  }

  function renderDetailView() {
    if (!els.detail) return;
    if (!state.selectedId) {
      els.detail.classList.add("hidden");
      els.detail.innerHTML = "";
      return;
    }
    const detail = state.cache.get(state.selectedId);
    const client =
      detail?.client ||
      state.clients.find((c) => c.id === state.selectedId) ||
      { company_name: "Klientas" };

    if (!detail) {
      viewClientDetails(state.selectedId);
      els.detail.innerHTML = `
        <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm p-4">
          <p class="text-sm text-graphite-steel/70">Kraunama kliento informacija...</p>
        </div>`;
      els.detail.classList.remove("hidden");
      return;
    }

    const summary = detail.financial_summary || {};
    const invoices = detail.invoices || [];

    els.detail.innerHTML = `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-4 py-3 border-b border-ghost-concrete">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Kliento detalės</p>
            <h3 class="text-lg font-semibold text-graphite-steel">${client.company_name}</h3>
            <p class="text-sm text-graphite-steel/70">${client.registration_code || "–"} ${
      client.vat_code ? "• " + client.vat_code : ""
    }</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn-secondary h-9" data-action="edit" data-id="${client.id}">${icon("pencil")} Redaguoti</button>
            <button class="btn-primary h-9" data-action="invoice" data-id="${client.id}">${icon("file-plus")} Nauja sąskaita</button>
            <button class="btn-ghost h-9" data-action="detail-close">${icon("x")} Uždaryti</button>
          </div>
        </div>
        <div class="px-4 py-3">
          <div class="flex flex-wrap gap-2 text-sm mb-3">
            ${["info", "invoices", "stats"]
              .map(
                (tab) => `
                <button class="px-3 py-2 rounded-lg border ${state.detailTab === tab ? "border-ordinn-red text-ordinn-red bg-ordinn-red/5" : "border-ghost-concrete text-graphite-steel hover:bg-ghost-concrete/40"}" data-tab="${tab}">
                  ${
                    tab === "info"
                      ? "Informacija"
                      : tab === "invoices"
                      ? "Sąskaitos"
                      : "Statistika"
                  }
                </button>`
              )
              .join("")}
          </div>
          ${renderDetailTabContent(client, detail, summary, invoices)}
        </div>
      </div>
    `;
    els.detail.classList.remove("hidden");
    renderIcons();
  }

  function renderDetailTabContent(client, detail, summary, invoices) {
    if (state.detailTab === "info") {
      return `
        <div class="grid gap-3 md:grid-cols-2">
          <div class="card-shell p-3 space-y-2">
            <p class="text-sm font-semibold text-graphite-steel">Kontaktai</p>
            <p class="text-sm text-graphite-steel/90">${client.address || "—"}</p>
            <p class="text-xs text-graphite-steel/60">${client.email || ""} ${client.phone ? "• " + client.phone : ""}</p>
          </div>
          <div class="card-shell p-3 space-y-2">
            <p class="text-sm font-semibold text-graphite-steel">Įmonės duomenys</p>
            <p class="text-sm text-graphite-steel/90">Įm. kodas: ${client.registration_code || "—"}</p>
            <p class="text-sm text-graphite-steel/90">PVM: ${client.vat_code || "—"}</p>
            <p class="text-sm text-graphite-steel/90">Tipas: ${TYPE_META[client.client_type]?.label || client.client_type}</p>
          </div>
        </div>
      `;
    }
    if (state.detailTab === "invoices") {
      return `
        <div class="space-y-2">
          ${
            invoices.length
              ? invoices
                  .map((inv) => {
                    const meta = STATUS_META[inv.status] || STATUS_META.default;
                    return `
                    <div class="flex items-center justify-between bg-ghost-concrete/30 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p class="font-semibold text-graphite-steel">${inv.number || inv.full_invoice_number || "—"}</p>
                        <p class="text-xs text-graphite-steel/60">${fmtDate(inv.invoice_date)}</p>
                      </div>
                      <div class="text-right">
                        <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}">${meta.label}</span>
                        <p class="text-sm font-semibold text-graphite-steel">${fmtCurrency(inv.total)}</p>
                      </div>
                    </div>`;
                  })
                  .join("")
              : `<p class="text-sm text-graphite-steel/70">Sąskaitų nerasta.</p>`
          }
        </div>
      `;
    }
    return `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div class="bg-ghost-concrete/40 rounded-lg p-3">
          <p class="text-xs text-graphite-steel/60">Sąskaitų sk.</p>
          <p class="text-lg font-semibold text-graphite-steel">${summary.invoice_count || 0}</p>
        </div>
        <div class="bg-ghost-concrete/40 rounded-lg p-3">
          <p class="text-xs text-graphite-steel/60">Apmokėtos</p>
          <p class="text-lg font-semibold text-graphite-steel">${summary.paid_invoice_count || 0}</p>
        </div>
        <div class="bg-ghost-concrete/40 rounded-lg p-3">
          <p class="text-xs text-graphite-steel/60">Išrašyta</p>
          <p class="text-lg font-semibold text-graphite-steel">${fmtCurrency(summary.total_invoiced || 0)}</p>
        </div>
        <div class="bg-ghost-concrete/40 rounded-lg p-3">
          <p class="text-xs text-graphite-steel/60">Neapmokėta</p>
          <p class="text-lg font-semibold text-ordinn-red">${fmtCurrency(summary.total_unpaid || 0)}</p>
        </div>
      </div>
      <button class="btn-secondary mt-3" data-action="refresh-stats" data-id="${client.id}">${icon("refresh-ccw")} Atnaujinti statistiką</button>
    `;
  }

  window.clientsUI = {
    loadClients,
    createClient,
    editClient,
    deleteClient,
    viewClientDetails,
    loadClientInvoices,
    loadClientStatistics,
    createInvoiceForClient,
    validateClientForm,
    searchClients,
    formatClientDisplay: (client) => ({
      name: client.company_name || client.name,
      type: TYPE_META[client.client_type]?.label || client.client_type,
      total: fmtCurrency(client.total_invoiced || 0),
      unpaid: fmtCurrency(client.total_unpaid || 0),
    }),
  };

  function init() {
    buildLayout();
    buildModal();
    loadClients();
  }

  document.addEventListener("DOMContentLoaded", init);
})();


