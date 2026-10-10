
import { supabase, requireSupabase } from "./supabase.js";

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

const CONTACTED_STAGES = new Set([
  "first_message_sent",
  "follow_up",
  "call_done",
  "interested",
  "not_interested",
  "future_opportunity",
  "proposal_sent",
  "won",
  "lost"
]);

function showMessage(message, type = "success") {
  const element = $("pageMessage");
  if (!element) return;

  element.textContent = message;
  element.className = `business-message show${type === "error" ? " error" : type === "warning" ? " warning" : ""}`;
}

function clearMessage() {
  const element = $("pageMessage");
  if (!element) return;

  element.textContent = "";
  element.className = "business-message";
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || String(value).trim() === "") {
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

function stageLabel(stage) {
  return STAGES[stage] || String(stage || "New Lead");
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

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
    services
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes(search);
}

function populateCountryFilter() {
  const select = $("countryFilter");
  const previous = select.value;
  const countries = [...new Set(
    state.leads.map((lead) => lead.country).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

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
  const now = Date.now();

  const dueCount = leads.filter((lead) => {
    if (!lead.next_follow_up_at) return false;
    return new Date(lead.next_follow_up_at).getTime() <= now;
  }).length;

  $("statTotal").textContent = leads.length;
  $("statContacted").textContent = leads.filter(
    (lead) => CONTACTED_STAGES.has(lead.stage)
  ).length;
  $("statFollowUp").textContent = dueCount;
  $("statInterested").textContent = leads.filter(
    (lead) => lead.stage === "interested"
  ).length;
  $("statWon").textContent = leads.filter(
    (lead) => lead.stage === "won"
  ).length;
}

function applyFilters(resetPage = true) {
  clearMessage();

  const search = ($("businessSearch").value || "").trim().toLowerCase();
  const country = $("countryFilter").value;
  const service = $("serviceFilter").value;
  const stage = $("stageFilter").value;

  state.filtered = state.leads.filter((lead) => {
    if (!leadMatchesSearch(lead, search)) return false;
    if (country && lead.country !== country) return false;
    if (stage && lead.stage !== stage) return false;

    if (service && !getLeadServices(lead.id).includes(service)) {
      return false;
    }

    return true;
  });

  if (resetPage) state.page = 1;

  const maxPage = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);

  renderTable();
}

function renderTable() {
  const tbody = $("businessTableBody");
  tbody.replaceChildren();

  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const start = total ? (state.page - 1) * state.pageSize : 0;
  const visible = state.filtered.slice(start, start + state.pageSize);
  const end = Math.min(start + state.pageSize, total);

  $("paginationInfo").textContent = total
    ? `Showing ${start + 1}–${end} of ${total}`
    : "Showing 0 businesses";

  $("pageNumber").textContent = `${state.page} / ${pages}`;
  $("prevPage").disabled = state.page <= 1;
  $("nextPage").disabled = state.page >= pages;

  $("tableSummary").textContent =
    `${total} matching business${total === 1 ? "" : "es"} · ${state.leads.length} active in total`;

  $("selectAll").checked =
    visible.length > 0 && visible.every((lead) => state.selected.has(lead.id));

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

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(lead.id);
    checkbox.setAttribute("aria-label", `Select ${lead.business_name}`);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(lead.id);
      else state.selected.delete(lead.id);

      renderTable();
    });

    makeCell(row, checkbox);

    const businessCell = document.createElement("div");
    businessCell.className = "business-cell";

    const avatar = createElement(
      "span",
      "business-avatar",
      safeText(lead.business_name, "?").charAt(0)
    );
    avatar.setAttribute("aria-hidden", "true");

    const businessText = document.createElement("div");
    businessText.className = "business-text";

    businessText.appendChild(
      createElement("span", "business-name", safeText(lead.business_name))
    );

    const email = createElement(
      "span",
      "business-email",
      safeText(lead.email, safeText(lead.website_url, "No email or website"))
    );

    businessText.appendChild(email);
    businessCell.append(avatar, businessText);
    makeCell(row, businessCell);

    makeCell(row, safeText(lead.contact || lead.contact_2));

    const countryCell = createElement(
      "span",
      "country-cell",
      safeText(lead.country)
    );
    makeCell(row, countryCell);

    const services = getLeadServices(lead.id);
    const serviceContainer = document.createElement("div");

    if (services.length) {
      serviceContainer.appendChild(
        createBadge(services[0], "service-badge")
      );

      if (services.length > 1) {
        const more = createElement(
          "span",
          "business-email",
          `+${services.length - 1} more`
        );
        serviceContainer.appendChild(more);
      }
    } else {
      serviceContainer.appendChild(
        createBadge(safeText(lead.category, "Unassigned"), "service-badge")
      );
    }

    makeCell(row, serviceContainer);

    const stageClass = `stage-${STAGES[lead.stage] ? lead.stage : "new"}`;
    makeCell(
      row,
      createBadge(stageLabel(lead.stage), `stage-badge ${stageClass}`)
    );

    makeCell(row, formatDate(lead.next_follow_up_at));

    const actions = createElement("div", "business-actions");
    const viewButton = createElement("button", "view-button", "View");
    viewButton.type = "button";
    viewButton.title = "View business details";

    viewButton.addEventListener("click", () => {
      const details = [
        `Business: ${safeText(lead.business_name)}`,
        `Contact: ${safeText(lead.contact)}`,
        `Second contact: ${safeText(lead.contact_2)}`,
        `Email: ${safeText(lead.email)}`,
        `Website: ${safeText(lead.website_url)}`,
        `Country: ${safeText(lead.country)}`,
        `Category: ${safeText(lead.category)}`,
        `Services: ${services.join(", ") || "—"}`,
        `Stage: ${stageLabel(lead.stage)}`,
        `Next follow-up: ${formatDate(lead.next_follow_up_at)}`,
        `Details: ${safeText(lead.optional_details)}`
      ].join("\n");

      window.alert(details);
    });

    const menuButton = createElement("button", "row-menu", "⋮");
    menuButton.type = "button";
    menuButton.setAttribute("aria-label", `Actions for ${lead.business_name}`);

    menuButton.addEventListener("click", async () => {
      const action = window.prompt(
        `Actions for ${lead.business_name}\nType "archive" to archive this lead, or enter a stage key:\n${Object.entries(STAGES).map(([key, label]) => `${key} = ${label}`).join("\n")}`
      );

      if (!action) return;

      if (action.toLowerCase() === "archive") {
        await archiveLeads([lead.id]);
        return;
      }

      if (STAGES[action]) {
        await updateLeadStages([lead.id], action);
        return;
      }

      showMessage("Unknown action. Please enter a valid stage key.", "warning");
    });

    actions.append(viewButton, menuButton);
    makeCell(row, actions);

    tbody.appendChild(row);
  });
}

