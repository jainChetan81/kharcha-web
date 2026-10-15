// Prints an APP_PASSWORD_HASH for /etc/kharcha-web/env. Reads the password from stdin.
// Usage: printf %s 'your password' | node --experimental-strip-types scripts/hash-password.ts
import crypto from "node:crypto";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (password.length < 12) throw new Error("Use at least 12 characters.");
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, 64);
console.log(`scrypt:${salt.toString("hex")}:${key.toString("hex")}`);
