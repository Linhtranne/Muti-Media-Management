#!/usr/bin/env node
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORY_ARGUMENT = "--story";
const USAGE_TEXT = "Usage: npm run ai-sdlc:check -- <STORY-ID>";
const PILOT_STORY_ID = "AI-SDLC-001";
const PILOT_STORY_SLUG = "Completion-Gate-Checker";
const DEFAULT_WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PILOT_REQUIRED_ARTIFACTS = [
  `docs/specs/SPEC-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/plans/${PILOT_STORY_ID}/PLAN-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/BRAINSTORM-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/APPROVAL-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/BASELINE-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/RED-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/GREEN-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/testing/${PILOT_STORY_ID}/REFACTOR-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`,
  `docs/reports/${PILOT_STORY_ID}/REPORT-${PILOT_STORY_ID}-${PILOT_STORY_SLUG}.md`
];

export function parseStoryArgument(arguments_) {
  const storyFlagIndex = arguments_.indexOf(STORY_ARGUMENT);
  const storyId = storyFlagIndex >= 0 ? arguments_[storyFlagIndex + 1] : arguments_[0];

  if (!storyId) {
    throw new Error(USAGE_TEXT);
  }

  return storyId;
}

async function findFileInDirectory(dirPath, prefix) {
  try {
    const files = await readdir(dirPath);
    for (const file of files) {
      if (file.toLowerCase().startsWith(prefix.toLowerCase())) {
        return path.join(dirPath, file);
      }
    }
  } catch {
    // ignore error
  }
  return null;
}

export async function resolveStoryArtifactPaths(storyId, workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  const specDir = path.join(workspaceRoot, "docs/specs");
  const planDir = path.join(workspaceRoot, `docs/plans/${storyId}`);
  const testingDir = path.join(workspaceRoot, `docs/testing/${storyId}`);
  const reportDir = path.join(workspaceRoot, `docs/reports/${storyId}`);

  const specFile = await findFileInDirectory(specDir, `SPEC-${storyId}`);
  const planFile = await findFileInDirectory(planDir, `PLAN-${storyId}`);
  const redFile = await findFileInDirectory(testingDir, `RED-${storyId}`);
  const reportFile = await findFileInDirectory(reportDir, `REPORT-${storyId}`);

  return {
    spec: specFile ? path.relative(workspaceRoot, specFile) : `docs/specs/SPEC-${storyId}.md`,
    plan: planFile ? path.relative(workspaceRoot, planFile) : `docs/plans/${storyId}/PLAN-${storyId}.md`,
    red: redFile ? path.relative(workspaceRoot, redFile) : `docs/testing/${storyId}/RED-${storyId}.md`,
    report: reportFile ? path.relative(workspaceRoot, reportFile) : `docs/reports/${storyId}/REPORT-${storyId}.md`
  };
}