async function loadBusinesses() {
  const client = requireSupabase();

  if (!client) {
    showMessage(
      "Supabase is not configured. Check assets/js/config.js and your project URL/key.",
      "error"
    );
    $("businessTableBody").replaceChildren();
    const row = document.createElement("tr");
    const cell = createElement("td", "table-empty", "Database connection is not configured.");
    cell.colSpan = 8;
    row.appendChild(cell);
    $("businessTableBody").appendChild(row);
    return;
  }

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError || !sessionData?.session) {
    window.location.replace("index.html");
    return;
  }

  state.user = sessionData.session.user;

  const { data: leads, error: leadsError } = await client
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
      stage,
      next_follow_up_at,
      is_archived,
      created_at
    `)
    .eq("user_id", state.user.id)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (leadsError) {
    console.error("Unable to load leads:", leadsError);
    showMessage(`Could not load businesses: ${leadsError.message}`, "error");
    return;
  }

  state.leads = leads || [];
  state.selected.clear();
  state.servicesByLead.clear();

  if (state.leads.length) {
    const leadIds = state.leads.map((lead) => lead.id);

    const { data: serviceRows, error: serviceError } = await client
      .from("lead_services")
      .select("lead_id, service_name")
      .eq("user_id", state.user.id)
      .in("lead_id", leadIds);

    if (serviceError) {
      console.warn("Unable to load lead services:", serviceError);
      showMessage(
        "Businesses loaded, but service labels could not be loaded. Check the lead_services table and its RLS policies.",
        "warning"
      );
    } else {
      (serviceRows || []).forEach((item) => {
        const services = state.servicesByLead.get(item.lead_id) || [];
        services.push(item.service_name);
        state.servicesByLead.set(item.lead_id, services);
      });
    }
  }

  renderStats();
  populateCountryFilter();

  const params = new URLSearchParams(window.location.search);
  const stageParam = params.get("stage");

  if (stageParam && STAGES[stageParam]) {
    $("stageFilter").value = stageParam;
  }

  applyFilters();

  if (params.get("add") === "1") {
    showMessage(
      "The Add Business form is the next step. Your business list is ready.",
      "warning"
    );
  }
}

async function updateLeadStages(ids, stage) {
  if (!ids.length) {
    showMessage("Select at least one business first.", "warning");
    return;
  }

  const client = requireSupabase();
  if (!client) return;

  const { error } = await client
    .from("leads")
    .update({ stage })
    .eq("user_id", state.user.id)
    .in("id", ids);

  if (error) {
    console.error("Stage update failed:", error);
    showMessage(`Could not update stages: ${error.message}`, "error");
    return;
  }

  showMessage(`Updated ${ids.length} business${ids.length === 1 ? "" : "es"}.`);
  await loadBusinesses();
}

async function archiveLeads(ids) {
  if (!ids.length) {
    showMessage("Select at least one business first.", "warning");
    return;
  }

  const confirmed = window.confirm(
    `Archive ${ids.length} selected business${ids.length === 1 ? "" : "es"}? You can restore them later from Archive.`
  );

  if (!confirmed) return;

  const client = requireSupabase();
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
    showMessage(`Could not archive businesses: ${error.message}`, "error");
    return;
  }

  showMessage(`Archived ${ids.length} business${ids.length === 1 ? "" : "es"}.`);
  await loadBusinesses();
}

function exportCSV() {
  const rows = state.filtered.filter((lead) => state.selected.has(lead.id));
  const leadsToExport = rows.length ? rows : state.filtered;

  if (!leadsToExport.length) {
    showMessage("There are no businesses to export.", "warning");
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
    ["Services", (lead) => getLeadServices(lead.id).join("; ")],
    ["Stage", (lead) => stageLabel(lead.stage)],
    ["Next Follow-up", (lead) => lead.next_follow_up_at],
    ["Address", (lead) => lead.address],
    ["Details", (lead) => lead.optional_details]
  ];

  const escapeCSV = (value) => {
    let text = String(value ?? "");

    // Protect spreadsheet users from CSV formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = [
    columns.map(([heading]) => escapeCSV(heading)).join(","),
    ...leadsToExport.map((lead) =>
      columns.map(([, getValue]) => escapeCSV(getValue(lead))).join(",")
    )
  ].join("\r\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sivexo-businesses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  showMessage(
    `Exported ${leadsToExport.length} business${leadsToExport.length === 1 ? "" : "es"} to CSV.`
  );
}

function bindEvents() {
  $("businessSearch").addEventListener("input", () => applyFilters());
  $("countryFilter").addEventListener("change", () => applyFilters());
  $("serviceFilter").addEventListener("change", () => applyFilters());
  $("stageFilter").addEventListener("change", () => applyFilters());

  $("filterButton").addEventListener("click", () => applyFilters());

  $("pageSize").addEventListener("change", (event) => {
    state.pageSize = Number(event.target.value) || 10;
    state.page = 1;
    renderTable();
  });

  $("prevPage").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });

  $("nextPage").addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));

    if (state.page < maxPage) {
      state.page += 1;
      renderTable();
    }
  });

  $("selectAll").addEventListener("change", (event) => {
    const start = (state.page - 1) * state.pageSize;
    const visible = state.filtered.slice(start, start + state.pageSize);

    visible.forEach((lead) => {
      if (event.target.checked) state.selected.add(lead.id);
      else state.selected.delete(lead.id);
    });

    renderTable();
  });

  $("exportButton").addEventListener("click", exportCSV);

  $("applyBulkButton").addEventListener("click", async () => {
    const action = $("bulkAction").value;

    if (!state.selected.size) {
      showMessage("Select one or more businesses first.", "warning");
      return;
    }

    if (!action) {
      showMessage("Choose a bulk action first.", "warning");
      return;
    }

    const ids = [...state.selected];

    if (action === "archive") {
      await archiveLeads(ids);
    } else if (STAGES[action]) {
      await updateLeadStages(ids, action);
    }
  });

  $("bulkAction").addEventListener("change", (event) => {
    $("applyBulkButton").style.display = event.target.value ? "inline-flex" : "none";
  });

  $("logoutButton").addEventListener("click", async () => {
    const client = requireSupabase();
    if (!client) return;

    const { error } = await client.auth.signOut();

    if (error) {
      showMessage(`Could not log out: ${error.message}`, "error");
      return;
    }

    window.location.replace("index.html");
  });
}

bindEvents();
loadBusinesses().catch((error) => {
  console.error("Business page initialization failed:", error);
  showMessage("Something went wrong while loading your businesses. Check the browser console.", "error");
});
