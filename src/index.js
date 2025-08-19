import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("remitos.db");

// Tablas base
db.prepare(`CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  address TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  password TEXT,
  role TEXT
)`).run();

// Carpeta para PDFs
const filesDir = path.join(process.cwd(), "files");
if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir);

app.use("/files", express.static(filesDir));

// Seed endpoint
app.get("/seed", (req, res) => {
  // Insertar sucursales si están vacías
  const count = db.prepare("SELECT COUNT(*) as c FROM branches").get().c;
  if (count === 0) {
    const branches = [
      ["Adrogué", "Av. Hipólito Yrigoyen 13298, B1846 Adrogué"],
      ["Avellaneda Local", "Guemes (Alto Avellaneda)"],
      ["Avellaneda Stand", "Guemes (Alto Avellaneda)"],
      ["Lomas", "Av. Antártida Argentina, Portal Lomas"],
      ["Banfield Outlet", "Av. Larroque, Banfield"],
      ["Martínez Local", "Paraná, Unicenter"],
      ["Martínez Stand", "Paraná, Unicenter"],
      ["Plaza Oeste", "Av. Vergara, Morón"],
      ["Brown", "Fernández de la Cruz, Factory Parque Brown"],
      ["Abasto", "Av. Corrientes 3247, CABA"]
    ];
    const stmt = db.prepare("INSERT INTO branches (name, address) VALUES (?, ?)");
    for (const [n,a] of branches) stmt.run(n,a);
  }

  // PDF demo
  const pdfPath = path.join(filesDir, "Remito_demo.pdf");
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(pdfPath));
  doc.fontSize(18).text("REMITO DEMO", { align: "center" });
  doc.moveDown().fontSize(12).text("Fecha: " + dayjs().format("DD/MM/YYYY"));
  doc.text("Sucursal destino: Adrogué");
  doc.text("Producto: Auricular Redragon x2");
  doc.end();

  res.json({ ok: true, branches: 10, pdf_demo: "/files/Remito_demo.pdf" });
});

app.get("/branches", (req, res) => {
  res.json(db.prepare("SELECT * FROM branches").all());
});

const PORT = 4000;
app.listen(PORT, () => console.log("API on http://localhost:" + PORT));
