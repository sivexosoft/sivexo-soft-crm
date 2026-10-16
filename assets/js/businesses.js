
import { requireSupabase } from "./supabase.js";

const supabase = requireSupabase();

const state = {
  user: null,
  leads: [],
  filteredLeads: [],
  servicesByLead: new Map(),
  selected: new Set(),
  page: 1,
  pageSize: 10,
  busyIds: new Set()
};

const STAGES = [
  ["new", "New Lead"],
  ["first_message_sent", "First Message Sent"],
  ["follow_up", "Follow-up"],
  ["call_done", "Call Done"],
  ["interested", "Interested"],
  ["not_interested", "Not Interested"],
  ["future_opportunity", "Future Opportunity"],
  ["proposal_sent", "Proposal Sent"],
  ["won", "Won"],
  ["lost", "Lost"]
];

const SERVICES = [
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
  ["business_name", "Business Name", "text"],
  ["contact", "Contact", "text"],
  ["contact_2", "Second Contact", "text"],
  ["email", "Email", "email"],
  ["website_url", "Website URL", "url"],
  ["country", "Country", "text"],
  ["category", "Category", "text"],
  ["address", "Address", "text"],
  ["next_follow_up_at", "Next Follow-up", "datetime-local"],
  ["optional_details", "Additional Details", "textarea"]
];

const $ = (id) => document.getElementById(id);

