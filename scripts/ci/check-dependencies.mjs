import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoots = ["apps", "packages"];
const sourceExtensions = [".ts", ".tsx", ".js", ".mjs"];
const packageByPrefix = new Map([
  ["apps/web/", "@shawtie/web"],
  ["apps/api/", "@shawtie/api"],
  ["apps/worker/", "@shawtie/worker"],
  ["packages/domain/", "@shawtie/domain"],
  ["packages/contracts/", "@shawtie/contracts"],
  ["packages/db/", "@shawtie/db"],
  ["packages/crypto/", "@shawtie/crypto"],
  ["packages/ui/", "@shawtie/ui"],
  ["packages/testkit/", "@shawtie/testkit"],
]);
const allowedWorkspaceDependencies = new Map([
  ["@shawtie/web", new Set(["@shawtie/contracts", "@shawtie/crypto", "@shawtie/ui"])],
  ["@shawtie/api", new Set(["@shawtie/domain", "@shawtie/contracts", "@shawtie/db", "@shawtie/crypto"])],
  ["@shawtie/worker", new Set(["@shawtie/domain", "@shawtie/contracts", "@shawtie/db"])],
  ["@shawtie/domain", new Set()],
  ["@shawtie/contracts", new Set()],
  ["@shawtie/db", new Set()],
  ["@shawtie/crypto", new Set()],
  ["@shawtie/ui", new Set()],
  ["@shawtie/testkit", new Set(["@shawtie/domain", "@shawtie/contracts", "@shawtie/db", "@shawtie/crypto"])],
]);

const failures = [];
const fileGraph = new Map();
const packageGraph = new Map();

for (const packageName of allowedWorkspaceDependencies.keys()) {
  packageGraph.set(packageName, new Set());
}

const packageDirectories = new Map(
  [...packageByPrefix].map(([prefix, packageName]) => [
    packageName,
    prefix.slice(0, -1),
  ]),
);

async function walk(directory, output = []) {
  if (!existsSync(directory)) return output;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, output);
      continue;
    }
    if (entry.isFile() && sourceExtensions.includes(path.extname(entry.name))) {
      output.push(absolute);
    }
  }

  return output;
}

function normalize(relative) {
  return relative.split(path.sep).join("/");
}

function owningPackage(relative) {
  for (const [prefix, packageName] of packageByPrefix) {
    if (relative.startsWith(prefix)) return packageName;
  }
  return null;
}

function resolveRelativeImport(fromRelative, specifier) {
  const fromDirectory = path.dirname(path.join(root, fromRelative));
  const candidate = path.resolve(fromDirectory, specifier);
  const candidates = [
    candidate,
    ...sourceExtensions.map((extension) => `${candidate}${extension}`),
    ...sourceExtensions.map((extension) => path.join(candidate, `index${extension}`)),
  ];

  for (const resolved of candidates) {
    if (existsSync(resolved)) return normalize(path.relative(root, resolved));
  }

  return null;
}

function importsFrom(content) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) specifiers.push(match[1]);
  }

  return specifiers;
}

function findCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;

    visiting.add(node);
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }

  return null;
}

for (const [packageName, relativeDirectory] of packageDirectories) {
  const manifestPath = path.join(root, relativeDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    failures.push(`Workspace package manifest is missing: ${relativeDirectory}/package.json`);
    continue;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== packageName) {
    failures.push(
      `Workspace package name mismatch: ${relativeDirectory}/package.json expected ${packageName}`,
    );
  }

  const dependencyGroups = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];

  for (const dependencies of dependencyGroups) {
    for (const target of Object.keys(dependencies ?? {})) {
      if (!target.startsWith("@shawtie/")) continue;

      const allowed = allowedWorkspaceDependencies.get(packageName);
      if (!allowed?.has(target)) {
        failures.push(`Forbidden workspace dependency: ${packageName} -> ${target} in package.json`);
      }

      if (packageName !== target) packageGraph.get(packageName)?.add(target);
    }
  }
}

const files = [];
for (const sourceRoot of sourceRoots) {
  await walk(path.join(root, sourceRoot), files);
}

for (const absolute of files) {
  const relative = normalize(path.relative(root, absolute));
  const owner = owningPackage(relative);
  const content = await readFile(absolute, "utf8");
  const edges = new Set();

  for (const specifier of importsFrom(content)) {
    if (specifier.startsWith(".")) {
      const resolved = resolveRelativeImport(relative, specifier);
      if (resolved) edges.add(resolved);
      continue;
    }

    if (!specifier.startsWith("@shawtie/")) continue;
    const target = specifier.split("/").slice(0, 2).join("/");

    if (!owner) {
      failures.push(`Workspace import without known owner: ${relative}: ${specifier}`);
      continue;
    }

    const allowed = allowedWorkspaceDependencies.get(owner);
    if (!allowed?.has(target)) {
      failures.push(`Forbidden workspace dependency: ${owner} -> ${target} in ${relative}`);
    }

    if (owner !== target) packageGraph.get(owner)?.add(target);
  }

  fileGraph.set(relative, edges);
}

const fileCycle = findCycle(fileGraph);
if (fileCycle) failures.push(`Circular source dependency: ${fileCycle.join(" -> ")}`);

const packageCycle = findCycle(packageGraph);
if (packageCycle) failures.push(`Circular workspace dependency: ${packageCycle.join(" -> ")}`);

if (failures.length > 0) {
  console.error("DEPENDENCY_CHECK_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("DEPENDENCY_CHECK_PASS");
console.log(`Scanned ${files.length} source files`);
