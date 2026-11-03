(function () {
  "use strict";

  // The GA4 Measurement ID will be added after the site owner creates the web stream.
  // Keep this empty until the real G-XXXXXXXXXX value is supplied.
  const GA4_MEASUREMENT_ID = "";
  const CONSENT_STORAGE_KEY = "fragilefit.analytics-consent.v1";

  // With no valid Measurement ID, this file is inert: no banner, cookies or analytics requests.
  if (!/^G-[A-Z0-9]+$/.test(GA4_MEASUREMENT_ID)) return;

  let analyticsEnabled = false;
  let bannerElement = null;

  function readConsent() {
    try {
      return window.localStorage.getItem(CONSENT_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function track(eventName, parameters) {
    if (!analyticsEnabled || typeof window.gtag !== "function") return;
    window.gtag("event", eventName, parameters || {});
  }

  function sendPageView() {
    track("page_view", {
      page_title: document.title,
      page_location: window.location.origin + window.location.pathname,
      page_path: window.location.pathname
    });
  }

  function enableAnalytics() {
    if (analyticsEnabled) return;

    window["ga-disable-" + GA4_MEASUREMENT_ID] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };

    window.gtag("js", new Date());
    window.gtag("config", GA4_MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_MEASUREMENT_ID);
    script.onerror = function () {
      analyticsEnabled = false;
    };
    document.head.appendChild(script);

    analyticsEnabled = true;
    sendPageView();
  }

  function saveChoice(choice) {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    } catch {
      // If browser storage is unavailable, the choice applies for this page view only.
    }

    if (choice === "granted") {
      enableAnalytics();
      track("analytics_consent_granted");
    } else {
      window["ga-disable-" + GA4_MEASUREMENT_ID] = true;
      analyticsEnabled = false;
    }

    if (bannerElement) {
      bannerElement.remove();
      bannerElement = null;
    }
  }

  function addStyles() {
    if (document.getElementById("ff-analytics-styles")) return;
    const style = document.createElement("style");
    style.id = "ff-analytics-styles";
    style.textContent = [
      ".ff-analytics-banner{position:fixed;z-index:100000;left:16px;right:16px;bottom:16px;max-width:720px;margin:0 auto;padding:18px 20px;background:#fff;color:#14243a;border:1px solid #d8e2ef;border-radius:16px;box-shadow:0 16px 48px rgba(15,35,65,.2);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}",
      ".ff-analytics-banner h2{margin:0 0 6px;font-size:17px;line-height:1.3;color:#10243b}",
      ".ff-analytics-banner p{margin:0 0 8px;color:#40536c}",
      ".ff-analytics-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}",
      ".ff-analytics-actions button{min-height:40px;padding:9px 14px;border:1px solid #c9d6e6;border-radius:9px;background:#f5f8fc;color:#173653;font:600 13px system-ui;cursor:pointer}",
      ".ff-analytics-actions .ff-analytics-allow{background:#1769d2;border-color:#1769d2;color:#fff}",
      ".ff-analytics-actions a{padding:8px;color:#315b89;font-size:13px}",
      ".ff-privacy-choice-link{margin:4px 8px;padding:4px 7px;border:0;background:transparent;color:#486b93;font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}",
      ".ff-privacy-choice-fallback{position:fixed;z-index:99990;right:12px;bottom:12px}",
      "@media(max-width:520px){.ff-analytics-banner{left:10px;right:10px;bottom:10px;padding:14px}.ff-analytics-actions{gap:6px}.ff-analytics-actions button{flex:1 1 130px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function showConsentBanner() {
    if (bannerElement) bannerElement.remove();
    addStyles();

    const currentChoice = readConsent();
    const statusText = currentChoice === "granted"
      ? "Your current choice is Allow analytics."
      : currentChoice === "denied"
        ? "Your current choice is Reject optional analytics."
        : "No choice has been saved in this browser yet.";

    const banner = document.createElement("section");
    banner.className = "ff-analytics-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Optional analytics preferences");
    banner.innerHTML =
      '<h2>Help improve FragileFit?</h2>' +
      '<p>With your permission, FragileFit can use Google Analytics to understand visits and broad feature usage. We do not send your product, order, shipment, customer, financial, address, backup or password contents.</p>' +
      '<p>Google may process technical information such as browser/device details, approximate region and page or event activity. You can reject analytics or change this choice later using Privacy choices.</p>' +
      '<p class="ff-analytics-status"></p>' +
      '<div class="ff-analytics-actions">' +
        '<button type="button" data-ff-consent="granted" class="ff-analytics-allow">Allow analytics</button>' +
        '<button type="button" data-ff-consent="denied">Reject optional analytics</button>' +
        '<a href="./privacy.html">Privacy details</a>' +
      '</div>';

    banner.querySelector(".ff-analytics-status").textContent = statusText;
    banner.querySelector('[data-ff-consent="granted"]').addEventListener("click", function () {
      saveChoice("granted");
    });
    banner.querySelector('[data-ff-consent="denied"]').addEventListener("click", function () {
      saveChoice("denied");
    });

    document.body.appendChild(banner);
    bannerElement = banner;
  }

  function addPrivacyChoicesControl() {
    addStyles();
    const existing = document.querySelector(".ff-privacy-choice-link");
    if (existing) return;

    const control = document.createElement("button");
    control.type = "button";
    control.className = "ff-privacy-choice-link";
    control.textContent = "Privacy choices";
    control.addEventListener("click", showConsentBanner);

    const footer = document.querySelector(".app-footer, .legal-foot, footer");
    if (footer) {
      footer.appendChild(control);
    } else {
      const wrapper = document.createElement("div");
      wrapper.className = "ff-privacy-choice-fallback";
      wrapper.appendChild(control);
      document.body.appendChild(wrapper);
    }
  }

  document.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-view], [data-action]");
    if (!target) return;

    const view = target.getAttribute("data-view");
    const allowedViews = [
      "dashboard", "products", "packaging", "roi", "orders",
      "shipments", "intelligence", "reports", "settings", "data-safety"
    ];
    if (view && allowedViews.includes(view)) {
      track("workspace_view_opened", { view: view });
    }

    const action = target.getAttribute("data-action");
    if (action === "install-app") track("install_app_clicked");
    if (action === "start-tour") track("guided_tour_started");
  }, true);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "pack-calc-form") {
      track("calculator_used", { calculator: "packaging" });
    } else if (form.id === "roi-form") {
      track("calculator_used", { calculator: "delivery_cost" });
    }
  }, true);

  window.addEventListener("appinstalled", function () {
    track("app_installed");
  });

  addPrivacyChoicesControl();

  const savedChoice = readConsent();
  if (savedChoice === "granted") {
    enableAnalytics();
  } else if (savedChoice !== "denied") {
    showConsentBanner();
  }
})();