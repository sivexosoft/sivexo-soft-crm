
import { requireSupabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  leads: [],
  filtered: [],
  servicesByLead: new Map(),
  selected: new Set(),
  page: 1,
  pageSize: 10
};

const STAGES = {
  new: "New Lead",
  first_message_sent: "First Message Sent",
  follow_up: "Follow-up",
  call_done: "Call Done",
  interested: "Interested",
  not_interested: "Not Interested",
  future_opportunity: "Future Opportunity",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost"
};

const CONTACTED_STAGES = new Set(
  Object.keys(STAGES).filter((stage) => stage !== "new")
);

const SERVICE_OPTIONS = [
  "Web Development",
  "App Development",
  "Digital Marketing",
  "Graphic Design",
  "SEO & Automation",
  "Branding",
  "AI Solutions",
  "Social Media Management"
];

const FIELDS = [
  ["business_name", "Business name", "text", true],
  ["contact", "Primary contact", "text"],
  ["contact_2", "Second contact", "text"],
  ["email", "Email", "email"],
  ["website_url", "Website URL", "url"],
  ["country", "Country", "text"],
  ["category", "Category", "text"],
  ["address", "Address", "text"],
  ["next_follow_up_at", "Next follow-up", "datetime-local"],
  ["optional_details", "Notes / details", "textarea"]
];

/* =========================================================
   HELPERS
   ========================================================= */

function showMessage(message, type = "success") {
  const el = $("pageMessage");
  if (!el) return;

  el.textContent = message;
  el.className =
    `business-message show${
      type === "error"
        ? " error"
        : type === "warning"
          ? " warning"
          : ""
    }`;
}

function clearMessage() {
  const el = $("pageMessage");
  if (!el) return;

  el.textContent = "";
  el.className = "business-message";
}

function safeText(value, fallback = "—") {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return fallback;
  }

  return String(value);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 16);
}

function stageLabel(stage) {
  return STAGES[stage] || String(stage || "New Lead");
}

