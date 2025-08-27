// server/index.js  (ESM)
import express from "express";
import cors from "cors";
import fs from "fs";
import * as path from "path";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// === BASE PÚBLICA para links absolutos (Render) ===
// Configurá en Render > Environment Variables:
// PUBLIC_BASE_URL = https://remitos-server.onrender.com
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const abs = (p) => p.startsWith("http") ? p : `${PUBLIC_BASE_URL}${p}`;

// ======= RUTAS/ARCHIVOS =======
const DATA_FILE = path.join(__dirname, "data.json");
const PDF_DIR   = path.join(__dirname, "pdf");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

// ======= UTILS =======
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    // bootstrap inicial
    const db = {
      users: {
        admin: { username: "admin", password: "admin123" }
      },
      branches: [], // {id,name,address,phone,pin}
      products: [], // {id,description,codes[]}
      remitos: [],  // {id,numero,fecha,origin,branch:{...},items:[{description,qty,received}],status, note, pdf, publicUrl, wa}
      counters: { remito: 3804 }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { users:{admin:{username:"admin",password:"admin123"}}, branches:[], products:[], remitos:[], counters:{remito:3804} }; }
}
function saveDB(db){ fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2), "utf8"); }
function nextRemitoNumber(db){ db.counters ||= {}; if(typeof db.counters.remito!=="number") db.counters.remito=3804; db.counters.remito+=1; return db.counters.remito; }
const norm = (s)=> String(s||"").trim().replace(/\s+/g," ").toLowerCase();
const looksBarcode = (s)=> /^\d{6,}$/.test(String(s||"").replace(/\s+/g,""));
const cleanPhone = (s="")=> String(s).replace(/\D+/g,"");
const waLink = (phone, text) => {
  const num = cleanPhone(phone);
  const base = num ? `https://wa.me/${num}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(text)}`;
};

// ======= APP SETUP =======
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: ["http://localhost:5173", /\.vercel\.app$/, /\.onrender\.com$/],
  credentials: false
}));
app.use("/pdf", express.static(PDF_DIR));

// ======= AUTH SIMPLE =======
// Admin fijo y Sucursal por PIN (no hay JWT; el front guarda estado en memoria)
app.post("/auth/login", (req,res)=>{
  const { role, username, password, branchId, pin } = req.body || {};
  const db = loadDB();
  if (role === "admin") {
    const ok = username===db.users.admin.username && password===db.users.admin.password;
    if(!ok) return res.status(401).json({ ok:false, error:"Credenciales inválidas" });
    return res.json({ ok:true, role:"admin" });
  }
  if (role === "branch") {
    const b = (db.branches||[]).find(x=> String(x.id)===String(branchId));
    if(!b) return res.status(404).json({ ok:false, error:"Sucursal inexistente" });
    if(String(b.pin||"") !== String(pin||"")) return res.status(401).json({ ok:false, error:"PIN incorrecto" });
    return res.json({ ok:true, role:"branch", branch: { id:b.id, name:b.name } });
  }
  res.status(400).json({ ok:false, error:"role inválido" });
});

// ======= SEED =======
app.get("/seed", (req,res)=>{
  const db = loadDB();
  if ((db.branches||[]).length>0) return res.send("Seed ya ejecutado.");
  db.branches = [
    { id:1, name:"Adrogué",           address:"Av. Hipólito Yrigoyen 13298, Adrogué", phone:"", pin:"1111" },
    { id:2, name:"Avellaneda Local",  address:"Güemes 897, Alto Avellaneda, Avellaneda", phone:"", pin:"2222" },
    { id:3, name:"Lomas",             address:"Antártida Argentina 799, Lomas", phone:"", pin:"3333" },
  ];
  saveDB(db);
  res.send("OK: sucursales creadas con PIN");
});

// ======= SUCURSALES (admin) =======
app.get("/branches", (req,res)=>{ const db=loadDB(); res.json(db.branches||[]); });

app.post("/branches/add", (req,res)=>{
  const db = loadDB();
  const name = String(req.body.name||"").trim();
  const address = String(req.body.address||"").trim();
  const phone = cleanPhone(req.body.phone||"");
  const pin = String(req.body.pin||"").trim();
  if(!name) return res.status(400).json({ error:"Nombre requerido" });
  const id = (db.branches?.reduce((m,b)=>Math.max(m,b.id),0)||0)+1;
  db.branches ||= [];
  db.branches.push({ id,name,address,phone,pin });
  saveDB(db);
  res.json({ ok:true });
});

