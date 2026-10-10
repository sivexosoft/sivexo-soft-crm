
import { supabase, requireSupabase } from "./supabase.js";

const $ = id => document.getElementById(id);

const fileInput = $("csvFile");
const dropZone = $("dropZone");
const startButton = $("startImport");
const messageBox = $("bulkMessage");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const REQUIRED_COLUMNS = ["business_name", "contact", "country"];
const VALID_STAGES = [
  "new", "first_message_sent", "follow_up", "call_done",
  "interested", "not_interested", "future_opportunity",
  "proposal_sent", "won", "lost"
];

const ALLOWED_SERVICES = [
  "Web Development",
  "App Development",
  "Digital Marketing",
  "Graphic Design",
  "SEO & Automation",
  "Branding",
  "AI Solutions",
  "Social Media Management"
];

const STAGE_ALIASES = {
  "new lead": "new",
  "new": "new",
  "first message": "first_message_sent",
  "first message sent": "first_message_sent",
  "first_message_sent": "first_message_sent",
  "follow-up": "follow_up",
  "follow up": "follow_up",
  "follow_up": "follow_up",
  "call done": "call_done",
  "call_done": "call_done",
  "interested": "interested",
  "not interested": "not_interested",
  "not_interested": "not_interested",
  "future opportunity": "future_opportunity",
  "future_opportunity": "future_opportunity",
  "proposal sent": "proposal_sent",
  "proposal_sent": "proposal_sent",
  "won": "won",
  "lost": "lost"
};

let currentUser = null;
let selectedFile = null;
let parsedRows = [];
let validationRows = [];
let validated = false;
let importing = false;

function showMessage(message, type = "info") {
  messageBox.textContent = message;
  messageBox.className = `form-message show ${type}`;
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "form-message";
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

// CSV parser supporting quoted values, commas inside quoted cells,
// escaped quotes, and line breaks inside quoted cells.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) {
    throw new Error("Your CSV has an unclosed quotation mark. Check the file and try again.");
  }

  row.push(cell);
  if (row.some(value => value.trim() !== "")) rows.push(row);

  if (rows.length < 2) {
    throw new Error("The CSV must contain a header row and at least one business.");
  }

  const headers = rows[0].map(normalizeHeader);

  if (headers.some(header => !header)) {
    throw new Error("The CSV contains an empty column heading.");
  }

  if (new Set(headers).size !== headers.length) {
    throw new Error("Your CSV contains duplicate column headings. Please make each heading unique.");
  }

  const missing = REQUIRED_COLUMNS.filter(header => !headers.includes(header));
  if (missing.length) {
    throw new Error(`Missing required CSV columns: ${missing.join(", ")}`);
  }

  return rows.slice(1).map((cells, index) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = String(cells[columnIndex] ?? "").trim();
    });

    return { csvRow: index + 2, record };
  });
}

function normalizeStage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return STAGE_ALIASES[normalized] || null;
}

function parseServices(value) {
  if (!value) return [];

  // Services are comma-separated. In the CSV, quote the whole cell,
  // for example: "Web Development, SEO & Automation".
  return [...new Set(
    value.split(";").map(item => item.trim()).filter(Boolean)
  )];
}

function parseFollowUp(value) {
  if (!value) return null;

  // Accept date-only or local date/time.
  const normalized = value.trim().replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function duplicateKey(record) {
  const email = normalizeEmail(record.email);
  if (email) return `email:${email}`;

  const name = String(record.business_name || "").trim().toLowerCase();
  const country = String(record.country || "").trim().toLowerCase();

  return `business:${name}|${country}`;
}

function prepareRecord(record) {
  const stage = record.stage ? normalizeStage(record.stage) : $("defaultStage").value;
  const followUp = parseFollowUp(record.next_follow_up_at || "");

  return {
    stage,
    followUp,
    services: parseServices(record.services || "")
  };
}

function validateRecord(item) {
  const record = item.record;
  const problems = [];

  for (const field of REQUIRED_COLUMNS) {
    if (!record[field]) problems.push(`Missing ${field}`);
  }

  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    problems.push("Invalid email address");
  }

  const stage = record.stage ? normalizeStage(record.stage) : $("defaultStage").value;
  if (!stage || !VALID_STAGES.includes(stage)) {
    problems.push("Unknown lead stage");
  }

  const followUp = parseFollowUp(record.next_follow_up_at || "");
  if (followUp === undefined) {
    problems.push("Invalid follow-up date");
  }

  const services = parseServices(record.services || "");
  const unknownServices = services.filter(service =>
    !ALLOWED_SERVICES.some(allowed => allowed.toLowerCase() === service.toLowerCase())
  );

  if (unknownServices.length) {
    problems.push(`Unknown service: ${unknownServices.join(", ")}`);
  }

  if (record.website_url && !/^https?:\/\//i.test(record.website_url)) {
    problems.push("Website must start with http:// or https://");
  }

  return {
    ...item,
    stage,
    followUp,
    services: services.map(service =>
      ALLOWED_SERVICES.find(allowed => allowed.toLowerCase() === service.toLowerCase())
    ),
    problems,
    duplicate: false
  };
}

function makeCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderPreview(rows) {
  const body = $("previewTable");
  body.replaceChildren();

  rows.slice(0, 5).forEach(item => {
    const record = item.record;
    const tr = document.createElement("tr");

    [
      record.business_name,
      record.contact,
      record.email,
      record.country,
      record.category,
      record.services,
      record.stage,
      record.next_follow_up_at
    ].forEach(value => tr.appendChild(makeCell(value || "—")));

    body.appendChild(tr);
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = makeCell("No data rows found");
    td.colSpan = 8;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  $("previewSummary").textContent =
    `Previewing ${Math.min(rows.length, 5)} of ${rows.length} CSV data rows.`;
}

function renderValidation(rows) {
  const panel = $("validationPanel");
  const body = $("validationTable");
  panel.hidden = false;
  body.replaceChildren();

  const errors = rows.filter(row => row.problems.length);
  const duplicates = rows.filter(row => row.duplicate && !row.problems.length);
  const ready = rows.filter(row => !row.problems.length && !row.duplicate);

  $("rowCount").textContent = rows.length;
  $("validCount").textContent = ready.length;
  $("errorCount").textContent = errors.length;
  $("duplicateCount").textContent = duplicates.length;

  rows.slice(0, 200).forEach(row => {
    const tr = document.createElement("tr");
    const status = row.problems.length
      ? "Error"
      : row.duplicate
        ? "Duplicate"
        : "Ready";

    const statusClass = row.problems.length
      ? "status-error"
      : row.duplicate
        ? "status-duplicate"
        : "status-ready";

    tr.append(
      makeCell(String(row.csvRow)),
      makeCell(row.record.business_name || "Unnamed business"),
      makeCell(status, statusClass),
      makeCell(row.problems.join("; ") || (row.duplicate
        ? "This record matches an existing or repeated lead."
        : "Ready to import"))
    );

    body.appendChild(tr);
  });

  if (rows.length > 200) {
    const tr = document.createElement("tr");
    const td = makeCell(`Showing the first 200 of ${rows.length} validation rows.`);
    td.colSpan = 4;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  startButton.disabled = ready.length === 0 || importing;
  startButton.innerHTML = `<span>⇧</span> Import ${ready.length} Valid Leads`;
}

async function checkDuplicates(rows) {
  if ($("duplicateMode").value === "import") {
    rows.forEach(row => { row.duplicate = false; });
    return rows;
  }

  // Fetch this user's existing lead fields for local duplicate comparison.
  const { data, error } = await supabase
    .from("leads")
    .select("business_name, email, country")
    .eq("user_id", currentUser.id);

  if (error) throw error;

  const known = new Set((data || []).map(lead => duplicateKey(lead)));

  // Also detect duplicates inside the uploaded file.
  for (const row of rows) {
    const key = duplicateKey(row.record);
    if (known.has(key)) {
      row.duplicate = true;
    } else {
      known.add(key);
    }
  }

  return rows;
}

async function validateCurrentFile() {
  clearMessage();

  if (!selectedFile) {
    showMessage("Choose a CSV file first.", "error");
    return;
  }

  startButton.disabled = true;
  showMessage("Checking CSV rows and duplicates…", "info");

  try {
    validationRows = parsedRows.map(validateRecord);
    await checkDuplicates(validationRows);

    validated = true;
    renderValidation(validationRows);

    const errors = validationRows.filter(row => row.problems.length).length;
    const duplicates = validationRows.filter(row => row.duplicate && !row.problems.length).length;
    const ready = validationRows.filter(row => !row.problems.length && !row.duplicate).length;

    showMessage(
      `Validation complete: ${ready} ready, ${errors} with errors, ${duplicates} duplicates skipped by the current setting.`,
      errors ? "info" : "success"
    );
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Could not validate this CSV.", "error");
    startButton.disabled = true;
  }
}

async function handleFile(file) {
  clearMessage();

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    showMessage("Please choose a .csv file.", "error");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showMessage("This file is larger than 5MB. Please choose a smaller CSV.", "error");
    return;
  }

  try {
    const text = await file.text();
    const rows = parseCSV(text);

    selectedFile = file;
    parsedRows = rows;
    validationRows = [];
    validated = false;

    $("fileName").textContent = file.name;
    $("fileMeta").textContent = `${rows.length} business rows · ${(file.size / 1024).toFixed(1)} KB`;
    $("fileInfo").hidden = false;
    $("dropTitle").textContent = file.name;
    startButton.disabled = true;

    renderPreview(rows);
    $("validationPanel").hidden = true;
    showMessage("CSV loaded. Review the preview, then start validation before importing.", "success");

    await validateCurrentFile();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Could not read the CSV file.", "error");
    resetFile();
  }
}

function resetFile() {
  selectedFile = null;
  parsedRows = [];
  validationRows = [];
  validated = false;

  fileInput.value = "";
  $("fileInfo").hidden = true;
  $("dropTitle").textContent = "Drag and drop your CSV file here";
  $("previewSummary").textContent = "Upload a CSV to preview your actual rows here.";
  $("validationPanel").hidden = true;
  startButton.disabled = true;
  startButton.innerHTML = "<span>⇧</span> Start Import";

  renderPreview([]);
}

function downloadSample() {
  const csv = [
    "business_name,contact,contact_2,website_url,email,country,category,address,optional_details,lead_source,services,stage,next_follow_up_at",
    'Global Rentals Ltd,John Smith,,https://example.com,contact@example.com,Guyana,Car Rental,,Interested in website services,Manual,"Web Development; SEO & Automation",new,2026-10-15',
    'Tropical Tours,Jane Doe,,https://example.org,hello@example.org,Tanzania,Travel,,Needs marketing support,Website,"Digital Marketing; Branding",interested,2026-10-18'
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "sivexo-business-import-sample.csv";
  link.click();

  URL.revokeObjectURL(url);
}

async function importLeads() {
  if (importing || !validated || !currentUser) return;

  // Revalidate and recheck duplicates immediately before writing.
  // This reduces, but cannot completely eliminate, concurrent duplicate imports.
  importing = true;
  startButton.disabled = true;
  startButton.textContent = "Importing…";
  clearMessage();

  try {
    validationRows = parsedRows.map(validateRecord);
    await checkDuplicates(validationRows);

    const readyRows = validationRows.filter(row =>
      !row.problems.length && !row.duplicate
    );

    if (!readyRows.length) {
      renderValidation(validationRows);
      showMessage("There are no valid new rows to import.", "error");
      return;
    }

    const isArchived = $("importArchived").checked;
    const now = new Date().toISOString();

    const leadsToInsert = readyRows.map(row => {
      const r = row.record;
      return {
        user_id: currentUser.id,
        business_name: r.business_name.trim(),
        contact: r.contact.trim(),
        contact_2: r.contact_2 || null,
        website_url: r.website_url || null,
        email: r.email || null,
        country: r.country.trim(),
        category: r.category || null,
        address: r.address || null,
        optional_details: r.optional_details || null,
        lead_source: r.lead_source || null,
        stage: row.stage,
        next_follow_up_at: row.followUp || null,
        is_archived: isArchived,
        archived_at: isArchived ? now : null
      };
    });

    // Insert in batches to avoid overly large requests.
    let insertedCount = 0;
    let serviceCount = 0;
    const failures = [];

    for (let start = 0; start < readyRows.length; start += 50) {
      const rowBatch = readyRows.slice(start, start + 50);
      const leadBatch = leadsToInsert.slice(start, start + 50);

      const { data: insertedLeads, error } = await supabase
        .from("leads")
        .insert(leadBatch)
        .select("id, business_name");

      if (error) {
        console.error("Lead batch insert failed:", error);
        failures.push(`Batch starting at CSV row ${rowBatch[0].csvRow}: ${error.message}`);
        continue;
      }

      insertedCount += insertedLeads.length;

      // Match returned records to submitted records by business name.
      // For repeated names, use per-name queues to preserve row matching.
      const queues = new Map();

      insertedLeads.forEach(lead => {
        const key = lead.business_name;
        if (!queues.has(key)) queues.set(key, []);
        queues.get(key).push(lead);
      });

      const serviceRows = [];

      rowBatch.forEach(row => {
        const queue = queues.get(row.record.business_name);
        const inserted = queue?.shift();
        if (!inserted) return;

        row.importedLeadId = inserted.id;

        row.services.forEach(serviceName => {
          serviceRows.push({
            user_id: currentUser.id,
            lead_id: inserted.id,
            service_name: serviceName
          });
        });
      });

      if (serviceRows.length) {
        const { error: serviceError } = await supabase
          .from("lead_services")
          .insert(serviceRows);

        if (serviceError) {
          console.error("Service insert failed:", serviceError);
          failures.push(`Services for one batch could not be saved: ${serviceError.message}`);
        } else {
          serviceCount += serviceRows.length;
        }
      }

      const activityRows = rowBatch
        .filter(row => row.importedLeadId)
        .map(row => ({
          user_id: currentUser.id,
          lead_id: row.importedLeadId,
          activity_type: "created",
          description: `Imported from CSV: ${row.record.business_name}`,
          services: row.services,
          outcome: "Bulk import"
        }));

      if (activityRows.length) {
        const { error: activityError } = await supabase
          .from("activities")
          .insert(activityRows);

        if (activityError) {
          console.warn("Some import activities could not be recorded:", activityError);
        }
      }
    }

    renderValidation(validationRows);

    if (failures.length) {
      showMessage(
        `${insertedCount} leads saved. ${failures.join(" | ")} Review your database before retrying, to avoid duplicate records.`,
        "error"
      );
    } else {
      showMessage(
        `Import complete: ${insertedCount} businesses saved and ${serviceCount} service assignments saved.`,
        "success"
      );

      resetFile();
    }
  } catch (error) {
    console.error("Import failed:", error);
    showMessage(
      error.message || "Import failed. Check Supabase permissions and your database schema.",
      "error"
    );
  } finally {
    importing = false;
    if (validated && selectedFile) {
      startButton.disabled = !validationRows.some(row =>
        !row.problems.length && !row.duplicate
      );
      startButton.innerHTML = "<span>⇧</span> Start Import";
    } else {
      startButton.disabled = true;
      startButton.innerHTML = "<span>⇧</span> Start Import";
    }
  }
}

async function initialize() {
  try {
    requireSupabase();

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    currentUser = data.session?.user;

    if (!currentUser) {
      window.location.replace("index.html");
      return;
    }

    const email = currentUser.email || "Sivexo Workspace";
    $("userLabel").textContent = email;
    $("userAvatar").textContent = email.charAt(0).toUpperCase();
  } catch (error) {
    console.error("CRM session error:", error);
    showMessage(
      "Could not connect to Supabase. Check your project URL, API key, and sign-in session.",
      "error"
    );
  }
}

// Upload interactions
dropZone.addEventListener("click", event => {
  if (event.target.closest("button")) return;
  fileInput.click();
});

dropZone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

$("chooseFileButton").addEventListener("click", event => {
  event.stopPropagation();
  fileInput.click();
});

fileInput.addEventListener("change", event => {
  handleFile(event.target.files?.[0]);
});

dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", event => {
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  handleFile(event.dataTransfer.files?.[0]);
});

$("removeFileButton").addEventListener("click", resetFile);
$("downloadSample").addEventListener("click", downloadSample);
startButton.addEventListener("click", importLeads);
$("resetImport").addEventListener("click", () => {
  if (importing) return;
  resetFile();
  $("defaultStage").value = "new";
  $("duplicateMode").value = "skip";
  $("importArchived").checked = false;
  clearMessage();
});

$("duplicateMode").addEventListener("change", async () => {
  if (selectedFile) await validateCurrentFile();
});

// Global search goes to the All Businesses page.
$("globalSearch").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    const query = event.currentTarget.value.trim();
    if (query) {
      window.location.href = `businesses.html?search=${encodeURIComponent(query)}`;
    }
  }
});

// Sign out
$("logoutButton").addEventListener("click", async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.replace("index.html");
  } catch (error) {
    console.error(error);
    showMessage("Could not log out. Please try again.", "error");
  }
});

renderPreview([]);
initialize();
