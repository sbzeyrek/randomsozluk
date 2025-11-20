const express = require("express");
const fs = require("fs-extra");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
app.use(cookieParser());

function requireAdmin(req, res, next) {
    if (!req.cookies.admin) return res.status(403).json({ error: "yetki yok" });

    bcrypt.compare(req.cookies.admin, ADMIN_HASH, (err, ok) => {
        if (ok) next();
        else return res.status(403).json({ error: "yetki yok" });
    });
}

app.post("/admin-login", async (req, res) => {
    const { password } = req.body;
    if (!password) return res.json({ error: "parola yok" });

    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if (!ok) return res.json({ error: "yanlış parola" });

    res.cookie("admin", password, {
        httpOnly: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 30
    });

    res.json({ ok: true });
});

app.use("/admin-54f6a12ca898b", express.static(path.join(__dirname, "admin-54f6a12ca898b")));

app.post("/admin-delete-title/:folder", requireAdmin, async (req, res) => {
    const folder = req.params.folder;
    const dir = path.join(__dirname, "titles", folder);

    if (!fs.existsSync(dir)) {
        return res.json({ error: "böyle bir başlık yok" });
    }

    await fs.remove(dir);
    res.json({ ok: true });
});

async function deleteTitle(folder) {
    if (!confirm("Bu başlık tamamen silinsin mi?")) return;

    await fetch("/admin-delete-title/" + folder, { method:"POST" });
    loadTitleManager();
    loadStats();
}


app.post("/admin-delete-entry", requireAdmin, async (req, res) => {
    const { folder, index } = req.body;

    if (folder == null || index == null)
        return res.json({ error: "eksik parametre" });

    const file = path.join(__dirname, "titles", folder, "data.json");

    if (!fs.existsSync(file)) return res.json({ error: "bulunamadı" });

    let data = await fs.readJson(file);

    if (!data[index]) return res.json({ error: "entry yok" });

    data.splice(index, 1);
    await fs.writeJson(file, data, { spaces: 2 });

    res.json({ ok: true });
});


// senin hashin
const ADMIN_HASH = "$2b$10$L2nKB5QyIiVYq7ehQBwXReTwqjYxhFTU60sOvJFiypHJD2OX2tEaK";

app.post("/admin-54f6a12ca898b/login", async (req, res) => {
    const { password } = req.body;

    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if (!ok) return res.json({ error: "yanlış şifre!" });

    res.cookie("admin", "ok", {
        httpOnly: true,
        sameSite: "strict",
        secure: true  // Render için zorunlu
    });

    res.json({ ok: true });
});

app.use("/admin-54f6a12ca898b", express.static(path.join(__dirname, "admin-54f6a12ca898b")));


const Database = require("better-sqlite3");
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


// STATIC FRONTEND
app.use(express.static("public"));
app.use("/titles", express.static(path.join(__dirname, "titles"))); // <-- önemli

// TITLES ROOT
const TITLES_DIR = path.join(__dirname, "titles");

// Başlık listesi (entry sayılarıyla birlikte)
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


// Yeni başlık oluştur
app.post("/api/new-title", (req, res) => {
    const { title, nick, text } = req.body;

    if (!title || !nick || !text)
        return res.json({ error: "Boş bıraktığın yer var!" });

    const folderName = title.toLowerCase().replace(/ /g, "-");

    // Başlık tabloya
    db.prepare(`
        INSERT INTO titles (folder, title, created_at)
        VALUES (?, ?, ?)
    `).run(folderName, title, new Date().toISOString());

    // İlk entry tabloya
    db.prepare(`
        INSERT INTO entries (folder, nick, text, date)
        VALUES (?, ?, ?, ?)
    `).run(folderName, nick, text, new Date().toISOString());

    res.json({ ok: true, folder: folderName });
});


// Belirli başlığın entry’leri al
app.get("/api/title/:name", (req, res) => {
    const name = req.params.name;

    const rows = db.prepare(`
        SELECT *
        FROM entries
        WHERE folder = ?
        ORDER BY id ASC
    `).all(name);

    res.json(rows);
});


// Başlığa entry ekle
app.post("/api/title/:name/add", (req, res) => {
    const name = req.params.name;
    const { nick, text } = req.body;

    db.prepare(`
        INSERT INTO entries (folder, nick, text, date)
        VALUES (?, ?, ?, ?)
    `).run(name, nick, text, new Date().toISOString());

    res.json({ ok: true });
});


// Başlık sayfası HTML şablonu
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


app.listen(3000, () => console.log("Çalışıyor: http://localhost:3000"));
