async function login() {
    const password = document.getElementById("password").value;

    let r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
    });

    let j = await r.json();

    if (!j.ok) {
        document.getElementById("msg").innerText = j.error;
    } else {
        window.location = "/admin/panel.html";
    }
}

async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location = "/admin/index.html";
}

// PANEL GİRİŞ KONTROLÜ
async function adminCheck() {
    let r = await fetch("/api/admin/check");
    if (!r.ok) window.location = "/admin/index.html";
}

// PANEL YÜKLEME İŞLEMLERİ
async function loadTitles() {
    const r = await fetch("/api/admin/titles");
    const list = await r.json();

    const box = document.getElementById("titles");
    box.innerHTML = "";

    list.forEach(t => {
        let div = document.createElement("div");
        div.className = "title-item";

        div.innerHTML = `
            <b>${t.title}</b> (${t.count}) 
            <button class="small" onclick="showEntries('${t.folder}')">entryleri gör</button>
            <button class="small" onclick="deleteTitle('${t.folder}')">sil</button>
        `;

        box.appendChild(div);
    });
}

async function deleteTitle(folder) {
    if (!confirm("Bu başlığı VE tüm entryleri silmek istediğine emin misin?")) return;

    await fetch(`/api/admin/delete-title/${folder}`, { method: "DELETE" });

    loadTitles();
    document.getElementById("entries").innerHTML = "";
}

async function showEntries(folder) {
    const r = await fetch(`/api/admin/title/${folder}`);
    const list = await r.json();

    const box = document.getElementById("entries");
    box.innerHTML = "";

    if (list.length === 0) {
        box.innerHTML = "<i>bu başlıkta entry yok</i>";
        return;
    }

    list.forEach(e => {
        let div = document.createElement("div");
        div.className = "entry-item";

        div.innerHTML = `
            <b>${e.nick}</b> - ${new Date(e.date).toLocaleString("tr-TR")}
            <br><br>${e.text}<br><br>
            <button class="small" onclick="deleteEntry('${e.folder}', ${e.id})">entry sil</button>
        `;

        div.dataset.folder = e.folder;
        box.appendChild(div);
    });
}

async function deleteEntry(folder, id) {
    if (!confirm("Entry silinsin mi?")) return;

    await fetch(`/api/admin/delete-entry/${folder}/${id}`, { method: "DELETE" });

    showEntries(folder);
}


// PANEL SAYFASIYSA YÜKLE
if (window.location.pathname.endsWith("panel.html")) {
    adminCheck();
    loadTitles();
}
