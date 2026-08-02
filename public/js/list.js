"use strict";
(async function () {
  const grid = document.getElementById("grid");
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  try {
    const res = await fetch("/api/trips");
    if (!res.ok) throw new Error("Could not load trips");
    const trips = await res.json();
    if (!trips.length) {
      grid.innerHTML =
        '<div class="empty">No trips yet. Click “+ New trip” to create one.</div>';
      return;
    }
    grid.innerHTML = "";
    trips.forEach((t) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        `<h3>${esc(t.title)}</h3>` +
        (t.subtitle ? `<div class="sub">${esc(t.subtitle)}</div>` : "") +
        `<div class="chips">` +
        (t.when ? `<span class="chip">${esc(t.when)}</span>` : "") +
        `<span class="chip">${t.stops} stops</span>` +
        `</div>`;
      card.addEventListener("click", () => (location.href = "/trip/" + t.id));
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }

  document.getElementById("new").addEventListener("click", async () => {
    const title = prompt("Trip title?");
    if (!title) return;
    const id = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        title,
        subtitle: "",
        when: "",
        stops: [],
        legs: [],
        parks: [],
        center: [-14, 40],
        zoom: 4,
      }),
    });
    if (res.ok) location.href = "/trip/" + id;
    else alert((await res.json()).error || "Could not create trip");
  });
})();
