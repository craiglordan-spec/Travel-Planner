"use strict";
/**
 * GRAuth — shared front-end login gate (mirrors GR-Scheduler's approach).
 *
 * Injects a full-screen branded sign-in card, keeps a bearer token in
 * localStorage, and exposes:
 *   GRAuth.ready(fn)        run fn once the user is authenticated
 *   GRAuth.apiFetch(u,opts) fetch() with the bearer token attached (401 -> re-login)
 *   GRAuth.logout()         drop the token and show the login screen
 *
 * Load this BEFORE the page's own script (list.js / trip.js / present.js).
 */
(function () {
  const KEY = "gr_tp_token";
  let TOKEN = localStorage.getItem(KEY) || "";
  const readyCbs = [];
  let authed = false;

  function runReady() {
    if (authed) return;
    authed = true;
    readyCbs.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function overlay() {
    return document.getElementById("gr-login");
  }
  function showLogin(focus) {
    const el = overlay();
    if (el) {
      el.classList.remove("hide");
      if (focus) {
        const u = document.getElementById("gr-lg-user");
        const p = document.getElementById("gr-lg-pass");
        (u && !u.value ? u : p || u).focus();
      }
    }
  }
  function hideLogin() {
    const el = overlay();
    if (el) el.classList.add("hide");
  }

  function injectLogin() {
    if (overlay()) return;
    const div = document.createElement("div");
    div.id = "gr-login";
    div.className = "gr-login";
    div.innerHTML =
      '<div class="gr-login-box">' +
      '<div class="gr-login-brand">Gravel Road</div>' +
      '<div class="gr-login-sub">Travel Planner</div>' +
      '<div class="gr-field"><label>Username</label>' +
      '<input id="gr-lg-user" autocomplete="username" autocapitalize="none" spellcheck="false"/></div>' +
      '<div class="gr-field"><label>Password</label>' +
      '<input id="gr-lg-pass" type="password" autocomplete="current-password"/></div>' +
      '<button class="btn gr-login-btn" id="gr-lg-go">Sign in</button>' +
      '<div class="gr-login-err" id="gr-lg-err"></div>' +
      "</div>";
    document.body.appendChild(div);

    const go = document.getElementById("gr-lg-go");
    const pass = document.getElementById("gr-lg-pass");
    const user = document.getElementById("gr-lg-user");
    go.addEventListener("click", doLogin);
    [user, pass].forEach((inp) =>
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
      })
    );
  }

  async function doLogin() {
    const err = document.getElementById("gr-lg-err");
    const username = document.getElementById("gr-lg-user").value.trim();
    const password = document.getElementById("gr-lg-pass").value;
    err.textContent = "";
    try {
      const r = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        let msg = "Sign in failed";
        try { msg = (await r.json()).error || msg; } catch {}
        err.textContent = msg;
        return;
      }
      const d = await r.json();
      TOKEN = d.token;
      localStorage.setItem(KEY, TOKEN);
      const p = document.getElementById("gr-lg-pass");
      if (p) p.value = "";
      hideLogin();
      runReady();
    } catch (e) {
      err.textContent = "Network error — please try again.";
    }
  }

  async function logout() {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {},
      });
    } catch {}
    TOKEN = "";
    localStorage.removeItem(KEY);
    // Simplest reliable reset for a signed-out SPA: reload to the login screen.
    location.reload();
  }

  async function apiFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {}, {
      Authorization: "Bearer " + TOKEN,
    });
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      TOKEN = "";
      localStorage.removeItem(KEY);
      showLogin(true);
      throw new Error("Your session has expired — please sign in again.");
    }
    return res;
  }

  async function verifyAndStart() {
    injectLogin();
    if (!TOKEN) {
      showLogin(true);
      return;
    }
    try {
      const r = await fetch("/api/me", {
        headers: { Authorization: "Bearer " + TOKEN },
      });
      if (r.ok) {
        hideLogin();
        runReady();
      } else {
        TOKEN = "";
        localStorage.removeItem(KEY);
        showLogin(true);
      }
    } catch {
      // Network hiccup — show login rather than a blank page.
      showLogin(true);
    }
  }

  window.GRAuth = {
    ready(fn) {
      if (authed) fn();
      else readyCbs.push(fn);
    },
    apiFetch,
    logout,
    get token() {
      return TOKEN;
    },
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", verifyAndStart);
  else verifyAndStart();
})();