export async function buildRequiredArtifactPaths(storyId, workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  if (storyId === PILOT_STORY_ID) {
    return [...PILOT_REQUIRED_ARTIFACTS];
  }

  const paths = await resolveStoryArtifactPaths(storyId, workspaceRoot);
  return Object.values(paths);
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export function detectPlaceholders(content) {
  const placeholders = [];
  const checks = [
    { text: "TODO", value: "TODO" },
    { text: "TBD", value: "TBD" },
    { text: "One sentence.", value: "One sentence." },
    { text: "SPEC-000", value: "SPEC-000" },
    { text: "US-000", value: "US-000" },
    { text: "YYYY-MM-DD", value: "YYYY-MM-DD" }
  ];

  for (const check of checks) {
    if (content.includes(check.text)) {
      placeholders.push(check.value);
    }
  }

  if (/(\s|^)\.\.\.(\s|$)/.test(content)) {
    placeholders.push("...");
  }

  return placeholders;
}

export function verifyHeadings(filePath, content) {
  const missing = [];
  
  const hasHeading = (heading) => {
    const regex = new RegExp(`^##?\\s+\\d*\\.?\\s*${heading}`, "im");
    return regex.test(content);
  };

  if (filePath.includes("SPEC-")) {
    const specHeadings = ["Goal", "In Scope", "Out of Scope", "Acceptance Criteria"];
    for (const h of specHeadings) {
      if (!hasHeading(h)) missing.push(h);
    }
  } else if (filePath.includes("PLAN-")) {
    const planHeadings = ["Goal", "Tasks", "Done When"];
    for (const h of planHeadings) {
      if (!hasHeading(h)) missing.push(h);
    }
  } else if (filePath.includes("REPORT-")) {
    const reportHeadings = ["Summary", "What Was Done", "How It Was Done", "Verification", "AI-SDLC Completion Gate"];
    for (const h of reportHeadings) {
      if (!hasHeading(h)) missing.push(h);
    }
  } else if (filePath.includes("RED-")) {
    const redHeadings = ["Failing", "RED", "Expected", "Baseline"];
    const foundAny = redHeadings.some(h => hasHeading(h) || new RegExp(h, "i").test(content));
    if (!foundAny) {
      missing.push("RED evidence header (Failing / RED / Expected / Baseline)");
    }
  }

  return missing;
}

export function verifyStatusApproved(content) {
  const clean = content.replace(/\*/g, "");
  return /status:\s*approved/i.test(clean);
}

export function traceAcceptanceCriteria({ specContent, planContent, testContents, reportContent }) {
  const acMatches = specContent.match(/AC[-_]?\d+/gi) || [];
  
  const standardize = (code) => {
    return code.toUpperCase().replace(/[-_]/g, "");
  };

  const acMap = new Map();
  for (const match of acMatches) {
    const std = standardize(match);
    if (!acMap.has(std)) {
      acMap.set(std, match);
    }
  }

  const untraced = [];

  for (const original of acMap.values()) {
    const issues = [];

    // 1. Trace to Plan
    if (!planContent || !new RegExp(original.replace("-", "[-_]?"), "i").test(planContent)) {
      issues.push(`AC ${original} is missing from Plan`);
    }

    // 2. Trace to Tests
    const foundInTests = testContents.some(testText => 
      testText && new RegExp(original.replace("-", "[-_]?"), "i").test(testText)
    );
    if (!foundInTests) {
      issues.push(`AC ${original} is missing from Tests/Evidence`);
    }

    // 3. Trace to Report and verify Pass
    if (!reportContent) {
      issues.push(`AC ${original} is missing from Report (no report content)`);
    } else {
      const lines = reportContent.split("\n");
      let foundRow = false;
      let status = "Not found";

      for (const line of lines) {
        if (new RegExp(original.replace("-", "[-_]?"), "i").test(line)) {
          foundRow = true;
          if (/\b(?:[pP]ass|[cC]ompleted|[vV]erified)\b/.test(line)) {
            status = "Pass";
          } else if (/\b(?:[fF]ail|[pP]artial|[nN]ot\s+checked)\b/.test(line)) {
            const statusMatch = line.match(/\b(?:Fail|Partial|Not checked|fail|partial|not checked)\b/i);
            status = statusMatch ? statusMatch[0] : "Fail/Partial";
          }
          break;
        }
      }

      if (!foundRow) {
        issues.push(`AC ${original} is missing from Report`);
      } else if (status !== "Pass") {
        issues.push(`${original} status in Report is not Pass (found: ${status})`);
      }
    }

    if (issues.length > 0) {
      untraced.push({
        acCode: original,
        issues
      });
    }
  }

  return {
    ok: untraced.length === 0,
    untraced
  };
}

async function readDirectoryFilesContent(dirPath) {
  const contents = [];
  try {
    const files = await readdir(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        const content = await readFile(fullPath, "utf8");
        contents.push(content);
      }
    }
  } catch {
    // ignore error
  }
  return contents;
}

