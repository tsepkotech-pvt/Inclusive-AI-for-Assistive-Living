import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use(express.json());

  app.post("/api/notify", async (req, res) => {
    const { type } = req.body;
    const dashboardLink = process.env.APP_URL || "http://localhost:3000";
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    let subject = "";
    let text = "";

    if (type === 'START') {
      subject = "Monitoring Started";
      text = `Monitoring Started. You can view the live feed here: ${dashboardLink}`;
    } else if (type === 'EMERGENCY') {
      subject = "URGENT: FALL DETECTED";
      text = `URGENT: FALL DETECTED! Immediate attention required. View the live feed here: ${dashboardLink}`;
    }

    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: process.env.CAREGIVER_EMAIL,
        subject: subject,
        text: text,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Email Error:", error);
      res.status(500).json({ success: false, error: "Failed to send email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
