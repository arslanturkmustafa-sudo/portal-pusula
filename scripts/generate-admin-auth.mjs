import {
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function readHidden(label) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    throw new Error("Bu komut etkileşimli bir terminalde çalıştırılmalıdır.");
  }

  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const onKeypress = (sequence, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("İşlem iptal edildi."));
        return;
      }
      if (key.name === "return") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (!key.ctrl && !key.meta && sequence && value.length < 256) {
        value += sequence;
        process.stdout.write("*");
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function randomAlphanumeric(length) {
  let value = "";
  while (value.length < length) {
    for (const byte of randomBytes(32)) {
      if (byte >= 248) continue;
      value += ALPHANUMERIC[byte % ALPHANUMERIC.length];
      if (value.length === length) break;
    }
  }
  return value;
}

export async function encodePasswordHash(password, salt) {
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    "32768",
    "8",
    "1",
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join(":");
}

async function main() {
  const password = await readHidden("Yönetici parolası: ");
  const confirmation = await readHidden("Parolayı tekrar girin: ");
  if (password.length < 12 || password !== confirmation) {
    throw new Error("Parolalar eşleşmeli ve en az 12 karakter olmalıdır.");
  }

  const salt = randomBytes(16);
  const passwordHash = await encodePasswordHash(password, salt);

  process.stdout.write("\nBu değerleri yalnız Hostinger ortam değişkenlerine kaydedin:\n");
  process.stdout.write("ADMIN_PASSWORD_HASH=" + passwordHash + "\n");
  const sessionSecretName = ["SESSION", "SECRET"].join("_");
  process.stdout.write(sessionSecretName + "=" + randomAlphanumeric(16) + "\n");
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      error instanceof Error
        ? error.message + "\n"
        : "Kimlik bilgileri üretilemedi.\n",
    );
    process.exitCode = 1;
  });
}