function createElement(tag, className = "", text) {
  const element = document.createElement(tag);

  if (className) element.className = className;

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function createBadge(text, className) {
  return createElement("span", className, text);
}

function makeCell(row, content, className = "") {
  const cell = document.createElement("td");

  if (className) cell.className = className;

  if (content instanceof Node) {
    cell.appendChild(content);
  } else {
    cell.textContent = content ?? "";
  }

  row.appendChild(cell);
  return cell;
}

function getLeadServices(leadId) {
  return state.servicesByLead.get(leadId) || [];
}

function getClient() {
  const client = requireSupabase();

  if (!client) {
    showMessage(
      "Supabase is not configured. Check assets/js/config.js.",
      "error"
    );
  }

  return client;
}

/* =========================================================
   SEARCH AND FILTERS
   ========================================================= */

function leadMatchesSearch(lead, search) {
  if (!search) return true;

  const services = getLeadServices(lead.id).join(" ");

  const haystack = [
    lead.business_name,
    lead.contact,
    lead.contact_2,
    lead.email,
    lead.country,
    lead.website_url,
    lead.category,
    lead.address,
    lead.optional_details,
    lead.lead_source,
    services
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function populateCountryFilter() {
  const select = $("countryFilter");
  if (!select) return;

  const previous = select.value;

  const countries = [
    ...new Set(
      state.leads
        .map((lead) => lead.country)
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  select.replaceChildren(new Option("All countries", ""));

  countries.forEach((country) => {
    select.add(new Option(country, country));
  });

  if (countries.includes(previous)) {
    select.value = previous;
  }
}

function renderStats() {
  const leads = state.leads;

  const dueCount = leads.filter((lead) => {
    if (!lead.next_follow_up_at) return false;

    return (
      new Date(lead.next_follow_up_at).getTime() <= Date.now()
    );
  }).length;

  if ($("statTotal")) {
    $("statTotal").textContent = leads.length;
  }

  if ($("statContacted")) {
    $("statContacted").textContent = leads.filter(
      (lead) => CONTACTED_STAGES.has(lead.stage)
    ).length;
  }

  if ($("statFollowUp")) {
    $("statFollowUp").textContent = dueCount;
  }

  if ($("statInterested")) {
    $("statInterested").textContent = leads.filter(
      (lead) => lead.stage === "interested"
    ).length;
  }

  if ($("statWon")) {
    $("statWon").textContent = leads.filter(
      (lead) => lead.stage === "won"
    ).length;
  }
}

function applyFilters(resetPage = true) {
  clearMessage();

  const search = (
    $("businessSearch")?.value || ""
  ).trim().toLowerCase();

  const country = $("countryFilter")?.value || "";
  const service = $("serviceFilter")?.value || "";
  const stage = $("stageFilter")?.value || "";

  state.filtered = state.leads.filter((lead) => {
    if (!leadMatchesSearch(lead, search)) return false;
    if (country && lead.country !== country) return false;
    if (stage && lead.stage !== stage) return false;

    if (
      service &&
      !getLeadServices(lead.id).includes(service)
    ) {
      return false;
    }

    return true;
  });

  if (resetPage) state.page = 1;

  const maxPage = Math.max(
    1,
    Math.ceil(state.filtered.length / state.pageSize)
  );

  state.page = Math.min(state.page, maxPage);

  renderTable();
}

/* =========================================================
   TABLE RENDERING
   ========================================================= */

function renderTable() {
  const tbody = $("businessTableBody");
  if (!tbody) return;

  tbody.replaceChildren();

  const total = state.filtered.length;

  const pages = Math.max(
    1,
    Math.ceil(total / state.pageSize)
  );

  const start = total
    ? (state.page - 1) * state.pageSize
    : 0;

  const visible = state.filtered.slice(
    start,
    start + state.pageSize
  );

  const end = Math.min(
    start + state.pageSize,
    total
  );

  if ($("paginationInfo")) {
    $("paginationInfo").textContent = total
      ? `Showing ${start + 1}–${end} of ${total}`
      : "Showing 0 businesses";
  }

  if ($("pageNumber")) {
    $("pageNumber").textContent = `${state.page} / ${pages}`;
  }

  if ($("prevPage")) {
    $("prevPage").disabled = state.page <= 1;
  }

  if ($("nextPage")) {
    $("nextPage").disabled = state.page >= pages;
  }

  if ($("tableSummary")) {
    $("tableSummary").textContent =
      `${total} matching business${total === 1 ? "" : "es"} · ` +
      `${state.leads.length} active in total`;
  }

  if ($("selectAll")) {
    $("selectAll").checked =
      visible.length > 0 &&
      visible.every((lead) => state.selected.has(lead.id));
  }

  if (!visible.length) {
    const row = document.createElement("tr");

    const cell = createElement(
      "td",
      "table-empty",
      state.leads.length
        ? "No businesses match these filters. Try changing your search."
        : "No businesses yet. Add your first lead to get started."
    );

    cell.colSpan = 8;
    row.appendChild(cell);
    tbody.appendChild(row);

    return;
  }

  visible.forEach((lead) => {
    const row = document.createElement("tr");

    /* Select checkbox */

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(lead.id);

    checkbox.setAttribute(
      "aria-label",
      `Select ${lead.business_name}`
    );

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selected.add(lead.id);
      } else {
        state.selected.delete(lead.id);
      }

      renderTable();
    });

    makeCell(row, checkbox);

    /* Business name and email */

    const businessCell = createElement("div", "business-cell");

    const avatar = createElement(
      "span",
      "business-avatar",
      safeText(lead.business_name, "?").charAt(0).toUpperCase()
    );

    avatar.setAttribute("aria-hidden", "true");

    const businessText = createElement("div", "business-text");

    businessText.appendChild(
      createElement(
        "span",
        "business-name",
        safeText(lead.business_name)
      )
    );

    businessText.appendChild(
      createElement(
        "span",
        "business-email",
        safeText(
          lead.email,
          safeText(lead.website_url, "No email or website")
        )
      )
    );

    businessCell.append(avatar, businessText);
    makeCell(row, businessCell);

    /* Contact */

    makeCell(
      row,
      safeText(lead.contact || lead.contact_2)
    );

    /* Country */

    makeCell(
      row,
      createElement(
        "span",
        "country-cell",
        safeText(lead.country)
      )
    );

    /* Services */

    const services = getLeadServices(lead.id);
    const serviceContainer = document.createElement("div");

    if (services.length) {
      serviceContainer.appendChild(
        createBadge(services[0], "service-badge")
      );

      if (services.length > 1) {
        serviceContainer.appendChild(
          createElement(
            "span",
            "business-email",
            `+${services.length - 1} more`
          )
        );
      }
    } else {
      serviceContainer.appendChild(
        createBadge(
          safeText(lead.category, "Unassigned"),
          "service-badge"
        )
      );
    }

    makeCell(row, serviceContainer);

    /* Stage */

    const stageClass = STAGES[lead.stage]
      ? lead.stage
      : "new";

    makeCell(
      row,
      createBadge(
        stageLabel(lead.stage),
        `stage-badge stage-${stageClass}`
      )
    );

    /* Follow-up */

    makeCell(
      row,
      formatDate(lead.next_follow_up_at)
    );

    /* Actions */

    const actions = createElement("div", "business-actions");

    const viewButton = createElement(
      "button",
      "view-button",
      "View"
    );

    viewButton.type = "button";
    viewButton.addEventListener("click", () => {
      openBusinessModal(lead, false);
    });

    const editButton = createElement(
      "button",
      "view-button",
      "Edit"
    );

    editButton.type = "button";
    editButton.title = "Edit business";

    editButton.addEventListener("click", () => {
      openBusinessModal(lead, true);
    });

    const menuButton = createElement(
      "button",
      "row-menu",
      "⋮"
    );

    menuButton.type = "button";

    menuButton.setAttribute(
      "aria-label",
      `Actions for ${lead.business_name}`
    );

    menuButton.addEventListener("click", () => {
      openBusinessActions(lead);
    });

    actions.append(viewButton, editButton, menuButton);
    makeCell(row, actions);

    tbody.appendChild(row);
  });
}

/* =========================================================
   LOAD BUSINESSES FROM SUPABASE
   ========================================================= */

async function loadBusinesses() {
  const client = requireSupabase();

  if (!client) {
    showMessage(
      "Supabase is not configured. Check assets/js/config.js and your project URL/key.",
      "error"
    );

    const tbody = $("businessTableBody");

    if (tbody) {
      tbody.replaceChildren();

      const row = document.createElement("tr");

      const cell = createElement(
        "td",
        "table-empty",
        "Database connection is not configured."
      );

      cell.colSpan = 8;
      row.appendChild(cell);
      tbody.appendChild(row);
    }

    return;
  }

  const {
    data: sessionData,
    error: sessionError
  } = await client.auth.getSession();

  if (sessionError || !sessionData?.session) {
    window.location.replace("index.html");
    return;
  }

  state.user = sessionData.session.user;

  const { data: leads, error } = await client
    .from("leads")
    .select(`
      id,
      user_id,
      business_name,
      contact,
      contact_2,
      website_url,
      email,
      country,
      category,
      address,
      optional_details,
      lead_source,
      stage,
      next_follow_up_at,
      is_archived,
      created_at,
      updated_at
    `)
    .eq("user_id", state.user.id)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Unable to load leads:", error);
    showMessage(
      `Could not load businesses: ${error.message}`,
      "error"
    );
    return;
  }

  state.leads = leads || [];
  state.selected.clear();
  state.servicesByLead.clear();

  if (state.leads.length) {
    const ids = state.leads.map((lead) => lead.id);

    const {
      data: serviceRows,
      error: serviceError
    } = await client
      .from("lead_services")
      .select("lead_id, service_name")
      .eq("user_id", state.user.id)
      .in("lead_id", ids);

    if (serviceError) {
      console.warn("Unable to load lead services:", serviceError);

      showMessage(
        "Businesses loaded, but service labels could not be loaded. Check lead_services and its RLS policies.",
        "warning"
      );
    } else {
      (serviceRows || []).forEach((item) => {
        const services =
          state.servicesByLead.get(item.lead_id) || [];

        services.push(item.service_name);

        state.servicesByLead.set(
          item.lead_id,
          services
        );
      });
    }
  }

  renderStats();
  populateCountryFilter();

  const params = new URLSearchParams(window.location.search);
  const stage = params.get("stage");

  if (stage && STAGES[stage] && $("stageFilter")) {
    $("stageFilter").value = stage;
  }

  applyFilters();

  if (params.get("add") === "1") {
    showMessage(
      "Your business list is ready. Use Add Business to create a new lead.",
      "warning"
    );
  }
}

/* =========================================================
   MODAL HELPERS
   ========================================================= */

function ensureModalRoot() {
  let root = $("businessModalRoot");

  if (!root) {
    root = document.createElement("div");
    root.id = "businessModalRoot";
    document.body.appendChild(root);
  }

  return root;
}

function closeModal() {
  ensureModalRoot().replaceChildren();
}

function modalShell(title, subtitle = "") {
  const root = ensureModalRoot();
  root.replaceChildren();

  const backdrop = createElement("div", "crm-modal-backdrop");

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  const card = createElement("section", "crm-modal-card");

  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", title);

  const head = createElement("div", "crm-modal-head");
  const headingWrap = document.createElement("div");

  headingWrap.appendChild(
    createElement("h2", "crm-modal-title", title)
  );

  if (subtitle) {
    headingWrap.appendChild(
      createElement("p", "crm-modal-subtitle", subtitle)
    );
  }

  const closeButton = createElement(
    "button",
    "crm-modal-close",
    "×"
  );

  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close dialog");
  closeButton.addEventListener("click", closeModal);

  head.append(headingWrap, closeButton);
  card.appendChild(head);
  backdrop.appendChild(card);
  root.appendChild(backdrop);

  const onKey = (event) => {
    if (event.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", onKey);
    }
  };

  document.addEventListener("keydown", onKey);

  return card;
}

function displayDetail(parent, label, value, full = false) {
  const box = createElement(
    "div",
    `crm-detail${full ? " full" : ""}`
  );

  box.appendChild(createElement("small", "", label));

  box.appendChild(
    createElement("span", "", safeText(value))
  );

  parent.appendChild(box);
}

/* =========================================================
   VIEW AND EDIT BUSINESS
   ========================================================= */

function openBusinessModal(lead, editMode = false) {
  const card = modalShell(
    editMode ? "Edit business" : safeText(lead.business_name),
    editMode
      ? "Update lead details and services."
      : `Created ${formatDate(lead.created_at)}`
  );

  /* VIEW MODE */

  if (!editMode) {
    const details = createElement("div", "crm-detail-list");

    [
      ["Business name", lead.business_name],
      ["Primary contact", lead.contact],
      ["Second contact", lead.contact_2],
      ["Email", lead.email],
      ["Website", lead.website_url],
      ["Country", lead.country],
      ["Category", lead.category],
      ["Address", lead.address],
      ["Stage", stageLabel(lead.stage)],
      ["Next follow-up", formatDate(lead.next_follow_up_at)],
      ["Lead source", lead.lead_source],
      ["Services", getLeadServices(lead.id).join(", ")],
      ["Notes / details", lead.optional_details]
    ].forEach(([label, value]) => {
      displayDetail(
        details,
        label,
        value,
        label === "Notes / details"
      );
    });

    card.appendChild(details);

    const actions = createElement("div", "crm-modal-actions");

    const editButton = createElement(
      "button",
      "primary",
      "Edit business"
    );

    editButton.type = "button";
    editButton.addEventListener("click", () => {
      openBusinessModal(lead, true);
    });

    const closeButton = createElement(
      "button",
      "",
      "Close"
    );

    closeButton.type = "button";
    closeButton.addEventListener("click", closeModal);

    actions.append(editButton, closeButton);
    card.appendChild(actions);

    return;
  }

  /* EDIT MODE */

  const form = document.createElement("form");
  const grid = createElement("div", "crm-modal-grid");
  const inputs = {};

  FIELDS.forEach(([key, label, type, required]) => {
    const wrap = createElement(
      "div",
      `crm-field${key === "optional_details" ? " full" : ""}`
    );

    const labelEl = createElement("label", "", label);

    const input =
      key === "optional_details"
        ? document.createElement("textarea")
        : document.createElement("input");

    input.name = key;
    input.id = `edit-${key}`;
    input.required = Boolean(required);

    if (key !== "optional_details") {
      input.type = type;
    }

    if (key === "next_follow_up_at") {
      input.value = toDateTimeLocal(lead[key]);
    } else {
      input.value = lead[key] ?? "";
    }

    labelEl.htmlFor = input.id;

    wrap.append(labelEl, input);
    grid.appendChild(wrap);
    inputs[key] = input;
  });

  /* Pipeline stage */

  const stageWrap = createElement("div", "crm-field");
  const stageLabelEl = createElement(
    "label",
    "",
    "Pipeline stage"
  );

  const stageSelect = document.createElement("select");
  stageSelect.name = "stage";
  stageSelect.id = "edit-stage";

  Object.entries(STAGES).forEach(([key, label]) => {
    stageSelect.add(new Option(label, key));
  });

  stageSelect.value = lead.stage || "new";
  stageLabelEl.htmlFor = stageSelect.id;

  stageWrap.append(stageLabelEl, stageSelect);
  grid.appendChild(stageWrap);

  /* Service multi-select */

  const servicesWrap = createElement("div", "crm-field full");

  servicesWrap.appendChild(
    createElement(
      "label",
      "",
      "Services (select all that apply)"
    )
  );

  const serviceOptions = createElement(
    "div",
    "crm-service-options"
  );

  const existingServices = new Set(
    getLeadServices(lead.id)
  );

  SERVICE_OPTIONS.forEach((service) => {
    const label = createElement(
      "label",
      "crm-service-option"
    );

    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = service;
    checkbox.checked = existingServices.has(service);

    label.append(
      checkbox,
      document.createTextNode(service)
    );

    serviceOptions.appendChild(label);
  });

  servicesWrap.appendChild(serviceOptions);
  grid.appendChild(servicesWrap);
  form.appendChild(grid);

  /* Form buttons */

  const actions = createElement("div", "crm-modal-actions");

  const cancelButton = createElement(
    "button",
    "",
    "Cancel"
  );

  cancelButton.type = "button";
  cancelButton.addEventListener("click", closeModal);

  const saveButton = createElement(
    "button",
    "primary",
    "Save changes"
  );

  saveButton.type = "submit";

  actions.append(cancelButton, saveButton);
  form.appendChild(actions);
  card.appendChild(form);

  /* Save changes */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!inputs.business_name.value.trim()) {
      inputs.business_name.focus();
      showMessage("Business name is required.", "warning");
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving…";

    const patch = {};

    FIELDS.forEach(([key]) => {
      let value = inputs[key].value.trim();

      if (key === "next_follow_up_at") {
        value = value
          ? new Date(value).toISOString()
          : null;
      } else {
        value = value || null;
      }

      patch[key] = value;
    });

    patch.business_name =
      inputs.business_name.value.trim();

    patch.stage = stageSelect.value;

    const client = getClient();

    if (!client) {
      saveButton.disabled = false;
      saveButton.textContent = "Save changes";
      return;
    }

    const {
      error: updateError
    } = await client
      .from("leads")
      .update(patch)
      .eq("id", lead.id)
      .eq("user_id", state.user.id);

    if (updateError) {
      console.error("Lead update failed:", updateError);

      showMessage(
        `Could not save changes: ${updateError.message}`,
        "error"
      );

      saveButton.disabled = false;
      saveButton.textContent = "Save changes";

      return;
    }

    const selectedServices = [
      ...serviceOptions.querySelectorAll(
        'input[type="checkbox"]:checked'
      )
    ].map((input) => input.value);

    const {
      error: deleteServiceError
    } = await client
      .from("lead_services")
      .delete()
      .eq("lead_id", lead.id)
      .eq("user_id", state.user.id);

    if (deleteServiceError) {
      console.error(
        "Could not replace services:",
        deleteServiceError
      );

      closeModal();
      await loadBusinesses();

      showMessage(
        `Business details saved, but services could not be updated: ${deleteServiceError.message}`,
        "warning"
      );

      return;
    }

    if (selectedServices.length) {
      const rows = selectedServices.map((service_name) => ({
        user_id: state.user.id,
        lead_id: lead.id,
        service_name
      }));

      const {
        error: insertError
      } = await client
        .from("lead_services")
        .insert(rows);

      if (insertError) {
        console.error(
          "Service update failed:",
          insertError
        );

        closeModal();
        await loadBusinesses();

        showMessage(
          `Business details saved, but services could not be saved: ${insertError.message}`,
          "warning"
        );

        return;
      }
    }

    closeModal();
    await loadBusinesses();

    showMessage("Business updated successfully.");
  });
}

