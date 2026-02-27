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
    return crypto.randomBytes(32).toString("hex");
}

// ============================
//  YARDIMCI: XSS escape
// ============================
function escHtml(str) {
    if (typeof str !== "string") return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

// ============================
//  YARDIMCI: Guvenli folder adi
// ============================
function toSafeFolder(title) {
    return title
        .toLowerCase()
        .replace(/\u011f/g, "g").replace(/\u00fc/g, "u").replace(/\u015f/g, "s")
        .replace(/\u0131/g, "i").replace(/\u00f6/g, "o").replace(/\u00e7/g, "c")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
}

// ============================
//  ADMIN STATIC - EN USTE
// ============================
app.use("/admin", express.static(path.join(__dirname, "public/admin")));

// ============================
//  VERITABANI
// ============================
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
    date TEXT,
    user_id INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nick TEXT UNIQUE,
    password_hash TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER,
    user_id INTEGER,
    vote INTEGER,
    UNIQUE(entry_id, user_id)
);
`);

// ============================
//  STATIC FRONTEND
// ============================
app.use(express.static("public"));
app.use("/titles", express.static(path.join(__dirname, "titles")));

const TITLES_DIR = path.join(__dirname, "titles");

// ============================
//  SESSION YARDIMCILARI
// ============================
function getUser(req) {
    const token = req.cookies.user_token;
    if (!token) return null;
    const row = db.prepare("SELECT * FROM user_sessions WHERE token = ?").get(token);
    if (!row) return null;
    return db.prepare("SELECT id, nick FROM users WHERE id = ?").get(row.user_id);
}

function requireUser(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "giris yapman lazim" });
    req.user = user;
    next();
}

// ============================
//  AUTH API
// ============================

app.post("/api/register", async (req, res) => {
    let { nick, password } = req.body;
    if (!nick || !password) return res.json({ error: "nick ve sifre gerekli" });

    nick = nick.toLowerCase().trim();

    if (nick.length < 2 || nick.length > 30)
        return res.json({ error: "nick 2-30 karakter olmali" });

    if (password.length < 4)
        return res.json({ error: "sifre en az 4 karakter olmali" });

    const existing = db.prepare("SELECT id FROM users WHERE nick = ?").get(nick);
    if (existing) return res.json({ error: "bu nick alinmis" });

    const hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (nick, password_hash, created_at) VALUES (?, ?, ?)")
        .run(nick, hash, new Date().toISOString());

    res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
    let { nick, password } = req.body;
    if (!nick || !password) return res.json({ error: "nick ve sifre gerekli" });

    nick = nick.toLowerCase().trim();

    const user = db.prepare("SELECT * FROM users WHERE nick = ?").get(nick);
    if (!user) return res.json({ error: "nick veya sifre hatali" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.json({ error: "nick veya sifre hatali" });

    const token = makeToken();
    db.prepare("INSERT INTO user_sessions (token, user_id, created_at) VALUES (?, ?, ?)")
        .run(token, user.id, new Date().toISOString());

    res.cookie("user_token", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ ok: true, nick: user.nick });
});

app.post("/api/logout", (req, res) => {
    const token = req.cookies.user_token;
    if (token) db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    res.clearCookie("user_token");
    res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
    const user = getUser(req);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, nick: user.nick, id: user.id });
});

// ============================
//  DASHBOARD API
// ============================

app.post("/api/dashboard/change-password", requireUser, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.json({ error: "eski ve yeni sifre gerekli" });
    if (newPassword.length < 4) return res.json({ error: "yeni sifre en az 4 karakter olmali" });

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok) return res.json({ error: "mevcut sifre yanlis" });

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);

    db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(req.user.id);
    const token = makeToken();
    db.prepare("INSERT INTO user_sessions (token, user_id, created_at) VALUES (?, ?, ?)")
        .run(token, req.user.id, new Date().toISOString());

    res.cookie("user_token", token, {
        httpOnly: true, sameSite: "strict", secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ ok: true });
});

app.post("/api/dashboard/change-nick", requireUser, async (req, res) => {
    let { newNick, password } = req.body;
    if (!newNick || !password) return res.json({ error: "yeni nick ve sifre gerekli" });

    newNick = newNick.toLowerCase().trim();

    if (newNick.length < 2 || newNick.length > 30)
        return res.json({ error: "nick 2-30 karakter olmali" });

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.json({ error: "sifre yanlis" });

    const existing = db.prepare("SELECT id FROM users WHERE nick = ? AND id != ?").get(newNick, req.user.id);
    if (existing) return res.json({ error: "bu nick alinmis" });

    db.prepare("UPDATE users SET nick = ? WHERE id = ?").run(newNick, req.user.id);
    res.json({ ok: true, nick: newNick });
});

app.get("/api/dashboard/my-entries", requireUser, (req, res) => {
    const rows = db.prepare(`
        SELECT e.id, e.folder, e.text, e.date, t.title
        FROM entries e
        LEFT JOIN titles t ON t.folder = e.folder
        WHERE e.user_id = ?
        ORDER BY e.id DESC
        LIMIT 50
    `).all(req.user.id);
    res.json(rows);
});

// Kullanici profili (herkese acik)
app.get("/api/user/:nick", (req, res) => {
    const nick = req.params.nick.toLowerCase();
    const user = db.prepare("SELECT id, nick, created_at FROM users WHERE nick = ?").get(nick);
    if (!user) return res.json({ error: "kullanici bulunamadi" });

    const entries = db.prepare(`
        SELECT e.id, e.folder, e.text, e.date, t.title
        FROM entries e
        LEFT JOIN titles t ON t.folder = e.folder
        WHERE e.user_id = ?
        ORDER BY e.id DESC
        LIMIT 30
    `).all(user.id);

    res.json({ nick: user.nick, created_at: user.created_at, entries });
});

// ============================
//  API: Baslik listesi
// ============================
app.get("/api/titles", (req, res) => {
    const rows = db.prepare(`
        SELECT t.title, t.folder,
            (SELECT COUNT(*) FROM entries e WHERE e.folder = t.folder) AS count
        FROM titles t
        ORDER BY t.id DESC
    `).all();
    res.json(rows);
});

// ============================
//  API: Yeni baslik olustur
// ============================
app.post("/api/new-title", requireUser, (req, res) => {
    let { title, text } = req.body;
    const user = req.user;

    if (!title || !text) return res.json({ error: "bos biraktigin yer var!" });

    title = title.toLowerCase().trim();
    text = text.toLowerCase().trim();

    if (title.length < 2) return res.json({ error: "baslik cok kisa" });
    if (text.length < 2) return res.json({ error: "entry cok kisa" });

    const folder = toSafeFolder(title);
    if (!folder) return res.json({ error: "gecerli bir baslik gir" });

    const existing = db.prepare("SELECT id FROM titles WHERE folder = ?").get(folder);
    if (existing) return res.json({ error: "bu baslik zaten var" });

    db.prepare("INSERT INTO titles (folder, title, created_at) VALUES (?, ?, ?)")
        .run(folder, title, new Date().toISOString());

    db.prepare("INSERT INTO entries (folder, nick, text, date, user_id) VALUES (?, ?, ?, ?, ?)")
        .run(folder, user.nick, text, new Date().toISOString(), user.id);

    const titlePath = path.join(TITLES_DIR, folder);
    fs.ensureDirSync(titlePath);
    fs.writeFileSync(path.join(titlePath, "index.html"), generateTitleHTML(title, folder));

    res.json({ ok: true, folder });
});

// ============================
//  API: Baslik entry'leri + oy sayilari
// ============================
app.get("/api/title/:name", (req, res) => {
    const folder = req.params.name.replace(/[^a-z0-9\-]/g, "");
    const user = getUser(req);
    const userId = user ? user.id : null;

    const rows = db.prepare(`
        SELECT e.*,
            (SELECT COUNT(*) FROM votes v WHERE v.entry_id = e.id AND v.vote = 1) AS likes,
            (SELECT COUNT(*) FROM votes v WHERE v.entry_id = e.id AND v.vote = -1) AS dislikes
        FROM entries e
        WHERE e.folder = ?
        ORDER BY e.id ASC
    `).all(folder);

    const result = rows.map(e => {
        let userVote = 0;
        if (userId) {
            const v = db.prepare("SELECT vote FROM votes WHERE entry_id = ? AND user_id = ?").get(e.id, userId);
            userVote = v ? v.vote : 0;
        }
        return { ...e, userVote };
    });

    res.json(result);
});

// ============================
//  API: Entry ekle
// ============================
app.post("/api/title/:name/add", requireUser, (req, res) => {
    let { text } = req.body;
    const folder = req.params.name.replace(/[^a-z0-9\-]/g, "");
    const user = req.user;

    if (!text || !text.trim()) return res.json({ error: "entry bos olamaz" });

    text = text.toLowerCase().trim();

    const titleExists = db.prepare("SELECT id FROM titles WHERE folder = ?").get(folder);
    if (!titleExists) return res.json({ error: "baslik bulunamadi" });

    db.prepare("INSERT INTO entries (folder, nick, text, date, user_id) VALUES (?, ?, ?, ?, ?)")
        .run(folder, user.nick, text, new Date().toISOString(), user.id);

    res.json({ ok: true });
});

// ============================
//  API: Like / Dislike
// ============================
app.post("/api/vote/:entryId", requireUser, (req, res) => {
    const entryId = parseInt(req.params.entryId);
    const { vote } = req.body;
    const userId = req.user.id;

    if (isNaN(entryId)) return res.json({ error: "gecersiz entry" });
    if (vote !== 1 && vote !== -1) return res.json({ error: "gecersiz oy" });

    const entry = db.prepare("SELECT * FROM entries WHERE id = ?").get(entryId);
    if (!entry) return res.json({ error: "entry bulunamadi" });

    if (entry.user_id === userId) return res.json({ error: "kendi entry'ine oy veremezsin" });

    const existing = db.prepare("SELECT * FROM votes WHERE entry_id = ? AND user_id = ?").get(entryId, userId);

    if (existing) {
        if (existing.vote === vote) {
            db.prepare("DELETE FROM votes WHERE entry_id = ? AND user_id = ?").run(entryId, userId);
        } else {
            db.prepare("UPDATE votes SET vote = ? WHERE entry_id = ? AND user_id = ?").run(vote, entryId, userId);
        }
    } else {
        db.prepare("INSERT INTO votes (entry_id, user_id, vote) VALUES (?, ?, ?)").run(entryId, userId, vote);
    }

    const likes    = db.prepare("SELECT COUNT(*) AS c FROM votes WHERE entry_id = ? AND vote = 1").get(entryId).c;
    const dislikes = db.prepare("SELECT COUNT(*) AS c FROM votes WHERE entry_id = ? AND vote = -1").get(entryId).c;
    const newVote  = db.prepare("SELECT vote FROM votes WHERE entry_id = ? AND user_id = ?").get(entryId, userId);

    res.json({ ok: true, likes, dislikes, userVote: newVote ? newVote.vote : 0 });
});

// ============================
//  ADMIN BACKEND
// ============================

app.post("/api/admin/login", async (req, res) => {
    const { password } = req.body;
    if (!password) return res.json({ error: "parola gerekli" });

    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if (!ok) return res.json({ error: "yanlis parola" });

    const token = makeToken();
    ACTIVE_ADMIN_TOKENS.add(token);

    res.cookie("admin_token", token, {
        httpOnly: true, sameSite: "strict", secure: false, maxAge: 86400000
    });

    res.json({ ok: true });
});

function requireAdmin(req, res, next) {
    const t = req.cookies.admin_token;
    if (!t || !ACTIVE_ADMIN_TOKENS.has(t))
        return res.status(401).json({ error: "yetki yok" });
    next();
}

app.get("/api/admin/check", requireAdmin, (req, res) => res.json({ ok: true }));

app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const t = req.cookies.admin_token;
    if (t) ACTIVE_ADMIN_TOKENS.delete(t);
    res.clearCookie("admin_token");
    res.json({ ok: true });
});

app.get("/api/admin/titles", requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT t.title, t.folder,
            (SELECT COUNT(*) FROM entries e WHERE e.folder = t.folder) AS count
        FROM titles t ORDER BY t.id DESC
    `).all();
    res.json(rows);
});