function escapeHTML(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(message, type = "success") {
  const el = $("pageMessage");
  if (!el) return;

  el.textContent = message;
  el.className = `page-message ${type}`;
  el.hidden = false;
}

function clearMessage() {
  const el = $("pageMessage");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function stageLabel(stage) {
  return STAGES.find(([value]) => value === stage)?.[1] || stage || "New Lead";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString();
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function servicesFor(id) {
  return state.servicesByLead.get(String(id)) || [];
}

function setServices(id, services) {
  state.servicesByLead.set(String(id), services);
}

function getStageOptions(current) {
  return STAGES.map(([value, label]) => `
    <option value="${escapeHTML(value)}"
      ${value === current ? "selected" : ""}>
      ${escapeHTML(label)}
    </option>
  `).join("");
}

function makeStageSelect(lead) {
  const select = document.createElement("select");
  select.className = "business-stage-select";
  select.setAttribute("aria-label", `Update status for ${lead.business_name || "business"}`);

  select.innerHTML = getStageOptions(lead.stage || "new");

  select.addEventListener("change", async () => {
    const newStage = select.value;
    const oldStage = lead.stage || "new";

    if (newStage === oldStage) return;

    select.disabled = true;
    clearMessage();

    try {
      const { error } = await supabase
        .from("leads")
        .update({ stage: newStage })
        .eq("id", lead.id)
        .eq("user_id", state.user.id);

      if (error) throw error;

      lead.stage = newStage;
      showMessage(`Status updated: ${lead.business_name} → ${stageLabel(newStage)}`);
      renderStats();
      applyFilters();
    } catch (error) {
      select.value = oldStage;
      showMessage(`Status update failed: ${error.message}`, "error");
    } finally {
      select.disabled = false;
    }
  });

  return select;
}

function addCell(row, content) {
  const td = document.createElement("td");

  if (content instanceof Node) {
    td.appendChild(content);
  } else {
    td.textContent = content ?? "—";
  }

  row.appendChild(td);
  return td;
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function getLeadServicesPayload() {
  return [...state.selected];
}

async function loadBusinesses() {
  clearMessage();

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  state.user = sessionData?.session?.user;

  if (!state.user) {
    window.location.href = "index.html";
    return;
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", state.user.id)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Businesses could not load. Check the leads table and is_archived column. ${error.message}`
    );
  }

  state.leads = leads || [];
  state.servicesByLead.clear();
  state.selected.clear();

  if (state.leads.length) {
    const ids = state.leads.map((lead) => lead.id);

    const { data: serviceRows, error: serviceError } = await supabase
      .from("lead_services")
      .select("lead_id, service_name")
      .eq("user_id", state.user.id)
      .in("lead_id", ids);

    if (serviceError) {
      console.error("Could not load lead services:", serviceError.message);
    } else {
      for (const item of serviceRows || []) {
        const id = String(item.lead_id);
        const existing = state.servicesByLead.get(id) || [];
        existing.push(item.service_name);
        state.servicesByLead.set(id, existing);
      }
    }
  }

  populateCountryFilter();
  renderStats();

  const params = new URLSearchParams(window.location.search);
  const stage = params.get("stage");

  if (stage && STAGES.some(([value]) => value === stage) && $("stageFilter")) {
    $("stageFilter").value = stage;
  }

  applyFilters();
}

function populateCountryFilter() {
  const select = $("countryFilter");
  if (!select) return;

  const current = select.value;
  const countries = [...new Set(
    state.leads.map((lead) => lead.country).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  select.innerHTML = '<option value="">All Countries</option>';

  for (const country of countries) {
    const option = document.createElement("option");
    option.value = country;
    option.textContent = country;
    select.appendChild(option);
  }

  if (countries.includes(current)) select.value = current;
}

function renderStats() {
  const leads = state.leads;

  if ($("statTotal")) $("statTotal").textContent = leads.length;
  if ($("statContacted")) {
    $("statContacted").textContent = leads.filter((lead) =>
      ["first_message_sent", "follow_up", "call_done", "interested",
        "not_interested", "future_opportunity", "proposal_sent", "won", "lost"]
        .includes(lead.stage)
    ).length;
  }

  if ($("statFollowUp")) {
    const now = Date.now();

    $("statFollowUp").textContent = leads.filter((lead) =>
      lead.next_follow_up_at &&
      new Date(lead.next_follow_up_at).getTime() <= now &&
      !["won", "lost", "not_interested"].includes(lead.stage)
    ).length;
  }

  if ($("statInterested")) {
    $("statInterested").textContent =
      leads.filter((lead) => lead.stage === "interested").length;
  }

  if ($("statWon")) {
    $("statWon").textContent =
      leads.filter((lead) => lead.stage === "won").length;
  }
}

function applyFilters() {
  const query = ($("businessSearch")?.value || "").trim().toLowerCase();
  const country = $("countryFilter")?.value || "";
  const service = $("serviceFilter")?.value || "";
  const stage = $("stageFilter")?.value || "";

  state.filteredLeads = state.leads.filter((lead) => {
    const leadServices = servicesFor(lead.id);

    const searchable = [
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
      lead.stage,
      ...leadServices
    ].join(" ").toLowerCase();

    return (!query || searchable.includes(query)) &&
      (!country || lead.country === country) &&
      (!service || leadServices.includes(service)) &&
      (!stage || lead.stage === stage);
  });

  state.page = 1;
  renderTable();
}

function renderTable() {
  const tbody = $("businessTableBody");
  if (!tbody) return;

  tbody.replaceChildren();

  const total = state.filteredLeads.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));

  state.page = Math.min(state.page, pageCount);

  const start = (state.page - 1) * state.pageSize;
  const rows = state.filteredLeads.slice(start, start + state.pageSize);

  for (const lead of rows) {
    const tr = document.createElement("tr");
    const id = String(lead.id);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(id);
    checkbox.setAttribute("aria-label", `Select ${lead.business_name || "business"}`);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(id);
      else state.selected.delete(id);
      updateSelectAll();
    });

    addCell(tr, checkbox);

    const businessCell = addCell(tr, "");
    const businessName = document.createElement("strong");
    businessName.textContent = lead.business_name || "Unnamed Business";
    businessCell.appendChild(businessName);

    const sub = document.createElement("div");
    sub.className = "business-subtext";
    sub.textContent = [lead.contact, lead.email].filter(Boolean).join(" • ") || "No contact details";
    businessCell.appendChild(sub);

    addCell(tr, lead.country || "—");
    addCell(tr, lead.category || "—");

    const serviceCell = addCell(tr, "");
    serviceCell.textContent = servicesFor(lead.id).join(", ") || "—";

    const stageCell = addCell(tr, "");
    stageCell.appendChild(makeStageSelect(lead));

    addCell(tr, formatDate(lead.next_follow_up_at));

    const actions = addCell(tr, "");
    actions.className = "business-actions";

    actions.append(
      makeButton("View", "btn btn-secondary", () => openBusinessModal(lead, "view")),
      makeButton("Edit", "btn btn-primary", () => openBusinessModal(lead, "edit")),
      makeButton("Delete", "btn btn-danger", () => deleteBusiness(lead))
    );

    tbody.appendChild(tr);
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "No businesses found.";
    td.className = "empty-state";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  if ($("paginationInfo")) {
    $("paginationInfo").textContent =
      total ? `Showing ${start + 1}–${Math.min(start + rows.length, total)} of ${total}` : "No businesses";
  }

  if ($("pageNumber")) $("pageNumber").textContent = `${state.page} / ${pageCount}`;
  if ($("prevPage")) $("prevPage").disabled = state.page <= 1;
  if ($("nextPage")) $("nextPage").disabled = state.page >= pageCount;
  if ($("tableSummary")) $("tableSummary").textContent = `${total} businesses`;

  updateSelectAll();
}

function updateSelectAll() {
  const checkbox = $("selectAll");
  if (!checkbox) return;

  const visibleIds = state.filteredLeads
    .slice((state.page - 1) * state.pageSize, state.page * state.pageSize)
    .map((lead) => String(lead.id));

  checkbox.checked =
    visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));

  checkbox.indeterminate =
    visibleIds.some((id) => state.selected.has(id)) && !checkbox.checked;
}

