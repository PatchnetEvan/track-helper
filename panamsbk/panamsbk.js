(() => {
  "use strict";

  const form = document.querySelector("#beta-request");
  const status = document.querySelector("#form-status");
  if (!form || !status) return;

  const fieldNames = [
    "first_name",
    "last_name",
    "email",
    "race_number",
    "primary_motorcycle",
    "primary_classes",
    "mobile",
    "next_event",
    "current_process",
    "desired_help",
  ];

  function setSubmitting(isSubmitting) {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = isSubmitting;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    if (!form.checkValidity()) {
      form.reportValidity();
      status.textContent = "Review the required fields and acknowledgments before submitting your request.";
      return;
    }

    const values = new FormData(form);
    const turnstileToken = String(values.get("cf-turnstile-response") || "").trim();
    if (!turnstileToken) {
      status.textContent = "Complete the verification check before submitting your request.";
      return;
    }

    const payload = Object.fromEntries(fieldNames.map((name) => [name, String(values.get(name) || "").trim()]));
    payload.eligibility_confirmed = values.get("eligibility_confirmed") === "on";
    payload.beta_acknowledged = values.get("beta_acknowledged") === "on";
    payload.privacy_acknowledged = values.get("privacy_acknowledged") === "on";
    payload.turnstile_token = turnstileToken;

    setSubmitting(true);
    status.textContent = "Submitting your request...";

    try {
      const response = await fetch("/api/panamsbk-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.ok !== true) {
        throw new Error("submission_failed");
      }

      form.reset();
      if (window.turnstile && typeof window.turnstile.reset === "function") window.turnstile.reset();
      status.textContent = result.message;
    } catch {
      status.textContent = "We could not submit your request. Please try again shortly.";
    } finally {
      setSubmitting(false);
    }
  });
})();
