
import { supabase, requireSupabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

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

let currentUser = null;
let allBusinesses = [];
let saving = false;

function showMessage(message, type = "error", target = "businessMessage") {
  const element = $(target);
  if (!element) return;

  element.textContent = message;
  element.className = `business-message show ${type}`;
}

function clearMessage(target = "businessMessage") {
  const element = $(target);
  if (!element) return;

  element.textContent = "";
  element.className = "business-message";
}

function stageName(stage) {
  return STAGES.find(([value]) => value === stage)?.[1] || stage || "—";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toLocalDateTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 16);
}

function escapeExternalUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function createAction(label, action, id, danger = false) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = `business-action${danger ? " danger" : ""}`;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;

  return button;
}

function populateFilterOptions() {
  const countries = [...new Set(
    allBusinesses.map((item) => item.country?.trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const categories = [...new Set(
    allBusinesses.map((item) => item.category?.trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  fillFilter("filterCountry", "All countries", countries);
  fillFilter("filterCategory", "All categories", categories);
}

function fillFilter(id, defaultLabel, values) {
  const select = $(id);
  const previousValue = select.value;

  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultLabel;
  select.appendChild(defaultOption);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }

  if (values.includes(previousValue)) {
    select.value = previousValue;
  }
}

function getFilteredBusinesses() {
  const query = $("searchBusinesses").value.trim().toLowerCase();
  const country = $("filterCountry").value;
  const category = $("filterCategory").value;
  const stage = $("filterStage").value;

  return allBusinesses.filter((business) => {
    const searchable = [
      business.business_name,
      business.contact,
      business.contact_2,
      business.email,
      business.website_url,
      business.country,
      business.category,
      business.address,
      business.optional_details
    ].join(" ").toLowerCase();

    return (
      (!query || searchable.includes(query)) &&
      (!country || business.country === country) &&
      (!category || business.category === category) &&
      (!stage || business.stage === stage)
    );
  });
}

function renderBusinesses() {
  const body = $("businessesTableBody");
  const filtered = getFilteredBusinesses();

  body.replaceChildren();

  $("businessCount").textContent =
    `Showing ${filtered.length} of ${allBusinesses.length} active businesses`;

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.className = "dashboard-empty";
    cell.textContent = allBusinesses.length
      ? "No businesses match your search or filters."
      : "No businesses yet. Click + Add Business to get started.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const business of filtered) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = business.business_name || "Unnamed business";
    nameCell.appendChild(name);

    if (business.website_url) {
      const safeUrl = escapeExternalUrl(business.website_url);

      if (safeUrl) {
        const link = document.createElement("a");
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Website";
        link.style.display = "block";
        link.style.marginTop = "5px";
        nameCell.appendChild(link);
      }
    }

    const contactCell = createCell(business.contact);
    if (business.email) {
      const emailLink = document.createElement("a");
      emailLink.href = `mailto:${business.email}`;
      emailLink.textContent = business.email;
      emailLink.style.display = "block";
      contactCell.appendChild(emailLink);
    }

    const stageCell = document.createElement("td");
    const stageSelect = document.createElement("select");
    stageSelect.className = "business-stage";
    stageSelect.setAttribute(
      "aria-label",
      `Sales stage for ${business.business_name}`
    );
    stageSelect.dataset.action = "stage";
    stageSelect.dataset.id = business.id;

    for (const [value, label] of STAGES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      stageSelect.appendChild(option);
    }

    stageSelect.value = business.stage || "new";
    stageCell.appendChild(stageSelect);

    const actionsCell = document.createElement("td");
    actionsCell.append(
      createAction("Edit", "edit", business.id),
      createAction("Archive", "archive", business.id, true)
    );

    row.append(
      nameCell,
      contactCell,
      createCell(business.country),
      createCell(business.category),
      stageCell,
      createCell(formatDate(business.next_follow_up_at)),
      actionsCell
    );

    body.appendChild(row);
  }
}

async function loadBusinesses() {
  $("businessCount").textContent = "Loading businesses...";

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id,
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
      created_at
    `)
    .eq("user_id", currentUser.id)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) throw error;

  allBusinesses = data || [];
  populateFilterOptions();
  renderBusinesses();
}

function openModal(business = null) {
  clearMessage("formMessage");
  $("businessForm").reset();

  $("businessId").value = business?.id || "";
  $("businessModalTitle").textContent =
    business ? "Edit Business" : "Add Business";

  $("businessName").value = business?.business_name || "";
  $("businessContact").value = business?.contact || "";
  $("businessContact2").value = business?.contact_2 || "";
  $("businessEmail").value = business?.email || "";
  $("businessWebsite").value = business?.website_url || "";
  $("businessCountry").value = business?.country || "";
  $("businessCategory").value = business?.category || "";
  $("businessStage").value = business?.stage || "new";
  $("businessFollowUp").value = toLocalDateTime(
    business?.next_follow_up_at
  );
  $("businessSource").value = business?.lead_source || "";
  $("businessAddress").value = business?.address || "";
  $("businessDetails").value = business?.optional_details || "";

  $("businessModal").classList.add("open");
  $("businessName").focus();
}

function closeModal() {
  if (saving) return;
  $("businessModal").classList.remove("open");
  clearMessage("formMessage");
}

function formValue(id) {
  return $(id).value.trim();
}

function getFormPayload() {
  const followUpValue = formValue("businessFollowUp");

  return {
    business_name: formValue("businessName"),
    contact: formValue("businessContact") || null,
    contact_2: formValue("businessContact2") || null,
    email: formValue("businessEmail") || null,
    website_url: formValue("businessWebsite") || null,
    country: formValue("businessCountry") || null,
    category: formValue("businessCategory") || null,
    stage: $("businessStage").value,
    next_follow_up_at: followUpValue
      ? new Date(followUpValue).toISOString()
      : null,
    lead_source: formValue("businessSource") || null,
    address: formValue("businessAddress") || null,
    optional_details: formValue("businessDetails") || null
  };
}

async function saveBusiness(event) {
  event.preventDefault();

  if (saving) return;

  const businessName = formValue("businessName");

  if (!businessName) {
    showMessage("Business name is required.", "error", "formMessage");
    return;
  }

  const website = formValue("businessWebsite");
  if (website && !escapeExternalUrl(website)) {
    showMessage(
      "Enter a valid website URL starting with https:// or http://.",
      "error",
      "formMessage"
    );
    return;
  }

  const email = formValue("businessEmail");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage("Enter a valid email address.", "error", "formMessage");
    return;
  }

  saving = true;
  $("saveBusinessButton").disabled = true;
  $("saveBusinessButton").textContent = "Saving...";

  try {
    const id = $("businessId").value;
    const payload = getFormPayload();

    let result;

    if (id) {
      result = await supabase
        .from("leads")
        .update(payload)
        .eq("id", id)
        .eq("user_id", currentUser.id)
        .select("id")
        .single();
    } else {
      result = await supabase
        .from("leads")
        .insert({
          ...payload,
          user_id: currentUser.id,
          is_archived: false
        })
        .select("id")
        .single();
    }

    if (result.error) throw result.error;

    $("businessModal").classList.remove("open");
    clearMessage("formMessage");
    showMessage(
      id ? "Business updated successfully." : "Business added successfully.",
      "success"
    );

    await loadBusinesses();
  } catch (error) {
    console.error("Save business error:", error);
    showMessage(
      error?.message || "Could not save this business.",
      "error",
      "formMessage"
    );
  } finally {
    saving = false;
    $("saveBusinessButton").disabled = false;
    $("saveBusinessButton").textContent = "Save Business";
  }
}

async function updateStage(id, stage, selectElement) {
  const previous = allBusinesses.find((item) => item.id === id)?.stage || "new";

  selectElement.disabled = true;
  clearMessage();

  try {
    const { error } = await supabase
      .from("leads")
      .update({ stage })
      .eq("id", id)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    const business = allBusinesses.find((item) => item.id === id);
    if (business) business.stage = stage;

    showMessage("Sales stage updated.", "success");
    renderBusinesses();
  } catch (error) {
    console.error("Update stage error:", error);
    selectElement.value = previous;
    showMessage(error?.message || "Could not update the stage.");
  } finally {
    selectElement.disabled = false;
  }
}

async function archiveBusiness(id) {
  const business = allBusinesses.find((item) => item.id === id);
  if (!business) return;

  const confirmed = window.confirm(
    `Archive "${business.business_name}"? You can restore it later from the Archive page.`
  );

  if (!confirmed) return;

  clearMessage();

  try {
    const { error } = await supabase
      .from("leads")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    showMessage("Business archived successfully.", "success");
    await loadBusinesses();
  } catch (error) {
    console.error("Archive error:", error);
    showMessage(error?.message || "Could not archive this business.");
  }
}

async function initialize() {
  if (!requireSupabase()) return;

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (!data.session) {
      window.location.replace("index.html");
      return;
    }

    currentUser = data.session.user;

    $("addBusinessButton").addEventListener("click", () => openModal());
    $("cancelBusinessButton").addEventListener("click", closeModal);
    $("businessForm").addEventListener("submit", saveBusiness);

    $("businessModal").addEventListener("click", (event) => {
      if (event.target === $("businessModal")) closeModal();
    });

    $("searchBusinesses").addEventListener("input", renderBusinesses);
    $("filterCountry").addEventListener("change", renderBusinesses);
    $("filterCategory").addEventListener("change", renderBusinesses);
    $("filterStage").addEventListener("change", renderBusinesses);

    $("businessesTableBody").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const { action, id } = button.dataset;

      if (action === "edit") {
        const business = allBusinesses.find((item) => item.id === id);
        if (business) openModal(business);
      }

      if (action === "archive") {
        archiveBusiness(id);
      }
    });

    $("businessesTableBody").addEventListener("change", (event) => {
      const select = event.target.closest('select[data-action="stage"]');
      if (!select) return;

      updateStage(select.dataset.id, select.value, select);
    });

    await loadBusinesses();
  } catch (error) {
    console.error("Businesses page error:", error);
    showMessage(
      error?.message || "Could not load businesses. Please refresh."
    );
    $("businessCount").textContent = "Unable to load businesses.";
  }
}

const logoutButton = $("logoutButton");

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    window.location.replace("index.html");
  } catch (error) {
    console.error("Logout error:", error);
    showMessage(error?.message || "Could not log out.");
    logoutButton.disabled = false;
  }
});

initialize();
