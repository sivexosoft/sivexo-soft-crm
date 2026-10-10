
import { supabase, requireSupabase } from "./supabase.js";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 10;

let allLeads = [];
let filteredLeads = [];
let selectedIds = new Set();
let currentPage = 1;
let userId = null;

const stages = {
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

function showMessage(message, error = false) {
  const el = $("followUpsMessage");
  el.textContent = message;
  el.className = `fu-message show${error ? " error" : ""}`;
}

function clearMessage() {
  $("followUpsMessage").className = "fu-message";
  $("followUpsMessage").textContent = "";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function stageClass(stage) {
  return String(stage || "").replaceAll("_", "-");
}

function text(value, fallback = "—") {
  return value == null || String(value).trim() === ""
    ? fallback
    : String(value);
}

function getServices(lead) {
  return (lead.lead_services || [])
    .map(service => service.service_name)
    .filter(Boolean);
}

function createCell(value, className = "") {
  const td = document.createElement("td");
  td.textContent = value;
  if (className) td.className = className;
  return td;
}

function updateStats() {
  const now = new Date();
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const scheduled = allLeads.filter(lead => lead.next_follow_up_at);

  const dueToday = scheduled.filter(lead => {
    const date = parseDate(lead.next_follow_up_at);
    return date && date >= today && date < tomorrow;
  }).length;

  const overdue = scheduled.filter(lead => {
    const date = parseDate(lead.next_follow_up_at);
    return date && date < today;
  }).length;

  const won = allLeads.filter(lead => lead.stage === "won").length;

  $("totalFollowUps").textContent = scheduled.length;
  $("dueToday").textContent = dueToday;
  $("overdueCount").textContent = overdue;

  // The current schema has no dedicated completed-reminder field.
  $("completedCount").textContent = "—";

  $("conversionRate").textContent = allLeads.length
    ? `${Math.round((won / allLeads.length) * 100)}%`
    : "0%";
}

function populateCountries() {
  const select = $("countryFilter");
  const previous = select.value;

  const countries = [
    ...new Set(allLeads.map(lead => lead.country).filter(Boolean))
  ].sort();

  select.replaceChildren(new Option("All countries", ""));
  countries.forEach(country => {
    select.add(new Option(country, country));
  });

  select.value = countries.includes(previous) ? previous : "";
}

function getFilteredLeads() {
  const query = (
    $("followUpSearch").value ||
    $("globalSearch").value ||
    ""
  ).trim().toLowerCase();

  const country = $("countryFilter").value;
  const stage = $("stageFilter").value;
  const range = $("dateFilter").value;

  const now = new Date();
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const limit = new Date(now);
  limit.setDate(limit.getDate() + Number(range || 30));

  return allLeads.filter(lead => {
    if (!lead.next_follow_up_at) return false;

    const date = parseDate(lead.next_follow_up_at);
    if (!date) return false;

    const searchable = [
      lead.business_name,
      lead.contact,
      lead.contact_2,
      lead.email,
      lead.country,
      lead.website_url
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) return false;
    if (country && lead.country !== country) return false;
    if (stage && lead.stage !== stage) return false;

    if (range === "today" && !(date >= today && date < tomorrow)) {
      return false;
    }

    if (range === "overdue" && date >= today) return false;

    if (
      range !== "all" &&
      range !== "today" &&
      range !== "overdue" &&
      date > limit
    ) {
      return false;
    }

    return true;
  }).sort((a, b) =>
    new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at)
  );
}

function updateSelectAll() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageLeads = filteredLeads.slice(start, start + PAGE_SIZE);

  $("selectAll").checked =
    pageLeads.length > 0 &&
    pageLeads.every(lead => selectedIds.has(lead.id));
}