function closeModal() {
  document.querySelector(".crm-modal-backdrop")?.remove();
  document.removeEventListener("keydown", handleModalEscape);
}

function handleModalEscape(event) {
  if (event.key === "Escape") closeModal();
}

function openModal(title, subtitle = "") {
  closeModal();

  const backdrop = document.createElement("div");
  backdrop.className = "crm-modal-backdrop";

  const card = document.createElement("section");
  card.className = "crm-modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const header = document.createElement("div");
  header.className = "crm-modal-head";

  const heading = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "crm-modal-title";
  h2.textContent = title;
  heading.appendChild(h2);

  if (subtitle) {
    const p = document.createElement("p");
    p.className = "crm-modal-subtitle";
    p.textContent = subtitle;
    heading.appendChild(p);
  }

  const close = makeButton("×", "crm-modal-close", closeModal);
  close.setAttribute("aria-label", "Close dialog");
  header.append(heading, close);

  const body = document.createElement("div");
  body.className = "crm-modal-body";

  card.append(header, body);
  backdrop.appendChild(card);

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });

  document.body.appendChild(backdrop);
  document.addEventListener("keydown", handleModalEscape);

  return { backdrop, card, body };
}

function openBusinessModal(lead, mode = "view") {
  const editing = mode === "edit";
  const { body } = openModal(
    editing ? "Edit Business" : "Business Details",
    lead.business_name || "Business record"
  );

  if (!editing) {
    const details = [
      ["Business Name", lead.business_name],
      ["Contact", lead.contact],
      ["Second Contact", lead.contact_2],
      ["Email", lead.email],
      ["Website", lead.website_url],
      ["Country", lead.country],
      ["Category", lead.category],
      ["Address", lead.address],
      ["Services", servicesFor(lead.id).join(", ")],
      ["Status", stageLabel(lead.stage)],
      ["Next Follow-up", formatDate(lead.next_follow_up_at)],
      ["Details", lead.optional_details]
    ];

    const list = document.createElement("div");
    list.className = "crm-detail-list";

    for (const [label, value] of details) {
      const item = document.createElement("div");
      item.className = "crm-detail";

      const strong = document.createElement("strong");
      strong.textContent = label;

      const valueEl = document.createElement("div");
      valueEl.textContent = value || "—";

      item.append(strong, valueEl);
      list.appendChild(item);
    }

    body.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "crm-modal-actions";
    footer.append(
      makeButton("Edit Business", "btn btn-primary", () => openBusinessModal(lead, "edit")),
      makeButton("Close", "btn btn-secondary", closeModal)
    );
    body.appendChild(footer);
    return;
  }

  const form = document.createElement("form");
  form.className = "crm-modal-grid";

  const controls = {};

  for (const [key, label, type] of FIELDS) {
    const wrapper = document.createElement("label");
    wrapper.className = "crm-field";
    wrapper.appendChild(document.createTextNode(label));

    let input;

    if (type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else {
      input = document.createElement("input");
      input.type = type;
    }

    input.name = key;
    input.value = key === "next_follow_up_at"
      ? toDateTimeLocal(lead[key])
      : (lead[key] || "");

    if (key === "business_name") input.required = true;
    controls[key] = input;

    wrapper.appendChild(input);
    form.appendChild(wrapper);
  }

  const statusLabel = document.createElement("label");
  statusLabel.className = "crm-field";
  statusLabel.appendChild(document.createTextNode("Business Status"));

  const stage = document.createElement("select");
  stage.name = "stage";
  stage.innerHTML = getStageOptions(lead.stage || "new");
  controls.stage = stage;
  statusLabel.appendChild(stage);
  form.appendChild(statusLabel);

  const serviceWrapper = document.createElement("fieldset");
  serviceWrapper.className = "crm-field crm-service-options";

  const legend = document.createElement("legend");
  legend.textContent = "Services";
  serviceWrapper.appendChild(legend);

  const chosenServices = new Set(servicesFor(lead.id));

  for (const service of SERVICES) {
    const label = document.createElement("label");
    label.className = "crm-service-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = service;
    checkbox.checked = chosenServices.has(service);

    label.append(checkbox, document.createTextNode(service));
    serviceWrapper.appendChild(label);
  }

  form.appendChild(serviceWrapper);

  const note = document.createElement("p");
  note.className = "crm-modal-note";
  note.textContent = "Changes are saved to your account.";
  form.appendChild(note);

  const footer = document.createElement("div");
  footer.className = "crm-modal-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-primary";
  save.textContent = "Save Changes";

  const cancel = makeButton("Cancel", "btn btn-secondary", closeModal);
  footer.append(save, cancel);
  form.appendChild(footer);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    clearMessage();

    try {
      const updates = {};

      for (const [key] of FIELDS) {
        const raw = controls[key].value.trim();

        if (key === "next_follow_up_at") {
          if (raw) {
            const date = new Date(raw);
            if (Number.isNaN(date.getTime())) {
              throw new Error("Please enter a valid follow-up date.");
            }
            updates[key] = date.toISOString();
          } else {
            updates[key] = null;
          }
        } else {
          updates[key] = raw || null;
        }
      }

      updates.stage = controls.stage.value;

      const selectedServices = [
        ...serviceWrapper.querySelectorAll('input[type="checkbox"]:checked')
      ].map((input) => input.value);

      const { error: updateError } = await supabase
        .from("leads")
        .update(updates)
        .eq("id", lead.id)
        .eq("user_id", state.user.id);

      if (updateError) throw updateError;

      // Replace this lead's service associations.
      const { error: deleteServicesError } = await supabase
        .from("lead_services")
        .delete()
        .eq("lead_id", lead.id)
        .eq("user_id", state.user.id);

      if (deleteServicesError) {
        throw new Error(
          `Business details saved, but services could not be updated: ${deleteServicesError.message}`
        );
      }

      if (selectedServices.length) {
        const serviceRows = selectedServices.map((service_name) => ({
          lead_id: lead.id,
          user_id: state.user.id,
          service_name
        }));

        const { error: insertError } = await supabase
          .from("lead_services")
          .insert(serviceRows);

        if (insertError) {
          throw new Error(
            `Business details saved, but services could not be saved: ${insertError.message}`
          );
        }
      }

      closeModal();
      showMessage("Business updated successfully.");
      await loadBusinesses();
    } catch (error) {
      showMessage(error.message || "Could not save business.", "error");
      save.disabled = false;
    }
  });

  body.appendChild(form);
}