app.post("/branches/:id/update", (req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const b = (db.branches||[]).find(x=>x.id===id);
  if(!b) return res.status(404).json({ error:"Sucursal no existe" });
  b.name    = String(req.body.name??b.name).trim();
  b.address = String(req.body.address??b.address).trim();
  b.phone   = cleanPhone(req.body.phone??b.phone);
  if(typeof req.body.pin !== "undefined") b.pin = String(req.body.pin||"").trim();
  saveDB(db);
  res.json({ ok:true });
});

app.post("/branches/:id/delete", (req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const n0 = (db.branches||[]).length;
  db.branches = (db.branches||[]).filter(x=>x.id!==id);
  saveDB(db);
  res.json({ ok:true, removed: n0-(db.branches.length) });
});

// ======= PRODUCTOS (admin) =======
app.get("/products", (req,res)=>{
  const db = loadDB();
  const q = String(req.query.q||"").trim();
  if(!q) return res.json((db.products||[]));
  const qn = norm(q);
  const list = (db.products||[]).filter(p=>{
    const matchDesc = norm(p.description).includes(qn);
    const matchCode = (p.codes||[]).some(c=> String(c).includes(q));
    return matchDesc || matchCode;
  });
  res.json(list);
});
app.post("/products", (req,res)=>{
  const db = loadDB();
  const description = String(req.body.description||"").trim();
  const codes = Array.isArray(req.body.codes) ? req.body.codes.map(c=>String(c).trim()).filter(Boolean) : [];
  if(!description) return res.status(400).json({ error:"Descripción requerida" });
  const id = (db.products?.reduce((m,p)=>Math.max(m,p.id),0)||0)+1;
  db.products ||= [];
  // evitar duplicados de códigos
  const dup = codes.find(code => (db.products||[]).some(p=>(p.codes||[]).includes(code)));
  if(dup) return res.status(400).json({ error:`Código duplicado: ${dup}` });
  db.products.push({ id, description, codes });
  saveDB(db);
  res.json({ ok:true, id });
});
app.post("/products/:id/update", (req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const p = (db.products||[]).find(x=>x.id===id);
  if(!p) return res.status(404).json({ error:"No existe" });
  const description = String(req.body.description??p.description).trim();
  const codes = Array.isArray(req.body.codes) ? req.body.codes.map(c=>String(c).trim()).filter(Boolean) : p.codes||[];
  // validar duplicados
  for(const code of codes){
    const other = (db.products||[]).find(x=>x.id!==id && (x.codes||[]).includes(code));
    if(other) return res.status(400).json({ error:`Código ya en uso por otro producto (${code})` });
  }
  p.description = description;
  p.codes = codes.slice(0,3);
  saveDB(db);
  res.json({ ok:true });
});
app.post("/products/:id/delete",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const n0 = (db.products||[]).length;
  db.products = (db.products||[]).filter(x=>x.id!==id);
  saveDB(db);
  res.json({ ok:true, removed: n0-(db.products.length) });
});

// ======= REMITOS =======
app.post("/remitos", (req,res)=>{
  const db = loadDB();
  const { branch, origin, date, items } = req.body||{};
  if(!branch?.id) return res.status(400).json({ error:"branch requerido" });
  if(!Array.isArray(items) || items.length===0) return res.status(400).json({ error:"items vacío" });

  const bFull = (db.branches||[]).find(x=>x.id===Number(branch.id));
  const phone = cleanPhone(bFull?.phone||"");

  const numero = nextRemitoNumber(db);
  const id = (db.remitos?.reduce((m,r)=>Math.max(m,r.id),0)||0)+1;

  const normItems = items.map(x=>({
    description: String(x.description||"").trim(),
    qty: parseInt(x.qty,10)||0,
    received: 0
  }));

  const remito = {
    id, numero,
    fecha: date || new Date().toISOString().slice(0,10),
    origin: String(origin||"Juan Manuel de Rosas 1325"),
    branch: { id: branch.id, name: branch.name, address: branch.address||"", phone },
    items: normItems,
    status: "pendiente",
    note: ""
  };

  // PDF
  const pdfRel = `/pdf/remito_${numero}.pdf`;
  try { generateRemitoPDF(remito, path.join(PDF_DIR, `remito_${numero}.pdf`)); }
  catch(e){ console.error("PDF error",e); return res.status(500).json({ error:"No se pudo generar PDF" }); }

  // público
  const publicRel = `/r/${id}`;

  // WhatsApp (si hay teléfono en sucursal)
  let wa = null;
  if(phone){
    const text = [
      `Remito ${numero} (${remito.fecha})`,
      `${remito.origin} → ${remito.branch.name}`,
      abs(publicRel)
    ].join("\n");
    wa = waLink(phone, text);
  }

  remito.pdf = pdfRel;
  remito.publicUrl = publicRel;
  remito.wa = wa;

  db.remitos ||= [];
  db.remitos.push(remito);
  saveDB(db);

  res.json({ ok:true, id, numero, pdf: remito.pdf, publicUrl: remito.publicUrl, wa: remito.wa });
});

