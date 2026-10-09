
import { supabase, requireSupabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

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

const PIPELINE = [
  { stage: "new", countId: "pipelineNew", color: "purple" },
  {
    stage: "first_message_sent",
    countId: "pipelineMessage",
    color: "blue"
  },
  { stage: "follow_up", countId: "pipelineFollowUp", color: "orange" },
  { stage: "interested", countId: "pipelineInterested", color: "pink" },
  { stage: "won", countId: "pipelineWon", color: "green" }
];

let currentUser = null;
let activeLeads = [];
let searchDebounce = null;

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function showMessage(message, type = "error") {
  const element = $("dashboardMessage");
  if (!element) return;

  element.textContent = message;
  element.className = `dashboard-message show ${type}`;
}

function clearMessage() {
  const element = $("dashboardMessage");
  if (!element) return;

  element.textContent = "";
  element.className = "dashboard-message";
}

function formatDate(value) {
  if (!value) return "Not scheduled";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function stageLabel(stage) {
  return STAGES[stage] || stage || "New Lead";
}

function stageClass(stage) {
  return `stage-badge stage-${STAGES[stage] ? stage : "new"}`;
}

function makeCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function makeStageBadge(stage) {
  const badge = document.createElement("span");
  badge.className = stageClass(stage);
  badge.textContent = stageLabel(stage);
  return badge;
}

function makeViewLink(lead) {
  const link = document.createElement("a");
  link.href = `businesses.html?lead=${encodeURIComponent(lead.id)}`;
  link.textContent = "View";
  link.setAttribute("aria-label", `View ${lead.business_name || "business"}`);
  return link;
}

function isDue(lead, now) {
  if (!lead.next_follow_up_at) return false;

  const followUpTime = new Date(lead.next_follow_up_at).getTime();
  return Number.isFinite(followUpTime) && followUpTime <= now;
}

function updatePipeline(leads) {
  const total = leads.length;

  for (const item of PIPELINE) {
    const count = leads.filter((lead) => lead.stage === item.stage).length;

    setText(item.countId, count);

    const countElement = $(item.countId);
    if (!countElement) continue;

    // Update the progress bar if this item has one in the HTML.
    const card = countElement.closest(".pipeline-item");
    if (!card) continue;

    const percent = total > 0 ? Math.round((count / total) * 100) : 0;
    const percentElement = card.querySelector(".pipeline-percent");
    const progressBar = card.querySelector(".pipeline-progress span");

    if (percentElement) {
      percentElement.textContent = `${percent}%`;
    }

    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }
  }
}

function renderFollowUps(leads) {
  const table = $("followUpsTable");
  if (!table) return;

  table.replaceChildren();

  const scheduled = leads
    .filter((lead) => lead.next_follow_up_at)
    .sort(
      (a, b) =>
        new Date(a.next_follow_up_at).getTime() -
        new Date(b.next_follow_up_at).getTime()
    )
    .slice(0, 8);

  if (scheduled.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent =
      "No follow-ups scheduled yet. Add a follow-up to a lead to see it here.";

    row.appendChild(cell);
    table.appendChild(row);
    return;
  }

  for (const lead of scheduled) {
    const row = document.createElement("tr");

    row.appendChild(makeCell(lead.business_name));
    row.appendChild(makeCell(lead.country || "—"));
    row.appendChild(makeCell(formatDate(lead.next_follow_up_at)));

    const stageCell = document.createElement("td");
    stageCell.appendChild(makeStageBadge(lead.stage));
    row.appendChild(stageCell);

    const actionCell = document.createElement("td");
    actionCell.appendChild(makeViewLink(lead));
    row.appendChild(actionCell);

    table.appendChild(row);
  }
}

function updateDashboard(leads, messageCount) {
  const now = Date.now();

  setText("totalLeads", leads.length);
  setText(
    "newLeads",
    leads.filter((lead) => lead.stage === "new").length
  );
  setText("messagesSent", messageCount);
  setText(
    "interestedLeads",
    leads.filter((lead) => lead.stage === "interested").length
  );
  setText("followUpsDue", leads.filter((lead) => isDue(lead, now)).length);
  setText("wonLeads", leads.filter((lead) => lead.stage === "won").length);

  updatePipeline(leads);
  renderFollowUps(leads);
}

async function loadDashboard() {
  clearMessage();

  const client = requireSupabase();

  if (!client) {
    showMessage(
      "Supabase is not configured. Check the URL and publishable key in assets/js/config.js."
    );
    return;
  }

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) {
    showMessage(`Could not check your session: ${sessionError.message}`);
    return;
  }

  const session = sessionData?.session;

  if (!session) {
    window.location.replace("index.html");
    return;
  }

  currentUser = session.user;

  const profileName =
    currentUser.user_metadata?.full_name ||
    currentUser.user_metadata?.name ||
    currentUser.email?.split("@")[0] ||
    "User";

  const nameElement = $("userName");
  if (nameElement) {
    nameElement.textContent = `Hello, ${profileName}`;
  }

  const [leadsResult, activitiesResult] = await Promise.all([
    client
      .from("leads")
      .select(
        "id, business_name, country, stage, next_follow_up_at, created_at"
      )
      .eq("user_id", currentUser.id)
      .eq("is_archived", false)
      .order("created_at", { ascending: false }),

    client
      .from("activities")
      .select("lead_id")
      .eq("user_id", currentUser.id)
      .eq("activity_type", "first_message_sent")
  ]);

  if (leadsResult.error) {
    showMessage(`Could not load leads: ${leadsResult.error.message}`);
    return;
  }

  if (activitiesResult.error) {
    console.warn(
      "Could not load message activity count:",
      activitiesResult.error.message
    );
  }

  activeLeads = leadsResult.data || [];

  // Count distinct leads with a recorded first-message activity.
  const messageCount = activitiesResult.error
    ? 0
    : new Set(
        (activitiesResult.data || []).map((activity) => activity.lead_id)
      ).size;

  updateDashboard(activeLeads, messageCount);
}

async function logout() {
  const button = $("logoutButton");
  if (button) button.disabled = true;

  try {
    const client = requireSupabase();

    if (!client) {
      window.location.replace("index.html");
      return;
    }

    const { error } = await client.auth.signOut();

    if (error) {
      showMessage(`Could not log out: ${error.message}`);
      if (button) button.disabled = false;
      return;
    }

    window.location.replace("index.html");
  } catch (error) {
    showMessage(error.message || "An unexpected logout error occurred.");
    if (button) button.disabled = false;
  }
}

function setupGlobalSearch() {
  const searchInput = $("globalSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);

    searchDebounce = setTimeout(() => {
      const query = searchInput.value.trim();

      if (!query) {
        window.location.href = "businesses.html";
        return;
      }

      window.location.href =
        `businesses.html?q=${encodeURIComponent(query)}`;
    }, 350);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      clearTimeout(searchDebounce);
      window.location.href =
        `businesses.html?q=${encodeURIComponent(searchInput.value.trim())}`;
    }
  });
}

function setupNotifications() {
  const button = $("notificationButton");
  if (!button) return;

  button.addEventListener("click", () => {
    window.location.href = "follow-ups.html";
  });
}

function setupAuthListener() {
  const client = supabase;
  if (!client) return;

  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("index.html");
    }
  });
}

async function initDashboard() {
  const logoutButton = $("logoutButton");

  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  setupGlobalSearch();
  setupNotifications();
  setupAuthListener();

  try {
    await loadDashboard();
  } catch (error) {
    console.error("Dashboard initialization failed:", error);
    showMessage(
      error.message || "Unable to load the dashboard. Please refresh the page."
    );
  }
}

initDashboard();
