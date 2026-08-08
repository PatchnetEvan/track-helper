// MotoTrack waitlist form. Two fields + affirmative consent; posts JSON to
// /api/waitlist; always shows the same generic confirmation the server
// returns. Attribution: only the utm_*/ref parameters ALREADY on this page's
// URL are forwarded - nothing is read from cookies (there are none) or
// storage. The consent checkbox is never pre-checked and submission is
// impossible without it.
(() => {
  const CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
  const select = document.getElementById("wl-country");
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const options = CODES.map((code) => ({ code, name: (() => { try { return names.of(code) || code; } catch { return code; } })() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const { code, name } of options) {
    const option = document.createElement("option");
    option.value = code; option.textContent = name;
    select.appendChild(option);
  }

  // Declared-location outcome preview. Classification mirrors the server's
  // US_BETA_CODES; the server is authoritative and never consults IP data.
  const US_BETA_CODES = ["US", "PR", "VI", "GU", "AS", "MP", "UM"];
  const trackNote = document.getElementById("wl-track-note");
  const describeTrack = () => {
    if (!select.value) { trackNote.textContent = ""; return; }
    trackNote.textContent = US_BETA_CODES.includes(select.value)
      ? "You’ll be joining the MotoTrack early-access beta waitlist. Invitations will be released gradually as testing capacity expands."
      : "MotoTrack beta access is not currently available in your region. You may join the international interest list and receive an email if availability expands.";
  };
  select.addEventListener("change", describeTrack);

  const form = document.getElementById("waitlist-form");
  const email = document.getElementById("wl-email");
  const consent = document.getElementById("wl-consent");
  const submit = document.getElementById("wl-submit");
  const status = document.getElementById("wl-status");
  let inFlight = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (inFlight) return;
    if (!email.value.trim()) { status.textContent = "Enter your email address."; email.focus(); return; }
    if (!select.value) { status.textContent = "Select your country or region."; select.focus(); return; }
    if (!consent.checked) { status.textContent = "Please tick the waitlist consent box to join."; consent.focus(); return; }
    inFlight = true;
    submit.disabled = true;
    status.textContent = "Sending…";
    fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email.value,
        country: select.value,
        consent: true,
        source: "waitlist.html",
        page_query: window.location.search || "",
      }),
    }).then(async (response) => {
      inFlight = false;
      if (response.status === 202) {
        const body = await response.json().catch(() => null);
        status.textContent = (body && body.message) || "Check your email to confirm your place on the MotoTrack waitlist.";
        form.hidden = true;
      } else {
        status.textContent = "Unable to process this request right now. Try again.";
        submit.disabled = false;
      }
    }).catch(() => {
      inFlight = false;
      status.textContent = "Unable to process this request right now. Try again.";
      submit.disabled = false;
    });
  });
})();
