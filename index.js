// server/index.js  (ESM)
import express from "express";
import cors from "cors";
import fs from "fs";
import * as path from "path";
import PDFDocument from "pdfkit";
import multer from "multer";
import xlsx from "xlsx";
import fsExtra from "fs-extra";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== Paths con persistencia en Render (Disk) ======
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const DATA_FILE = path.join(STORAGE_DIR, "data.json");
const PDF_DIR = path.join(STORAGE_DIR, "pdf");
const UP_DIR = path.join(STORAGE_DIR, "uploads");

const app = express();
const PORT = process.env.PORT || 4000;

// ====== Utils DB ======
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    return { branches: [], products: [], remitos: [], counters: { remito: 3804 } };
  }
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    // migraciones suaves
    db.branches = (db.branches || []).map((b, i) => ({
      id: b.id ?? i + 1,
      name: b.name || "",
      address: b.address || "",
      phone: b.phone || "" // nuevo
    }));
    db.products = (db.products || []).map(p => ({
      id: p.id,
      description: p.description || "",
      codes: Array.isArray(p.codes) ? p.codes : []
    }));
    db.remitos = (db.remitos || []).map(r => ({
      ...r,
      items: (r.items || []).map(it => ({
        description: it.description || "",
        qty: parseInt(it.qty, 10) || 0,
        received: parseInt(it.received, 10) || 0
      })),
      status: r.status || "pendiente"
    }));
    db.counters = db.counters || { remito: 3804 };
    return db;
  } catch {
    return { branches: [], products: [], remitos: [], counters: { remito: 3804 } };
  }
}
function saveDB(db) {
  fsExtra.ensureDirSync(path.dirname(DATA_FILE));
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}
function nextRemitoNumber(db) {
  db.counters = db.counters || {};
  if (typeof db.counters.remito !== "number") db.counters.remito = 3804;
  db.counters.remito += 1;
  return db.counters.remito;
}
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const looksCode = (s) => /^\d{6,}$/.test(String(s || "").replace(/\s+/g, ""));

// ====== Setup ======
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: ["http://localhost:5173", /\.vercel\.app$/, /\.onrender\.com$/], credentials: false }));

fsExtra.ensureDirSync(PDF_DIR);
fsExtra.ensureDirSync(UP_DIR);

// servir PDFs estáticos
app.use("/pdf", express.static(PDF_DIR));

// ====== Seed sucursales ======
app.get("/seed", (req, res) => {
  const db = loadDB();
  if (db.branches && db.branches.length > 0) {
    return res.send("Seed ya ejecutado.");
  }
  db.branches = [
    { id: 1,  name: "Adrogué",             address: "Av. Hipólito Yrigoyen 13298, Adrogué",                             phone: "" },
    { id: 2,  name: "Avellaneda Local",    address: "Güemes 897, Alto Avellaneda, Avellaneda",                          phone: "" },
    { id: 3,  name: "Avellaneda Stand",    address: "Güemes 897, Alto Avellaneda (Stand), Avellaneda",                  phone: "" },
    { id: 4,  name: "Banfield Outlet",     address: "Av. Larroque, Banfield",                                           phone: "" },
    { id: 5,  name: "Brown",               address: "Av. Fernández de la Cruz 4602, Factory Parque Brown, CABA",        phone: "" },
    { id: 6,  name: "Lomas",               address: "Av. Antártida Argentina 799, Portal Lomas, Lomas de Zamora",       phone: "" },
    { id: 7,  name: "Martínez Local",      address: "Paraná 3745, Unicenter, Martínez",                                  phone: "" },
    { id: 8,  name: "Martínez Stand",      address: "Paraná 3745, Unicenter (Stand), Martínez",                          phone: "" },
    { id: 9,  name: "Plaza Oeste",         address: "Av. Vergara, Morón",                                                phone: "" },
    { id: 10, name: "Abasto",              address: "Av. Corrientes 3247, CABA",                                         phone: "" }
  ];
  saveDB(db);
  res.send("OK: sucursales creadas.");
});

