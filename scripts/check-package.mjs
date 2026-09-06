import assert from "node:assert/strict";
import { readFile, access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
for (const [path, entry] of Object.entries(pkg.exports)) {
  for (const condition of ["import", "require"]) {
    await access(new URL(`../${entry[condition].types}`, import.meta.url));
    await access(new URL(`../${entry[condition].default}`, import.meta.url));
  }
  // Vitest's conformance runner is intentionally imported only inside Vitest.
  if (path === "./conformance") continue;
  const name = path === "." ? pkg.name : `${pkg.name}/${path.slice(2)}`;
  assert.ok(Object.keys(await import(name)).length > 0, `ESM export: ${name}`);
  assert.ok(Object.keys(require(name)).length > 0, `CJS export: ${name}`);
}
for (const sdk of [await import(pkg.name), require(pkg.name)]) {
  const { mock } = await import(`${pkg.name}/mock`);
  const provider = mock();
  provider._testing.createSubscription({
    customerRef: "user",
    productId: "pro",
  });
  const billing = sdk.createEnhancedClient({
    provider,
    plans: { pro: { features: ["api"], limits: { seats: 3 } } },
  });
  assert.equal(await billing.hasFeature("user", "api"), true);
  assert.equal((await billing.checkLimit("user", "seats", 2)).allowed, true);
  await billing.dispose();
}
// Compile actual NodeNext ESM and CommonJS consumers against published types.
const typeDirectory = await mkdtemp(new URL("../.billing-types-", import.meta.url));
try {
  const code = `import { createEnhancedClient, definePlans } from "@fuime/billing-sdk";
import { mock } from "@fuime/billing-sdk/mock";
const plans = definePlans({ pro: { features: ["api"], limits: { seats: 3 } } });
const billing = createEnhancedClient({ provider: mock(), plans });
const access: Promise<boolean> = billing.hasFeature("user", "api");
void access;
`;
  const esm = join(typeDirectory, "consumer.mts");
  const cjs = join(typeDirectory, "consumer.cts");
  await writeFile(esm, code);
  await writeFile(cjs, code);
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", esm, cjs], { stdio: "pipe" });
} finally { await rm(typeDirectory, { recursive: true, force: true }); }

// Prove --help works in an isolated directory without optional provider SDKs.
const temporary = await mkdtemp(join(tmpdir(), "billing-sdk-cli-"));
try {
  const cli = join(temporary, "doctor.mjs");
  await writeFile(
    cli,
    await readFile(new URL("../dist/cli/doctor.js", import.meta.url)),
  );
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /billing-sdk doctor/,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(
  "Package exports, ESM/CJS behavior and TypeScript consumers, and standalone CLI help passed.",
);
