// Standalone mock Reasonix worker for conformance testing.
// Reads a review_diff_input_v1 JSON object from stdin and writes a
// pure review result JSON object to stdout (no system envelope fields).
//
// Used by bin/coagent-mock-worker.cmd and by worker-contract conformance tests.

const decoder = new TextDecoder();
const chunks: Uint8Array[] = [];

for await (const chunk of Bun.stdin.stream() as AsyncIterable<Uint8Array>) {
  chunks.push(chunk);
}

const raw = decoder.decode(Bun.concatArrayBuffers(chunks as unknown as ArrayBuffer[])).trim();

let _input: Record<string, unknown>;
try {
  _input = JSON.parse(raw);
} catch {
  process.stderr.write("mock worker: invalid JSON on stdin\n");
  process.exit(1);
}

// Pure review result — Coagent attaches wrapper metadata separately.
const output = {
  verdict: "pass",
  summary: "Mock worker completed review.",
  findings: [] as Array<Record<string, unknown>>,
  tests_to_run: [] as string[],
  risks: [] as string[],
  assumptions: [] as string[],
  confidence: 0.9,
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