// ====== Branches ======
app.get("/branches", (req, res) => {
  const db = loadDB();
  res.json(db.branches || []);
});
app.post("/branches/add", (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const phone = String(req.body.phone || "").trim();
  if (!name) return res.status(400).json({ error: "Nombre requerido" });

  const id = (db.branches?.reduce((m, b) => Math.max(m, b.id), 0) || 0) + 1;
  db.branches = db.branches || [];
  db.branches.push({ id, name, address, phone });
  saveDB(db);
  res.json({ ok: true, branch: { id, name, address, phone } });
});
app.post("/branches/:id/update", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const phone = String(req.body.phone || "").trim();
  const b = (db.branches || []).find(x => x.id === id);
  if (!b) return res.status(404).json({ error: "Sucursal no existe" });
  if (!name) return res.status(400).json({ error: "Nombre requerido" });

  b.name = name;
  b.address = address;
  b.phone = phone;
  saveDB(db);
  res.json({ ok: true, branch: b });
});
app.post("/branches/:id/delete", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const before = db.branches?.length || 0;
  db.branches = (db.branches || []).filter(x => x.id !== id);
  const after = db.branches.length;
  saveDB(db);
  res.json({ ok: true, removed: before - after });
});

// ====== Productos ======
// GET /products?q=  (busca por descripción o fragmento de código)
app.get("/products", (req, res) => {
  const db = loadDB();
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.json((db.products || []).map(p => ({ id: p.id, description: p.description, codes: p.codes || [] })));
  }
  const qn = norm(q);
  const list = (db.products || [])
    .filter(p => norm(p.description).includes(qn) || (p.codes || []).some(c => String(c).includes(q)))
    .map(p => ({ id: p.id, description: p.description, codes: p.codes || [] }));
  res.json(list);
});

app.get("/products/by-code/:code", (req, res) => {
  const db = loadDB();
  const code = String(req.params.code || "").trim();
  const product = (db.products || []).find(p => (p.codes || []).includes(code));
  if (!product) return res.status(404).json({ error: "Código no encontrado", reason: "unknown_code" });
  res.json({ product: { id: product.id, description: product.description, codes: product.codes || [] } });
});

app.post("/products", (req, res) => {
  const db = loadDB();
  const description = String(req.body.description || "").trim();
  const code = req.body.code ? String(req.body.code).trim() : "";
  if (!description) return res.status(400).json({ error: "Descripción requerida" });

  const id = (db.products?.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
  const codes = [];
  if (code) {
    const dup = (db.products || []).some(p => (p.codes || []).includes(code));
    if (dup) return res.status(400).json({ error: "Código ya existente" });
    codes.push(code);
  }
  db.products = db.products || [];
  db.products.push({ id, description, codes });
  saveDB(db);
  res.json({ ok: true, id });
});

app.post("/products/:id/update", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const description = String(req.body.description || "").trim();
  const p = (db.products || []).find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "No existe" });
  if (!description) return res.status(400).json({ error: "Descripción requerida" });
  p.description = description;
  saveDB(db);
  res.json({ ok: true });
});

app.post("/products/:id/addCode", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const code = String(req.body.code || "").trim();
  const p = (db.products || []).find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "No existe" });
  if (!code) return res.status(400).json({ error: "Código requerido" });
  p.codes = p.codes || [];
  if (p.codes.length >= 3) return res.status(400).json({ error: "Máximo 3 códigos" });
  const dup = (db.products || []).some(x => (x.codes || []).includes(code));
  if (dup) return res.status(400).json({ error: "Código ya vinculado a otro producto" });
  p.codes.push(code);
  saveDB(db);
  res.json({ ok: true, codes: p.codes });
});

app.post("/products/:id/removeCode", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const code = String(req.body.code || "").trim();
  const p = (db.products || []).find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "No existe" });
  p.codes = (p.codes || []).filter(c => c !== code);
  saveDB(db);
  res.json({ ok: true, codes: p.codes });
});