// lista y detalle
app.get("/remitos",(req,res)=>{
  const db=loadDB();
  const role = String(req.query.role||"");
  const branchId = Number(req.query.branchId||0);
  let list = (db.remitos||[]);
  if(role==="branch" && branchId){
    list = list.filter(r => Number(r.branch?.id)===branchId);
  }
  list = list.map(r=>({
    id:r.id, numero:r.numero, fecha:r.fecha, branch:r.branch, origin:r.origin,
    pdf:r.pdf, publicUrl:r.publicUrl, wa:r.wa||null, status:r.status, note:r.note||""
  })).sort((a,b)=> b.id-a.id);
  res.json(list);
});
app.get("/remitos/:id",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const r = (db.remitos||[]).find(x=>x.id===id);
  if(!r) return res.status(404).json({ error:"No existe" });
  res.json(r);
});

// recepción por código (suma +1)
app.post("/remitos/:id/scan",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const code = String(req.body.code||"").trim();
  const r = (db.remitos||[]).find(x=>x.id===id);
  if(!r) return res.status(404).json({ error:"No existe" });
  if(!code) return res.status(400).json({ error:"Código requerido" });

  const prod = (db.products||[]).find(p=>(p.codes||[]).includes(code));
  if(!prod) return res.status(404).json({ error:"Código no encontrado", reason:"unknown_code" });

  const idx = r.items.findIndex(it=> norm(it.description)===norm(prod.description));
  if(idx===-1) return res.status(400).json({ error:"Producto no figura en el remito", reason:"not_in_remito" });

  const it = r.items[idx];
  it.received = Math.min(it.qty, (parseInt(it.received,10)||0)+1);

  applyStatus(r);
  saveDB(db);
  res.json({ ok:true, item:{ index:idx, description:it.description, qty:it.qty, received:it.received }, status:r.status });
});

// set recibido directo (+/- desde UI)
app.post("/remitos/:id/set-received",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const { index, received } = req.body||{};
  const r = (db.remitos||[]).find(x=>x.id===id);
  if(!r) return res.status(404).json({ error:"No existe" });
  const i = Number(index);
  if(isNaN(i) || i<0 || i>=r.items.length) return res.status(400).json({ error:"index inválido" });
  const val = Math.max(0, parseInt(received,10)||0);
  r.items[i].received = val;
  applyStatus(r);
  saveDB(db);
  res.json({ ok:true, item:{ index:i, received: r.items[i].received }, status:r.status });
});

function applyStatus(r){
  const allOk  = r.items.every(x=>(+x.received||0) === (+x.qty||0));
  const anyOver= r.items.some (x=>(+x.received||0) >  (+x.qty||0));
  const anyDiff= r.items.some (x=>(+x.received||0) !== (+x.qty||0));
  r.status = allOk && !anyOver ? "ok" : (anyDiff ? "diferencias" : "pendiente");
}