app.get("/api/admin/title/:folder", requireAdmin, (req, res) => {
    const folder = req.params.folder.replace(/[^a-z0-9\-]/g, "");
    const rows = db.prepare("SELECT id, nick, text, date FROM entries WHERE folder = ? ORDER BY id ASC").all(folder);
    res.json(rows);
});

app.delete("/api/admin/delete-title/:folder", requireAdmin, (req, res) => {
    const folder = req.params.folder.replace(/[^a-z0-9\-]/g, "");
    db.prepare("DELETE FROM votes WHERE entry_id IN (SELECT id FROM entries WHERE folder = ?)").run(folder);
    db.prepare("DELETE FROM entries WHERE folder = ?").run(folder);
    db.prepare("DELETE FROM titles WHERE folder = ?").run(folder);
    const titlePath = path.join(TITLES_DIR, folder);
    if (fs.existsSync(titlePath)) fs.removeSync(titlePath);
    res.json({ ok: true });
});

app.delete("/api/admin/delete-entry/:folder/:id", requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const folder = req.params.folder.replace(/[^a-z0-9\-]/g, "");
    if (isNaN(id)) return res.json({ error: "gecersiz id" });
    db.prepare("DELETE FROM votes WHERE entry_id = ?").run(id);
    db.prepare("DELETE FROM entries WHERE id = ? AND folder = ?").run(id, folder);
    res.json({ ok: true });
});