app.post("/products/:id/delete", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const before = db.products?.length || 0;
  db.products = (db.products || []).filter(x => x.id !== id);
  const after = db.products.length;
  saveDB(db);
  res.json({ ok: true, removed: before - after });
});

// ====== Importar XLSX ======
const upload = multer({ dest: UP_DIR });

app.get("/admin/products-xlsx", (req, res) => {
  const msg = req.query.msg ? decodeURIComponent(req.query.msg) : "";
  res.send(`
    <html><head><meta charset="utf-8"><title>Importar productos (.xlsx)</title>
    <style>
      body{font-family:system-ui;padding:20px}
      input,button{padding:8px}
      .card{border:1px solid #e5e7eb;border-radius:10px;padding:12px;max-width:720px}
      pre{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px;overflow:auto}
    </style>
    </head>
    <body>
      <h2>Importar productos (.xlsx)</h2>
      <div class="card">
        <p>Formato de columnas (primera hoja):</p>
        <ul>
          <li><b>A</b>: código1</li>
          <li><b>B</b>: código2</li>
          <li><b>C</b>: código3</li>
          <li><b>D</b>: descripción</li>
        </ul>
        <p><i>La primera fila puede ser encabezado.</i></p>
        <form method="POST" action="/admin/products-xlsx" enctype="multipart/form-data">
          <input type="file" name="file" accept=".xlsx,.xls" required />
          <button type="submit">Subir</button>
        </form>
      </div>
      ${msg ? `<h3>Resultados</h3><pre>${msg}</pre>` : ""}
    </body></html>
  `);
});