// cierre OK o con diferencias (con nota y WA)
app.post("/remitos/:id/close",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const { action, note } = req.body||{};
  const r = (db.remitos||[]).find(x=>x.id===id);
  if(!r) return res.status(404).json({ error:"No existe" });

  if(action==="ok"){
    const allOk = r.items.every(x=>(+x.received||0) === (+x.qty||0));
    if(!allOk) return res.status(400).json({ error:"No coincide todo; hay diferencias" });
    r.status = "ok";
    r.note = "";
  }else if(action==="diferencias"){
    r.status = "diferencias";
    r.note = String(note||"");
  }else{
    return res.status(400).json({ error:"action inválida" });
  }

  // regenerar PDF con nota (si hay)
  try { generateRemitoPDF(r, path.join(PDF_DIR, `remito_${r.numero}.pdf`)); } catch(e){}

  // WhatsApp a +5491150976156 con resumen
  const target = "5491150976156";
  const lines = [
    `${r.branch?.name||"Sucursal"}`,
    ...r.items.map(it=> `${it.description}: ${it.qty} / ${it.received}`)
  ];
  if(r.status==="ok") lines.push("Remito OK");
  else lines.push("Remito con las siguientes Observaciones:", r.note||"(sin observaciones)");
  const msg = lines.join("\n");
  const waAdmin = waLink(target, msg);

  saveDB(db);
  res.json({ ok:true, status:r.status, waAdmin });
});

