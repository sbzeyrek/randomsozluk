const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ============================
//  ADMIN AYARLARI
// ============================

const ADMIN_HASH = "$2b$10$L2nKB5QyIiVYq7ehQBwXReTwqjYxhFTU60sOvJFiypHJD2OX2tEaK";
const ACTIVE_ADMIN_TOKENS = new Set();

function makeToken() {
    return crypto.randomBytes(24).toString("hex");
}

// ============================
//  1) *** ADMIN STATIC ROUTE EN ÜSTE ***
app.use("/admin", express.static(path.join(__dirname, "public/admin")));


const db = new Database("./data/words.db");

db.exec(`
CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT UNIQUE,
    title TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT,
    nick TEXT,
    text TEXT,
    date TEXT
);
`);

// ============================
// STATIC FRONTEND (admin üstte olmak zorunda)
// ============================

app.use(express.static("public"));
app.use("/titles", express.static(path.join(__dirname, "titles")));

const TITLES_DIR = path.join(__dirname, "titles");

// ============================
// API: Başlık listesi
// ============================

app.get("/api/titles", (req, res) => {
    const rows = db.prepare(`
        SELECT 
            t.title,
            t.folder,
            (SELECT COUNT(*) - 1 FROM entries e WHERE e.folder = t.folder) AS count
        FROM titles t
        ORDER BY t.id DESC
    `).all();

    res.json(rows);
});

// ============================
// API: Yeni başlık oluştur
// ============================

app.post("/api/new-title", (req, res) => {
    const { title, nick, text } = req.body;

    if (!title || !nick || !text)
        return res.json({ error: "Boş bıraktığın yer var!" });

    const folder = title.toLowerCase().replace(/ /g, "-");

    db.prepare(`
        INSERT INTO titles (folder, title, created_at)
        VALUES (?, ?, ?)
    `).run(folder, title, new Date().toISOString());

    db.prepare(`
        INSERT INTO entries (folder, nick, text, date)
        VALUES (?, ?, ?, ?)
    `).run(folder, nick, text, new Date().toISOString());

    // HTML oluştur
    const titlePath = path.join(TITLES_DIR, folder);
    fs.ensureDirSync(titlePath);
    fs.writeFileSync(path.join(titlePath, "index.html"), generateTitleHTML(title));

    res.json({ ok: true, folder });
});

// ============================
// API: Başlık entryleri
// ============================

app.get("/api/title/:name", (req, res) => {
    const folder = req.params.name;

    const rows = db.prepare(`
        SELECT *
        FROM entries
        WHERE folder = ?
        ORDER BY id ASC
    `).all(folder);

    res.json(rows);
});

// ============================
// API: Entry ekle
// ============================

app.post("/api/title/:name/add", (req, res) => {
    const { nick, text } = req.body;
    const folder = req.params.name;

    db.prepare(`
        INSERT INTO entries (folder, nick, text, date)
        VALUES (?, ?, ?, ?)
    `).run(folder, nick, text, new Date().toISOString());

    res.json({ ok: true });
});

// ============================
// ADMIN BACKEND
// ============================

// Admin login
app.post("/api/admin/login", async (req, res) => {
    const { password } = req.body;

    if (!password) return res.json({ error: "Parola gerekli" });

    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if (!ok) return res.json({ error: "Yanlış parola" });

    const token = makeToken();
    ACTIVE_ADMIN_TOKENS.add(token);

    res.cookie("admin_token", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: false, // Render otomatik HTTPS'te secure'a zorlar
        maxAge: 86400000
    });

    res.json({ ok: true });
});

// Admin middleware
function requireAdmin(req, res, next) {
    const t = req.cookies.admin_token;
    if (!t || !ACTIVE_ADMIN_TOKENS.has(t))
        return res.status(401).json({ error: "Yetki yok" });
    next();
}

app.get("/api/admin/check", requireAdmin, (req, res) => {
    res.json({ ok: true });
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const t = req.cookies.admin_token;
    if (t) ACTIVE_ADMIN_TOKENS.delete(t);
    res.clearCookie("admin_token");
    res.json({ ok: true });
});

// Admin başlık listesi
app.get("/api/admin/titles", requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT 
            t.title,
            t.folder,
            (SELECT COUNT(*) FROM entries e WHERE e.folder = t.folder) AS count
        FROM titles t
        ORDER BY t.id DESC
    `).all();

    res.json(rows);
});

// Admin entry listesi
app.get("/api/admin/title/:folder", requireAdmin, (req, res) => {
    const folder = req.params.folder;

    const rows = db.prepare(`
        SELECT id, nick, text, date
        FROM entries
        WHERE folder = ?
        ORDER BY id ASC
    `).all(folder);

    res.json(rows);
});

// Admin title sil
app.delete("/api/admin/delete-title/:folder", requireAdmin, (req, res) => {
    const folder = req.params.folder;

    db.prepare(`DELETE FROM entries WHERE folder = ?`).run(folder);
    db.prepare(`DELETE FROM titles WHERE folder = ?`).run(folder);

    fs.removeSync(path.join(TITLES_DIR, folder));

    res.json({ ok: true });
});

// Admin entry sil
app.delete("/api/admin/delete-entry/:folder/:id", requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM entries WHERE id = ? AND folder = ?`)
        .run(req.params.id, req.params.folder);

    res.json({ ok: true });
});

