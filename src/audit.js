// src/audit.js
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

export class AuditLog {
  logMint(taskScope, cardId) {
    const time = new Date().toLocaleTimeString();
    const limit = (taskScope.max_amount / 100).toFixed(2);
    const currency = (taskScope.currency || "USD").toUpperCase();
    const merchant = taskScope.merchant_lock?.value || "Any";
    
    console.log(
      `\n┌─── ${BOLD}${CYAN}ZeroDOM MINT EVENT${RESET} ───────────────────────────────\n` +
      `│ Timestamp: ${GRAY}${time}${RESET}\n` +
      `│ Card ID:   ${BOLD}${cardId}${RESET}\n` +
      `│ Limit:     ${BOLD}${currency} ${limit}${RESET}\n` +
      `│ Scope:     Single-use: ${taskScope.single_use}, Merchant: ${merchant}\n` +
      `└──────────────────────────────────────────────────────────`
    );
  }

  logAttempt(cardId, amount, merchant, result) {
    const time = new Date().toLocaleTimeString();
    const formattedAmount = (amount / 100).toFixed(2);
    
    const isApproved = String(result).toLowerCase() === "approved" || 
                       String(result).toLowerCase() === "success" || 
                       String(result).toLowerCase() === "succeeded";
    const color = isApproved ? GREEN : RED;
    const statusText = isApproved ? "APPROVED" : "DECLINED";

    console.log(
      `\n┌─── ${color}${BOLD}ZeroDOM AUTHORIZATION ATTEMPT (${statusText})${RESET} ───────────\n` +
      `│ Timestamp: ${GRAY}${time}${RESET}\n` +
      `│ Card ID:   ${BOLD}${cardId}${RESET}\n` +
      `│ Merchant:  ${BOLD}${merchant}${RESET}\n` +
      `│ Amount:    ${BOLD}USD ${formattedAmount}${RESET}\n` +
      `│ Outcome:   ${color}${BOLD}${result.toUpperCase()}${RESET}\n` +
      `└──────────────────────────────────────────────────────────`
    );
  }

  logRevoke(cardId) {
    const time = new Date().toLocaleTimeString();
    console.log(
      `\n┌─── ${YELLOW}${BOLD}ZeroDOM REVOCATION EVENT${RESET} ───────────────────────────\n` +
      `│ Timestamp: ${GRAY}${time}${RESET}\n` +
      `│ Card ID:   ${BOLD}${cardId}${RESET}\n` +
      `│ Status:    ${YELLOW}${BOLD}REVOKED / DESTROYED (Lifecycle terminated)${RESET}\n` +
      `└──────────────────────────────────────────────────────────`
    );
  }
}

const audit = new AuditLog();
export default audit;
export { audit };