// ============================
//  BASLIK HTML OLUSTURUCU
// ============================
function generateTitleHTML(title, folder) {
    const safeTitle  = escHtml(title);
    const safeFolder = escHtml(folder);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
    body{margin:0;background-color:#5a5a1e;font-family:Verdana,Arial,sans-serif;color:#e1e1b0;font-size:12px;}
    a{color:#ffec8f;text-decoration:none;}
    a:hover{text-decoration:underline;}
    #left{width:180px;background-color:#464619;height:100vh;overflow-y:auto;border-right:1px solid #242400;padding:10px;position:fixed;top:0;left:0;}
    #searchBox{width:160px;padding:4px;background-color:#dfdfc3;border:1px solid #333;margin-bottom:10px;}
    #titleList a{display:block;padding:4px 0;border-bottom:1px solid #555;font-size:12px;}
    .entry-count{color:#b8b894;font-size:10px;float:right;}
    #content{margin-left:210px;padding:25px;width:650px;}
    h1{font-family:"Comic Sans MS";font-size:40px;text-align:center;color:#ffdf00;text-shadow:2px 2px 3px black;margin:0;}
    .entry{background-color:#3c3c14;padding:10px;border:1px solid #222;margin-bottom:10px;}
    .entry-meta{color:#b8b894;font-size:11px;margin-bottom:6px;}
    .entry-text{line-height:1.6;word-break:break-word;white-space:pre-wrap;}
    .vote-bar{margin-top:8px;display:flex;gap:8px;align-items:center;}
    .vote-btn{background:none;border:1px solid #555;color:#b8b894;padding:2px 8px;cursor:pointer;font-size:11px;border-radius:3px;font-family:Verdana,Arial,sans-serif;}
    .vote-btn.liked{border-color:#7fa;color:#7fa;}
    .vote-btn.disliked{border-color:#f77;color:#f77;}
    .vote-btn:disabled{cursor:default;opacity:0.5;}
    .box{background-color:#464619;padding:15px;border:1px solid #242400;margin-bottom:20px;}
    textarea,input[type=text]{width:95%;padding:5px;background-color:#dfdfc3;border:1px solid #333;font-size:12px;color:black;}
    textarea{background:white;height:130px;}
    .main-btn{background-color:#e3bf00;border:1px solid black;padding:5px 12px;cursor:pointer;margin-top:10px;font-family:Verdana,Arial,sans-serif;}
    #userbar{text-align:right;margin-bottom:10px;font-size:11px;color:#b8b894;}
    #userbar a{color:#ffec8f;}
    #entryMsg{margin-top:6px;color:#f99;font-size:11px;}
    @media(max-width:768px){
        #left{position:static;width:100%;height:auto;border-right:none;padding:10px;box-sizing:border-box;}
        #searchBox{width:100%;box-sizing:border-box;}
        #content{margin-left:0;width:100%;padding:15px;box-sizing:border-box;}
        h1{font-size:28px;}
        textarea,input[type=text],.main-btn{width:100%;box-sizing:border-box;font-size:14px;}
        textarea{height:120px;}
    }
</style>
</head>
<body>

<div id="left">
    <input type="text" id="searchBox" placeholder="baslik ara" onkeyup="filterTitles()">
    <h4>basliklar</h4>
    <div id="titleList"></div>
</div>

<div id="content">
    <h1><a href="/">randomsozluk</a></h1>
    <div id="userbar"></div>
    <div class="box"><h2>${safeTitle}</h2></div>
    <div id="entries"></div>
    <div class="box">
        <h3>entry gir</h3>
        <textarea id="text" placeholder="noronlarindan gecenler"></textarea>
        <br>
        <button class="main-btn" onclick="send()">yolla</button>
        <div id="entryMsg"></div>
    </div>
</div>

<script>
const FOLDER = "${safeFolder}";
let currentUser = null;

function esc(s){
    if(typeof s!=="string")return"";
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}

async function loadMe(){
    const r=await fetch("/api/me");
    const d=await r.json();
    const bar=document.getElementById("userbar");
    if(d.loggedIn){
        currentUser=d;
        bar.innerHTML='merhaba <a href="/dashboard.html"><b>'+esc(d.nick)+'</b></a> &nbsp;|&nbsp; <a href="#" onclick="doLogout()">cikis</a>';
    }else{
        bar.innerHTML='<a href="/giris.html">giris yap</a> &nbsp;|&nbsp; <a href="/kayit.html">kayit ol</a>';
    }
}

async function doLogout(){
    await fetch("/api/logout",{method:"POST"});
    location.reload();
}

async function loadTitles(){
    const r=await fetch("/api/titles");
    const list=await r.json();
    const div=document.getElementById("titleList");
    div.innerHTML="";
    list.forEach(t=>{
        let a=document.createElement("a");
        a.href="/titles/"+t.folder+"/index.html";
        let c=t.count>0?' <span class="entry-count">('+t.count+')</span>':'';
        a.innerHTML=esc(t.title)+c;
        div.appendChild(a);
    });
}

async function load(){
    const r=await fetch("/api/title/"+FOLDER);
    const data=await r.json();
    const div=document.getElementById("entries");
    div.innerHTML="";
    data.forEach(e=>{
        let box=document.createElement("div");
        box.className="entry";
        let d=new Date(e.date);
        let dateStr=d.toLocaleDateString("tr-TR")+" "+d.toLocaleTimeString("tr-TR");
        let likeClass  =e.userVote===1 ?" liked":"";
        let dislikeClass=e.userVote===-1?" disliked":"";
        let canVote=currentUser&&currentUser.nick!==e.nick;
        box.innerHTML=
            '<div class="entry-meta"><a href="/kullanici.html?nick='+encodeURIComponent(e.nick)+'">'+esc(e.nick)+'</a> &mdash; '+dateStr+'</div>'+
            '<div class="entry-text">'+esc(e.text)+'</div>'+
            '<div class="vote-bar">'+
                '<button class="vote-btn'+likeClass+'" id="like-'+e.id+'" '+(canVote?'':'disabled')+' onclick="vote('+e.id+',1)">'+
                    '&#9650; <span id="lc-'+e.id+'">'+e.likes+'</span>'+
                '</button>'+
                '<button class="vote-btn'+dislikeClass+'" id="dislike-'+e.id+'" '+(canVote?'':'disabled')+' onclick="vote('+e.id+',-1)">'+
                    '&#9660; <span id="dc-'+e.id+'">'+e.dislikes+'</span>'+
                '</button>'+
            '</div>';
        div.appendChild(box);
    });
}

async function vote(entryId,v){
    if(!currentUser)return;
    const r=await fetch("/api/vote/"+entryId,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({vote:v})
    });
    const d=await r.json();
    if(!d.ok)return;
    document.getElementById("lc-"+entryId).innerText=d.likes;
    document.getElementById("dc-"+entryId).innerText=d.dislikes;
    document.getElementById("like-"+entryId).className="vote-btn"+(d.userVote===1?" liked":"");
    document.getElementById("dislike-"+entryId).className="vote-btn"+(d.userVote===-1?" disliked":"");
}

async function send(){
    const msg=document.getElementById("entryMsg");
    if(!currentUser){msg.innerText="entry girmek icin giris yapman lazim";return;}
    let text=document.getElementById("text").value;
    if(!text.trim()){msg.innerText="entry bos olamaz";return;}
    text=text.toLowerCase();
    const r=await fetch("/api/title/"+FOLDER+"/add",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text})
    });
    const d=await r.json();
    if(d.error){msg.innerText=d.error;return;}
    document.getElementById("text").value="";
    msg.innerText="";
    load();loadTitles();
}

function filterTitles(){
    const q=document.getElementById("searchBox").value.toLowerCase();
    document.querySelectorAll("#titleList a").forEach(a=>{
        a.style.display=a.innerText.toLowerCase().includes(q)?"block":"none";
    });
}

(async()=>{await loadMe();loadTitles();load();})();
</script>
</body>
</html>`;
}

app.listen(3000, () => console.log("caliyor: http://localhost:3000"));
