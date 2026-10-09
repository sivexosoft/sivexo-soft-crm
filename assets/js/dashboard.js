
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
  {
    stage: "new",
    countId: "pipelineNew",
    percentId: "pipelineNewPercent",
    barId: "pipelineNewBar"
  },
  {
    stage: "first_message_sent",
    countId: "pipelineMessage",
    percentId: "pipelineMessagePercent",
    barId: "pipelineMessageBar"
  },
  {
    stage: "follow_up",
    countId: "pipelineFollowUp",
    percentId: "pipelineFollowUpPercent",
    barId: "pipelineFollowUpBar"
  },
  {
    stage: "interested",
    countId: "pipelineInterested",
    percentId: "pipelineInterestedPercent",
    barId: "pipelineInterestedBar"
  },
  {
    stage: "won",
    countId: "pipelineWon",
    percentId: "pipelineWonPercent",
    barId: "pipelineWonBar"
  }
];

let currentUser = null;
let searchTimeout = null;

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

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}

function createStageBadge(stage) {
  const badge = document.createElement("span");
  badge.className = `stage-badge stage-${STAGES[stage] ? stage : "new"}`;
  badge.textContent = stageLabel(stage);
  return badge;
}

function renderPipeline(leads) {
  const total = leads.length;

  for (const item of PIPELINE) {
    const count = leads.filter(
      (lead) => lead.stage === item.stage
    ).length;

    const percentage =
      total > 0 ? Math.round((count / total) * 100) : 0;

    setText(item.countId, count);
    setText(item.percentId, `${percentage}%`);

    const bar = $(item.barId);

    if (bar) {
      bar.style.width = `${percentage}%`;
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(percentage));
      bar.setAttribute(
        "aria-label",
        `${stageLabel(item.stage)}: ${percentage}% of active leads`
      );
    }
  }
}

function renderFollowUps(leads) {
  const table = $("followUpsTable");
  if (!table) return;

  table.replaceChildren();

  const scheduledLeads = leads
    .filter((lead) => lead.next_follow_up_at)
    .sort(
      (a, b) =>
        new Date(a.next_follow_up_at).getTime() -
        new Date(b.next_follow_up_at).getTime()
    )
    .slice(0, 5);

  if (scheduledLeads.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent =
      "No follow-ups scheduled yet. Set a follow-up date on a lead to see it here.";

    row.appendChild(cell);
    table.appendChild(row);
    return;
  }

  for (const lead of scheduledLeads) {
    const row = document.createElement("tr");

    row.appendChild(createCell(lead.business_name));
    row.appendChild(createCell(lead.country));
    row.appendChild(createCell(formatDate(lead.next_follow_up_at)));

    const stageCell = document.createElement("td");
    stageCell.appendChild(createStageBadge(lead.stage));
    row.appendChild(stageCell);

    const actionCell = document.createElement("td");
    const viewLink = document.createElement("a");

    viewLink.href =
      `businesses.html?lead=${encodeURIComponent(lead.id)}`;
    viewLink.textContent = "View";
    viewLink.setAttribute(
      "aria-label",
      `View ${lead.business_name || "business"}`
    );

    actionCell.appendChild(viewLink);
    row.appendChild(actionCell);

    table.appendChild(row);
  }
}

function updateStatistics(leads, messageCount) {
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

  setText(
    "followUpsDue",
    leads.filter((lead) => {
      if (!lead.next_follow_up_at) return false;

      const followUpTime = new Date(
        lead.next_follow_up_at
      ).getTime();

      return Number.isFinite(followUpTime) && followUpTime <= now;
    }).length
  );

  setText(
    "wonLeads",
    leads.filter((lead) => lead.stage === "won").length
  );

  renderPipeline(leads);
  renderFollowUps(leads);
}

function updateProfile(user) {
  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";

  const profile = document.querySelector(".user-profile");
  const avatar = document.querySelector(".user-profile .avatar");

  if (profile) {
    const nameSpan = profile.querySelector("span");

    if (nameSpan) {
      nameSpan.textContent = `Hello, ${name}`;
    }
  }

  if (avatar) {
    avatar.textContent = name.charAt(0).toUpperCase();
  }
}

async function loadDashboard() {
  const client = requireSupabase();

  if (!client) {
    showMessage(
      "Supabase is not configured. Check assets/js/config.js."
    );
    return;
  }

  const {
    data: { session },
    error: sessionError
  } = await client.auth.getSession();

  if (sessionError) {
    showMessage(`Unable to check login: ${sessionError.message}`);
    return;
  }

  if (!session) {
    window.location.replace("index.html");
    return;
  }

  currentUser = session.user;
  updateProfile(currentUser);

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
    showMessage(
      `Unable to load businesses: ${leadsResult.error.message}`
    );
    return;
  }

  const leads = leadsResult.data || [];

  let messageCount = 0;

  if (activitiesResult.error) {
    console.error(
      "Unable to load message activity:",
      activitiesResult.error.message
    );
    showMessage(
      "Leads loaded, but the message count could not be retrieved. Check the activities table permissions."
    );
  } else {
    messageCount = new Set(
      (activitiesResult.data || []).map((activity) => activity.lead_id)
    ).size;
  }

  updateStatistics(leads, messageCount);
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
      showMessage(`Unable to log out: ${error.message}`);
      if (button) button.disabled = false;
      return;
    }

    window.location.replace("index.html");
  } catch (error) {
    showMessage(error.message || "An unexpected logout error occurred.");
    if (button) button.disabled = false;
  }
}

function setupSearch() {
  const searchInput = $("globalSearch");
  if (!searchInput) return;

  function goToSearch() {
    const query = searchInput.value.trim();

    const destination = query
      ? `businesses.html?q=${encodeURIComponent(query)}`
      : "businesses.html";

    window.location.href = destination;
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(goToSearch, 600);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      clearTimeout(searchTimeout);
      goToSearch();
    }
  });
}

function setupNotifications() {
  const button = document.querySelector(".notification-button");
  if (!button) return;

  button.addEventListener("click", () => {
    window.location.href = "follow-ups.html";
  });
}

function setupLogout() {
  const button = $("logoutButton");
  if (button) {
    button.addEventListener("click", logout);
  }
}

function setupAuthListener() {
  if (!supabase) return;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("index.html");
    }
  });
}

async function initDashboard() {
  setupLogout();
  setupSearch();
  setupNotifications();
  setupAuthListener();

  try {
    await loadDashboard();
  } catch (error) {
    console.error("Dashboard error:", error);

    showMessage(
      error.message ||
        "The dashboard could not load. Please refresh and try again."
    );
  }
}

initDashboard();
