
import { supabase, requireSupabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  templates: [],
  leads: [],
  selected: new Set(),
  page: 1,
  pageSize: 8,
  editingId: null,
  usageThisWeek: 0
};

const categoryColors = ["", "blue", "teal", "pink", "orange"];
const categoryIcons = {
  "cold outreach": "✉",
  "follow-up": "◷",
  call: "☎",
  engagement: "☆",
  proposal: "▤",
  closing: "✓",
  marketing: "▣"
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(message, type = "success") {
  const box = $("pageMessage");
  box.textContent = message;
  box.className = `page-message show ${type}`;

  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    box.className = "page-message";
    box.textContent = "";
  }, 5000);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatPreview(content, maxLength = 115) {
  const clean = String(content || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength
    ? `${clean.slice(0, maxLength)}…`
    : clean;
}

function getCategoryColor(category) {
  const text = normalize(category);

  if (text.includes("follow") || text.includes("marketing")) return "blue";
  if (text.includes("call") || text.includes("closing")) return "teal";
  if (text.includes("engagement") || text.includes("decline")) return "pink";
  if (text.includes("proposal")) return "orange";

  return "";
}

function getIcon(category) {
  return categoryIcons[normalize(category)] || "✉";
}

function getFilteredTemplates() {
  const query = normalize($("templateSearch").value);
  const category = $("categoryFilter").value;
  const sort = $("sortFilter").value;

  let items = state.templates.filter((template) => {
    const matchesQuery =
      !query ||
      normalize(template.name).includes(query) ||
      normalize(template.description).includes(query) ||
      normalize(template.category).includes(query) ||
      normalize(template.content).includes(query);

    const matchesCategory = !category || template.category === category;

    return matchesQuery && matchesCategory;
  });

  if (sort === "name") {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === "usage") {
    items.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
  } else if (sort === "oldest") {
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else {
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return items;
}

function renderStats() {
  $("totalTemplates").textContent = state.templates.length;

  const categories = new Set(
    state.templates.map((item) => item.category).filter(Boolean)
  );

  $("categoryCount").textContent = categories.size;
  $("usedThisWeek").textContent = state.usageThisWeek;

  const mostUsed = [...state.templates].sort(
    (a, b) => (b.usage_count || 0) - (a.usage_count || 0)
  )[0];

  $("mostUsed").textContent = mostUsed && (mostUsed.usage_count || 0) > 0
    ? mostUsed.name
    : "—";
}

function renderCategoryOptions() {
  const select = $("categoryFilter");
  const previousValue = select.value;

  const categories = [...new Set(
    state.templates.map((item) => item.category).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  select.replaceChildren(new Option("All categories", ""));

  categories.forEach((category) => {
    select.add(new Option(category, category));
  });

  if (categories.includes(previousValue)) {
    select.value = previousValue;
  }
}

function renderTemplates() {
  const filtered = getFilteredTemplates();
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));

  state.page = Math.min(state.page, totalPages);

  const start = (state.page - 1) * state.pageSize;
  const visible = filtered.slice(start, start + state.pageSize);
  const tbody = $("templatesTable");

  tbody.replaceChildren();

  if (!visible.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-state";
    cell.textContent = state.templates.length
      ? "No templates match your search or filters."
      : "No templates yet. Create your first message template.";
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    visible.forEach((template) => {
      const row = document.createElement("tr");
      const color = getCategoryColor(template.category);
      const isSelected = state.selected.has(template.id);

      row.innerHTML = `
        <td class="check-column">
          <input type="checkbox" class="template-checkbox"
            data-id="${escapeHtml(template.id)}"
            aria-label="Select ${escapeHtml(template.name)}"
            ${isSelected ? "checked" : ""}>
        </td>
        <td class="template-name-cell">
          <div class="template-name-wrap">
            <div class="template-icon ${color}">
              ${escapeHtml(getIcon(template.category))}
            </div>
            <div>
              <div class="template-name">${escapeHtml(template.name)}</div>
              <div class="template-description">${escapeHtml(template.description || "Message template")}</div>
            </div>
          </div>
        </td>
        <td><span class="category-pill ${color}">${escapeHtml(template.category)}</span></td>
        <td class="template-preview">${escapeHtml(formatPreview(template.content))}</td>
        <td class="usage-cell"><span class="usage-icon">▥</span>${Number(template.usage_count) || 0}</td>
        <td>
          <div class="action-group">
            <button class="small-action" data-action="edit" data-id="${escapeHtml(template.id)}">✎ Edit</button>
            <button class="small-action" data-action="use" data-id="${escapeHtml(template.id)}">➤ Use</button>
            <button class="more-action" title="Delete template"
              aria-label="Delete ${escapeHtml(template.name)}"
              data-action="delete" data-id="${escapeHtml(template.id)}">⋮</button>
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  const first = filtered.length ? start + 1 : 0;
  const last = Math.min(start + state.pageSize, filtered.length);

  $("resultsCount").textContent =
    `Showing ${first}–${last} of ${filtered.length}`;

  $("pageIndicator").textContent = `${state.page} / ${totalPages}`;
  $("previousPage").disabled = state.page <= 1;
  $("nextPage").disabled = state.page >= totalPages;

  $("selectAllTemplates").checked =
    visible.length > 0 && visible.every((item) => state.selected.has(item.id));

  $("selectAllTemplates").indeterminate =
    visible.some((item) => state.selected.has(item.id)) &&
    !visible.every((item) => state.selected.has(item.id));
}

async function loadTemplates() {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id,user_id,name,category,description,content,usage_count,created_at,updated_at")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  state.templates = data || [];
  renderCategoryOptions();
  renderStats();
  renderTemplates();
}

async function loadLeads() {
  const { data, error } = await supabase
    .from("leads")
    .select("id,business_name,contact,email,country")
    .eq("user_id", state.user.id)
    .eq("is_archived", false)
    .order("business_name", { ascending: true });

  if (error) throw error;

  state.leads = data || [];
}

function openCreateDialog() {
  state.editingId = null;
  $("templateForm").reset();
  $("templateId").value = "";
  $("dialogTitle").textContent = "Create New Template";
  $("saveTemplateButton").textContent = "Save Template";
  $("templateDialog").showModal();
  $("templateName").focus();
}

function openEditDialog(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;

  state.editingId = id;
  $("templateId").value = id;
  $("templateName").value = template.name;
  $("templateCategory").value = template.category;
  $("templateDescription").value = template.description || "";
  $("templateBody").value = template.content;

  $("dialogTitle").textContent = "Edit Template";
  $("saveTemplateButton").textContent = "Save Changes";
  $("templateDialog").showModal();
}

async function saveTemplate(event) {
  event.preventDefault();

  const name = $("templateName").value.trim();
  const category = $("templateCategory").value.trim();
  const description = $("templateDescription").value.trim();
  const content = $("templateBody").value.trim();

  if (!name || !category || !content) {
    showMessage("Please complete the template name, category, and message.", "error");
    return;
  }

  const button = $("saveTemplateButton");
  button.disabled = true;

  try {
    const values = {
      name,
      category,
      description,
      content,
      updated_at: new Date().toISOString()
    };

    let result;

    if (state.editingId) {
      result = await supabase
        .from("message_templates")
        .update(values)
        .eq("id", state.editingId)
        .eq("user_id", state.user.id);
    } else {
      result = await supabase
        .from("message_templates")
        .insert({
          ...values,
          user_id: state.user.id,
          usage_count: 0
        });
    }

    if (result.error) throw result.error;

    $("templateDialog").close();
    await loadTemplates();
    showMessage(state.editingId ? "Template updated." : "Template created.");
  } catch (error) {
    console.error("Saving template failed:", error);
    showMessage(error.message || "Could not save the template.", "error");
  } finally {
    button.disabled = false;
  }
}

function fillMessage(template, lead) {
  const replacements = {
    name: lead.contact || lead.business_name || "",
    business: lead.business_name || "",
    email: lead.email || "",
    country: lead.country || ""
  };

  return String(template.content || "").replace(
    /\{(name|business|email|country)\}/gi,
    (_, key) => replacements[key.toLowerCase()] || ""
  );
}

function openUseDialog(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;

  $("sendTemplateId").value = id;

  const select = $("sendLead");
  select.replaceChildren(new Option("Choose a business…", ""));

  state.leads.forEach((lead) => {
    select.add(new Option(lead.business_name, lead.id));
  });

  $("preparedMessage").value = template.content;
  $("sendDialog").showModal();

  select.onchange = () => {
    const lead = state.leads.find((item) => item.id === select.value);
    $("preparedMessage").value = lead ? fillMessage(template, lead) : template.content;
  };

  if (!state.leads.length) {
    showMessage("Add a lead before preparing a personalized message.", "error");
  }
}

async function recordUsage(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;

  const nextCount = (Number(template.usage_count) || 0) + 1;

  const { error } = await supabase
    .from("message_templates")
    .update({
      usage_count: nextCount,
      updated_at: new Date().toISOString()
    })
    .eq("id", templateId)
    .eq("user_id", state.user.id);

  if (error) throw error;

  template.usage_count = nextCount;
  renderStats();
  renderTemplates();
}

async function prepareMessage(event) {
  event.preventDefault();

  const templateId = $("sendTemplateId").value;
  const message = $("preparedMessage").value.trim();

  if (!message) {
    showMessage("The message is empty.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(message);
    await recordUsage(templateId);
    $("sendDialog").close();
    showMessage("Message copied. You can now paste it into your email or messaging app.");
  } catch (error) {
    console.error("Preparing message failed:", error);
    showMessage(
      "Copying was blocked by the browser. Select the message text and copy it manually.",
      "error"
    );
  }
}

async function deleteTemplate(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;

  const confirmed = window.confirm(
    `Delete "${template.name}"? This action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    const { error } = await supabase
      .from("message_templates")
      .delete()
      .eq("id", id)
      .eq("user_id", state.user.id);

    if (error) throw error;

    state.selected.delete(id);
    await loadTemplates();
    showMessage("Template deleted.");
  } catch (error) {
    console.error("Deleting template failed:", error);
    showMessage(error.message || "Could not delete the template.", "error");
  }
}

function handleTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "edit") openEditDialog(id);
  if (action === "use") openUseDialog(id);
  if (action === "delete") deleteTemplate(id);
}

function handleSelection(event) {
  const checkbox = event.target.closest(".template-checkbox");
  if (!checkbox) return;

  if (checkbox.checked) state.selected.add(checkbox.dataset.id);
  else state.selected.delete(checkbox.dataset.id);

  renderTemplates();
}

function bindEvents() {
  $("createTemplateButton").addEventListener("click", openCreateDialog);
  $("templateForm").addEventListener("submit", saveTemplate);
  $("sendForm").addEventListener("submit", prepareMessage);

  $("closeDialogButton").addEventListener("click", () => $("templateDialog").close());
  $("cancelTemplateButton").addEventListener("click", () => $("templateDialog").close());
  $("closeSendDialogButton").addEventListener("click", () => $("sendDialog").close());
  $("cancelSendButton").addEventListener("click", () => $("sendDialog").close());

  $("templateSearch").addEventListener("input", () => {
    state.page = 1;
    renderTemplates();
  });

  $("categoryFilter").addEventListener("change", () => {
    state.page = 1;
    renderTemplates();
  });

  $("sortFilter").addEventListener("change", () => {
    state.page = 1;
    renderTemplates();
  });

  $("clearFiltersButton").addEventListener("click", () => {
    $("templateSearch").value = "";
    $("categoryFilter").value = "";
    $("sortFilter").value = "newest";
    state.page = 1;
    renderTemplates();
  });

  $("previousPage").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderTemplates();
    }
  });

  $("nextPage").addEventListener("click", () => {
    const pages = Math.max(1, Math.ceil(getFilteredTemplates().length / state.pageSize));
    if (state.page < pages) {
      state.page++;
      renderTemplates();
    }
  });

  $("templatesTable").addEventListener("click", handleTableClick);
  $("templatesTable").addEventListener("change", handleSelection);

  $("selectAllTemplates").addEventListener("change", (event) => {
    const filtered = getFilteredTemplates();
    const start = (state.page - 1) * state.pageSize;
    const visible = filtered.slice(start, start + state.pageSize);

    visible.forEach((item) => {
      if (event.target.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
    });

    renderTemplates();
  });

  $("globalSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const query = $("globalSearch").value.trim();
      window.location.href = query
        ? `businesses.html?search=${encodeURIComponent(query)}`
        : "businesses.html";
    }
  });

  $("logoutButton").addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      showMessage(error.message || "Could not log out.", "error");
      return;
    }

    window.location.href = "index.html";
  });
}

async function init() {
  try {
    requireSupabase();

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    if (!data.session) {
      window.location.replace("index.html");
      return;
    }

    state.user = data.session.user;

    bindEvents();

    await Promise.all([
      loadTemplates(),
      loadLeads()
    ]);
  } catch (error) {
    console.error("Message templates initialization failed:", error);

    const message = error.message || "Unable to connect to your CRM.";

    if (/column .* does not exist|schema cache/i.test(message)) {
      showMessage(
        "Your message_templates table columns do not match this page's expected schema. Check the table columns and update the JavaScript queries.",
        "error"
      );
    } else {
      showMessage(message, "error");
    }

    $("templatesTable").innerHTML =
      '<tr><td colspan="6" class="empty-state">Could not load templates. Check your Supabase connection and table permissions.</td></tr>';
  }
}

init();
