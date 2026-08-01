import * as fs from "node:fs";

const LOG_FILE = "audit-log-hackathon.json";

function drawDashboard() {
  console.clear();
  
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  console.log(`${BOLD}================================================================================${RESET}`);
  console.log(`                               ${BOLD}ZeroDOM Audit Dashboard${RESET}                              `);
  console.log(`${BOLD}================================================================================${RESET}\n`);

  if (!fs.existsSync(LOG_FILE)) {
    console.log(`${DIM}[i] No audit logs generated yet. Waiting for events...${RESET}\n`);
    console.log(`${BOLD}Active Cards:${RESET}\n  (None)\n`);
    console.log(`${BOLD}Live Audit Trail:${RESET}\n  (None)\n`);
    return;
  }

  try {
    const raw = fs.readFileSync(LOG_FILE, "utf8");
    const logs = JSON.parse(raw);

    // 1. Calculate Active Cards from events
    const activeCards = new Map<string, { account_id: string; timestamp: string }>();
    for (const entry of logs) {
      if (entry.event_type === "mint") {
        activeCards.set(entry.card_id, {
          account_id: entry.account_id,
          timestamp: entry.timestamp
        });
      } else if (entry.event_type === "revocation") {
        activeCards.delete(entry.card_id);
      }
    }

    // Print Active Cards
    console.log(`${BOLD}Active Cards:${RESET}`);
    if (activeCards.size === 0) {
      console.log(`  ${DIM}(None)${RESET}`);
    } else {
      activeCards.forEach((details, cardId) => {
        console.log(`  - Card ID: ${BOLD}${cardId}${RESET} | Account: ${details.account_id} | Minted: ${DIM}${new Date(details.timestamp).toLocaleTimeString()}${RESET}`);
      });
    }
    console.log("");

    // 2. Print Live Audit Trail (last 15 events, newest first)
    console.log(`${BOLD}Live Audit Trail:${RESET}`);
    const last15 = logs.slice(-15).reverse();
    if (last15.length === 0) {
      console.log(`  ${DIM}(None)${RESET}`);
    } else {
      for (const entry of last15) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        let message = "";

        if (entry.event_type === "mint") {
          message = `[MINT] ${DIM}${time}${RESET} Card ${BOLD}${entry.card_id}${RESET} minted for account ${entry.account_id}`;
        } else if (entry.event_type === "revocation") {
          message = `[!] REVOKED ${DIM}${time}${RESET} Card ${BOLD}${entry.card_id}${RESET} | Reason: ${entry.details.reason}`;
        } else if (entry.event_type === "attempt") {
          const status = entry.details.result.toUpperCase();
          const amount = (entry.details.attempted_amount / 100).toFixed(2);
          const icon = status === "APPROVED" ? "[✓]" : "[X]";
          message = `${icon} ${status} ${DIM}${time}${RESET} Card ${BOLD}${entry.card_id}${RESET} charged $${amount} at ${entry.details.attempted_merchant}`;
        }
        console.log(`  ${message}`);
      }
    }
    console.log("");

  } catch (err) {
    console.log(`${DIM}[!] Error reading logs: ${err instanceof Error ? err.message : String(err)}${RESET}\n`);
  }
}

// Draw immediately and start polling
drawDashboard();
setInterval(drawDashboard, 1000);
