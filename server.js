const express = require("express");
const fs = require("fs-extra");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// STATIC FRONTEND
app.use(express.static("public"));
app.use("/titles", express.static(path.join(__dirname, "titles"))); // <-- önemli

// TITLES ROOT
const TITLES_DIR = path.join(__dirname, "titles");

// Başlık listesi (entry sayılarıyla birlikte)
app.get("/api/titles", async (req, res) => {
    if (!fs.existsSync(TITLES_DIR)) return res.json([]);

    const folders = await fs.readdir(TITLES_DIR);
    const result = [];

    for (const f of folders) {
        const dataFile = path.join(TITLES_DIR, f, "data.json");
        let entryCount = 0;

        if (fs.existsSync(dataFile)) {
            const d = await fs.readJson(dataFile);
            entryCount = Math.max(0, d.length - 1); // ilk entry hariç
        }

        result.push({
            folder: f,
            title: f.replace(/-/g, " "),
            count: entryCount
        });
    }

    res.json(result);
});

// Yeni başlık oluştur
app.post("/api/new-title", async (req, res) => {
    const { title, nick, text } = req.body;

    if (!title || !nick || !text)
        return res.json({ error: "Boş bıraktığın yer var!" });

    const folderName = title.toLowerCase().replace(/ /g, "-");
    const titlePath = path.join(TITLES_DIR, folderName);

    await fs.ensureDir(titlePath);

    const dataFile = path.join(titlePath, "data.json");

    const entry = {
        nick,
        text,
        date: new Date().toISOString()
    };

    await fs.writeJson(dataFile, [entry], { spaces: 2 });

    const htmlFile = path.join(titlePath, "index.html");
    const template = generateTitleHTML(title);
    await fs.writeFile(htmlFile, template);

    res.json({ ok: true, folder: folderName });
});

// Belirli başlığın entry’leri al
app.get("/api/title/:name", async (req, res) => {
    const name = req.params.name;
    const dataFile = path.join(TITLES_DIR, name, "data.json");

    if (!fs.existsSync(dataFile)) return res.json([]);

    const data = await fs.readJson(dataFile);
    res.json(data);
});

// Başlığa entry ekle
app.post("/api/title/:name/add", async (req, res) => {
    const name = req.params.name;
    const { nick, text } = req.body;

    const dataFile = path.join(TITLES_DIR, name, "data.json");
    let data = [];

    if (fs.existsSync(dataFile))
        data = await fs.readJson(dataFile);

    data.push({
        nick,
        text,
        date: new Date().toISOString()
    });

    await fs.writeJson(dataFile, data, { spaces: 2 });

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
   MOBİL DÜZEN (max 768px)
   =========================== */
@media (max-width: 768px) {

    /* Sol menü yukarı taşınacak */
    #left {
        position: static;
        width: 100%;
        height: auto;
        border-right: none;
    }

    #searchBox {
        width: 95%;
    }

    #titleList a {
        font-size: 14px;
        padding: 8px 0;
    }

    /* İçerik alanı tam genişlik */
    #content {
        margin-left: 0;
        width: 100%;
        padding: 15px;
    }

    h1 {
        font-size: 28px;
    }

    #subtitle {
        font-size: 14px;
        width: 100%;
    }

    /* Entry kutuları */
    .entry {
        width: 100%;
        box-sizing: border-box;
        font-size: 14px;
    }

    /* textarea ve inputlar */
    input[type=text],
    textarea {
        width: 100%;
        box-sizing: border-box;
        font-size: 14px;
    }

    /* Yeni başlık kutusu */
    .box {
        padding: 10px;
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