/* =========================================================
   ROW ACTIONS
   ========================================================= */

function openBusinessActions(lead) {
  const card = modalShell(
    "Business actions",
    safeText(lead.business_name)
  );

  const stageWrap = createElement("div", "crm-field");

  const label = createElement(
    "label",
    "",
    "Change pipeline stage"
  );

  const select = document.createElement("select");
  select.id = "action-stage";

  Object.entries(STAGES).forEach(([key, text]) => {
    select.add(new Option(text, key));
  });

  select.value = lead.stage || "new";
  label.htmlFor = select.id;

  stageWrap.append(label, select);
  card.appendChild(stageWrap);

  const actions = createElement("div", "crm-modal-actions");

  const cancelButton = createElement(
    "button",
    "",
    "Cancel"
  );

  cancelButton.type = "button";
  cancelButton.addEventListener("click", closeModal);

  const updateButton = createElement(
    "button",
    "primary",
    "Update stage"
  );

  updateButton.type = "button";

  updateButton.addEventListener("click", async () => {
    updateButton.disabled = true;
    updateButton.textContent = "Updating…";

    await updateLeadStages([lead.id], select.value);
  });

  const archiveButton = createElement(
    "button",
    "danger",
    "Archive"
  );

  archiveButton.type = "button";

  archiveButton.addEventListener("click", async () => {
    closeModal();
    await archiveLeads([lead.id]);
  });

  actions.append(
    cancelButton,
    updateButton,
    archiveButton
  );

  card.appendChild(actions);

  card.appendChild(
    createElement(
      "p",
      "crm-modal-note",
      "Archiving hides this lead from the active list. It does not permanently delete it."
    )
  );
}

