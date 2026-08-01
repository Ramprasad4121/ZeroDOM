import * as dotenv from "dotenv";
import { app } from "../src/server/mcp.js";

// Load environment variables from .env
dotenv.config();

const port = Number(process.env.ZERODOME_PORT || process.env.PORT || 4020);
const host = process.env.ZERODOME_HOST || "127.0.0.1";

console.log(`Starting ZeroDOM Express Server...`);

const server = app.listen(port, host, () => {
  console.log(`ZeroDOM Express Server is listening at http://${host}:${port}`);
  console.log(`- POST /request_task_card (Mint scoped cards)`);
  console.log(`- GET  /checkout          (Merchant payment checkout form)`);
  console.log(`- POST /charge            (Visa/Mastercard network charge processing)`);
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("Server shut down gracefully.");
    process.exit(0);
  });
});