export async function checkStoryArtifacts({ storyId, workspaceRoot = DEFAULT_WORKSPACE_ROOT }) {
  const required = await buildRequiredArtifactPaths(storyId, workspaceRoot);
  const missing = [];
  const invalidQuality = [];
  const contentsMap = {};

  for (const relativePath of required) {
    const fullPath = path.join(workspaceRoot, relativePath);
    const exists = await fileExists(fullPath);

    if (!exists) {
      missing.push(relativePath);
      continue;
    }

    try {
      const content = await readFile(fullPath, "utf8");
      contentsMap[relativePath] = content;

      const placeholders = detectPlaceholders(content);
      const missingHeadings = verifyHeadings(relativePath, content);
      
      let statusIssue = null;
      if (relativePath.includes("SPEC-") || relativePath.includes("PLAN-")) {
        if (!verifyStatusApproved(content)) {
          statusIssue = "Status is not marked as Approved";
        }
      }

      if (placeholders.length > 0 || missingHeadings.length > 0 || statusIssue) {
        invalidQuality.push({
          filePath: relativePath,
          placeholders,
          missingHeadings,
          statusIssue
        });
      }
    } catch (error) {
      invalidQuality.push({
        filePath: relativePath,
        placeholders: [],
        missingHeadings: [],
        statusIssue: `Error reading file: ${error.message}`
      });
    }
  }

  // AC Trace Check (Spec -> Plan -> Test -> Report)
  const resolved = await resolveStoryArtifactPaths(storyId, workspaceRoot);
  const specContent = contentsMap[resolved.spec];
  const planContent = contentsMap[resolved.plan];
  const reportContent = contentsMap[resolved.report];
  
  let untraced = [];
  if (specContent && planContent && reportContent) {
    // Collect all testing evidence content for the tests part
    const testingDir = path.join(workspaceRoot, `docs/testing/${storyId}`);
    const testContents = await readDirectoryFilesContent(testingDir);
    
    const traceResult = traceAcceptanceCriteria({
      specContent,
      planContent,
      testContents,
      reportContent
    });
    untraced = traceResult.untraced;
  }

  return {
    ok: missing.length === 0 && invalidQuality.length === 0 && untraced.length === 0,
    required,
    missing,
    invalidQuality,
    untraced
  };
}

async function runCli() {
  try {
    const storyId = parseStoryArgument(process.argv.slice(2));
    const result = await checkStoryArtifacts({ storyId });

    if (result.ok) {
      console.log(`AI-SDLC gate passed for ${storyId}. Required artifacts exist, pass quality checks, and are fully traced.`);
      return 0;
    }

    if (result.missing.length > 0) {
      console.error(`AI-SDLC gate failed for ${storyId}. Missing artifacts:`);
      for (const missingPath of result.missing) {
        console.error(`- ${missingPath}`);
      }
    }

    if (result.invalidQuality && result.invalidQuality.length > 0) {
      console.error(`AI-SDLC quality checks failed for ${storyId}:`);
      for (const issue of result.invalidQuality) {
        console.error(`- File: ${issue.filePath}`);
        if (issue.placeholders.length > 0) {
          console.error(`  Placeholders found: ${issue.placeholders.join(", ")}`);
        }
        if (issue.missingHeadings.length > 0) {
          console.error(`  Missing required headings: ${issue.missingHeadings.join(", ")}`);
        }
        if (issue.statusIssue) {
          console.error(`  Status issue: ${issue.statusIssue}`);
        }
      }
    }

    if (result.untraced && result.untraced.length > 0) {
      console.error(`AI-SDLC AC tracing failed for ${storyId}:`);
      for (const trace of result.untraced) {
        console.error(`- AC: ${trace.acCode}`);
        for (const issue of trace.issues) {
          console.error(`  ${issue}`);
        }
      }
    }

    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE_TEXT);
    return 1;
  }
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