/* =========================================================
   UPDATE PIPELINE STAGE
   ========================================================= */

async function updateLeadStages(ids, stage) {
  if (!ids.length || !STAGES[stage]) {
    showMessage(
      "Select businesses and choose a valid stage.",
      "warning"
    );
    return;
  }

  const client = getClient();
  if (!client) return;

  const { error } = await client
    .from("leads")
    .update({ stage })
    .eq("user_id", state.user.id)
    .in("id", ids);

  if (error) {
    console.error("Stage update failed:", error);

    showMessage(
      `Could not update stages: ${error.message}`,
      "error"
    );

    return;
  }

  closeModal();

  ids.forEach((id) => state.selected.delete(id));

  await loadBusinesses();

  showMessage(
    `Updated ${ids.length} business${ids.length === 1 ? "" : "es"}.`
  );
}

/* =========================================================
   ARCHIVE BUSINESSES
   ========================================================= */

async function archiveLeads(ids) {
  if (!ids.length) {
    showMessage(
      "Select at least one business first.",
      "warning"
    );
    return;
  }

  const confirmed = window.confirm(
    `Archive ${ids.length} business${ids.length === 1 ? "" : "es"}? You can restore them later from Archive.`
  );

  if (!confirmed) return;

  const client = getClient();
  if (!client) return;

  const { error } = await client
    .from("leads")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString()
    })
    .eq("user_id", state.user.id)
    .in("id", ids);

  if (error) {
    console.error("Archiving failed:", error);

    showMessage(
      `Could not archive businesses: ${error.message}`,
      "error"
    );

    return;
  }

  ids.forEach((id) => state.selected.delete(id));

  await loadBusinesses();

  showMessage(
    `Archived ${ids.length} business${ids.length === 1 ? "" : "es"}.`
  );
}

