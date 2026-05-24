const api = typeof browser !== "undefined" ? browser : chrome;
let processedMedia = [];
let currentTabId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const [activeTab] = await api.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) return;
  currentTabId = activeTab.id;

  api.runtime.onMessage.addListener((message) => {
    if (message.action === "mediaUpdated") {
      processAndRender(message.assets);
    }
  });

  api.scripting.executeScript({
    target: { tabId: currentTabId },
    files: ["content.js"],
  });

  document
    .getElementById("filter-path")
    .addEventListener("change", filterAndRender);
  document
    .getElementById("download-zip")
    .addEventListener("click", downloadAllAsZip);
});

function processAndRender(assets) {
  const pathCounts = {};

  processedMedia = assets.map((item) => {
    pathCounts[item.pathDirectory] = (pathCounts[item.pathDirectory] || 0) + 1;

    const kb = (item.sizeInBytes / 1024).toFixed(1);
    const sizeStr = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

    return {
      ...item,
      size: sizeStr,
    };
  });

  updateFilterDropdowns(pathCounts);
  filterAndRender();
}

function updateFilterDropdowns(pathCounts) {
  const pathSelect = document.getElementById("filter-path");
  const currentPath = pathSelect.value;

  pathSelect.innerHTML = '<option value="">All Shared Folder Paths</option>';
  Object.keys(pathCounts).forEach((path) => {
    if (pathCounts[path] > 1) {
      pathSelect.innerHTML += `<option value="${path}">${path} (${pathCounts[path]} items)</option>`;
    }
  });

  pathSelect.value = currentPath;
}

function filterAndRender() {
  const selectedPath = document.getElementById("filter-path").value;
  const filtered = processedMedia.filter(
    (item) => !selectedPath || item.pathDirectory === selectedPath,
  );
  renderUIList(filtered);
}

function renderUIList(items) {
  const container = document.getElementById("media-list");
  document.getElementById("count").innerText = `(${items.length})`;
  container.innerHTML = "";

  if (items.length === 0) {
    container.innerHTML =
      '<div style="text-align:center; padding:20px; color:#999;">No assets in memory match paths.</div>';
    return;
  }

  items.forEach((item) => {
    const itemEl = document.createElement("div");
    itemEl.className = "media-item";

    // Pointing the image source tag to the original URL preserves the native
    // filename context on right-click "Save Image As..." actions.
    itemEl.innerHTML = `
      <div class="img-wrapper">
         <img src="${item.originalUrl}" alt="${item.filename}" />
      </div>
      <div class="media-info">
        <p style="font-weight:bold; color:#222; margin-bottom: 2px;">${item.filename}</p>
        <p style="margin-bottom: 2px;">Size: <strong>${item.size}</strong></p>
        <p style="color:#777; font-size:10px; background: #f0f0f0; padding: 2px 4px; border-radius: 3px;">${item.pathDirectory}</p>
      </div>
      <button class="single-dl" title="Download from cache">📥</button>
    `;

    // Clicking this button still processes the file offline from data URL memory
    itemEl.querySelector(".single-dl").addEventListener("click", (e) => {
      e.stopPropagation();
      api.tabs.sendMessage(currentTabId, {
        action: "triggerTabDownload",
        dataUrl: item.dataUrl,
        filename: item.filename,
      });
    });

    container.appendChild(itemEl);
  });
}

async function downloadAllAsZip() {
  const selectedPath = document.getElementById("filter-path").value;
  const dlButton = document.getElementById("download-zip");

  const targets = processedMedia.filter(
    (item) => !selectedPath || item.pathDirectory === selectedPath,
  );
  if (targets.length === 0) return;

  dlButton.disabled = true;
  const total = targets.length;
  dlButton.innerText = `Packing (0/${total})...`;

  const zip = new JSZip();

  for (let i = 0; i < total; i++) {
    const item = targets[i];
    const base64Data = item.dataUrl.split(",")[1];
    zip.file(item.filename, base64Data, { base64: true });

    dlButton.innerText = `Packing (${i + 1}/${total})...`;
    await new Promise((resolve) => setTimeout(resolve, 30)); // Yield thread for visible redraws
  }

  dlButton.innerText = "Compiling ZIP payload...";
  await new Promise((resolve) => setTimeout(resolve, 50));

  const base64ZipStr = await zip.generateAsync({ type: "base64" });
  const dataUrlPayload = "data:application/zip;base64," + base64ZipStr;

  dlButton.innerText = "Opening File Save...";

  // Route bulk archive assembly extraction into the active web tab container
  api.tabs.sendMessage(currentTabId, {
    action: "triggerTabDownload",
    dataUrl: dataUrlPayload,
    filename: `MediaSuite_Collection_${Date.now()}.zip`,
  });

  setTimeout(() => {
    dlButton.disabled = false;
    dlButton.innerText = "Download Filtered as ZIP";
  }, 1000);
}
