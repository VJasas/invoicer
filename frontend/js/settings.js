(function () {
  const root = document.getElementById("settings-root");
  if (!root || typeof window.api === "undefined") return;

  const TABS = [
    { key: "company", label: "Įmonės informacija", icon: "building-2" },
    { key: "banks", label: "Banko sąskaitos", icon: "landmark" },
    { key: "series", label: "Sąskaitų serijos", icon: "hash" },
    { key: "general", label: "Bendri nustatymai", icon: "sliders-horizontal" },
  ];

  const BANK_OPTIONS = ["Swedbank", "SEB", "Luminor", "Šiaulių bankas", "Other"];
  const DATE_FORMATS = [
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
    { value: "DD-MM-YYYY", label: "DD-MM-YYYY" },
  ];
  const LANG_OPTIONS = [{ value: "lt", label: "Lietuvių" }];
  const defaultGeneralSettings = {
    payment_terms: 5,
    currency: "EUR",
    date_format: "YYYY-MM-DD",
    include_vat: true,
    auto_increment: true,
    language: "lt",
  };

  const state = {
    activeTab: "company",
    company: { company_name: "", tax_id: "", address: "", phone: "", email: "" },
    companyErrors: {},
    bankAccounts: [],
    bankForm: createBankForm(),
    bankErrors: [],
    bankModalMode: "create",
    series: [],
    seriesForm: createSeriesForm(),
    seriesErrors: [],
    seriesModalMode: "create",
    general: { ...defaultGeneralSettings },
    generalErrors: [],
    loading: { company: true, banks: true, series: true, general: true },
    saving: { company: false, bank: false, series: false, general: false },
    autosave: { status: "idle", message: "" },
  };

  const els = {
    content: null,
    tabButtons: [],
    autosave: null,
    toast: null,
    bankModal: null,
    seriesModal: null,
  };

  const icon = (name, cls = "") => `<i data-lucide="${name}" class="h-4 w-4 ${cls}"></i>`;
  const renderIcons = () => {
    if (window.lucide && window.lucide.icons) {
      window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide" });
    }
  };

  function showToast(type, message) {
    if (!els.toast) {
      const container = document.createElement("div");
      container.id = "settings-toast";
      container.className = "fixed top-4 right-4 z-50 space-y-2";
      document.body.appendChild(container);
      els.toast = container;
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
    els.toast.appendChild(el);
    setTimeout(() => el.remove(), 4200);
    renderIcons();
  }

  function setAutosave(status = "idle", message = "") {
    state.autosave = { status, message };
    updateAutosaveIndicator();
  }

  function renderAutosave() {
    if (state.autosave.status === "saving") {
      return `<span class="inline-flex items-center gap-2 text-graphite-steel"><span class="h-3 w-3 rounded-full bg-ordinn-red animate-pulse"></span><span>Automatiškai saugoma...</span></span>`;
    }
    if (state.autosave.status === "saved") {
      return `<span class="inline-flex items-center gap-2 text-green-700">${icon("check-circle")} <span>Išsaugota${state.autosave.message ? ` · ${state.autosave.message}` : ""}</span></span>`;
    }
    if (state.autosave.status === "error") {
      return `<span class="inline-flex items-center gap-2 text-ordinn-red">${icon("alert-triangle")} <span>Nepavyko išsaugoti</span></span>`;
    }
    return `<span class="inline-flex items-center gap-2 text-graphite-steel/70">${icon("shield-check")} <span>Automatinis saugojimas paruoštas</span></span>`;
  }

  function updateAutosaveIndicator() {
    if (!els.autosave) return;
    els.autosave.innerHTML = renderAutosave();
  }

  function escapeHtml(value) {
    return (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderLayout() {
    root.innerHTML = `
      <section class="bg-white border border-ghost-concrete rounded-lg shadow-sm p-4 space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Nustatymai</p>
            <h2 class="text-2xl font-semibold text-graphite-steel">Sistemos nustatymai</h2>
            <p class="text-sm text-graphite-steel/70">Tvarkykite įmonės informaciją, banko sąskaitas, sąskaitų serijas ir bendrus nustatymus.</p>
          </div>
          <div id="settings-autosave" class="flex items-center gap-2 text-sm text-graphite-steel/70">${renderAutosave()}</div>
        </div>
        <div class="flex flex-wrap gap-2 border-b border-ghost-concrete pb-2" role="tablist">
          ${TABS.map((tab) => {
            const isActive = tab.key === state.activeTab;
            const activeCls = isActive
              ? "bg-ordinn-red/10 text-ordinn-red border-ordinn-red"
              : "text-graphite-steel hover:bg-ghost-concrete/30 border-ghost-concrete";
            return `<button class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${activeCls}" data-action="switch-tab" data-tab="${tab.key}" aria-selected="${isActive}">${icon(tab.icon)} <span>${tab.label}</span></button>`;
          }).join("")}
        </div>
        <div id="settings-content" class="space-y-4"></div>
      </section>
    `;
    els.content = root.querySelector("#settings-content");
    els.autosave = root.querySelector("#settings-autosave");
    els.tabButtons = Array.from(root.querySelectorAll("[data-action='switch-tab']"));
    els.tabButtons.forEach((btn) => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));
    renderActiveTab();
  }

  function renderActiveTab() {
    if (!els.content) return;
    let content = "";
    if (state.activeTab === "company") content = buildCompanyTab();
    if (state.activeTab === "banks") content = buildBankAccountsTab();
    if (state.activeTab === "series") content = buildSeriesTab();
    if (state.activeTab === "general") content = buildGeneralTab();
    els.content.innerHTML = content;
    renderIcons();
  }

  function buildSkeleton(rows = 3) {
    return Array.from({ length: rows })
      .map(
        () => `
        <div class="card-shell p-4 space-y-3">
          <div class="flex justify-between items-center">
            <div class="skeleton h-5 w-40"></div>
            <div class="skeleton h-5 w-24"></div>
          </div>
          <div class="space-y-2">
            <div class="skeleton h-4 w-full"></div>
            <div class="skeleton h-4 w-3/4"></div>
          </div>
        </div>`
      )
      .join("");
  }

  function buildCompanyTab() {
    if (state.loading.company) {
      return `<div class="grid gap-4 md:grid-cols-2">${buildSkeleton(2)}</div>`;
    }
    const fieldClass = (key) =>
      `input-field w-full ${state.companyErrors[key] ? "border-ordinn-red focus:border-ordinn-red ring-ordinn-red/10" : ""}`;
    const errorText = (key) =>
      state.companyErrors[key] ? `<p class="text-xs text-ordinn-red">${state.companyErrors[key]}</p>` : "";

    return `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
        <div class="p-4 space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm space-y-1">
              <span>Įmonės pavadinimas *</span>
              <input data-section="company" data-field="company_name" class="${fieldClass(
                "company_name"
              )}" value="${escapeHtml(state.company.company_name)}" placeholder="UAB Pavyzdys">
              ${errorText("company_name")}
            </label>
            <label class="text-sm space-y-1">
              <span>IV pažymos nr. *</span>
              <input data-section="company" data-field="tax_id" class="${fieldClass(
                "tax_id"
              )}" value="${escapeHtml(state.company.tax_id)}" placeholder="1234567">
              ${errorText("tax_id")}
            </label>
            <label class="text-sm space-y-1 md:col-span-2">
              <span>Adresas *</span>
              <textarea data-section="company" data-field="address" rows="3" class="${fieldClass(
                "address"
              )}" placeholder="Gatvė, miestas, šalis">${escapeHtml(state.company.address)}</textarea>
              ${errorText("address")}
            </label>
            <label class="text-sm space-y-1">
              <span>Telefonas</span>
              <input data-section="company" data-field="phone" class="${fieldClass(
                "phone"
              )}" value="${escapeHtml(state.company.phone)}" placeholder="+370...">
              ${errorText("phone")}
            </label>
            <label class="text-sm space-y-1">
              <span>El. paštas *</span>
              <input data-section="company" data-field="email" type="email" class="${fieldClass(
                "email"
              )}" value="${escapeHtml(state.company.email)}" placeholder="info@imone.lt">
              ${errorText("email")}
            </label>
          </div>
        </div>
        <div class="border-t border-ghost-concrete px-4 py-3 flex items-center justify-end gap-2">
          <button class="btn-primary h-10 px-4 ${state.saving.company ? "opacity-70 cursor-not-allowed" : ""}" data-action="save-company" ${
      state.saving.company ? "disabled" : ""
    }>
            ${icon(state.saving.company ? "loader-2" : "save", state.saving.company ? "animate-spin" : "")}
            <span>Išsaugoti</span>
          </button>
        </div>
      </div>
    `;
  }

  function buildBankAccountsTab() {
    if (state.loading.banks) {
      return `<div class="space-y-3">${buildSkeleton(3)}</div>`;
    }

    const list =
      state.bankAccounts.length === 0
        ? `<div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ghost-concrete p-6 text-center bg-ghost-concrete/20">
            <div class="h-14 w-14 rounded-full bg-ghost-concrete flex items-center justify-center">${icon("credit-card")}</div>
            <p class="text-graphite-steel">Kol kas nėra banko sąskaitų.</p>
            <p class="text-sm text-graphite-steel/70">Pridėkite pirmąją ir nustatykite numatytąją.</p>
          </div>`
        : state.bankAccounts
            .map(
              (acc) => `
          <div class="card-shell p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <p class="text-base font-semibold text-graphite-steel">${escapeHtml(acc.bank_name || "Bankas")}</p>
                ${acc.is_default ? badge("Numatytoji", "bg-green-100 text-green-700") : ""}
              </div>
              <p class="text-sm text-graphite-steel/70 font-mono">${escapeHtml(acc.account_number || "—")}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              ${
                !acc.is_default
                  ? `<button class="btn-secondary h-9 px-3" data-action="set-default-bank" data-id="${acc.id}">${icon(
                      "check-circle"
                    )} Numatyti</button>`
                  : ""
              }
              <button class="btn-ghost h-9 px-3" data-action="edit-bank" data-id="${acc.id}">${icon(
                "pen"
              )} Redaguoti</button>
              <button class="btn-ghost h-9 px-3 text-ordinn-red border border-ordinn-red/40 ${
                acc.is_default ? "opacity-50 cursor-not-allowed" : ""
              }" data-action="delete-bank" data-id="${acc.id}" ${acc.is_default ? "disabled" : ""}>
                ${icon("trash")} Pašalinti
              </button>
            </div>
          </div>`
            )
            .join("");

    return `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
        <div class="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold text-graphite-steel">Banko sąskaitos</h3>
            <p class="text-sm text-graphite-steel/70">Tvarkykite įmonės banko sąskaitas ir numatytąją.</p>
          </div>
          <button class="btn-primary h-10 px-4" data-action="open-bank-modal">${icon("plus")} Nauja sąskaita</button>
        </div>
        <div class="p-4 space-y-3">
          ${list}
        </div>
      </div>
    `;
  }

  function buildSeriesTab() {
    if (state.loading.series) {
      return `<div class="space-y-3">${buildSkeleton(3)}</div>`;
    }
    const rows =
      state.series.length === 0
        ? `<tr><td colspan="5" class="px-4 py-6 text-center text-sm text-graphite-steel/70">Kol kas nėra serijų.</td></tr>`
        : state.series
            .map(
              (s) => `
        <tr class="hover:bg-ghost-concrete/20">
          <td class="px-4 py-3 font-semibold text-graphite-steel">${escapeHtml(s.series_code || "")}</td>
          <td class="px-4 py-3 text-sm text-graphite-steel/80">${escapeHtml(s.description || "—")}</td>
          <td class="px-4 py-3 text-sm text-graphite-steel text-right">${s.current_number ?? "—"}</td>
          <td class="px-4 py-3 text-sm">
            ${
              s.active
                ? badge("Aktyvi", "bg-green-100 text-green-700")
                : badge("Išjungta", "bg-ordinn-red/10 text-ordinn-red")
            }
          </td>
          <td class="px-4 py-3 text-sm text-right">
            <div class="flex justify-end gap-2">
              <label class="inline-flex items-center gap-2 text-sm text-graphite-steel/80">
                <input type="checkbox" class="h-4 w-4" data-action="toggle-series-status" data-id="${s.id}" ${
                s.active ? "checked" : ""
              }>
                <span>${s.active ? "Aktyvi" : "Neaktyvi"}</span>
              </label>
              <button class="btn-ghost h-9 px-3" data-action="edit-series" data-id="${s.id}">${icon(
                "pen"
              )} Redaguoti</button>
              <button class="btn-ghost h-9 px-3 text-ordinn-red border border-ordinn-red/40" data-action="deactivate-series" data-id="${
                s.id
              }">
                ${icon("x-circle")} Išjungti
              </button>
            </div>
          </td>
        </tr>`
            )
            .join("");

    return `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
        <div class="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold text-graphite-steel">Sąskaitų serijos</h3>
            <p class="text-sm text-graphite-steel/70">Valdykite serijų kodus ir būsenas. Dabartinis numeris keičiamas automatiškai.</p>
          </div>
          <button class="btn-primary h-10 px-4" data-action="open-series-modal">${icon("plus")} Nauja serija</button>
        </div>
        <div class="px-4 pb-4 text-xs text-graphite-steel/70">Dabartinis numeris negali būti redaguojamas rankiniu būdu – jis didėja automatiškai išrašant sąskaitas.</div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-ghost-concrete text-graphite-steel">
              <tr>
                <th class="px-4 py-3 text-left">Serijos kodas</th>
                <th class="px-4 py-3 text-left">Aprašymas</th>
                <th class="px-4 py-3 text-right">Dabartinis nr.</th>
                <th class="px-4 py-3 text-left">Statusas</th>
                <th class="px-4 py-3 text-right">Veiksmai</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ghost-concrete">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildGeneralTab() {
    if (state.loading.general) {
      return `<div class="space-y-3">${buildSkeleton(2)}</div>`;
    }
    const fieldClass = (key) =>
      `input-field w-full ${state.generalErrors[key] ? "border-ordinn-red focus:border-ordinn-red ring-ordinn-red/10" : ""}`;
    const errorText = (key) =>
      state.generalErrors[key] ? `<p class="text-xs text-ordinn-red">${state.generalErrors[key]}</p>` : "";
    return `
      <div class="bg-white border border-ghost-concrete rounded-lg shadow-sm">
        <div class="p-4 space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm space-y-1">
              <span>Numatytas apmokėjimo terminas (d.)</span>
              <input type="number" min="1" data-section="general" data-field="payment_terms" class="${fieldClass(
                "payment_terms"
              )}" value="${state.general.payment_terms}" placeholder="5">
              ${errorText("payment_terms")}
            </label>
            <label class="text-sm space-y-1">
              <span>Numatytoji valiuta</span>
              <select data-section="general" data-field="currency" class="${fieldClass("currency")}">
                <option value="EUR" ${state.general.currency === "EUR" ? "selected" : ""}>EUR</option>
              </select>
            </label>
            <label class="text-sm space-y-1">
              <span>Datos formatas</span>
              <select data-section="general" data-field="date_format" class="${fieldClass("date_format")}">
                ${DATE_FORMATS.map(
                  (d) => `<option value="${d.value}" ${state.general.date_format === d.value ? "selected" : ""}>${d.label}</option>`
                ).join("")}
              </select>
            </label>
            <label class="text-sm space-y-1">
              <span>Kalba</span>
              <select data-section="general" data-field="language" class="${fieldClass("language")}">
                ${LANG_OPTIONS.map(
                  (lng) => `<option value="${lng.value}" ${state.general.language === lng.value ? "selected" : ""}>${lng.label}</option>`
                ).join("")}
              </select>
            </label>
          </div>
          <div class="space-y-2">
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" class="h-4 w-4" data-section="general" data-field="include_vat" ${
                state.general.include_vat ? "checked" : ""
              }>
              <span>Įtraukti PVM pagal nutylėjimą</span>
            </label>
            <label class="inline-flex items-center gap-2 text-sm opacity-70">
              <input type="checkbox" class="h-4 w-4" checked disabled>
              <span>Automatiškai didinti sąskaitų numerius</span>
            </label>
          </div>
        </div>
        <div class="border-t border-ghost-concrete px-4 py-3 flex items-center justify-end gap-2">
          <button class="btn-primary h-10 px-4 ${state.saving.general ? "opacity-70 cursor-not-allowed" : ""}" data-action="save-general" ${
      state.saving.general ? "disabled" : ""
    }>
            ${icon(state.saving.general ? "loader-2" : "save", state.saving.general ? "animate-spin" : "")}
            <span>Išsaugoti</span>
          </button>
        </div>
      </div>
    `;
  }

  function badge(text, cls) {
    return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}">${text}</span>`;
  }

  function setActiveTab(tab) {
    if (!TABS.find((t) => t.key === tab)) return;
    state.activeTab = tab;
    renderLayout();
  }

  function handleRootClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case "switch-tab":
        setActiveTab(actionEl.dataset.tab);
        break;
      case "save-company":
        updateCompanyInfo();
        break;
      case "open-bank-modal":
        openBankModal("create");
        break;
      case "edit-bank":
        openBankModal("edit", id);
        break;
      case "delete-bank":
        deleteBankAccount(id);
        break;
      case "set-default-bank":
        setDefaultBankAccount(id);
        break;
      case "open-series-modal":
        openSeriesModal("create");
        break;
      case "edit-series":
        openSeriesModal("edit", id);
        break;
      case "deactivate-series":
        toggleSeriesStatus(id, false);
        break;
      case "save-general":
        updateGeneralSettings();
        break;
      default:
        break;
    }
  }

  function handleRootChange(event) {
    const target = event.target;
    if (target.dataset.action === "toggle-series-status") {
      toggleSeriesStatus(target.dataset.id, target.checked);
      return;
    }
    const field = target.dataset.field;
    const section = target.dataset.section;
    if (!field || !section) return;

    if (section === "company") {
      state.company[field] = target.value;
      if (state.companyErrors[field]) delete state.companyErrors[field];
    }
    if (section === "general") {
      if (target.type === "checkbox") {
        state.general[field] = target.checked;
      } else if (target.type === "number") {
        state.general[field] = Number(target.value) || 0;
      } else {
        state.general[field] = target.value;
      }
      if (state.generalErrors[field]) delete state.generalErrors[field];
    }

    if (section === "series-status-toggle") {
      toggleSeriesStatus(field, target.checked);
    }
  }

  function handleRootInput(event) {
    const target = event.target;
    const field = target.dataset.field;
    const section = target.dataset.section;
    if (!field || !section) return;

    if (section === "company") {
      state.company[field] = target.value;
    }
    if (section === "general") {
      state.general[field] = target.type === "number" ? Number(target.value) || 0 : target.value;
    }
  }

  root.addEventListener("click", handleRootClick);
  root.addEventListener("change", handleRootChange);
  root.addEventListener("input", handleRootInput);

  function createBankForm() {
    return { id: null, bank_name: BANK_OPTIONS[0], account_number: "", is_default: false };
  }

  function createSeriesForm() {
    return { id: null, series_code: "", description: "", start_number: 1, active: true };
  }

  async function loadCompanyInfo() {
    state.loading.company = true;
    renderActiveTab();
    try {
      const res = await api.getCompanyInfo();
      state.company = {
        company_name: res?.company_name || res?.name || "",
        tax_id: res?.tax_id || res?.registration_code || "",
        address: res?.address || "",
        phone: res?.phone || "",
        email: res?.email || "",
      };
    } catch (error) {
      console.error("Nepavyko gauti įmonės informacijos", error);
      showToast("error", error?.message || "Nepavyko gauti įmonės informacijos.");
    } finally {
      state.loading.company = false;
      renderActiveTab();
    }
  }

  async function updateCompanyInfo() {
    const errors = validateCompanyForm(state.company);
    state.companyErrors = errors;
    if (Object.keys(errors).length) {
      renderActiveTab();
      return;
    }
    state.saving.company = true;
    setAutosave("saving", "Įmonės informacija");
    renderActiveTab();
    try {
      await api.updateCompanyInfo({
        company_name: state.company.company_name.trim(),
        tax_id: state.company.tax_id.trim(),
        address: state.company.address.trim(),
        phone: state.company.phone.trim(),
        email: state.company.email.trim(),
      });
      showToast("success", "Įmonės informacija atnaujinta.");
      setAutosave("saved", "Įmonė");
    } catch (error) {
      console.error("Nepavyko atnaujinti įmonės informacijos", error);
      showToast("error", error?.message || "Nepavyko išsaugoti įmonės informacijos.");
      setAutosave("error");
    } finally {
      state.saving.company = false;
      renderActiveTab();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  async function loadBankAccounts() {
    state.loading.banks = true;
    renderActiveTab();
    try {
      const res = await api.getBankAccounts();
      state.bankAccounts = Array.isArray(res) ? res : res?.accounts || [];
      if (state.bankAccounts.length && !state.bankAccounts.some((acc) => acc.is_default)) {
        const first = state.bankAccounts[0];
        try {
          await api.updateBankAccount(first.id, { is_default: true });
          state.bankAccounts = state.bankAccounts.map((acc) => ({ ...acc, is_default: acc.id === first.id }));
        } catch (error) {
          console.warn("Nepavyko nustatyti numatytosios sąskaitos", error);
        }
      }
    } catch (error) {
      console.error("Nepavyko gauti banko sąskaitų", error);
      showToast("error", error?.message || "Nepavyko gauti banko sąskaitų.");
    } finally {
      state.loading.banks = false;
      renderActiveTab();
    }
  }

  function validateBankForm(form) {
    const errors = [];
    if (!form.bank_name) errors.push("Pasirinkite banko pavadinimą.");
    if (!form.account_number) errors.push("Įveskite sąskaitos numerį.");
    if (form.account_number && !validateIBAN(form.account_number)) {
      errors.push("Neteisingas IBAN formatas (LT + 18 skaitmenų).");
    }
    const normalized = normalizeIBAN(form.account_number);
    const exists = state.bankAccounts.some(
      (acc) => normalizeIBAN(acc.account_number) === normalized && (!form.id || acc.id !== form.id)
    );
    if (exists) errors.push("Toks sąskaitos numeris jau egzistuoja.");

    if (state.bankAccounts.length === 1 && form.id === state.bankAccounts[0]?.id && state.bankAccounts[0]?.is_default && !form.is_default) {
      errors.push("Bent viena sąskaita turi likti numatytoji.");
    }
    return errors;
  }

  async function createBankAccount() {
    const errors = validateBankForm(state.bankForm);
    state.bankErrors = errors;
    renderBankModalErrors();
    if (errors.length) return;
    state.saving.bank = true;
    setAutosave("saving", "Banko sąskaita");
    renderBankModalErrors();
    try {
      await api.createBankAccount({
        bank_name: state.bankForm.bank_name,
        account_number: normalizeIBAN(state.bankForm.account_number),
        is_default: !!state.bankForm.is_default,
      });
      await loadBankAccounts();
      closeBankModal();
      showToast("success", "Banko sąskaita sukurta.");
      setAutosave("saved", "Banko sąskaitos");
    } catch (error) {
      console.error("Nepavyko sukurti banko sąskaitos", error);
      showToast("error", error?.message || "Nepavyko sukurti banko sąskaitos.");
      setAutosave("error");
    } finally {
      state.saving.bank = false;
      renderBankModalErrors();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  async function editBankAccount(id) {
    const errors = validateBankForm(state.bankForm);
    state.bankErrors = errors;
    renderBankModalErrors();
    if (errors.length) return;
    state.saving.bank = true;
    setAutosave("saving", "Banko sąskaita");
    try {
      await api.updateBankAccount(id, {
        bank_name: state.bankForm.bank_name,
        account_number: normalizeIBAN(state.bankForm.account_number),
        is_default: !!state.bankForm.is_default,
      });
      await loadBankAccounts();
      closeBankModal();
      showToast("success", "Banko sąskaita atnaujinta.");
      setAutosave("saved", "Banko sąskaitos");
    } catch (error) {
      console.error("Nepavyko atnaujinti banko sąskaitos", error);
      showToast("error", error?.message || "Nepavyko atnaujinti banko sąskaitos.");
      setAutosave("error");
    } finally {
      state.saving.bank = false;
      renderBankModalErrors();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  async function deleteBankAccount(id) {
    const account = state.bankAccounts.find((acc) => String(acc.id) === String(id));
    if (!account) return;
    if (account.is_default) {
      showToast("info", "Numatytoji sąskaita negali būti ištrinta.");
      return;
    }
    const confirmed = window.confirm("Ar tikrai norite ištrinti šią banko sąskaitą?");
    if (!confirmed) return;
    try {
      await api.deleteBankAccount(id);
      await loadBankAccounts();
      showToast("success", "Sąskaita ištrinta.");
    } catch (error) {
      console.error("Nepavyko ištrinti banko sąskaitos", error);
      showToast("error", error?.message || "Nepavyko ištrinti banko sąskaitos.");
    }
  }

  async function setDefaultBankAccount(id) {
    if (!id) return;
    try {
      await api.updateBankAccount(id, { is_default: true });
      state.bankAccounts = state.bankAccounts.map((acc) => ({ ...acc, is_default: String(acc.id) === String(id) }));
      renderActiveTab();
      showToast("success", "Numatytoji sąskaita atnaujinta.");
    } catch (error) {
      console.error("Nepavyko nustatyti numatytosios sąskaitos", error);
      showToast("error", error?.message || "Nepavyko atnaujinti numatytosios sąskaitos.");
    }
  }

  async function loadInvoiceSeries() {
    state.loading.series = true;
    renderActiveTab();
    try {
      const res = await api.getInvoiceSeries();
      state.series = Array.isArray(res) ? res : res?.series || [];
    } catch (error) {
      console.error("Nepavyko gauti serijų", error);
      showToast("error", error?.message || "Nepavyko gauti sąskaitų serijų.");
    } finally {
      state.loading.series = false;
      renderActiveTab();
    }
  }

  function validateSeriesForm(form, isEdit = false) {
    const errors = [];
    if (!form.series_code) errors.push("Įveskite serijos kodą.");
    if (form.series_code && !validateSeriesCode(form.series_code)) {
      errors.push("Serijos kodas turi būti 2-4 didžiosios raidės.");
    }
    if (!isEdit) {
      if (!form.start_number || Number(form.start_number) < 1) {
        errors.push("Pradžios numeris turi būti 1 arba didesnis.");
      }
    }
    return errors;
  }

  async function createInvoiceSeries() {
    const errors = validateSeriesForm(state.seriesForm, false);
    state.seriesErrors = errors;
    renderSeriesModalErrors();
    if (errors.length) return;
    state.saving.series = true;
    setAutosave("saving", "Serija");
    try {
      await api.createInvoiceSeries({
        series_code: state.seriesForm.series_code.trim().toUpperCase(),
        description: state.seriesForm.description.trim(),
        start_number: Number(state.seriesForm.start_number) || 1,
        active: !!state.seriesForm.active,
      });
      await loadInvoiceSeries();
      closeSeriesModal();
      showToast("success", "Serija sukurta.");
      setAutosave("saved", "Serijos");
    } catch (error) {
      console.error("Nepavyko sukurti serijos", error);
      showToast("error", error?.message || "Nepavyko sukurti serijos.");
      setAutosave("error");
    } finally {
      state.saving.series = false;
      renderSeriesModalErrors();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  async function editInvoiceSeries(id) {
    const errors = validateSeriesForm(state.seriesForm, true);
    state.seriesErrors = errors;
    renderSeriesModalErrors();
    if (errors.length) return;
    state.saving.series = true;
    setAutosave("saving", "Serija");
    try {
      await api.updateInvoiceSeries(id, {
        series_code: state.seriesForm.series_code.trim().toUpperCase(),
        description: state.seriesForm.description.trim(),
        active: !!state.seriesForm.active,
      });
      await loadInvoiceSeries();
      closeSeriesModal();
      showToast("success", "Serija atnaujinta.");
      setAutosave("saved", "Serijos");
    } catch (error) {
      console.error("Nepavyko atnaujinti serijos", error);
      showToast("error", error?.message || "Nepavyko atnaujinti serijos.");
      setAutosave("error");
    } finally {
      state.saving.series = false;
      renderSeriesModalErrors();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  async function toggleSeriesStatus(id, value) {
    const series = state.series.find((s) => String(s.id) === String(id));
    if (!series) return;
    const newValue = typeof value === "boolean" ? value : !series.active;
    try {
      await api.updateInvoiceSeries(id, { active: newValue });
      state.series = state.series.map((s) => (String(s.id) === String(id) ? { ...s, active: newValue } : s));
      renderActiveTab();
      showToast("success", `Serija ${newValue ? "aktyvuota" : "išjungta"}.`);
    } catch (error) {
      console.error("Nepavyko pakeisti serijos būsenos", error);
      showToast("error", error?.message || "Nepavyko pakeisti serijos būsenos.");
    }
  }

  async function loadGeneralSettings() {
    state.loading.general = true;
    renderActiveTab();
    try {
      const res = await api.get("/settings/general");
      if (res && typeof res === "object") {
        state.general = {
          payment_terms: res.payment_terms ?? defaultGeneralSettings.payment_terms,
          currency: res.currency || defaultGeneralSettings.currency,
          date_format: res.date_format || defaultGeneralSettings.date_format,
          include_vat: res.include_vat ?? defaultGeneralSettings.include_vat,
          auto_increment: true,
          language: res.language || defaultGeneralSettings.language,
        };
      } else {
        state.general = { ...defaultGeneralSettings };
      }
    } catch (error) {
      console.error("Nepavyko gauti bendrų nustatymų", error);
      showToast("error", error?.message || "Nepavyko gauti bendrų nustatymų. Naudojamos numatytos reikšmės.");
      state.general = { ...defaultGeneralSettings };
    } finally {
      state.loading.general = false;
      renderActiveTab();
    }
  }

  function validateGeneralForm(data) {
    const errors = {};
    if (!data.payment_terms || Number(data.payment_terms) < 1) {
      errors.payment_terms = "Terminas turi būti bent 1 diena.";
    }
    if (!data.currency) errors.currency = "Pasirinkite valiutą.";
    if (!data.date_format) errors.date_format = "Pasirinkite datos formatą.";
    if (!data.language) errors.language = "Pasirinkite kalbą.";
    return errors;
  }

  async function updateGeneralSettings() {
    const errors = validateGeneralForm(state.general);
    state.generalErrors = errors;
    if (Object.keys(errors).length) {
      renderActiveTab();
      return;
    }
    state.saving.general = true;
    setAutosave("saving", "Bendri nustatymai");
    renderActiveTab();
    try {
      await api.put("/settings/general", {
        payment_terms: Number(state.general.payment_terms) || defaultGeneralSettings.payment_terms,
        currency: state.general.currency,
        date_format: state.general.date_format,
        include_vat: !!state.general.include_vat,
        auto_increment: true,
        language: state.general.language,
      });
      showToast("success", "Bendri nustatymai išsaugoti.");
      setAutosave("saved", "Bendri nustatymai");
    } catch (error) {
      console.error("Nepavyko išsaugoti bendrų nustatymų", error);
      showToast("error", error?.message || "Nepavyko išsaugoti bendrų nustatymų.");
      setAutosave("error");
    } finally {
      state.saving.general = false;
      renderActiveTab();
      setTimeout(() => setAutosave("idle"), 1400);
    }
  }

  function validateIBAN(iban) {
    const normalized = normalizeIBAN(iban);
    return /^LT\d{18}$/.test(normalized);
  }

  function normalizeIBAN(iban) {
    return (iban || "").replace(/\s+/g, "").toUpperCase();
  }

  function validateSeriesCode(code) {
    return /^[A-Z]{2,4}$/.test((code || "").toUpperCase());
  }

  function validateCompanyForm(data) {
    const errors = {};
    if (!data.company_name) errors.company_name = "Įrašykite įmonės pavadinimą.";
    if (!data.tax_id) errors.tax_id = "Įrašykite IV pažymos numerį.";
    if (!data.address) errors.address = "Įveskite adresą.";
    if (!data.email) {
      errors.email = "Įveskite el. pašto adresą.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = "Netinkamas el. pašto formatas.";
    }
    return errors;
  }

  function buildBankModal() {
    const modal = document.createElement("div");
    modal.id = "bank-modal";
    modal.className = "fixed inset-0 z-50 hidden";
    modal.innerHTML = `
      <div class="absolute inset-0 bg-graphite-steel/60 backdrop-blur-sm"></div>
      <div class="relative z-10 flex min-h-full items-center justify-center px-4 py-6">
        <div class="bg-white border border-ghost-concrete rounded-xl shadow-2xl max-w-xl w-full max-h-[92vh] overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ghost-concrete">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Banko sąskaita</p>
              <h3 id="bank-modal-title" class="text-lg font-semibold text-graphite-steel">Nauja banko sąskaita</h3>
            </div>
            <button class="btn-ghost h-10 w-10 p-0" data-action="cancel-bank" aria-label="Uždaryti">${icon("x")}</button>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <form id="bank-form" class="space-y-4">
              <div id="bank-form-errors" class="hidden bg-ordinn-red/5 border border-ordinn-red/30 text-ordinn-red rounded-lg p-3 text-sm"></div>
              <label class="space-y-1 text-sm">
                <span>Banko pavadinimas *</span>
                <select name="bank_name" data-section="bank" data-field="bank_name" class="input-field">
                  ${BANK_OPTIONS.map((b) => `<option value="${b}">${b}</option>`).join("")}
                </select>
              </label>
              <label class="space-y-1 text-sm">
                <span>Sąskaitos numeris (IBAN) *</span>
                <input name="account_number" data-section="bank" data-field="account_number" class="input-field" placeholder="LT00 0000 0000 0000 0000">
              </label>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_default" data-section="bank" data-field="is_default" class="h-4 w-4">
                <span>Nustatyti kaip numatytąją</span>
              </label>
            </form>
          </div>
          <div class="border-t border-ghost-concrete px-6 py-4 flex items-center justify-end gap-2">
            <button class="btn-ghost" data-action="cancel-bank">Atšaukti</button>
            <button class="btn-primary" data-action="save-bank">${icon("save")} Išsaugoti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    els.bankModal = {
      root: modal,
      title: modal.querySelector("#bank-modal-title"),
      form: modal.querySelector("#bank-form"),
      errors: modal.querySelector("#bank-form-errors"),
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeBankModal();
    });
    modal.addEventListener("input", handleBankModalInput);
    modal.addEventListener("change", handleBankModalInput);
    modal.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      if (actionEl.dataset.action === "cancel-bank") {
        closeBankModal();
      }
      if (actionEl.dataset.action === "save-bank") {
        if (state.bankModalMode === "edit" && state.bankForm.id) {
          editBankAccount(state.bankForm.id);
        } else {
          createBankAccount();
        }
      }
    });
  }

  function handleBankModalInput(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    if (field === "is_default") {
      state.bankForm.is_default = event.target.checked;
    } else {
      state.bankForm[field] = event.target.value;
    }
  }

  function openBankModal(mode = "create", id) {
    state.bankModalMode = mode;
    state.bankErrors = [];
    if (mode === "edit") {
      const acc = state.bankAccounts.find((a) => String(a.id) === String(id));
      if (!acc) return;
      state.bankForm = {
        id: acc.id,
        bank_name: acc.bank_name || BANK_OPTIONS[0],
        account_number: acc.account_number || "",
        is_default: !!acc.is_default,
      };
    } else {
      state.bankForm = createBankForm();
    }
    syncBankModal();
    els.bankModal?.root.classList.remove("hidden");
    renderIcons();
  }

  function syncBankModal() {
    if (!els.bankModal?.form) return;
    els.bankModal.title.textContent =
      state.bankModalMode === "edit" ? "Redaguoti banko sąskaitą" : "Nauja banko sąskaita";
    els.bankModal.form.bank_name.value = state.bankForm.bank_name || BANK_OPTIONS[0];
    els.bankModal.form.account_number.value = state.bankForm.account_number || "";
    els.bankModal.form.is_default.checked = !!state.bankForm.is_default;
    renderBankModalErrors();
  }

  function renderBankModalErrors() {
    if (!els.bankModal?.errors) return;
    if (!state.bankErrors.length) {
      els.bankModal.errors.classList.add("hidden");
      els.bankModal.errors.innerHTML = "";
      return;
    }
    els.bankModal.errors.classList.remove("hidden");
    els.bankModal.errors.innerHTML = state.bankErrors.map((e) => `<p>• ${e}</p>`).join("");
  }

  function closeBankModal() {
    els.bankModal?.root.classList.add("hidden");
  }

  function buildSeriesModal() {
    const modal = document.createElement("div");
    modal.id = "series-modal";
    modal.className = "fixed inset-0 z-50 hidden";
    modal.innerHTML = `
      <div class="absolute inset-0 bg-graphite-steel/60 backdrop-blur-sm"></div>
      <div class="relative z-10 flex min-h-full items-center justify-center px-4 py-6">
        <div class="bg-white border border-ghost-concrete rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ghost-concrete">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-graphite-steel/60">Serijos kortelė</p>
              <h3 id="series-modal-title" class="text-lg font-semibold text-graphite-steel">Nauja serija</h3>
            </div>
            <button class="btn-ghost h-10 w-10 p-0" data-action="cancel-series" aria-label="Uždaryti">${icon("x")}</button>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <form id="series-form" class="space-y-4">
              <div id="series-form-errors" class="hidden bg-ordinn-red/5 border border-ordinn-red/30 text-ordinn-red rounded-lg p-3 text-sm"></div>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="space-y-1 text-sm">
                  <span>Serijos kodas *</span>
                  <input name="series_code" data-section="series" data-field="series_code" class="input-field uppercase" placeholder="SF">
                </label>
                <label class="space-y-1 text-sm">
                  <span>Pradžios numeris *</span>
                  <input name="start_number" type="number" min="1" data-section="series" data-field="start_number" class="input-field" placeholder="1">
                </label>
                <label class="space-y-1 text-sm md:col-span-2">
                  <span>Aprašymas</span>
                  <textarea name="description" rows="3" data-section="series" data-field="description" class="input-field" placeholder="Trumpas paaiškinimas"></textarea>
                </label>
              </div>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" data-section="series" data-field="active" class="h-4 w-4" checked>
                <span>Serija aktyvi</span>
              </label>
              <p class="text-xs text-graphite-steel/70">Dabartinis numeris negali būti redaguojamas rankiniu būdu – jis didėja automatiškai išrašant sąskaitas.</p>
            </form>
          </div>
          <div class="border-t border-ghost-concrete px-6 py-4 flex items-center justify-end gap-2">
            <button class="btn-ghost" data-action="cancel-series">Atšaukti</button>
            <button class="btn-primary" data-action="save-series">${icon("save")} Išsaugoti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    els.seriesModal = {
      root: modal,
      title: modal.querySelector("#series-modal-title"),
      form: modal.querySelector("#series-form"),
      errors: modal.querySelector("#series-form-errors"),
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeSeriesModal();
    });
    modal.addEventListener("input", handleSeriesModalInput);
    modal.addEventListener("change", handleSeriesModalInput);
    modal.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      if (actionEl.dataset.action === "cancel-series") {
        closeSeriesModal();
      }
      if (actionEl.dataset.action === "save-series") {
        if (state.seriesModalMode === "edit" && state.seriesForm.id) {
          editInvoiceSeries(state.seriesForm.id);
        } else {
          createInvoiceSeries();
        }
      }
    });
  }

  function handleSeriesModalInput(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    if (field === "active") {
      state.seriesForm.active = event.target.checked;
    } else if (field === "start_number") {
      state.seriesForm.start_number = Number(event.target.value) || 1;
    } else if (field === "series_code") {
      const value = (event.target.value || "").toUpperCase();
      event.target.value = value;
      state.seriesForm.series_code = value;
    } else {
      state.seriesForm[field] = event.target.value;
    }
  }

  function openSeriesModal(mode = "create", id) {
    state.seriesModalMode = mode;
    state.seriesErrors = [];
    if (mode === "edit") {
      const found = state.series.find((s) => String(s.id) === String(id));
      if (!found) return;
      state.seriesForm = {
        id: found.id,
        series_code: (found.series_code || "").toUpperCase(),
        description: found.description || "",
        start_number: found.start_number || found.current_number || 1,
        active: !!found.active,
      };
    } else {
      state.seriesForm = createSeriesForm();
    }
    syncSeriesModal();
    els.seriesModal?.root.classList.remove("hidden");
    renderIcons();
  }

  function syncSeriesModal() {
    if (!els.seriesModal?.form) return;
    els.seriesModal.title.textContent =
      state.seriesModalMode === "edit" ? "Redaguoti seriją" : "Nauja serija";
    els.seriesModal.form.series_code.value = state.seriesForm.series_code || "";
    els.seriesModal.form.description.value = state.seriesForm.description || "";
    els.seriesModal.form.start_number.value = state.seriesForm.start_number || 1;
    els.seriesModal.form.start_number.disabled = state.seriesModalMode === "edit";
    els.seriesModal.form.querySelector('[data-field="active"]').checked = !!state.seriesForm.active;
    renderSeriesModalErrors();
  }

  function renderSeriesModalErrors() {
    if (!els.seriesModal?.errors) return;
    if (!state.seriesErrors.length) {
      els.seriesModal.errors.classList.add("hidden");
      els.seriesModal.errors.innerHTML = "";
      return;
    }
    els.seriesModal.errors.classList.remove("hidden");
    els.seriesModal.errors.innerHTML = state.seriesErrors.map((e) => `<p>• ${e}</p>`).join("");
  }

  function closeSeriesModal() {
    els.seriesModal?.root.classList.add("hidden");
  }

  async function loadAll() {
    await Promise.all([loadCompanyInfo(), loadBankAccounts(), loadInvoiceSeries(), loadGeneralSettings()]);
  }

  buildBankModal();
  buildSeriesModal();
  renderLayout();
  loadAll();
})();

