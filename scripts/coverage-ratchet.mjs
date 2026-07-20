#!/usr/bin/env node
// Monotonic coverage ratchet. Fails if any metric drops more than TOLERANCE
// below .coverage-baseline.json. Bump the baseline up (never down) as coverage
// climbs. Reads coverage/coverage-summary.json (from `npm run test:coverage`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const TOLERANCE = 0.5 // percentage points
const METRICS = ['statements', 'branches', 'functions', 'lines']
const SUMMARY = 'coverage/coverage-summary.json'
const BASELINE = '.coverage-baseline.json'

function readJson(file, hint) {
  if (!existsSync(file)) {
    console.error(`✗ ${file} not found. ${hint}`)
    process.exit(1)
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`✗ ${file} is not valid JSON: ${e.message}`)
    process.exit(1)
  }
}

const updating = process.argv.includes('--update')
const summary = readJson(SUMMARY, 'Run `npm run test:coverage` first.')

let baseline
if (existsSync(BASELINE)) {
  baseline = readJson(BASELINE, '')
} else if (updating) {
  baseline = {} // bootstrap a fresh baseline from current coverage
} else {
  console.error(`✗ ${BASELINE} not found. Run with --update after \`npm run test:coverage\` to create it.`)
  process.exit(1)
}

const current = Object.fromEntries(METRICS.map((m) => [m, summary.total[m]?.pct ?? 0]))

let failed = false
for (const m of METRICS) {
  const now = current[m]
  const base = baseline[m] ?? 0
  if (now < base - TOLERANCE) {
    failed = true
    console.error(`✗ ${m}: ${now}% is >${TOLERANCE}pp below baseline ${base}%`)
  } else {
    console.log(`✓ ${m}: ${now}% (baseline ${base}%)`)
  }
}

// Only ratchet up, and never record a drop: skip the write when failing.
if (updating && !failed) {
  const bumped = Object.fromEntries(
    METRICS.map((m) => [m, Math.max(current[m], baseline[m] ?? 0)]),
  )
  writeFileSync(BASELINE, JSON.stringify(bumped, null, 2) + '\n')
  console.log('Baseline updated.')
}

process.exit(failed ? 1 : 0)