async function deleteBusiness(lead) {
  const confirmed = window.confirm(
    `Permanently delete "${lead.business_name || "this business"}"?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  const id = String(lead.id);
  if (state.busyIds.has(id)) return;

  state.busyIds.add(id);
  clearMessage();

  try {
    // Delete linked services first, scoped to the signed-in user.
    const { error: serviceError } = await supabase
      .from("lead_services")
      .delete()
      .eq("lead_id", lead.id)
      .eq("user_id", state.user.id);

    if (serviceError) throw serviceError;

    const { error: leadError } = await supabase
      .from("leads")
      .delete()
      .eq("id", lead.id)
      .eq("user_id", state.user.id);

    if (leadError) {
      throw new Error(
        `Could not delete business. The linked service records may already have been removed. ${leadError.message}`
      );
    }

    state.selected.delete(id);
    state.servicesByLead.delete(id);

    showMessage(`"${lead.business_name}" was permanently deleted.`);
    await loadBusinesses();
  } catch (error) {
    showMessage(
      `Delete failed: ${error.message}. Check Supabase table permissions and RLS policies.`,
      "error"
    );
  } finally {
    state.busyIds.delete(id);
  }
}

async function archiveBusiness(lead) {
  const confirmed = window.confirm(
    `Archive "${lead.business_name || "this business"}"? It will be hidden from the active list.`
  );

  if (!confirmed) return;

  try {
    const { error } = await supabase
      .from("leads")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString()
      })
      .eq("id", lead.id)
      .eq("user_id", state.user.id);

    if (error) throw error;

    showMessage("Business archived.");
    await loadBusinesses();
  } catch (error) {
    showMessage(`Archive failed: ${error.message}`, "error");
  }
}

async function applyBulkAction() {
  const action = $("bulkAction")?.value;
  const ids = [...state.selected];

  if (!ids.length) {
    showMessage("Please select at least one business.", "error");
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(
      `Permanently delete ${ids.length} selected business(es)? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const { error: servicesError } = await supabase
        .from("lead_services")
        .delete()
        .eq("user_id", state.user.id)
        .in("lead_id", ids);

      if (servicesError) throw servicesError;

      const { error } = await supabase
        .from("leads")
        .delete()
        .eq("user_id", state.user.id)
        .in("id", ids);

      if (error) throw error;

      showMessage(`${ids.length} business(es) deleted.`);
      await loadBusinesses();
    } catch (error) {
      showMessage(`Bulk delete failed: ${error.message}`, "error");
    }

    return;
  }

  if (action === "archive") {
    if (!window.confirm(`Archive ${ids.length} selected business(es)?`)) return;

    try {
      const { error } = await supabase
        .from("leads")
        .update({
          is_archived: true,
          archived_at: new Date().toISOString()
        })
        .eq("user_id", state.user.id)
        .in("id", ids);

      if (error) throw error;

      showMessage(`${ids.length} business(es) archived.`);
      await loadBusinesses();
    } catch (error) {
      showMessage(`Bulk archive failed: ${error.message}`, "error");
    }

    return;
  }

  const stage = STAGES.find(([value]) => value === action);

  if (stage) {
    try {
      const { error } = await supabase
        .from("leads")
        .update({ stage: stage[0] })
        .eq("user_id", state.user.id)
        .in("id", ids);

      if (error) throw error;

      showMessage(`Status updated for ${ids.length} business(es).`);
      await loadBusinesses();
    } catch (error) {
      showMessage(`Bulk status update failed: ${error.message}`, "error");
    }

    return;
  }

  showMessage("Choose a valid bulk action.", "error");
}

