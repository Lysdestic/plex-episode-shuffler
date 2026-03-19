import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import dotenv from "dotenv";
import { PlexApi } from "./plex.js";

const ENV_PATH = path.resolve(process.cwd(), ".env");
const EXAMPLE_ENV_PATH = path.resolve(process.cwd(), ".env.example");

const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off"]);

const COLOR_ENABLED = process.stdout.isTTY && !Object.hasOwn(process.env, "NO_COLOR");

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function style(text, ...codes) {
  if (!COLOR_ENABLED) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function heading(text) {
  return style(text, ANSI.bold, ANSI.cyan);
}

function accent(text) {
  return style(text, ANSI.bold, ANSI.blue);
}

function info(text) {
  return style(text, ANSI.cyan);
}

function muted(text) {
  return style(text, ANSI.dim);
}

function good(text) {
  return style(text, ANSI.green);
}

function warn(text) {
  return style(text, ANSI.yellow);
}

function bad(text) {
  return style(text, ANSI.red);
}

function section(title) {
  console.log(heading(`== ${title} ==`));
}

function formatPrompt(label, fallback = "") {
  const suffix = fallback ? ` ${muted(`[${fallback}]`)}` : "";
  return `${accent("?")} ${label}${suffix}: `;
}

async function loadEnvValues(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return dotenv.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function parseBooleanInput(value, fallback = "true") {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return "true";
  if (FALSE_VALUES.has(normalized)) return "false";
  return null;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueTitles(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function printOptions(label, options) {
  if (!options || options.length === 0) return;
  section(`Available ${label}`);
  options.forEach((option, index) => {
    console.log(`${style(String(index + 1).padStart(2, " "), ANSI.magenta, ANSI.bold)}. ${option}`);
  });
  console.log("");
}

function resolveSingleOption(value, options) {
  const trimmed = String(value || "").trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;

  const index = Number(trimmed) - 1;
  if (index < 0 || index >= options.length) return null;
  return options[index];
}

function resolveMultiOptions(value, options) {
  const parts = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";

  const resolved = [];
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < 1 || start > options.length || end > options.length || start > end) {
        return null;
      }

      for (let index = start; index <= end; index += 1) {
        resolved.push(options[index - 1]);
      }
      continue;
    }

    const selected = resolveSingleOption(part, options);
    if (selected == null) return null;
    resolved.push(selected);
  }

  return uniqueTitles(resolved).join(",");
}

async function promptWithOptions(rl, label, fallback, options, { multi = false } = {}) {
  while (true) {
    const answer = (await rl.question(formatPrompt(label, fallback))).trim();
    const value = answer || fallback;
    if (!value) {
      console.log(bad(`${label} is required.`));
      continue;
    }

    if (!options || options.length === 0) {
      return value;
    }

    if (multi) {
      const resolved = resolveMultiOptions(value, options);
      if (resolved != null) return resolved;
      console.log(
        warn(
          `Invalid selection. Enter client names, numbers, or ranges (for example: 1,3-5) from 1-${options.length}.`,
        ),
      );
      continue;
    }

    const resolved = resolveSingleOption(value, options);
    if (resolved != null) return resolved;
    console.log(warn(`Invalid selection. Enter a name or a number from 1-${options.length}.`));
  }
}

function buildEnvFile(values) {
  return [
    `PLEX_URL=${values.PLEX_URL}`,
    `PLEX_TOKEN=${values.PLEX_TOKEN}`,
    "",
    "# Comma-separated partial names. Example simulcast:",
    "# PLEX_CLIENTS=Living Room,Bedroom",
    `PLEX_CLIENTS=${values.PLEX_CLIENTS}`,
    "",
    `PLEX_LIBRARY=${values.PLEX_LIBRARY}`,
    `PLEX_COLLECTION=${values.PLEX_COLLECTION}`,
    "",
    "# Optional: set false to use legacy single-episode queue behavior.",
    `PLEX_SHUFFLE_CONTINUOUS=${values.PLEX_SHUFFLE_CONTINUOUS}`,
    "",
  ].join("\n");
}

async function promptNonEmpty(rl, label, fallback = "") {
  while (true) {
    const answer = (await rl.question(formatPrompt(label, fallback))).trim();
    const value = answer || fallback;
    if (value) return value;
    console.log(bad(`${label} is required.`));
  }
}

async function promptBoolean(rl, label, fallback = "true") {
  while (true) {
    const current = fallback === "false" ? "false" : "true";
    const answer = await rl.question(formatPrompt(`${label} [true/false]`, current));
    const parsed = parseBooleanInput(answer || fallback, fallback);
    if (parsed) return parsed;
    console.log(warn("Please enter true or false."));
  }
}

function printSummary(values) {
  section("Summary");
  console.log(`${muted("PLEX_URL")}: ${values.PLEX_URL}`);
  console.log(`${muted("PLEX_CLIENTS")}: ${values.PLEX_CLIENTS}`);
  console.log(`${muted("PLEX_LIBRARY")}: ${values.PLEX_LIBRARY}`);
  console.log(`${muted("PLEX_COLLECTION")}: ${values.PLEX_COLLECTION}`);
  console.log(`${muted("PLEX_SHUFFLE_CONTINUOUS")}: ${values.PLEX_SHUFFLE_CONTINUOUS}`);
  console.log("");
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive setup requires a TTY terminal.");
  }

  const [existingValues, exampleValues] = await Promise.all([
    loadEnvValues(ENV_PATH),
    loadEnvValues(EXAMPLE_ENV_PATH),
  ]);

  const defaults = {
    PLEX_URL: existingValues.PLEX_URL || exampleValues.PLEX_URL || "http://host:32400",
    PLEX_TOKEN: existingValues.PLEX_TOKEN || exampleValues.PLEX_TOKEN || "",
    PLEX_CLIENTS:
      existingValues.PLEX_CLIENTS ||
      existingValues.PLEX_CLIENT ||
      exampleValues.PLEX_CLIENTS ||
      "Living Room",
    PLEX_LIBRARY: existingValues.PLEX_LIBRARY || exampleValues.PLEX_LIBRARY || "TV Shows",
    PLEX_COLLECTION: existingValues.PLEX_COLLECTION || exampleValues.PLEX_COLLECTION || "",
    PLEX_SHUFFLE_CONTINUOUS:
      parseBooleanInput(existingValues.PLEX_SHUFFLE_CONTINUOUS, "true") ||
      parseBooleanInput(exampleValues.PLEX_SHUFFLE_CONTINUOUS, "true") ||
      "true",
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    section("Plex Collection Shuffler Setup");
    console.log(info("Interactive configuration wizard"));
    console.log(muted("Press Enter to accept defaults. For discovered options, you can type a name or its number."));
    console.log("");

    section("Connection");
    const values = {
      PLEX_URL: await promptNonEmpty(rl, "Plex server URL", defaults.PLEX_URL),
      PLEX_TOKEN: await promptNonEmpty(rl, "Plex token", defaults.PLEX_TOKEN),
    };

    const plex = new PlexApi({
      plexUrl: values.PLEX_URL,
      plexToken: values.PLEX_TOKEN,
    });

    let clientOptions = [];
    let sections = [];
    try {
      const clients = await plex.listClients();
      clientOptions = uniqueTitles(clients.map((client) => client.title));
      printOptions("clients", clientOptions);
    } catch (error) {
      console.warn(warn(`Warning: could not load clients (${error.message})`));
      console.log("");
    }

    try {
      sections = await plex.listLibrarySections();
      printOptions("libraries", uniqueTitles(sections.map((section) => section.title)));
    } catch (error) {
      console.warn(warn(`Warning: could not load libraries (${error.message})`));
      console.log("");
    }

    section("Playback Targets");
    values.PLEX_CLIENTS = await promptWithOptions(
      rl,
      "Plex clients (comma-separated names/numbers/ranges)",
      defaults.PLEX_CLIENTS,
      clientOptions,
      { multi: true },
    );

    const libraryOptions = uniqueTitles(sections.map((section) => section.title));
    values.PLEX_LIBRARY = await promptWithOptions(
      rl,
      "Plex library title (name or number)",
      defaults.PLEX_LIBRARY,
      libraryOptions,
    );

    let collections = [];
    const selectedSection = sections.find((section) => normalize(section.title) === normalize(values.PLEX_LIBRARY));
    if (selectedSection) {
      try {
        collections = await plex.listCollections(selectedSection.key);
        printOptions("collections", uniqueTitles(collections.map((collection) => collection.title)));
      } catch (error) {
        console.warn(warn(`Warning: could not load collections (${error.message})`));
        console.log("");
      }
    } else if (sections.length > 0) {
      console.warn(warn("Warning: selected library did not match discovered libraries; skipping collection discovery."));
      console.log("");
    }

    const collectionOptions = uniqueTitles(collections.map((collection) => collection.title));
    values.PLEX_COLLECTION = await promptWithOptions(
      rl,
      "Plex collection title (name or number)",
      defaults.PLEX_COLLECTION,
      collectionOptions,
    );

    section("Behavior");
    values.PLEX_SHUFFLE_CONTINUOUS = await promptBoolean(
      rl,
      "Use shuffled continuous play queue",
      defaults.PLEX_SHUFFLE_CONTINUOUS,
    );

    console.log("");
    printSummary(values);

    const confirmation = await rl.question(formatPrompt(`Write configuration to ${ENV_PATH}`, "Y"));
    const normalizedAnswer = confirmation.trim().toLowerCase();
    if (normalizedAnswer && normalizedAnswer !== "y" && normalizedAnswer !== "yes") {
      console.log(warn("Cancelled. No changes were written."));
      return;
    }

    await fs.writeFile(ENV_PATH, buildEnvFile(values), "utf8");
    console.log(good(`Saved ${ENV_PATH}`));
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(bad(`Setup error: ${error.message}`));
  process.exitCode = 1;
});