app.post("/admin/products-xlsx", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  if (!filePath) return res.status(400).send("Archivo requerido");
  let summary = { totalRows: 0, headerSkipped: false, created: 0, codesAdded: 0, duplicatesSkipped: 0, invalidRows: 0 };

  try {
    const wb = xlsx.readFile(filePath, { cellDates: false, cellText: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("La primera hoja del Excel está vacía");

    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true });
    const db = loadDB();
    db.products = db.products || [];

    const first = rows[0] || [];
    const looksHeader =
      (String(first[0] || "").toLowerCase().includes("cod") || isNaN(Number(first[0]))) &&
      (String(first[3] || "").toLowerCase().includes("desc") || typeof first[3] === "string");

    let start = 0;
    if (looksHeader) { summary.headerSkipped = true; start = 1; }

    for (let i = start; i < rows.length; i++) {
      const row = rows[i] || [];
      summary.totalRows++;

      const c1 = String(row[0] ?? "").trim();
      const c2 = String(row[1] ?? "").trim();
      const c3 = String(row[2] ?? "").trim();
      const desc = String(row[3] ?? "").trim();

      if (!desc && !c1 && !c2 && !c3) { continue; }
      if (!desc) { summary.invalidRows++; continue; }

      const pnorm = (s) => String(s||"").trim().replace(/\s+/g," ").toLowerCase();
      let p = db.products.find(x => pnorm(x.description) === pnorm(desc));
      if (!p) {
        const id = (db.products.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1;
        p = { id, description: desc, codes: [] };
        db.products.push(p);
        summary.created++;
      }
      p.codes = p.codes || [];
      const candidate = [c1,c2,c3].filter(Boolean);
      for (const code of candidate) {
        const dup = db.products.some(x => x !== p && (x.codes || []).includes(code));
        if (dup) { summary.duplicatesSkipped++; continue; }
        if (!p.codes.includes(code) && p.codes.length < 3) {
          p.codes.push(code);
          summary.codesAdded++;
        }
      }
    }

    saveDB(db);
    const msg = [
      `Filas leídas (sin contar encabezado): ${summary.totalRows}`,
      `Encabezado detectado: ${summary.headerSkipped ? "Sí" : "No"}`,
      `Productos creados: ${summary.created}`,
      `Códigos agregados: ${summary.codesAdded}`,
      `Códigos duplicados (saltados): ${summary.duplicatesSkipped}`,
      `Filas inválidas (sin descripción): ${summary.invalidRows}`
    ].join("\n");

    res.redirect(`/admin/products-xlsx?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error leyendo XLSX: " + e.message);
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
});

// Panel simple (opcional)
app.get("/admin/products-manage", (req, res) => {
  res.send(`
    <html><head><meta charset="utf-8"><title>Productos (gestión)</title>
    <style>
      body{font-family:system-ui;padding:16px}
      input,button{padding:8px}
      table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #ddd;padding:8px}
    </style>
    </head>
    <body>
      <h2>Productos</h2>
      <div style="margin-bottom:10px">
        <input id="q" placeholder="Buscar..." />
        <button onclick="load()">Buscar</button>
        <a href="/admin/products-xlsx" target="_blank">Importar .xlsx</a>
      </div>
      <table>
        <thead><tr><th>Descripción</th><th>Códigos</th><th>Acciones</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
      <script>
        async function load(){
          const q = document.getElementById('q').value;
          const r = await fetch('/products'+(q?'?q='+encodeURIComponent(q):''));
          const data = await r.json();
          const tb = document.getElementById('tbody');
          tb.innerHTML = '';
          data.forEach(p=>{
            const tr = document.createElement('tr');
            tr.innerHTML = '<td><input style="width:95%" value="'+(p.description||'')+'" onblur="upd('+p.id+', this.value)"/></td>'+
                           '<td>'+( (p.codes||[]).join(' · ') || '—')+'</td>'+
                           '<td><button onclick="delP('+p.id+')">Eliminar</button></td>';
            tb.appendChild(tr);
          });
        }
        async function upd(id, description){
          await fetch('/products/'+id+'/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description})});
        }
        async function delP(id){
          if(!confirm('¿Eliminar producto?'))return;
          await fetch('/products/'+id+'/delete',{method:'POST'});
          load();
        }
        load();
      </script>
    </body></html>
  `);
});

// ====== Remitos ======
app.post("/remitos", (req, res) => {
  const db = loadDB();
  const { branch, origin, date, items } = req.body || {};
  if (!branch?.id) return res.status(400).json({ error: "branch requerido" });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items vacío" });

  const numero = nextRemitoNumber(db);
  const id = (db.remitos?.reduce((m, r) => Math.max(m, r.id), 0) || 0) + 1;

  const normItems = items.map(x => ({
    description: String(x.description || "").trim(),
    qty: parseInt(x.qty, 10) || 0,
    received: 0
  }));

  const branchFull = (db.branches || []).find(b => b.id === Number(branch.id)) || branch;

  const remito = {
    id,
    numero,
    fecha: date || new Date().toISOString().slice(0,10),
    origin: String(origin || "Juan Manuel de Rosas 1325"),
    branch: { id: branchFull.id, name: branchFull.name, address: branchFull.address || "", phone: branchFull.phone || "" },
    items: normItems,
    status: "pendiente",
    note: ""
  };

  const pdfRel = `/pdf/remito_${numero}.pdf`;
  const pdfAbs = path.join(PDF_DIR, `remito_${numero}.pdf`);
  generateRemitoPDF(remito, pdfAbs);

  remito.pdf = pdfRel;
  remito.publicUrl = `/r/${id}`;

  db.remitos = db.remitos || [];
  db.remitos.push(remito);
  saveDB(db);

  res.json({ ok: true, id, numero, pdf: pdfRel, publicUrl: remito.publicUrl });
});

app.get("/remitos", (req, res) => {
  const db = loadDB();
  const list = (db.remitos || []).map(r => ({
    id: r.id,
    numero: r.numero,
    fecha: r.fecha,
    branch: r.branch,
    origin: r.origin,
    pdf: r.pdf,
    publicUrl: r.publicUrl,
    status: r.status
  }));
  list.sort((a,b)=> b.id - a.id);
  res.json(list);
});

app.get("/remitos/:id", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const r = (db.remitos || []).find(x => x.id === id);
  if (!r) return res.status(404).json({ error: "No existe" });
  res.json(r);
});

// Scan en recepción
app.post("/remitos/:id/scan", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const code = String(req.body.code || "").trim();
  const remito = (db.remitos || []).find(x => x.id === id);
  if (!remito) return res.status(404).json({ error: "No existe" });
  if (!code) return res.status(400).json({ error: "Código requerido" });

  const prod = (db.products || []).find(p => (p.codes || []).includes(code));
  if (!prod) {
    return res.status(404).json({ error: "Código no encontrado", reason: "unknown_code" });
  }

  const idx = remito.items.findIndex(it => norm(it.description) === norm(prod.description));
  if (idx === -1) {
    return res.status(400).json({ error: "Producto no figura en el remito", reason: "not_in_remito" });
  }

  const it = remito.items[idx];
  it.received = Math.min(it.qty, (parseInt(it.received,10) || 0) + 1);

  const allOk = remito.items.every(x => (parseInt(x.received,10)||0) === (parseInt(x.qty,10)||0));
  const anyOver = remito.items.some(x => (parseInt(x.received,10)||0) > (parseInt(x.qty,10)||0));
  const anyDiff = remito.items.some(x => (parseInt(x.received,10)||0) !== (parseInt(x.qty,10)||0));
  remito.status = allOk && !anyOver ? "ok" : (anyDiff ? "diferencias" : "pendiente");

  saveDB(db);
  res.json({ ok: true, item: { index: idx, description: it.description, qty: it.qty, received: it.received }, status: remito.status });
});

// Cierre OK o diferencias
app.post("/remitos/:id/close", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const { action, note } = req.body || {};
  const remito = (db.remitos || []).find(x => x.id === id);
  if (!remito) return res.status(404).json({ error: "No existe" });

  if (action === "ok") {
    const allOk = remito.items.every(x => (parseInt(x.received,10)||0) === (parseInt(x.qty,10)||0));
    if (!allOk) return res.status(400).json({ error: "No coincide todo; hay diferencias" });
    remito.status = "ok";
    remito.note = "";
  } else if (action === "diferencias") {
    remito.status = "diferencias";
    remito.note = String(note || "");
  } else {
    return res.status(400).json({ error: "action inválida" });
  }
  saveDB(db);
  res.json({ ok: true, status: remito.status });
});

// ====== Página pública /r/:id (recepción) ======
app.get("/r/:id", (req, res) => {
  const db = loadDB();
  const id = Number(req.params.id);
  const r = (db.remitos || []).find(x => x.id === id);
  if (!r) return res.status(404).send("Remito inexistente");

  const waBase = r.branch?.phone ? `https://wa.me/549${(r.branch.phone||'').replace(/\D/g,'')}` : `https://wa.me/`;
  const waText = `Remito ${r.numero} ${req.protocol}://${req.get('host')}${r.publicUrl}`;
  const waHref = `${waBase}?text=${encodeURIComponent(waText)}`;

  const html = `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Recepción de Remito ${r.numero}</title>
<style>
  :root{ --line:#e2e8f0; --muted:#64748b; --primary:#0ea5e9; }
  body{font-family:system-ui;margin:0;background:#f6faff;color:#0f172a}
  .wrap{max-width:900px;margin:0 auto;padding:16px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}
  .row{display:flex;gap:10px;align-items:center}
  .input{padding:10px;border:1px solid var(--line);border-radius:10px;width:100%}
  .btn{padding:10px 14px;border-radius:10px;border:1px solid var(--primary);background:var(--primary);color:#fff;cursor:pointer}
  .btn.secondary{background:#fff;color:var(--primary)}
  table{border-collapse:collapse;width:100%}
  td,th{border-top:1px solid var(--line);padding:8px}
  thead th{background:#f1f5f9}
  .pill{padding:4px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px}
  .pill.ok{background:#ecfeff}
  .pill.diff{background:#fff1f2}
  .pill.pend{background:#fff7ed}
  .modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;z-index:50}
  .modal{width:min(680px,92vw);background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}
</style>
</head>
<body>
<div class="wrap">
  <h2>Recepción — Remito ${r.numero}</h2>
  <div class="card">
    <div class="row" style="flex-wrap:wrap">
      <div><b>Fecha:</b> ${r.fecha}</div>
      <div><b>Origen:</b> ${r.origin}</div>
      <div><b>Destino:</b> ${r.branch?.name || ""}</div>
      <div><b>Estado:</b> <span id="st" class="pill ${r.status==="ok"?"ok":r.status==="diferencias"?"diff":"pend"}">${String(r.status).toUpperCase()}</span></div>
      <div style="margin-left:auto"><a class="btn secondary" href="${waHref}" target="_blank">WhatsApp</a></div>
    </div>

    <div class="row" style="margin-top:10px; flex-wrap:wrap">
      <input id="scan" class="input" placeholder="Escaneá o pegá un código y Enter" />
      <input id="find" class="input" placeholder="Buscar por descripción (filtra la tabla)" />
      <button class="btn secondary" onclick="reload()">Actualizar</button>
    </div>

    <div style="margin-top:12px">
      <table>
        <thead><tr><th>#</th><th>Descripción</th><th>Enviado</th><th>Recibido</th></tr></thead>
        <tbody id="tb">
          ${(r.items||[]).map((it,i)=>`
            <tr data-desc="${(it.description||"").replace(/"/g,'&quot;')}"><td>${i+1}</td><td>${it.description}</td><td>${it.qty}</td><td id="rcv_${i}">${it.received||0}</td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="closeOk()">OK Final</button>
      <button class="btn secondary" onclick="sendDiff()">Enviar diferencias</button>
      <div id="msg" style="margin-left:auto;color:#059669"></div>
    </div>
    <div id="scanErr" style="color:#b91c1c;margin-top:8px"></div>
  </div>

  <div class="card" style="margin-top:12px">
    <div><b>PDF:</b> <a href="${r.pdf}" target="_blank">${r.pdf}</a></div>
    <iframe title="PDF" src="${r.pdf}" style="width:100%;height:520px;border:1px solid var(--line);border-radius:10px;margin-top:6px"></iframe>
  </div>
</div>

<!-- Modal Crear/Vincular código desconocido -->
<div id="u-backdrop" class="modal-backdrop">
  <div class="modal">
    <h3>El código <code id="u-code"></code> no existe</h3>
    <div class="row" style="margin:8px 0">
      <button id="u-tab-create" class="btn">➕ Crear producto</button>
      <button id="u-tab-link" class="btn secondary">🔗 Vincular a existente</button>
      <span style="flex:1"></span>
      <button id="u-close" class="btn secondary">Cerrar</button>
    </div>
    <div id="u-create">
      <label>Descripción</label>
      <input id="u-desc" type="text" class="input"/>
      <div class="row" style="margin-top:10px"><button id="u-create-go" class="btn">Crear</button></div>
    </div>
    <div id="u-link" style="display:none">
      <label>Buscar producto</label>
      <input id="u-q" type="text" class="input" placeholder="Escribí parte del nombre o código"/>
      <div id="u-list" style="max-height:260px;overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:10px;padding:6px"></div>
    </div>
  </div>
</div>

<script>
  const BASE = location.origin.replace(':5173', ':4000');
  const RID = ${r.id};

  function showMsg(t){ const e=document.getElementById('msg'); e.textContent=t; setTimeout(()=>e.textContent='', 2500); }
  function showErr(id, t){ const e=document.getElementById(id); e.textContent=t; setTimeout(()=>e.textContent='', 2500); }
  function cls(c){ return c==='ok'?'ok':(c==='diferencias'?'diff':'pend'); }

  async function reload(){
    const r = await fetch(\`\${BASE}/remitos/\${RID}\`);
    const data = await r.json();
    (data.items||[]).forEach((it,i)=>{
      const td = document.getElementById('rcv_'+i);
      if (td) td.textContent = it.received||0;
    });
    const st = document.getElementById('st');
    st.textContent = String(data.status||'').toUpperCase();
    st.className = 'pill '+cls(data.status||'pendiente');
  }

  // Escaneo (Enter)
  document.getElementById('scan').addEventListener('keydown', async (e)=>{
    if (e.key !== 'Enter') return;
    const t = e.target.value.trim();
    if (!t) return;
    e.target.value = '';
    document.getElementById('scanErr').textContent = '';

    const r = await fetch(\`\${BASE}/remitos/\${RID}/scan\`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: t })
    });

    if(!r.ok){
      const j=await r.json().catch(async()=>({error:await r.text()}));
      if(j.reason==="unknown_code"){
        ensureUnknownModal();
        openUnknownModal(t);
        return;
      } else if (j.reason==="not_in_remito") {
        alert("El producto existe, pero no está en este remito.");
        return;
      } else {
        showErr("scanErr", j.error || "No se pudo registrar"); return;
      }
    }

    const j = await r.json();
    if (j?.item){
      const td = document.getElementById('rcv_'+j.item.index);
      if (td) td.textContent = j.item.received;
    }
    const st = document.getElementById('st');
    st.textContent = String(j.status||'').toUpperCase();
    st.className = 'pill '+cls(j.status||'pendiente');
  });

  // Buscar (filtra tabla por descripción)
  document.getElementById('find').addEventListener('input', (e)=>{
    const q = e.target.value.trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll('#tb tr'));
    rows.forEach(tr=>{
      const desc = (tr.getAttribute('data-desc')||'').toLowerCase();
      tr.style.display = q ? (desc.includes(q) ? '' : 'none') : '';
    });
  });

  async function closeOk(){
    const r = await fetch(\`\${BASE}/remitos/\${RID}/close\`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'ok' }) });
    if(!r.ok){ const j=await r.json().catch(()=>({})); alert(j.error||'No se pudo cerrar en OK'); return; }
    showMsg('Remito cerrado en OK');
    reload();
  }
  async function sendDiff(){
    const note = prompt('Describí las diferencias:','');
    if (note===null) return;
    const r = await fetch(\`\${BASE}/remitos/\${RID}/close\`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'diferencias', note }) });
    if(!r.ok){ const j=await r.json().catch(()=>({})); alert(j.error||'No se pudo enviar diferencias'); return; }
    showMsg('Diferencias enviadas');
    reload();
  }

  // ===== Modal Crear/Vincular código desconocido =====
  function ensureUnknownModal(){
    if (document.getElementById("u-backdrop").dataset.ready==="1") return;
    document.getElementById("u-close").onclick = closeUnknownModal;
    document.getElementById("u-tab-create").onclick = ()=>{ 
      document.getElementById("u-create").style.display="block";
      document.getElementById("u-link").style.display="none";
      document.getElementById("u-tab-create").className="btn";
      document.getElementById("u-tab-link").className="btn secondary";
    };
    document.getElementById("u-tab-link").onclick = ()=>{ 
      document.getElementById("u-create").style.display="none";
      document.getElementById("u-link").style.display="block";
      document.getElementById("u-tab-create").className="btn secondary";
      document.getElementById("u-tab-link").className="btn";
    };
    document.getElementById("u-create-go").onclick = async ()=>{
      const code = document.getElementById("u-backdrop").dataset.code;
      const desc = document.getElementById("u-desc").value.trim();
      if(!desc){ alert("Escribí la descripción"); return; }
      const r2 = await fetch(\`\${BASE}/products\`, {
        method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ description: desc, code })
      });
      if(!r2.ok){ alert("No pude crear el producto"); return; }
      alert("Producto creado. Volvé a escanear el ítem.");
      closeUnknownModal();
    };
    document.getElementById("u-q").addEventListener("input", ()=>{
      const q = document.getElementById("u-q").value;
      clearTimeout(window.__u_t);
      window.__u_t = setTimeout(async ()=>{
        const r = await fetch(\`\${BASE}/products?q=\${encodeURIComponent(q)}\`);
        const data = await r.json().catch(()=>[]);
        const list = Array.isArray(data)?data:[];
        const wrap = document.getElementById("u-list");
        wrap.innerHTML = list.length? "" : "<div style='color:#64748b'>Sin resultados</div>";
        list.slice(0,50).forEach(p=>{
          const row = document.createElement("div");
          row.style.padding="8px";
          row.style.borderTop="1px solid #eef2f7";
          row.innerHTML = \`<div style="font-weight:600">\${p.description}</div><div style="color:#64748b;font-size:12px">\${(p.codes||[]).join(" · ")||"—"}</div>\`;
          row.onclick = async ()=>{
            const r3 = await fetch(\`\${BASE}/products/\${p.id}/addCode\`, {
              method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: document.getElementById("u-backdrop").dataset.code })
            });
            if(!r3.ok){ alert("No se pudo vincular (¿repetido o >3?)"); return; }
            alert("Código vinculado. Volvé a escanear el ítem.");
            closeUnknownModal();
          };
          wrap.appendChild(row);
        });
      }, 180);
    });
    document.getElementById("u-backdrop").dataset.ready="1";
  }
  function openUnknownModal(code){
    const b = document.getElementById("u-backdrop");
    document.getElementById("u-code").textContent = code;
    document.getElementById("u-desc").value = "";
    document.getElementById("u-q").value = "";
    document.getElementById("u-list").innerHTML = "";
    b.style.display = "flex";
    b.dataset.code = code;
  }
  function closeUnknownModal(){
    const b = document.getElementById("u-backdrop");
    if (b) b.style.display = "none";
  }
</script>
</body></html>
  `;
  res.send(html);
});

// ====== PDF generator ======
function generateRemitoPDF(remito, outPath) {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // Encabezado
  doc.fillColor("#0ea5e9").fontSize(18).text("REMITO DE TRANSPORTE DE MERCADERÍAS", { align: "center" });
  doc.moveDown(0.5);
  doc.fillColor("#111").fontSize(10).text("Empresa: Gonzalo Herna Yelmo Beltran", { align: "left" });
  doc.text("CUIT: 20-30743247-2");
  doc.text("Actividad: Transporte de mercadería entre sucursales");
  doc.moveDown(0.5);

  // Datos remito
  const y0 = doc.y;
  doc.fontSize(11).fillColor("#111");
  doc.text(`Remito Nº: ${remito.numero}`);
  doc.text(`Fecha: ${remito.fecha}`);
  doc.moveDown(0.2);
  doc.text(`Origen: ${remito.origin}`);
  doc.moveDown(0.2);
  doc.text(`Destino: ${remito.branch?.name || ""} — ${remito.branch?.address || ""}`);
  doc.moveTo(36, y0-6).lineTo(559, y0-6).strokeColor("#e5e7eb").stroke();

  // Tabla
  doc.moveDown(0.6);
  const colX = { desc: 36, qty: 500 };
  doc.fillColor("#444").fontSize(10).text("Descripción", colX.desc, doc.y);
  doc.text("Cantidad", colX.qty, doc.y, { width: 80, align: "right" });
  doc.moveDown(0.2);
  doc.moveTo(36, doc.y).lineTo(559, doc.y).strokeColor("#e5e7eb").stroke();

  doc.fontSize(11).fillColor("#111");
  remito.items.forEach((it) => {
    doc.text(it.description, colX.desc, doc.y + 6, { width: 440 });
    doc.text(String(it.qty), colX.qty, doc.y, { width: 80, align: "right" });
    doc.moveDown(0.4);
    if (doc.y > 760) doc.addPage();
  });

  // Firmas
  if (doc.y < 680) doc.moveDown(2);
  doc.moveTo(80, 760).lineTo(240, 760).strokeColor("#e5e7eb").stroke();
  doc.text("Firma y Aclaración - Origen", 80, 765);
  doc.moveTo(330, 760).lineTo(490, 760).strokeColor("#e5e7eb").stroke();
  doc.text("Firma y Aclaración - Destino", 330, 765);

  doc.end();
}

// ====== start ======
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
