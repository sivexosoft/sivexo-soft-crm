
import { supabase, requireSupabase } from "./supabase.js";

const byId = (id) => document.getElementById(id);

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

function showMessage(message, type = "error") {
  const element = byId("dashboardMessage");
  if (!element) return;

  element.textContent = message;
  element.className = `dashboard-message show ${type}`;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value);
}

function countStage(leads, stage) {
  return leads.filter((lead) => lead.stage === stage).length;
}

function renderFollowUps(leads) {
  const table = byId("followUpsTable");
  if (!table) return;

  table.replaceChildren();

  if (leads.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.className = "dashboard-empty";
    cell.textContent = "No follow-ups scheduled yet.";

    row.appendChild(cell);
    table.appendChild(row);
    return;
  }

  const now = new Date();

  for (const lead of leads) {
    const row = document.createElement("tr");
    const businessCell = document.createElement("td");
    const countryCell = document.createElement("td");
    const dateCell = document.createElement("td");
    const stageCell = document.createElement("td");

    const link = document.createElement("a");
    link.href = `businesses.html?lead=${encodeURIComponent(lead.id)}`;
    link.textContent = lead.business_name || "Unnamed business";
    businessCell.appendChild(link);

    countryCell.textContent = lead.country || "—";
    dateCell.textContent = formatDate(lead.next_follow_up_at);
    stageCell.textContent = STAGES[lead.stage] || lead.stage || "—";

    if (new Date(lead.next_follow_up_at) < now) {
      dateCell.style.color = "#ff9aaa";
    }

    row.append(businessCell, countryCell, dateCell, stageCell);
    table.appendChild(row);
  }
}

async function loadDashboard() {
  try {
    if (!requireSupabase()) return;

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const session = sessionData?.session;

    if (!session) {
      window.location.replace("index.html");
      return;
    }

    const userId = session.user.id;

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select(
        "id, business_name, country, stage, next_follow_up_at, is_archived, created_at"
      )
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (leadsError) throw leadsError;

    const activeLeads = leads || [];
    const now = new Date();

    setText("totalLeads", activeLeads.length);
    setText("newLeads", countStage(activeLeads, "new"));
    setText("interestedLeads", countStage(activeLeads, "interested"));
    setText("wonLeads", countStage(activeLeads, "won"));

    const dueFollowUps = activeLeads.filter(
      (lead) =>
        lead.next_follow_up_at &&
        new Date(lead.next_follow_up_at) <= now
    );

    setText("followUpsDue", dueFollowUps.length);

    // Count actual first-message activities, rather than guessing from stages.
    const { data: messageActivities, error: activityError } =
      await supabase
        .from("activities")
        .select("lead_id")
        .eq("user_id", userId)
        .eq("activity_type", "first_message_sent");

    if (activityError) throw activityError;

    const uniqueMessagedLeads = new Set(
      (messageActivities || []).map((activity) => activity.lead_id)
    );

    setText("messagesSent", uniqueMessagedLeads.size);

    setText("pipelineNew", countStage(activeLeads, "new"));
    setText(
      "pipelineMessage",
      countStage(activeLeads, "first_message_sent")
    );
    setText("pipelineFollowUp", countStage(activeLeads, "follow_up"));
    setText("pipelineInterested", countStage(activeLeads, "interested"));
    setText("pipelineWon", countStage(activeLeads, "won"));

    const scheduledFollowUps = activeLeads
      .filter((lead) => lead.next_follow_up_at)
      .sort(
        (a, b) =>
          new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at)
      )
      .slice(0, 8);

    renderFollowUps(scheduledFollowUps);
  } catch (error) {
    console.error("Dashboard loading error:", error);
    showMessage(
      error?.message || "Could not load dashboard data. Please refresh."
    );
  }
}

const logoutButton = byId("logoutButton");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      window.location.replace("index.html");
    } catch (error) {
      console.error("Logout error:", error);
      showMessage("Logout failed. Please try again.");
      logoutButton.disabled = false;
    }
  });
}

loadDashboard();
