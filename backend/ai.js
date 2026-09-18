import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import "dotenv/config"

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.MODEL || "gemini-flash-lite-latest";

const COMMON = { maxOutputTokens: 4096, thinkingConfig: {thinkingLevel: "LOW"} };

const RETRY_STATUSES = [500, 502, 503, 504];
const MAX_ATTEMPTS = 3;

function toContents(msg) {
    return msg.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
    }));
}

function checkBlocked(response) {
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
        throw new Error(`The AI declined this request (${blockReason}). Try different notes.`);
    }
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && !["STOP", "MAX_TOKENS"].includes(finishReason)) {
        throw new Error(`The AI stopped early (${finishReason}). Try different notes.`);
    }
}

async function withRetry(run) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await run();
        } catch (err) {
        if (!RETRY_STATUSES.includes(err?.status) || attempt >= MAX_ATTEMPTS) throw err;
            const waitMs = 600 * 2 ** (attempt - 1);
            console.warn(`Gemini ${err.status} — retrying in ${waitMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
}

export async function askAI({ system, prompt, schema }) {
    const config = { ...COMMON, systemInstruction: system }
    if (schema) {
        config.responseMimeType = "application/json";
        config.responseJsonSchema = schema;
    }

    const response = await client.models.generateContent({
        model: MODEL,
        contents: toContents([{ role: "user", content: prompt }]),
        config
    });

    checkBlocked(response);

    const text = response.text ?? "";
    if (!text.trim()) throw new Error("AI Returned empty answer.");
    return text;
}

export function friendlyError(err) {
    if (!process.env.GEMINI_API_KEY) {
        return "No API key found. Add GEMINI_API_KEY to server/.env and restart the server.";
    }

    const status = err instanceof ApiError ? err.status : err?.status;
    const detail = err?.message || "";

    if (status === 401 || status === 403 || /API key not valid/i.test(detail)) {
        return "The API key is missing or wrong. Check GEMINI_API_KEY in server/.env.";
    }

    if (status === 429) {
        const seconds =
        detail.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ||
        detail.match(/retry in ([\d.]+)s/)?.[1];
        const wait = seconds ? `${Math.ceil(Number(seconds))} seconds` : "a minute";
        return `Free-tier limit reached for this model. Try again in ${wait}.`;
    }

    if (status >= 500) {
        return `AI service error (${status}). Try again in a moment.`;
    }

    if (status === 400) {
        return `AI service rejected the request: ${detail}`;
    }

    if (err?.name === "ConnectionError" || /fetch failed|ENOTFOUND/i.test(detail)) {
        return "Can't reach the AI service. Check your internet connection.";
    }

    return detail || "Something went wrong.";
}

export async function streamAI({ system, messages, onText }) {
    const stream = await client.models.generateContentStream({
        model: MODEL,
        contents: toContents(messages),
        config: { ...COMMON, systemInstruction: system }
    });

    let sawText = false;
    for await (const chunk of stream) {
        const piece = chunk.text;

        if (piece) {
            sawText = true;
            onText(piece);
        }
    }

    if (!sawText) onText("(The AI declined to answer this one.)");
}

