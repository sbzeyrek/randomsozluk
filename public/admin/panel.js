function esc(s){
    if(typeof s!=="string")return"";
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}

const API = { credentials:"include", headers:{"Content-Type":"application/json"} };

async function login(){
    const password = document.getElementById("password").value;
    const r = await fetch("/api/admin/login",{
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({password})
    });
    const j = await r.json();
    if(!j.ok){
        document.getElementById("msg").innerText = j.error || "hata";
    } else {
        window.location = "/admin/panel.html";
    }
}

async function logout(){
    await fetch("/api/admin/logout",{ method:"POST", credentials:"include" });
    window.location = "/admin/index.html";
}

async function adminCheck(){
    try {
        const r = await fetch("/api/admin/check", { credentials:"include" });
        if(!r.ok) window.location = "/admin/index.html";
    } catch(e) {
        window.location = "/admin/index.html";
    }
}

async function loadTitles(){
    const r = await fetch("/api/admin/titles", { credentials:"include" });
    if(!r.ok){ window.location="/admin/index.html"; return; }
    const list = await r.json();
    const box = document.getElementById("titles");
    box.innerHTML = "";
    if(!list.length){ box.innerHTML="<i>hic baslik yok</i>"; return; }
    list.forEach(t => {
        let div = document.createElement("div");
        div.className = "title-item";
        div.innerHTML =
            "<b>"+esc(t.title)+"</b> ("+t.count+" entry) "+
            "<button class='small' onclick=\"showEntries('"+esc(t.slug)+"')\">entry'leri gor</button> "+
            "<button class='small' onclick=\"deleteTitle('"+esc(t.slug)+"')\">baslik sil</button>";
        box.appendChild(div);
    });
}

async function deleteTitle(slug){
    if(!confirm("bu baslik ve tum entry'leri silinsin mi?")) return;
    await fetch("/api/admin/delete-title/"+encodeURIComponent(slug),{
        method:"DELETE", credentials:"include"
    });
    loadTitles();
    document.getElementById("entries").innerHTML = "";
}

let currentSlug = null;

async function showEntries(slug){
    currentSlug = slug;
    const r = await fetch("/api/admin/title/"+encodeURIComponent(slug), { credentials:"include" });
    if(!r.ok){ alert("hata"); return; }
    const list = await r.json();
    const box = document.getElementById("entries");
    box.innerHTML = "";
    if(!list.length){ box.innerHTML="<i>bu baslikta entry yok</i>"; return; }
    list.forEach(e => {
        let div = document.createElement("div");
        div.className = "entry-item";
        let d = new Date(e.date);
        div.innerHTML =
            "<b>"+esc(e.nick)+"</b> &mdash; "+d.toLocaleString("tr-TR")+"<br><br>"+
            "<span style='white-space:pre-wrap;word-break:break-word;'>"+esc(e.text)+"</span><br><br>"+
            "<button class='small' onclick=\"deleteEntry('"+esc(slug)+"',"+parseInt(e.id)+")\">entry sil</button>";
        box.appendChild(div);
    });
}

async function deleteEntry(slug, id){
    if(!confirm("entry silinsin mi?")) return;
    await fetch("/api/admin/delete-entry/"+encodeURIComponent(slug)+"/"+id,{
        method:"DELETE", credentials:"include"
    });
    showEntries(slug);
}

document.addEventListener("keydown", e => {
    if(e.key==="Enter" && document.getElementById("password")) login();
});

if(window.location.pathname.endsWith("panel.html")){
    adminCheck();
    loadTitles();
}
