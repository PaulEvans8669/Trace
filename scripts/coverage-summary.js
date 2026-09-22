/**
 * Renders the Vitest coverage summary as a markdown table into the GitHub
 * Actions job summary (the $GITHUB_STEP_SUMMARY file).
 *
 * This is purely informational: the Quality workflow runs it with
 * `continue-on-error: true`, and no coverage thresholds are configured, so a
 * low percentage can never fail the build.
 *
 * When run outside GitHub Actions (no GITHUB_STEP_SUMMARY set) the table is
 * printed to stdout instead, which makes it easy to check locally.
 */
const fs = require('fs');
const path = require('path');

// Produced by the `json-summary` reporter configured in vitest.config.ts.
const summaryPath = path.join('coverage', 'coverage-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.log(`No coverage summary at ${summaryPath} - skipping coverage report.`);
  process.exit(0);
}

const { total } = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const metrics = ['Lines', 'Statements', 'Functions', 'Branches'];

const rows = metrics.map((label) => {
  const metric = total[label.toLowerCase()];
  return `| ${label} | ${metric.pct}% | ${metric.covered}/${metric.total} |`;
});

const markdown = [
  '## Test coverage (non-blocking)',
  '',
  '| Metric | % | Covered / Total |',
  '| --- | ---: | ---: |',
  ...rows,
  '',
  '_Informational only - no coverage thresholds are enforced._',
  ''
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
} else {
  console.log(markdown);
}