// ======= Página de recepción /r/:id =======
app.get("/r/:id",(req,res)=>{
  const db = loadDB();
  const id = Number(req.params.id);
  const r = (db.remitos||[]).find(x=>x.id===id);
  if(!r) return res.status(404).send("Remito inexistente");

  const waHref = r.wa ? r.wa : "https://wa.me/?text="+encodeURIComponent("Remito "+r.numero);

  const rowsHtml = (r.items||[]).map((it,i)=>{
    const desc = String(it.description||"").replace(/"/g,"&quot;");
    const qty = parseInt(it.qty,10)||0;
    const rec = parseInt(it.received,10)||0;
    // hallar codes para búsqueda
    const p = (db.products||[]).find(pp => norm(pp.description)===norm(it.description));
    const codes = (p?.codes||[]).join(" ");
    return (
      "<tr data-desc=\""+desc+"\" data-codes=\""+codes+"\">" +
        "<td>"+(i+1)+"</td>" +
        "<td>"+desc+(codes?("<div style='color:#64748b;font-size:12px'>"+codes+"</div>"):"")+"</td>" +
        "<td>"+qty+"</td>" +
        "<td>" +
          "<div style='display:flex;gap:6px;align-items:center'>" +
            "<button onclick='step("+i+",-1)' class='btn secondary' title='-1'>–</button>" +
            "<input id='rcv_"+i+"' type='number' min='0' style='width:80px;padding:6px;border:1px solid #e2e8f0;border-radius:8px' value='"+rec+"' oninput='setRcv("+i+", this.value)'/>" +
            "<button onclick='step("+i+",1)' class='btn secondary' title='+1'>+1</button>" +
          "</div>" +
        "</td>" +
      "</tr>"
    );
  }).join("");

  const html =
"<!doctype html>"+
"<html lang='es'><head><meta charset='utf-8'/>"+
"<meta name='viewport' content='width=device-width,initial-scale=1'/>"+
"<title>Recepción "+r.numero+"</title>"+
"<style>"+
":root{--line:#e2e8f0;--muted:#64748b;--primary:#0ea5e9}"+
"body{font-family:system-ui;margin:0;background:#f6faff;color:#0f172a}"+
".wrap{max-width:980px;margin:0 auto;padding:16px}"+
".card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}"+
".row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}"+
".input{padding:10px;border:1px solid var(--line);border-radius:10px;width:100%}"+
".btn{padding:10px 14px;border-radius:10px;border:1px solid var(--primary);background:var(--primary);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}"+
".btn.secondary{background:#fff;color:var(--primary)}"+
"table{border-collapse:collapse;width:100%} td,th{border-top:1px solid var(--line);padding:8px} thead th{background:#f1f5f9}"+
".pill{padding:4px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px}"+
".pill.ok{background:#ecfeff}.pill.diff{background:#fff1f2}.pill.pend{background:#fff7ed}"+
"</style></head><body>"+
"<div class='wrap'>"+
"  <h2>Recepción — Remito "+r.numero+"</h2>"+
"  <div class='card'>"+
"    <div class='row'>"+
"      <div><b>Fecha:</b> "+r.fecha+"</div>"+
"      <div><b>Origen:</b> "+r.origin+"</div>"+
"      <div><b>Destino:</b> "+(r.branch?.name||"")+"</div>"+
"      <div><b>Estado:</b> <span id='st' class='pill "+(r.status==='ok'?'ok':(r.status==='diferencias'?'diff':'pend'))+"'>"+String(r.status||'').toUpperCase()+"</span></div>"+
"    </div>"+
"    <div class='row' style='margin-top:10px'>"+
"      <input id='scan' class='input' placeholder='Escaneá o pegá un código y Enter'/>"+
"      <input id='find' class='input' placeholder='Buscar por descripción o código (filtra y auto-select)'/>"+
"      <button class='btn secondary' onclick='reload()'>Actualizar</button>"+
"      <a class='btn secondary' href='"+waHref+"' target='_blank'>WhatsApp</a>"+
"    </div>"+
"    <div style='margin-top:12px'>"+
"      <table><thead><tr><th>#</th><th>Descripción</th><th>Enviado</th><th>Recibido</th></tr></thead>"+
"      <tbody id='tb'>"+rowsHtml+"</tbody></table>"+
"    </div>"+
"    <div class='row' style='margin-top:12px'>"+
"      <textarea id='note' rows='3' class='input' placeholder='Observaciones (para Enviar diferencias)'></textarea>"+
"      <div class='row' style='margin-left:auto'>"+
"        <button class='btn' onclick='closeOk()'>OK Final</button>"+
"        <button class='btn secondary' onclick='sendDiff()'>Enviar diferencias</button>"+
"      </div>"+
"      <div id='msg' style='margin-left:auto;color:#059669'></div>"+
"    </div>"+
"    <div id='scanErr' style='color:#b91c1c;margin-top:8px'></div>"+
"  </div>"+
"  <div class='card'>"+
"    <div><b>PDF:</b> <a href='"+r.pdf+"' target='_blank'>"+r.pdf+"</a></div>"+
"    <iframe title='PDF' src='"+r.pdf+"' style='width:100%;height:520px;border:1px solid var(--line);border-radius:10px;margin-top:6px'></iframe>"+
"  </div>"+
"</div>"+
"<script>"+
"const BASE = location.origin.replace(':5173',':"+PORT+"'); const RID="+r.id+";"+
"function showMsg(t){const e=document.getElementById('msg');e.textContent=t;setTimeout(()=>e.textContent='',2500);}"+
"function cls(c){return c==='ok'?'ok':(c==='diferencias'?'diff':'pend');}"+
"async function reload(){const rr=await fetch(BASE+'/remitos/'+RID);const d=await rr.json();(d.items||[]).forEach((it,i)=>{const el=document.getElementById('rcv_'+i); if(el) el.value=it.received||0;});const st=document.getElementById('st'); st.textContent=String(d.status||'').toUpperCase(); st.className='pill '+cls(d.status||'pendiente');}"+
"document.getElementById('scan').addEventListener('keydown', async (e)=>{ if(e.key!=='Enter')return; const t=e.target.value.trim(); if(!t)return; e.target.value=''; const rr=await fetch(BASE+'/remitos/'+RID+'/scan',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:t})}); if(!rr.ok){const j=await rr.json().catch(async()=>({error:await rr.text()})); alert(j.error||'No se pudo registrar'); return;} const j=await rr.json(); const el=document.getElementById('rcv_'+j.item.index); if(el) el.value=j.item.received; const st=document.getElementById('st'); st.textContent=String(j.status||'').toUpperCase(); st.className='pill '+cls(j.status||'pendiente');});"+
"function fold(s){return String(s||'').toLowerCase().normalize('NFD').replace(/\\p{Diacritic}/gu,'');}"+
"document.getElementById('find').addEventListener('input',(e)=>{ const fq=fold(e.target.value); const rows=[...document.querySelectorAll('#tb tr')]; let first=null; rows.forEach(tr=>{ const text=(tr.getAttribute('data-desc')||'')+' '+(tr.getAttribute('data-codes')||''); const m=!fq||fold(text).includes(fq); tr.style.display=m?'':'none'; if(m && !first) first=tr; }); rows.forEach(tr=>tr.style.background=''); if(first){ first.style.background='#fffbe6'; first.scrollIntoView({behavior:'smooth',block:'center'});} });"+
"async function setRcv(i,val){ val=Math.max(0,parseInt(val||0)); const rr=await fetch(BASE+'/remitos/'+RID+'/set-received',{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({index:i,received:val})}); if(!rr.ok){alert('No se pudo actualizar'); return;} const j=await rr.json(); const st=document.getElementById('st'); st.textContent=String(j.status||'').toUpperCase(); st.className='pill '+cls(j.status||'pendiente'); }"+
"function step(i,delta){ const el=document.getElementById('rcv_'+i); const v=Math.max(0,parseInt(el.value||0)+delta); el.value=v; setRcv(i,v);}"+
"async function closeOk(){ const rr=await fetch(BASE+'/remitos/'+RID+'/close',{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'ok'})}); if(!rr.ok){const j=await rr.json().catch(()=>({})); alert(j.error||'No se pudo cerrar en OK'); return;} showMsg('Remito cerrado en OK'); reload(); }"+
"async function sendDiff(){ const note=document.getElementById('note').value||''; const rr=await fetch(BASE+'/remitos/'+RID+'/close',{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'diferencias', note})}); if(!rr.ok){ alert('No se pudo enviar diferencias'); return;} const j=await rr.json(); showMsg('Diferencias enviadas'); if(j.waAdmin) window.open(j.waAdmin,'_blank'); reload(); }"+
"</script></body></html>";

  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// ======= PDF =======
function generateRemitoPDF(remito, outPath){
  const doc = new PDFDocument({ size:"A4", margin:36 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fillColor("#0ea5e9").fontSize(18).text("REMITO DE TRANSPORTE DE MERCADERÍAS", { align:"center" });
  doc.moveDown(0.5);
  doc.fillColor("#111").fontSize(10).text("Empresa: Gonzalo Herna Yelmo Beltran");
  doc.text("CUIT: 20-30743247-2");
  doc.text("Actividad: Transporte de mercadería entre sucursales");
  doc.moveDown(0.5);

  const y0=doc.y;
  doc.fontSize(11).fillColor("#111");
  doc.text(`Remito Nº: ${remito.numero}`);
  doc.text(`Fecha: ${remito.fecha}`);
  doc.moveDown(0.2);
  doc.text(`Origen: ${remito.origin}`);
  doc.moveDown(0.2);
  doc.text(`Destino: ${remito.branch?.name||""} — ${remito.branch?.address||""}`);
  doc.moveTo(36,y0-6).lineTo(559,y0-6).strokeColor("#e5e7eb").stroke();

  doc.moveDown(0.6);
  const colX = { desc:36, qty:500, rcv:540 };
  doc.fillColor("#444").fontSize(10).text("Descripción", colX.desc, doc.y);
  doc.text("Cant.", colX.qty, doc.y, { width:40, align:"right" });
  doc.text("Rec.", colX.rcv, doc.y, { width:40, align:"right" });
  doc.moveDown(0.2);
  doc.moveTo(36,doc.y).lineTo(559,doc.y).strokeColor("#e5e7eb").stroke();

  doc.fontSize(11).fillColor("#111");
  remito.items.forEach(it=>{
    doc.text(it.description, colX.desc, doc.y+6, { width:440 });
    doc.text(String(it.qty), colX.qty, doc.y, { width:40, align:"right" });
    doc.text(String(it.received||0), colX.rcv, doc.y, { width:40, align:"right" });
    doc.moveDown(0.4);
    if(doc.y>760) doc.addPage();
  });

  if(remito.status==="diferencias" && (remito.note||"").trim()){
    doc.moveDown(1);
    doc.fillColor("#b91c1c").fontSize(12).text("Observaciones:", { underline:true });
    doc.fillColor("#111").fontSize(11).text(remito.note);
  }

  if(doc.y<680) doc.moveDown(2);
  doc.moveTo(80,760).lineTo(240,760).strokeColor("#e5e7eb").stroke();
  doc.text("Firma y Aclaración - Origen", 80, 765);
  doc.moveTo(330,760).lineTo(490,760).strokeColor("#e5e7eb").stroke();
  doc.text("Firma y Aclaración - Destino", 330, 765);

  doc.end();
}

// ======= START =======
app.listen(PORT, ()=> console.log(`API on ${PUBLIC_BASE_URL}`));