function exportCSV() {
  const leads = state.selected.size
    ? state.filteredLeads.filter((lead) => state.selected.has(String(lead.id)))
    : state.filteredLeads;

  if (!leads.length) {
    showMessage("No businesses to export.", "error");
    return;
  }

  const headers = [
    "Business Name", "Contact", "Second Contact", "Email", "Website",
    "Country", "Category", "Address", "Services", "Status",
    "Next Follow-up", "Details"
  ];

  const rows = leads.map((lead) => [
    lead.business_name,
    lead.contact,
    lead.contact_2,
    lead.email,
    lead.website_url,
    lead.country,
    lead.category,
    lead.address,
    servicesFor(lead.id).join(", "),
    stageLabel(lead.stage),
    lead.next_follow_up_at,
    lead.optional_details
  ]);

  const safeCSV = (value) => {
    let text = String(value ?? "");

    // Prevent spreadsheet formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;

    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(safeCSV).join(","))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sivexo-businesses.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $("businessSearch")?.addEventListener("input", applyFilters);

  $("filterButton")?.addEventListener("click", applyFilters);
  $("countryFilter")?.addEventListener("change", applyFilters);
  $("serviceFilter")?.addEventListener("change", applyFilters);
  $("stageFilter")?.addEventListener("change", applyFilters);

  $("pageSize")?.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    state.pageSize = Number.isFinite(value) && value > 0 ? value : 10;
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
    const pages = Math.max(1, Math.ceil(state.filteredLeads.length / state.pageSize));
    if (state.page < pages) {
      state.page++;
      renderTable();
    }
  });

  $("selectAll")?.addEventListener("change", (event) => {
    const visible = state.filteredLeads.slice(
      (state.page - 1) * state.pageSize,
      state.page * state.pageSize
    );

    for (const lead of visible) {
      const id = String(lead.id);
      if (event.target.checked) state.selected.add(id);
      else state.selected.delete(id);
    }

    renderTable();
  });

  $("exportButton")?.addEventListener("click", exportCSV);
  $("applyBulkButton")?.addEventListener("click", applyBulkAction);

  $("logoutButton")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      showMessage(`Logout failed: ${error.message}`, "error");
      return;
    }

    window.location.href = "index.html";
  });

  $("globalSearch")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if ($("businessSearch")) $("businessSearch").value = event.target.value;
      applyFilters();
    }
  });
}

async function initialize() {
  bindEvents();

  try {
    await loadBusinesses();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Could not load businesses.", "error");
  }
}

initialize();
