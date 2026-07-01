#!/usr/bin/env node
import { spawn } from "node:child_process";

const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM"];
const WINDOWS_NPM_COMMAND = "npm.cmd";
const DEFAULT_NPM_COMMAND = "npm";

function getNpmCommand() {
  return process.platform === "win32" ? WINDOWS_NPM_COMMAND : DEFAULT_NPM_COMMAND;
}

function runCommand(name, arguments_, options = {}) {
  const child = spawn(getNpmCommand(), arguments_, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: "inherit",
    ...options
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });

  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

function stopChildren(children) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

async function main() {
  console.log("[dev:all] building project...");
  const build = runCommand("build", ["run", "build"]);
  const buildResult = await waitForExit(build);

  if (buildResult.code !== 0) {
    console.error(`[dev:all] build failed with exit code ${buildResult.code}.`);
    return buildResult.code;
  }

  console.log("[dev:all] starting orchestrator and ngrok...");
  const children = [
    runCommand("orchestrator", ["run", "start:orchestrator"]),
    runCommand("ngrok", ["run", "start:ngrok"])
  ];

  for (const signal of TERMINATION_SIGNALS) {
    process.on(signal, () => {
      stopChildren(children);
      process.exit(0);
    });
  }

  const firstExit = await Promise.race(children.map((child) => waitForExit(child)));
  stopChildren(children);

  if (firstExit.signal) {
    console.error(`[dev:all] child process stopped by ${firstExit.signal}.`);
    return 1;
  }

  return firstExit.code;
}

const exitCode = await main();
process.exit(exitCode);
