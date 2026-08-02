"use strict";
(async function () {
  const id = decodeURIComponent(location.pathname.split("/").pop());
  let trip = null;

  try {
    const res = await fetch("/api/trips/" + id);
    if (!res.ok) throw new Error("Trip not found");
    trip = await res.json();
  } catch (e) {
    document.getElementById("panel").innerHTML =
      `<div class="msg">${e.message}. <a href="/">Back to trips</a></div>`;
    return;
  }

  GRMap.mount(trip, { mode: "edit" });

  // ---- present link ----
  document.getElementById("present").addEventListener("click", () => {
    const url = location.origin + "/present?id=" + encodeURIComponent(id);
    navigator.clipboard
      ? navigator.clipboard.writeText(url).then(
          () => alert("Present link copied:\n" + url + "\n\n(If a read key is set on the server, append &key=YOUR_READ_KEY to share without the password.)"),
          () => prompt("Present link:", url)
        )
      : prompt("Present link:", url);
  });

  // ---- edit JSON ----
  const modal = document.getElementById("editModal");
  const text = document.getElementById("editText");
  const err = document.getElementById("editErr");
  document.getElementById("edit").addEventListener("click", () => {
    text.value = JSON.stringify(trip, null, 2);
    err.textContent = "";
    modal.style.display = "flex";
  });
  document.getElementById("closeEdit").addEventListener("click", () => {
    modal.style.display = "none";
  });
  document.getElementById("saveEdit").addEventListener("click", async () => {
    let parsed;
    try {
      parsed = JSON.parse(text.value);
    } catch (e) {
      err.textContent = "Invalid JSON: " + e.message;
      return;
    }
    const res = await fetch("/api/trips/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (res.ok) location.reload();
    else err.textContent = (await res.json()).error || "Save failed";
  });
})();
