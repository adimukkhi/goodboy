import "dotenv/config";
import express from "express";
import { askAI, friendlyError } from "./ai.js";
import { SYSTEM_PROMPT, summaryPrompt, tutorSystemPrompt } from "./prompts.js";
import { loadHistory, saveToHistory } from "./history.js";
import { fileURLToPath } from "node:url";
import { quizPrompt, QUIZ_SCHEMA } from "./prompts.js";
import { streamAI } from "./ai.js";

const app = express();
const PORT = process.env.PORT || 3001;
const clientDust = fileURLToPath(new URL("../frontend/dist", import.meta.url));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(clientDust));

app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile("index.html", { root: clientDust }, (err) => err && next());
});

const MAX_NOTES = 30000;

app.get("/api/health", (req, res) => {
    res.json({
        status: "Server Running",
        time: new Date().toISOString()
    });
});


function readNotes(req, res) {
    const notes = String(req.body.notes || "").trim();
    if (notes.length < 50) {
        res.status(400).json({ error: "Minimum 50 characters required." });
    } if (notes.length > MAX_NOTES) {
        res.status(400).json({ error: `Too many notes, maximum of ${MAX_NOTES} notes.` });
    }

    return notes;
}

app.post("/api/summary", async (req, res) => {
    const notes = readNotes(req, res);
    if (!notes) return;

    try {
        const summary = await askAI({
            system: SYSTEM_PROMPT,
            prompt: summaryPrompt(notes)
        });

        await saveToHistory({ notes, summary });
        res.json({summary}); 
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: friendlyError(err) });
    }
});

app.post("/api/quiz", async (req, res) => {
    const notes = readNotes(req, res);
    if (!notes) return;

    const difficulty = ["easy", "medium", "hard"].includes(req.body.difficulty)
    ? req.body.difficulty
    : "medium";

    try {
        const json = await askAI({
            system: SYSTEM_PROMPT,
            prompt: quizPrompt(notes, difficulty),
            schema: QUIZ_SCHEMA,
        });

        res.json(JSON.parse(json));
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: friendlyError(err) });
    }
});


function cleanMessages(list) {
    const messages = (Array.isArray(list) ? list : [])
        .filter((m) => ["user", "assistant"].includes(m?.role))
        .filter((m) => typeof m.content === "string" && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-20);
    while (messages.length && messages[0].role !== "user") messages.shift();
    return messages;
}

app.post("/api/chat", async (req, res) => {
    const notes = readNotes(req, res);
    if (!notes) return;

    const messages = cleanMessages(req.body.messages);
    if (messages.at(-1)?.role !== "user") {
        return res.status(400).json({ error: "Type a question first." });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    try {
        await streamAI({
        system: tutorSystemPrompt(notes),
        messages,
        onText: (text) => res.write(text),
        });
    } catch (err) {
        console.error(err);
        res.write(`\n\n⚠ ${friendlyError(err)}`);
    }
    res.end();
});

app.get("/api/history", async (req, res) => {
    res.json(await loadHistory());
});


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});