function renderTable() {
  filteredLeads = getFilteredLeads();

  const pageCount = Math.max(
    1,
    Math.ceil(filteredLeads.length / PAGE_SIZE)
  );

  currentPage = Math.min(currentPage, pageCount);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageLeads = filteredLeads.slice(start, start + PAGE_SIZE);
  const tbody = $("followUpsTable");

  tbody.replaceChildren();

  if (!pageLeads.length) {
    const row = document.createElement("tr");
    const cell = createCell(
      "No scheduled follow-ups match your filters.",
      "empty-state"
    );
    cell.colSpan = 8;
    row.append(cell);
    tbody.append(row);
  }

  pageLeads.forEach(lead => {
    const row = document.createElement("tr");

    // Selection checkbox
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "fu-row-check";
    checkbox.checked = selectedIds.has(lead.id);
    checkbox.setAttribute("aria-label", `Select ${lead.business_name}`);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(lead.id);
      else selectedIds.delete(lead.id);
      updateSelectAll();
    });

    checkCell.append(checkbox);
    row.append(checkCell);

    // Business and email
    const businessCell = document.createElement("td");
    const businessWrap = document.createElement("div");
    businessWrap.className = "business-cell";

    const avatar = document.createElement("span");
    avatar.className = "business-avatar";
    avatar.textContent = text(lead.business_name, "?").charAt(0).toUpperCase();

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "business-name";
    name.textContent = text(lead.business_name);

    const email = document.createElement("div");
    email.className = "business-email";
    email.textContent = text(lead.email, "No email");

    info.append(name, email);
    businessWrap.append(avatar, info);
    businessCell.append(businessWrap);
    row.append(businessCell);

    row.append(createCell(text(lead.contact)));
    row.append(createCell(text(lead.country)));

    // Stage badge
    const stageCell = document.createElement("td");
    const stageBadge = document.createElement("span");
    stageBadge.className = `stage-badge ${stageClass(lead.stage)}`;
    stageBadge.textContent = stages[lead.stage] || text(lead.stage);
    stageCell.append(stageBadge);
    row.append(stageCell);

    // Follow-up date
    const dateCell = document.createElement("td");
    const dateBadge = document.createElement("span");
    const followUpDate = parseDate(lead.next_follow_up_at);

    dateBadge.className =
      "followup-date" +
      (followUpDate && followUpDate < new Date() ? " overdue" : "");

    dateBadge.textContent = `▦ ${formatDate(lead.next_follow_up_at)}`;
    dateCell.append(dateBadge);
    row.append(dateCell);

    // Services
    const servicesCell = document.createElement("td");
    const services = getServices(lead);

    if (services.length) {
      const badge = document.createElement("span");
      badge.className = "service-badge";
      badge.textContent = services.slice(0, 2).join(", ");
      servicesCell.append(badge);
    } else {
      servicesCell.textContent = "—";
    }
    row.append(servicesCell);

    // View action
    const actionsCell = document.createElement("td");
    const viewButton = document.createElement("button");
    viewButton.className = "view-button";
    viewButton.type = "button";
    viewButton.textContent = "View";

    viewButton.addEventListener("click", () => {
      window.location.href =
        `businesses.html?lead=${encodeURIComponent(lead.id)}`;
    });

    actionsCell.append(viewButton);
    row.append(actionsCell);
    tbody.append(row);
  });

  $("showingCount").textContent = filteredLeads.length
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filteredLeads.length)} of ${filteredLeads.length}`
    : "Showing 0";

  $("currentPage").textContent = currentPage;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= pageCount;

  updateSelectAll();
}

async function loadLeads() {
  requireSupabase();

  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  if (!session) {
    window.location.href = "index.html";
    return;
  }

  userId = session.user.id;

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id, user_id, business_name, contact, contact_2,
      email, website_url, country, stage, next_follow_up_at,
      lead_services(service_name)
    `)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .not("next_follow_up_at", "is", null)
    .order("next_follow_up_at", { ascending: true });

  if (error) throw error;

  allLeads = data || [];
  populateCountries();
  updateStats();
  renderTable();
}

function getSelectedLeads() {
  return allLeads.filter(lead => selectedIds.has(lead.id));
}

