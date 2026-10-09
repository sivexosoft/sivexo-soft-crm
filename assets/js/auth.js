
import { supabase } from "./supabase.js";

const form = document.querySelector("#loginForm");
const message = document.querySelector("#authMessage");

function showMessage(text, isError = false) {
  if (!message) return;

  message.textContent = text;
  message.classList.toggle("error", isError);
}

async function redirectIfSignedIn() {
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    showMessage(error.message, true);
    return;
  }

  if (data.session) {
    window.location.replace("dashboard.html");
  }
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabase) {
      showMessage(
        "Connect Supabase first using assets/js/config.js.",
        true
      );
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    const email = form.email.value.trim();
    const password = form.password.value;

    button.disabled = true;
    button.textContent = "Signing in...";

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      window.location.replace("dashboard.html");
    } catch (error) {
      showMessage(error.message || "Unable to sign in.", true);
      button.disabled = false;
      button.textContent = "Sign in →";
    }
  });
}

redirectIfSignedIn();