function generateTitleHTML(title) {
    const folder = title.toLowerCase().replace(/ /g, "-");

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>

<style>
    body {
        margin: 0;
        background-color: #5a5a1e;
        font-family: Verdana, Arial, sans-serif;
        color: #e1e1b0;
        font-size: 12px;
    }

    a { color: #ffec8f; text-decoration: none; }
    a:hover { text-decoration: underline; }

    #left {
        width: 180px;
        background-color: #464619;
        height: 100vh;
        overflow-y: auto;
        border-right: 1px solid #242400;
        padding: 10px;
        position: fixed;
        top: 0;
        left: 0;
    }

    #searchBox {
        width: 160px;
        padding: 4px;
        background-color: #dfdfc3;
        border: 1px solid #333;
        margin-bottom: 10px;
    }

    #titleList a {
        display: block;
        padding: 4px 0;
        border-bottom: 1px solid #555;
        font-size: 12px;
    }

    .entry-count {
        color: #b8b894;
        font-size: 10px;
        float: right;
    }

    #content {
        margin-left: 210px;
        padding: 25px;
        width: 650px;
    }

    h1 {
        font-family: "Comic Sans MS";
        font-size: 40px;
        text-align: center;
        color: #ffdf00;
        text-shadow: 2px 2px 3px black;
        margin: 0;
    }

    .entry {
        background-color: #3c3c14;
        padding: 10px;
        border: 1px solid #222;
        margin-bottom: 10px;
    }

    textarea, input[type=text] {
        width: 95%;
        padding: 5px;
        background-color: #dfdfc3;
        border: 1px solid #333;
        font-size: 12px;
        color: black;
    }

    textarea {
        background: white;
        height: 130px;
    }

    button {
        background-color: #e3bf00;
        border: 1px solid black;
        padding: 5px 12px;
        cursor: pointer;
        margin-top: 10px;
    }
	
	/* ===========================
   MOBİL TASARIM (max 768px)
   =========================== */
@media (max-width: 768px) {

    body {
        font-size: 14px;
    }

    /* Sidebar mobilde yukarı çıkar */
    #left {
        position: static;
        width: 100%;
        height: auto;
        border-right: none;
        padding: 10px;
        box-sizing: border-box;
    }

    #searchBox {
        width: 100%;
        box-sizing: border-box;
    }

    #titleList a {
        padding: 10px 0;
        font-size: 14px;
        border-bottom: 1px solid #555;
    }

    /* İçerik sağdan sola kaymayı önler */
    #content {
        margin-left: 0;
        width: 100%;
        padding: 15px;
        box-sizing: border-box;
    }

    h1 {
        font-size: 28px;
    }

    h2 {
        font-size: 20px;
        text-align: center;
    }

    .box {
        padding: 12px;
        margin-bottom: 15px;
    }

    .entry {
        font-size: 14px;
        padding: 10px;
    }

    .entry-info {
        font-size: 11px;
    }

    /* Input ve textarea tam genişlik olur */
    input[type=text],
    textarea,
    button {
        width: 100%;
        box-sizing: border-box;
        font-size: 14px;
    }

    textarea {
        height: 120px;
    }
}


</style>

</head>
<body>

<!-- SOL SİDEBAR -->
<div id="left">
    <input type="text" id="searchBox" placeholder="başlık ara" onkeyup="filterTitles()">
    <h4>başlıklar</h4>
    <div id="titleList"></div>
</div>

<!-- SAĞ İÇERİK -->
<div id="content">

    <h1><a href="/">randomsözlük</a></h1>

    <div class="box">
        <h2>${title}</h2>
    </div>

    <div id="entries"></div>

    <div class="box">
        <h3>entry gir</h3>
        <input id="nick" placeholder="nick">
        <br><br>
        <textarea id="text" placeholder="nöronlarından geçenler"></textarea>
        <br>
        <button onclick="send()">yolla</button>
    </div>

</div>

<script>
// BAŞLIK LİSTESİ
async function loadTitles() {
    const r = await fetch("/api/titles");
    const list = await r.json();

    const div = document.getElementById("titleList");
    div.innerHTML = "";

    list.forEach(t => {
        let link = document.createElement("a");
        link.href = "/titles/" + t.folder + "/index.html";
        let c = t.count > 0 ? ' <span class="entry-count">(' + t.count + ')</span>' : '';
        link.innerHTML = t.title + c;
        div.appendChild(link);
    });
}

// ENTRYLERİ YÜKLE
async function load() {
    let r = await fetch("/api/title/${folder}");
    let data = await r.json();

    let div = document.getElementById("entries");
    div.innerHTML = "";

    data.forEach(e => {
        let box = document.createElement("div");
        box.className = "entry";
        let d = new Date(e.date);

        box.innerHTML =
            "<b>" + e.nick + "</b> - " +
            d.toLocaleDateString("tr-TR") + " " +
            d.toLocaleTimeString("tr-TR") +
            "<br><br>" + e.text;

        div.appendChild(box);
    });
}

// ENTRY EKLE
async function send() {
    let nick = document.getElementById("nick").value;
    let text = document.getElementById("text").value;

    await fetch("/api/title/${folder}/add", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ nick, text })
    });

    document.getElementById("text").value = "";
    load();
    loadTitles();
}

// ARAMA FİLTRESİ
function filterTitles() {
    const q = document.getElementById("searchBox").value.toLowerCase();
    const all = document.querySelectorAll("#titleList a");

    all.forEach(a => {
        a.style.display = a.innerText.toLowerCase().includes(q)
            ? "block"
            : "none";
    });
}

loadTitles();
load();
</script>

</body>
</html>
`;
}

// server listen
app.listen(3000, () => console.log("Çalışıyor: http://localhost:3000"));
