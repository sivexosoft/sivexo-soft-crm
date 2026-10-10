
import { supabase, requireSupabase } from "./supabase.js";

const form = document.getElementById("businessForm");
const saveButton = document.getElementById("saveBusinessButton");
const resetButton = document.getElementById("resetFormButton");
const messageBox = document.getElementById("formMessage");

const businessInput = form.elements.business_name;
const contactInput = form.elements.contact;
const countryInput = form.elements.country;
const stageInput = form.elements.stage;
const notesInput = form.elements.optional_details;
const servicesInputs = [...form.querySelectorAll('input[name="services"]')];

let currentUser = null;
let supabaseReady = false;

const stageLabels = {
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

function showMessage(text, type = "success") {
  messageBox.textContent = text;
  messageBox.className = `form-message show ${type}`;
  messageBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "form-message";
}

function selectedServices() {
  return servicesInputs
    .filter(input => input.checked)
    .map(input => input.value);
}

function updateSummary() {
  const business = businessInput.value.trim();
  const contact = contactInput.value.trim();
  const country = countryInput.value;
  const stage = stageInput.value;
  const services = selectedServices();

  document.getElementById("summaryBusiness").textContent = business || "—";
  document.getElementById("summaryContact").textContent = contact || "—";
  document.getElementById("summaryCountry").textContent = country || "—";
  document.getElementById("summaryServices").textContent =
    services.length ? services.join(", ") : "—";

  document.getElementById("summaryStage").textContent =
    stageLabels[stage] || "New Lead";

  document.getElementById("noteCount").textContent =
    String(notesInput.value.length);
}

function getFormValues() {
  const data = new FormData(form);
  const phone = String(data.get("phone_number") || "").trim();
  let notes = String(data.get("optional_details") || "").trim();

  // The current schema does not define a phone_number column.
  // Preserve the phone number in notes rather than sending an unknown column.
  if (phone) {
    notes = notes ? `${notes}\n\nPhone: ${phone}` : `Phone: ${phone}`;
  }

  const nextFollowUp = String(data.get("next_follow_up_at") || "").trim();
  const archived = document.getElementById("isArchived").checked;

  return {
    business: {
      user_id: currentUser.id,
      business_name: String(data.get("business_name") || "").trim(),
      contact: String(data.get("contact") || "").trim(),
      contact_2: String(data.get("contact_2") || "").trim() || null,
      website_url: String(data.get("website_url") || "").trim() || null,
      email: String(data.get("email") || "").trim() || null,
      country: String(data.get("country") || "").trim(),
      category: String(data.get("category") || "").trim(),
      address: String(data.get("address") || "").trim() || null,
      optional_details: notes || null,
      stage: String(data.get("stage") || "new"),
      next_follow_up_at: nextFollowUp
        ? new Date(nextFollowUp).toISOString()
        : null,
      is_archived: archived,
      archived_at: archived ? new Date().toISOString() : null
    },
    services: selectedServices()
  };
}

async function initializePage() {
  try {
    requireSupabase();

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    currentUser = data.session?.user || null;

    if (!currentUser) {
      window.location.replace("index.html");
      return;
    }

    supabaseReady = true;
  } catch (error) {
    console.error("CRM initialization error:", error);
    showMessage(
      "Could not connect to Supabase. Check your project URL, API key, and connection.",
      "error"
    );
  }
}

form.addEventListener("input", updateSummary);
form.addEventListener("change", updateSummary);

resetButton.addEventListener("click", () => {
  window.setTimeout(() => {
    clearMessage();
    updateSummary();
  }, 0);
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();

  if (!supabaseReady || !currentUser) {
    showMessage("Your session is not ready. Refresh the page and sign in again.", "error");
    return;
  }

  const services = selectedServices();

  if (services.length === 0) {
    showMessage("Please select at least one service.", "error");
    return;
  }

  if (!form.reportValidity()) return;

  const { business, services: selected } = getFormValues();

  saveButton.disabled = true;
  saveButton.textContent = "Saving business…";

  try {
    // Save the business record.
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert(business)
      .select()
      .single();

    if (leadError) throw leadError;

    // Save selected services as related records.
    const serviceRows = selected.map(serviceName => ({
      user_id: currentUser.id,
      lead_id: lead.id,
      service_name: serviceName
    }));

    const { error: servicesError } = await supabase
      .from("lead_services")
      .insert(serviceRows);

    if (servicesError) {
      console.error("Services could not be saved:", servicesError);
      showMessage(
        "The business was saved, but its services could not be saved. Check the lead_services table and its RLS policies.",
        "error"
      );
      return;
    }

    // Record the creation in the activity history.
    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        user_id: currentUser.id,
        lead_id: lead.id,
        activity_type: "created",
        description: `Business created: ${lead.business_name}`,
        services: selected,
        outcome: "Lead created"
      });

    if (activityError) {
      // The lead and services are already saved; do not report a false failure.
      console.warn("Activity history was not recorded:", activityError);
    }

    const prepareWelcome = document.getElementById("prepareWelcome").checked;
    let successText = `${lead.business_name} was saved successfully.`;

    if (prepareWelcome) {
      const template = document.getElementById("messageTemplate").value;
      const templates = {
        intro: `Hello ${lead.contact}, I hope you're doing well. I'm reaching out from Sivexo Soft to introduce our digital services. We'd love to explore how we can help ${lead.business_name}.`,
        website: `Hello ${lead.contact}, Sivexo Soft helps businesses improve their online presence with professional website solutions. Would you be open to a quick discussion about ${lead.business_name}'s website needs?`,
        followup: `Hello ${lead.contact}, I wanted to follow up and see if you'd be interested in discussing how Sivexo Soft could support ${lead.business_name}.`
      };

      try {
        await navigator.clipboard.writeText(templates[template] || templates.intro);
        successText += " A welcome message was copied to your clipboard.";
      } catch {
        successText += " You can prepare a message from Message Templates.";
      }
    }

    showMessage(successText, "success");

    form.reset();
    updateSummary();

  } catch (error) {
    console.error("Unable to save business:", error);

    if (error.code === "23505") {
      showMessage("This record may already exist. Check your database's duplicate rules.", "error");
    } else if (error.code === "42501" || error.code === "PGRST301") {
      showMessage("Permission denied. Check that Row Level Security policies allow your signed-in user to insert leads and related records.", "error");
    } else {
      showMessage(error.message || "Something went wrong while saving. Please try again.", "error");
    }
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = "<span>＋</span> Save Business";
  }
});

// Search sends the entered query to the All Businesses page.
document.getElementById("globalSearch").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    const query = event.currentTarget.value.trim();
    if (query) {
      window.location.href = `businesses.html?search=${encodeURIComponent(query)}`;
    }
  }
});

// Sign out safely.
document.getElementById("logoutButton").addEventListener("click", async () => {
  const button = document.getElementById("logoutButton");
  button.disabled = true;

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.replace("index.html");
  } catch (error) {
    console.error("Sign out failed:", error);
    showMessage("Could not log out. Please try again.", "error");
    button.disabled = false;
  }
});

updateSummary();
initializePage();
