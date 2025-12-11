const DEFAULT_API_URL = "http://localhost:5000/api";

class ApiError extends Error {
    constructor(message, { status, data, url, original } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
        this.url = url;
        this.original = original;
    }
}

class InvoiceAPI {
    constructor(baseURL = DEFAULT_API_URL) {
        this.baseURL = baseURL.replace(/\/+$/, "");
        this.authToken = null;
        this.loadingCount = 0;
        this.loadingListeners = new Set();
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        this.defaultTimeout = 15000;
        this.defaultRetries = 2;
    }

    get isLoading() {
        return this.loadingCount > 0;
    }

    onLoadingChange(listener) {
        if (typeof listener !== "function") return () => {};
        this.loadingListeners.add(listener);
        return () => this.loadingListeners.delete(listener);
    }

    setToken(token) {
        this.authToken = token || null;
    }

    clearToken() {
        this.authToken = null;
    }

    useRequest(interceptor) {
        this.requestInterceptors.push(interceptor);
        return () => this._removeInterceptor(this.requestInterceptors, interceptor);
    }

    useResponse(interceptor) {
        this.responseInterceptors.push(interceptor);
        return () => this._removeInterceptor(this.responseInterceptors, interceptor);
    }

    _removeInterceptor(collection, interceptor) {
        const idx = collection.indexOf(interceptor);
        if (idx >= 0) collection.splice(idx, 1);
    }

    _emitLoading() {
        this.loadingListeners.forEach((listener) => {
            try {
                listener(this.isLoading);
            } catch (err) {
                console.warn("Loading listener failed", err);
            }
        });
    }

    _beginRequest() {
        this.loadingCount += 1;
        this._emitLoading();
    }

    _endRequest() {
        this.loadingCount = Math.max(0, this.loadingCount - 1);
        this._emitLoading();
    }

    _buildURL(endpoint, params) {
        let url;
        if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
            url = new URL(endpoint);
        } else {
            const normalized = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
            url = new URL(normalized, `${this.baseURL}/`);
        }

        if (params && typeof params === "object") {
            Object.entries(params).forEach(([key, value]) => {
                if (value === undefined || value === null || value === "") return;
                if (Array.isArray(value)) {
                    value.forEach((val) => url.searchParams.append(key, val));
                } else {
                    url.searchParams.append(key, value);
                }
            });
        }