/* =========================================================
   EXPORT CSV
   ========================================================= */

function exportCSV() {
  const selectedRows = state.filtered.filter(
    (lead) => state.selected.has(lead.id)
  );

  const rows = selectedRows.length
    ? selectedRows
    : state.filtered;

  if (!rows.length) {
    showMessage(
      "There are no businesses to export.",
      "warning"
    );
    return;
  }

  const columns = [
    ["Business Name", (lead) => lead.business_name],
    ["Contact", (lead) => lead.contact],
    ["Contact 2", (lead) => lead.contact_2],
    ["Email", (lead) => lead.email],
    ["Website", (lead) => lead.website_url],
    ["Country", (lead) => lead.country],
    ["Category", (lead) => lead.category],
    [
      "Services",
      (lead) => getLeadServices(lead.id).join("; ")
    ],
    ["Stage", (lead) => stageLabel(lead.stage)],
    ["Next Follow-up", (lead) => lead.next_follow_up_at],
    ["Address", (lead) => lead.address],
    ["Lead Source", (lead) => lead.lead_source],
    ["Details", (lead) => lead.optional_details]
  ];

  function escapeCSV(value) {
    let text = String(value ?? "");

    // Prevent spreadsheet formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  const csv = [
    columns
      .map(([heading]) => escapeCSV(heading))
      .join(","),

    ...rows.map((lead) =>
      columns
        .map(([, getter]) => escapeCSV(getter(lead)))
        .join(",")
    )
  ].join("\r\n");

  const blob = new Blob(
    ["\uFEFF", csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `sivexo-businesses-${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  showMessage(
    `Exported ${rows.length} business${rows.length === 1 ? "" : "es"} to CSV.`
  );
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

function bindEvents() {
  $("businessSearch")?.addEventListener(
    "input",
    () => applyFilters()
  );

  $("countryFilter")?.addEventListener(
    "change",
    () => applyFilters()
  );

  $("serviceFilter")?.addEventListener(
    "change",
    () => applyFilters()
  );

  $("stageFilter")?.addEventListener(
    "change",
    () => applyFilters()
  );

  $("filterButton")?.addEventListener(
    "click",
    () => applyFilters()
  );

  $("pageSize")?.addEventListener("change", (event) => {
    state.pageSize = Number(event.target.value) || 10;
    state.page = 1;
    renderTable();
  });

  $("prevPage")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderTable();
    }
  });

  $("nextPage")?.addEventListener("click", () => {
    const maxPage = Math.max(
      1,
      Math.ceil(state.filtered.length / state.pageSize)
    );

    if (state.page < maxPage) {
      state.page++;
      renderTable();
    }
  });

  $("selectAll")?.addEventListener("change", (event) => {
    const start = (state.page - 1) * state.pageSize;

    const visible = state.filtered.slice(
      start,
      start + state.pageSize
    );

    visible.forEach((lead) => {
      if (event.target.checked) {
        state.selected.add(lead.id);
      } else {
        state.selected.delete(lead.id);
      }
    });

    renderTable();
  });

  $("exportButton")?.addEventListener(
    "click",
    exportCSV
  );

  $("applyBulkButton")?.addEventListener(
    "click",
    async () => {
      const action = $("bulkAction")?.value;

      if (!state.selected.size) {
        showMessage(
          "Select one or more businesses first.",
          "warning"
        );
        return;
      }

      if (!action) {
        showMessage(
          "Choose a bulk action first.",
          "warning"
        );
        return;
      }

      const ids = [...state.selected];

      if (action === "archive") {
        await archiveLeads(ids);
      } else if (STAGES[action]) {
        await updateLeadStages(ids, action);
      }
    }
  );

  $("bulkAction")?.addEventListener("change", (event) => {
    const button = $("applyBulkButton");
    if (button) {
      button.style.display = event.target.value
        ? "inline-flex"
        : "none";
    }
  });

  $("logoutButton")?.addEventListener(
    "click",
    async () => {
      const client = getClient();
      if (!client) return;

      const { error } = await client.auth.signOut();

      if (error) {
        showMessage(
          `Could not log out: ${error.message}`,
          "error"
        );
        return;
      }

      window.location.replace("index.html");
    }
  );

  $("globalSearch")?.addEventListener("input", () => {
    const localSearch = $("businessSearch");
    const globalSearch = $("globalSearch");

    if (
      localSearch &&
      globalSearch &&
      localSearch.value !== globalSearch.value
    ) {
      localSearch.value = globalSearch.value;
      applyFilters();
    }
  });
}

/* =========================================================
   INITIALIZE PAGE
   ========================================================= */

bindEvents();

loadBusinesses().catch((error) => {
  console.error(
    "Business page initialization failed:",
    error
  );

  showMessage(
    "Something went wrong while loading your businesses. Check the browser console.",
    "error"
  );
});
