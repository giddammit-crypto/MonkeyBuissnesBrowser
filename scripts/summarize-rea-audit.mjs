import fs from 'node:fs';

const file = process.argv[2];
if (!file || fs.statSync(file).size > 128 * 1024 * 1024) throw new Error('REA evidence file missing or above 128 MiB');
let payload = JSON.parse(fs.readFileSync(file, 'utf8'));
payload = payload.data ?? payload;
const evidence = payload.error ? payload.details?.partial_observation ?? {} : payload;
const result = evidence.normalized_result ?? {};
const statistics = result.statistics ?? {};
console.log(JSON.stringify({
  status: payload.error ? 'failed' : 'returned-evidence',
  errorCode: payload.code,
  evidenceId: evidence.evidence_id,
  sha256: evidence.subject?.digest?.sha256,
  sourceSelection: result.source_selection,
  statistics,
  graphCoverage: result.graph?.coverage,
  semanticCoverage: result.semantic_graph?.coverage,
  summary: result.summary,
  limitations: evidence.limitations,
}, null, 2));
if (payload.error || !evidence.evidence_id || statistics.parsed_javascript_files < 3 || statistics.skipped_javascript_files !== 0) {
  throw new Error('REA did not parse all three selected plugin modules; inspect retained evidence');
}