        return url;
    }

    async _applyRequestInterceptors(context) {
        let current = { ...context };
        for (const interceptor of this.requestInterceptors) {
            try {
                const updated = await interceptor({ ...current });
                if (updated && typeof updated === "object") {
                    current = {
                        ...current,
                        ...updated,
                        url: updated.url
                            ? updated.url instanceof URL
                                ? updated.url
                                : new URL(updated.url)
                            : current.url,
                    };
                }
            } catch (err) {
                console.warn("Request interceptor failed", err);
            }
        }
        return current;
    }

    async _applyResponseInterceptors(data, response, context) {
        let current = data;
        for (const interceptor of this.responseInterceptors) {
            try {
                const next = await interceptor(current, response, context);
                if (typeof next !== "undefined") {
                    current = next;
                }
            } catch (err) {
                console.warn("Response interceptor failed", err);
            }
        }
        return current;
    }

    _shouldRetry(error) {
        if (!error) return false;
        if (error instanceof ApiError) {
            if (error.status === 408) return true;
            if (error.status === 429) return true;
            if (error.status >= 500 || error.status === 0) return true;
            return false;
        }
        return true;
    }

    _backoff(attempt) {
        const base = 250;
        return Math.min(3000, base * 2 ** attempt);
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async _parseResponse(response, parseAs) {
        if (response.status === 204) return null;
        const contentType = response.headers.get("content-type") || "";
        const mode =
            parseAs ||
            (contentType.includes("application/json")
                ? "json"
                : contentType.includes("application/pdf") || contentType.includes("octet-stream")
                ? "blob"
                : "text");

        if (mode === "json") {
            try {
                return await response.json();
            } catch {
                return null;
            }
        }
        if (mode === "blob") {
            return await response.blob();
        }
        if (mode === "arrayBuffer") {
            return await response.arrayBuffer();
        }
        return await response.text();
    }

    async _extractErrorPayload(response) {
        const contentType = response.headers.get("content-type") || "";
        try {
            if (contentType.includes("application/json")) {
                return await response.json();
            }
            return await response.text();
        } catch {
            return null;
        }
    }

    _friendlyMessage(status, detail, original) {
        const detailText =
            typeof detail === "string"
                ? detail
                : detail && typeof detail === "object"
                ? detail.error || detail.message || ""
                : "";

        const defaultMessage = "Įvyko nenumatyta klaida. Bandykite dar kartą.";
        const statusMessages = {
            400: "Neteisinga užklausa. Patikrinkite duomenis.",
            401: "Prisijunkite, kad galėtumėte tęsti.",
            403: "Neturite teisės atlikti šio veiksmo.",
            404: "Prašomas įrašas nerastas.",
            408: "Užklausa užtruko per ilgai. Bandykite dar kartą.",
            409: "Veiksmas negalimas dėl konflikto arba būsenos.",
            422: "Neteisingi duomenys. Patikrinkite formą.",
            429: "Per daug užklausų. Bandykite vėliau.",
        };

        if (status >= 500) {
            return detailText || "Serveris laikinai nepasiekiamas. Bandykite dar kartą.";
        }
        if (status && statusMessages[status]) {
            return detailText || statusMessages[status];
        }
        if (status === 0) {
            return "Nepavyko prisijungti prie serverio. Patikrinkite interneto ryšį.";
        }

        if (original instanceof DOMException && original.name === "AbortError") {
            return "Užklausa nutraukta arba baigėsi laikas.";
        }

        return detailText || defaultMessage;
    }

    async _buildError(response, url) {
        const payload = await this._extractErrorPayload(response);
        const message = this._friendlyMessage(response.status, payload);
        return new ApiError(message, {
            status: response.status,
            data: payload,
            url: url.toString(),
        });
    }

    async request(endpoint, options = {}) {
        const {
            method = "GET",
            headers = {},
            params,
            body,
            retry = this.defaultRetries,
            parseAs,
            timeout = this.defaultTimeout,
            skipAuth = false,
        } = options;

        let url = this._buildURL(endpoint, params);
        let fetchOptions = {
            method,
            headers: {
                Accept: "application/json, text/plain, */*",
                ...headers,
            },
            credentials: "include",
        };

        if (body !== undefined && body !== null) {
            if (body instanceof FormData) {
                fetchOptions.body = body;
            } else {
                fetchOptions.body = JSON.stringify(body);
                fetchOptions.headers["Content-Type"] = "application/json";
            }
        }

        if (this.authToken && !skipAuth) {
            fetchOptions.headers.Authorization = `Bearer ${this.authToken}`;
        }

        let context = await this._applyRequestInterceptors({ url, options: fetchOptions });

        const attempts = Math.max(0, retry) + 1;
        this._beginRequest();
        try {
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const response = await fetch(context.url.toString(), {
                        ...context.options,
                        signal: controller.signal,
                    });
                    clearTimeout(timer);

                    if (!response.ok) {
                        const error = await this._buildError(response, context.url);
                        if (attempt < attempts - 1 && this._shouldRetry(error)) {
                            await this._delay(this._backoff(attempt));
                            continue;
                        }
                        throw error;
                    }

                    let data = await this._parseResponse(response, parseAs);
                    data = await this._applyResponseInterceptors(data, response, context);
                    return data;
                } catch (error) {
                    clearTimeout(timer);
                    const isAbort = error && error.name === "AbortError";
                    const wrapped =
                        error instanceof ApiError
                            ? error
                            : new ApiError(
                                  this._friendlyMessage(
                                      isAbort ? 408 : null,
                                      null,
                                      isAbort ? error : undefined
                                  ),
                                  {
                                      status: isAbort ? 408 : 0,
                                      url: context.url.toString(),
                                      original: error,
                                  }
                              );

                    if (attempt < attempts - 1 && this._shouldRetry(wrapped)) {
                        await this._delay(this._backoff(attempt));
                        continue;
                    }

                    throw wrapped;
                }
            }
        } finally {
            this._endRequest();
        }
    }

    // Generic convenience helpers
    async get(endpoint, params = {}, options = {}) {
        return this.request(endpoint, { ...options, method: "GET", params });
    }

    async post(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: "POST", body });
    }

    async put(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: "PUT", body });
    }

    async patch(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: "PATCH", body });
    }

    async delete(endpoint, params = {}, options = {}) {
        return this.request(endpoint, { ...options, method: "DELETE", params });
    }

    // Client endpoints
    async getClients(params = {}) {
        return this.get("/clients/", params);
    }

    async getClient(id) {
        return this.get(`/clients/${id}`);
    }

    async createClient(data) {
        return this.post("/clients/", data);
    }

    async updateClient(id, data) {
        return this.put(`/clients/${id}`, data);
    }

    async deleteClient(id, params = {}) {
        return this.delete(`/clients/${id}`, params);
    }

    async getClientInvoices(id, params = {}) {
        return this.get(`/clients/${id}/invoices`, params);
    }

    async getClientStatistics(id) {
        return this.get(`/clients/${id}/statistics`);
    }

    // Invoice endpoints
    async getInvoices(params = {}) {
        return this.get("/invoices/", params);
    }

    async getInvoice(id) {
        return this.get(`/invoices/${id}`);
    }

    async createInvoice(data) {
        return this.post("/invoices/", data);
    }

    async updateInvoice(id, data) {
        return this.put(`/invoices/${id}`, data);
    }

    async deleteInvoice(id) {
        return this.delete(`/invoices/${id}`);
    }

    async updateInvoiceStatus(id, status) {
        return this.patch(`/invoices/${id}/status`, { status });
    }

    async getInvoicePDF(id) {
        return this.request(`/invoices/${id}/pdf`, { parseAs: "blob" });
    }

    async duplicateInvoice(id) {
        return this.post(`/invoices/${id}/duplicate`);
    }

    async getNextInvoiceNumber(seriesId) {
        return this.get(`/invoices/next-number/${seriesId}`);
    }

    // Dashboard endpoints
    async getDashboardStatistics(year, month = null) {
        const params = { year };
        if (month !== null && month !== undefined) params.month = month;
        return this.get("/dashboard/statistics", params);
    }

    async getMonthlyData(year) {
        return this.get("/dashboard/monthly-data", { year });
    }

    async getRecentActivity() {
        return this.get("/dashboard/recent-activity");
    }

    // Settings endpoints
    async getCompanyInfo() {
        return this.get("/settings/company");
    }

    async updateCompanyInfo(data) {
        return this.put("/settings/company", data);
    }

    async getBankAccounts() {
        return this.get("/settings/bank-accounts");
    }

    async createBankAccount(data) {
        return this.post("/settings/bank-accounts", data);
    }

    async updateBankAccount(id, data) {
        return this.put(`/settings/bank-accounts/${id}`, data);
    }

    async deleteBankAccount(id) {
        return this.delete(`/settings/bank-accounts/${id}`);
    }

    async getInvoiceSeries() {
        return this.get("/settings/series");
    }

    async createInvoiceSeries(data) {
        return this.post("/settings/series", data);
    }

    async updateInvoiceSeries(id, data) {
        return this.put(`/settings/series/${id}`, data);
    }
}

// Export singleton instance for global use
const api = new InvoiceAPI();
window.api = api;
