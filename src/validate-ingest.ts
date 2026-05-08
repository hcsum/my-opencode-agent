import { validateCurrentIngestTarget } from "./ingest-validator.js";

function parseTarget(argv: string[]): string | undefined {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--target") {
      return args[i + 1];
    }
  }
  return args[0];
}

const target = parseTarget(process.argv);

if (!target) {
  console.error("Usage: npx tsx src/validate-ingest.ts --target <path-or-url>");
  process.exit(1);
}

const result = validateCurrentIngestTarget(target);

const lines = [
  `Validation: ${result.summary}`,
  ...(result.touchedFiles.length ? ["Matched source pages:", ...result.touchedFiles.map((file) => `- ${file}`)] : []),
  ...(result.warnings.length ? ["Warnings:", ...result.warnings.map((item) => `- ${item}`)] : []),
  ...(result.errors.length ? ["Errors:", ...result.errors.map((item) => `- ${item}`)] : []),
];

console.log(lines.join("\n"));
process.exit(result.passed ? 0 : 1);