async function markSelectedCompleted() {
  const selected = getSelectedLeads();

  if (!selected.length) {
    showMessage("Select at least one follow-up first.");
    return;
  }

  const confirmed = window.confirm(
    `Mark ${selected.length} selected follow-up(s) as completed? ` +
    "This clears their scheduled dates."
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("leads")
    .update({ next_follow_up_at: null })
    .eq("user_id", userId)
    .in("id", selected.map(lead => lead.id));

  if (error) throw error;

  selectedIds.clear();
  showMessage("Selected follow-up dates have been cleared.");
  await loadLeads();
}

async function rescheduleSelected() {
  const selected = getSelectedLeads();

  if (!selected.length) {
    showMessage("Select at least one follow-up first.");
    return;
  }

  const defaultDate = new Date(Date.now() + 86400000);
  defaultDate.setMinutes(
    defaultDate.getMinutes() - defaultDate.getTimezoneOffset()
  );

  const input = window.prompt(
    "Enter the new date and time (YYYY-MM-DDTHH:MM):",
    defaultDate.toISOString().slice(0, 16)
  );

  if (!input) return;

  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    showMessage("Invalid date. Please use YYYY-MM-DDTHH:MM.", true);
    return;
  }

  const { error } = await supabase
    .from("leads")
    .update({ next_follow_up_at: date.toISOString() })
    .eq("user_id", userId)
    .in("id", selected.map(lead => lead.id));

  if (error) throw error;

  selectedIds.clear();
  showMessage("Selected follow-ups have been rescheduled.");
  await loadLeads();
}

function setupEvents() {
  $("applyFilters").addEventListener("click", () => {
    currentPage = 1;
    clearMessage();
    renderTable();
  });

  $("followUpSearch").addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });

  $("globalSearch").addEventListener("input", () => {
    $("followUpSearch").value = $("globalSearch").value;
    currentPage = 1;
    renderTable();
  });

  ["countryFilter", "stageFilter", "dateFilter"].forEach(id => {
    $(id).addEventListener("change", () => {
      currentPage = 1;
      renderTable();
    });
  });

  $("selectAll").addEventListener("change", () => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageLeads = filteredLeads.slice(start, start + PAGE_SIZE);

    pageLeads.forEach(lead => {
      if ($("selectAll").checked) selectedIds.add(lead.id);
      else selectedIds.delete(lead.id);
    });

    renderTable();
  });

  $("prevPage").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  $("nextPage").addEventListener("click", () => {
    if (currentPage < Math.ceil(filteredLeads.length / PAGE_SIZE)) {
      currentPage++;
      renderTable();
    }
  });

  $("markCompleted").addEventListener("click", async () => {
    try {
      clearMessage();
      await markSelectedCompleted();
    } catch (error) {
      showMessage(error.message || "Could not update follow-ups.", true);
    }
  });

  $("rescheduleSelected").addEventListener("click", async () => {
    try {
      clearMessage();
      await rescheduleSelected();
    } catch (error) {
      showMessage(error.message || "Could not reschedule follow-ups.", true);
    }
  });

  $("sendReminder").addEventListener("click", () => {
    const selected = getSelectedLeads();

    if (!selected.length) {
      showMessage("Select at least one lead first.");
      return;
    }

    const lead = selected[0];

    if (!lead.email) {
      showMessage("This lead has no email address. Add one to the lead record.", true);
      return;
    }

    const subject = encodeURIComponent(`Follow-up — ${lead.business_name}`);
    const body = encodeURIComponent(
      `Hello${lead.contact ? ` ${lead.contact}` : ""},\n\n` +
      "I wanted to follow up regarding our conversation. " +
      "Please let me know a convenient time to discuss further.\n\n" +
      "Best regards,\nSivexo Soft"
    );

    window.location.href =
      `mailto:${encodeURIComponent(lead.email)}?subject=${subject}&body=${body}`;
  });

  $("logoutButton").addEventListener("click", async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.href = "index.html";
    } catch (error) {
      showMessage(error.message || "Could not log out.", true);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();

  try {
    await loadLeads();
  } catch (error) {
    console.error("Follow-ups error:", error);
    showMessage(
      error.message || "Could not load follow-ups. Check your Supabase setup.",
      true
    );

    $("followUpsTable").innerHTML =
      '<tr><td colspan="8" class="empty-state">' +
      "Could not load follow-ups. Check the error message above." +
      "</td></tr>";
  }
});
