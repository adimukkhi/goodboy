import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
    res.json({
        status: "Server Running",
        time: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});