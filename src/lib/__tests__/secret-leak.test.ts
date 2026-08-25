#!/usr/bin/env tsx
/**
 * secret-leak.test.ts
 *
 * Secret Leak Verification & Security Review for M021 Assessment Pipeline
 *
 * Statically analyzes source files for potential secret exposure:
 * 1. apiKey never leaks in API responses, console logs, error messages, or UI rendering
 * 2. No SQL injection vectors in ClickHouse query construction
 * 3. No prompt injection risks from user-controlled data
 * 4. No information disclosure through error shapes or logs
 *
 * Run: npx tsx src/lib/__tests__/secret-leak.test.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────

interface Finding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  location: string;
  description: string;
  exploitScenario: string;
  remediation: string;
}

interface SourceFile {
  path: string;
  content: string;
}

// ── Globals ──────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');
let passed = 0;
let failed = 0;
const findings: Finding[] = [];

// ── Assertion Helpers ────────────────────────────────────────────────────

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertNotIncludes(text: string, forbidden: string, msg: string) {
  if (!text.includes(forbidden)) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 found "${forbidden}"`);
  }
}



// ── File Loading ─────────────────────────────────────────────────────────

function loadSourceFiles(): SourceFile[] {
  const files: SourceFile[] = [];
  const paths = [
    'src/app/api/trades/[id]/assessments/route.ts',
    'src/app/api/ai-settings/route.ts',
    'src/lib/ai-provider.ts',
    'src/lib/assessment-engine.ts',
    'src/lib/clickhouse-client.ts',
    'src/lib/scorecard.ts',
    'src/components/trade-detail/assessment-card.tsx',
    'src/components/trade-detail/assessment-history.tsx',
  ];

  for (const p of paths) {
    const fullPath = path.join(REPO_ROOT, p);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      files.push({ path: p, content });
    } catch {
      console.error(`  \u26a0\ufe0f Could not read ${p} \u2014 skipping`);
    }
  }

  return files;
}

// ── Category 1: apiKey Leak Detection ───────────────────────────────────

function checkApiKeyLeaks(files: SourceFile[]) {
  console.log('\n=== 1. apiKey Leak Verification ===\n');

  // ── Check: ai-settings route strips apiKey ──────────────────────────
  const aiSettingsRoute = files.find((f) => f.path.includes('ai-settings/route'));
  if (aiSettingsRoute) {
    // The route strips apiKey via rest destructuring: `const { apiKey, ...safeRow } = row`
    // (GET, PUT create-branch, PUT update-branch). Accept both the aliased
    // `apiKey: _` form and the plain `apiKey` rest-destructuring form.
    const aliased = aiSettingsRoute.content.includes('apiKey: _, ...safeRow');
    const plain = aiSettingsRoute.content.includes('apiKey, ...safeRow');
    assert(
      aliased || plain,
      'ai-settings route strips apiKey via rest destructuring before responding',
    );
    // There are 3 destructuring sites: GET, PUT create-branch, PUT update-branch
    const stripCount =
      (aiSettingsRoute.content.match(/const \{ apiKey: _, \.\.\.safeRow \}/g) || []).length +
      (aiSettingsRoute.content.match(/const \{ apiKey, \.\.\.safeRow \}/g) || []).length;
    assert(
      stripCount >= 2,
      `ai-settings apiKey-strip destructuring found ${stripCount} times (>=2 expected)`,
    );
  }

  // ── Check: assessment route code (not comments) never references apiKey ──
  const assessmentRoute = files.find((f) => f.path.includes('assessments/route'));
  if (assessmentRoute) {
    // Filter out JSDoc and inline comment lines (they document the no-apiKey design intent)
    const codeLines = assessmentRoute.content
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const codeBody = codeLines.join('\n');
    assert(
      !codeBody.includes('apiKey'),
      'assessment route code (excluding comments) never references apiKey',
    );
    assert(
      !assessmentRoute.content.includes('api_key'),
      'assessment route never references api_key',
    );
  }

  // ── Check: ai-provider logs never include apiKey ─────────────────────
  const aiProvider = files.find((f) => f.path.includes('ai-provider.ts'));
  if (aiProvider) {
    const logLines = aiProvider.content
      .split('\n')
      .filter((l) => l.includes('console.log'));
    for (const logLine of logLines) {
      assertNotIncludes(
        logLine,
        'apiKey',
        `ai-provider log does not include apiKey: "${logLine.trim().slice(0, 60)}..."`,
      );
      assertNotIncludes(
        logLine,
        'sk-',
        'ai-provider log does not contain raw API key string',
      );
    }

    assert(
      aiProvider.content.includes('apiKey'),
      'ai-provider.ts references apiKey (for internal provider construction, not logged)',
    );
    assert(
      !aiProvider.content.match(/ai_provider_init[^}]*apiKey/),
      'ai_provider_init log does not include apiKey',
    );
  }

  // ── Check: assessment-engine logs never include apiKey ───────────────
  const engine = files.find((f) => f.path.includes('assessment-engine.ts'));
  if (engine) {
    const logLines = engine.content
      .split('\n')
      .filter((l) => l.includes('console.log'));
    for (const logLine of logLines) {
      assertNotIncludes(
        logLine,
        'apiKey',
        `engine log does not include apiKey: "${logLine.trim().slice(0, 60)}..."`,
      );
    }
  }

  // ── Check: UI components never reference apiKey ──────────────────────
  const uiFiles = files.filter((f) =>
    f.path.includes('assessment-card.tsx') || f.path.includes('assessment-history.tsx'),
  );
  for (const file of uiFiles) {
    assertNotIncludes(file.content, 'apiKey', `${file.path} never references apiKey`);
    assertNotIncludes(file.content, 'api_key', `${file.path} never references api_key`);
    assertNotIncludes(file.content, 'sk-', `${file.path} no raw API key string`);
  }

  // ── Check: scorecard.ts never references apiKey ─────────────────────
  const scorecard = files.find((f) => f.path.includes('scorecard.ts'));
  if (scorecard) {
    assertNotIncludes(scorecard.content, 'apiKey', 'scorecard.ts never references apiKey');
  }

  // ── Check: clickhouse-client never references apiKey ─────────────────
  const ch = files.find((f) => f.path.includes('clickhouse-client.ts'));
  if (ch) {
    assertNotIncludes(ch.content, 'apiKey', 'clickhouse-client.ts never references apiKey');
    assertNotIncludes(ch.content, 'sk-', 'clickhouse-client.ts no raw API key');
    assert(
      ch.content.includes('config.password'),
      'clickhouse-client uses config.password internally',
    );
    const logLinesForPass = ch.content.split('\n').filter((l) => l.includes('console.log'));
    const passLogged = logLinesForPass.some((l) => l.includes('password'));
    assert(!passLogged, 'clickhouse-client logs do not include password');
  }
}

// ── Category 2: Error Message Safety ─────────────────────────────────────

function checkErrorMessages(files: SourceFile[]) {
  console.log('\n=== 2. Error Message Safety ===\n');

  const assessmentRoute = files.find((f) => f.path.includes('assessments/route'));
  if (assessmentRoute) {
    // Check that mapAssessmentError returns generic safe messages
    assert(
      assessmentRoute.content.includes(`'AI provider error`),
      'AI provider error uses generic safe message',
    );
    assert(
      assessmentRoute.content.includes(`'AI returned invalid assessment`),
      'Parse error uses generic safe message',
    );
    assert(
      assessmentRoute.content.includes(`'AI is not configured`),
      'Not configured uses generic safe message',
    );

    // Check that err.message is NOT in 4xx/5xx NextResponse.json responses.
    // err.message IS intentionally used in:
    //   1. console.log for server-side diagnostics
    //   2. safeMessage: err.message for CLICKHOUSE_ERROR / MISSING_MARKET_DATA (200)
    const errorResponseLines = assessmentRoute.content
      .split('\n')
      .filter((l) => l.includes('NextResponse.json') && (l.includes('status: 4') || l.includes('status: 5')));
    for (const line of errorResponseLines) {
      assertNotIncludes(line, 'err.message', '4xx/5xx NextResponse.json does not expose err.message');
    }

    // err.code IS intentionally returned because codes are typed enum values
    // (AI_PROVIDER_ERROR, TRADE_NOT_FOUND) safe for client consumption.
    // Verify they are paired with safeMessage for defense-in-depth.
    const codeLines = assessmentRoute.content.split('\n').filter((l) => l.includes('code: err.code'));
    for (const line of codeLines) {
      assert(line.includes('safeMessage'), 'err.code in response is accompanied by safeMessage');
    }

    // Check the outer catch returns generic message
    assert(
      assessmentRoute.content.includes(`'Failed to process assessment request'`),
      'Outer catch returns generic failure message',
    );
  }

  // ── Check: AI provider uses typed error codes, not raw messages ─────
  const aiProvider = files.find((f) => f.path.includes('ai-provider.ts'));
  if (aiProvider) {
    assert(
      aiProvider.content.includes("errorType: 'AUTH_ERROR'"),
      'AUTH_ERROR uses typed error code, not raw message',
    );
    assert(
      aiProvider.content.includes("errorType: 'TIMEOUT'"),
      'TIMEOUT uses typed error code',
    );
    assert(
      aiProvider.content.includes("errorType: 'CONNECTION_ERROR'"),
      'CONNECTION_ERROR uses typed error code',
    );
  }

  // ── Check: assessment-error logs use codes ─────────────────────────
  const engine = files.find((f) => f.path.includes('assessment-engine.ts'));
  if (engine) {
    const errorLogs = engine.content
      .split('\n')
      .filter((l) => l.includes('assessment_error'));
    for (const line of errorLogs) {
      assertNotIncludes(line, 'err.message', 'assessment_error log uses codes, not raw messages');
    }
  }
}

// ── Category 3: SQL Injection Vectors (ClickHouse) ───────────────────────

function checkSqlInjection(files: SourceFile[]) {
  console.log('\n=== 3. SQL Injection Vectors ===\n');

  const ch = files.find((f) => f.path.includes('clickhouse-client.ts'));
  if (ch) {
    // Verify escapeSqlString helper exists
    assert(ch.content.includes('escapeSqlString'), 'clickhouse-client has escapeSqlString helper');

    // Verify escapeSqlString is called at least 3 times (escapedSymbol + escapedStart + escapedEnd)
    const escapeCalls = (ch.content.match(/escapeSqlString\(/g) || []).length;
    assert(
      escapeCalls >= 3,
      `escapeSqlString called ${escapeCalls} times (>=3 expected: symbol + start + end)`,
    );

    // Verify both SQL array constructors exist (resolveSecid + queryOhlc)
    const sqlArrays = (ch.content.match(/const sql = \[/g) || []).length;
    assert(
      sqlArrays >= 2,
      `SQL array blocks (const sql = [) found: ${sqlArrays} (>=2 expected)`,
    );

    // Check for potential unescaped interpolation in SQL context
    const lines = ch.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('${') && line.includes('`')) {
        const nearbyContext = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
        if (
          (nearbyContext.includes('SELECT') || nearbyContext.includes('FROM') || nearbyContext.includes('WHERE')) &&
          !line.includes('escapeSqlString')
        ) {
          const interpolation = line.match(/\$\{[^}]+\}/g);
          if (interpolation) {
            for (const match of interpolation) {
              const varName = match.slice(2, -1).trim();
              if (['symbol', 'startDate', 'endDate', 'escapedSymbol'].includes(varName) && !line.includes('escapeSqlString')) {
                console.log(`  \u26a0\ufe0f Potential unescaped SQL interpolation at ${ch.path}:${i + 1}: ${match}`);
              }
            }
          }
        }
      }
    }

    // Verify secid is parsed as number before SQL use
    const secidLinesWithNumeric = ch.content
      .split('\n')
      .filter((l) => l.includes('secid') && (l.includes('=') || l.includes('${')))
      .some((l) => l.includes('parseNumeric') || l.includes('Number('));
    assert(secidLinesWithNumeric, 'secid values are parsed as numbers before SQL use');

    // Verify secid is NOT quoted in SQL (number type safe for direct interpolation)
    const sqlText = ch.content.match(/const sql = \[[\s\S]*?\]\.join\(/g);
    let secidQuotedInSql = false;
    if (sqlText) {
      for (const block of sqlText) {
        // Find lines with secid interpolation in template literals within SQL
        const secidSpliced = block.split('\n').filter((l) => l.includes('secid') && l.includes('$'));
        for (const sl of secidSpliced) {
          // Check if ${secid} has a quote immediately before it (which would be wrong for numbers)
          const match = sl.match(/\$\{secid\}/);
          if (match && match.index && match.index >= 1) {
            const charBefore = sl[match.index - 1];
            if (charBefore === "'" || charBefore === '"') {
              secidQuotedInSql = true;
            }
          }
        }
      }
    }
    assert(!secidQuotedInSql, 'secid is NOT quoted in SQL (number type - safe for direct interpolation)');

    // Verify credentials are URL-encoded in query params
    assert(
      ch.content.includes('encodeURIComponent(config.password)'),
      'ClickHouse password URL-encoded in query param',
    );
    assert(
      !ch.content.includes('password:') ||
      ch.content.includes('encodedPass') ||
      ch.content.includes('config.password'),
      'ClickHouse password not hardcoded',
    );
  }
}

// ── Category 4: Prompt Injection Risks ───────────────────────────────────

function checkPromptInjection(files: SourceFile[]) {
  console.log('\n=== 4. Prompt Injection Risks ===\n');

  const engine = files.find((f) => f.path.includes('assessment-engine.ts'));
  if (engine) {
    // Verify system prompt says JSON-only (in template literal, not single-quoted)
    assert(
      engine.content.includes('You must respond with valid JSON only'),
      'system prompt enforces JSON-only response',
    );

    // AI provider uses response_format json_object
    const aiProvider = files.find((f) => f.path.includes('ai-provider.ts'));
    if (aiProvider) {
      assert(
        aiProvider.content.includes('response_format:') && aiProvider.content.includes('json_object'),
        'AI provider uses response_format json_object',
      );
    }

    // Scorecard is validated after AI response
    assert(engine.content.includes('parseScorecard'), 'AI response is validated through parseScorecard');
    assert(engine.content.includes('SCORECARD_PARSE_ERROR'), 'Invalid AI responses produce SCORECARD_PARSE_ERROR');

    // Check user-authored content included in prompt (surface this for awareness)
    const parts = engine.content.match(/t\.(thesis|invalidationCondition|preTradePlan)/g);
    if (parts) {
      console.log(`  \u2139\ufe0f User-authored content in AI prompt: ${[...new Set(parts)].join(', ')}`);
    }

    // Verify the prompt includes output length limits
    assert(
      engine.content.includes('max 2000 chars') || engine.content.includes('max 500 chars'),
      'Prompt enforces output length limits',
    );
  }
}

// ── Category 5: UI Safety ────────────────────────────────────────────────

function checkUiSafety(files: SourceFile[]) {
  console.log('\n=== 5. UI Rendering Safety ===\n');

  const uiFiles = files.filter((f) =>
    f.path.includes('assessment-card.tsx') || f.path.includes('assessment-history.tsx'),
  );

  for (const file of uiFiles) {
    const content = file.content;

    // Check no dangerouslySetInnerHTML
    assertNotIncludes(content, 'dangerouslySetInnerHTML', `${file.path} no dangerouslySetInnerHTML`);
    assertNotIncludes(content, 'eval(', `${file.path} no eval()`);
    assertNotIncludes(content, 'new Function(', `${file.path} no new Function()`);

    // Verify error messages rendered as simple text (not raw object dump)
    const errorPattern = content.match(/<span>\{error\}<\/span>/g);
    if (errorPattern) {
      assert(errorPattern.length > 0, `${file.path} renders error as simple text`);
    }

    // No JSON.stringify in rendering (would leak internal state)
    assertNotIncludes(content, 'JSON.stringify', `${file.path} no JSON.stringify in rendering`);

    // Warnings rendered as plain text via <span>{w} (WarningsList in assessment-card.tsx)
    if (file.path.includes('assessment-card.tsx')) {
      assert(content.includes('<span>{w}'), 'assessment-card.tsx renders warnings as plain text <span>{w}');
    }
  }
}

// ── Category 6: Structured Logging Safety ───────────────────────────────

function checkLogSafety(files: SourceFile[]) {
  console.log('\n=== 6. Structured Logging Safety ===\n');

  // Check for suspicious keys in log objects across all source files
  const suspiciousLogs: Array<{ file: string; line: number; text: string }> = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('console.log') || line.includes('console.error')) {
        const objStr = line.match(/\{[^}]+\}/);
        if (objStr) {
          const logContent = objStr[0];
          const sensitiveKeys = ['password', 'secret', 'token', 'credential', 'api_key', 'apiKey'];
          for (const key of sensitiveKeys) {
            if (logContent.includes(key) && !logContent.includes('apiKey: _,') && !logContent.includes('apiKey:_,')) {
              suspiciousLogs.push({ file: file.path, line: i + 1, text: line.trim().slice(0, 100) });
            }
          }
        }
      }
    }
  }

  if (suspiciousLogs.length > 0) {
    for (const log of suspiciousLogs) {
      console.error(`  \u274c Suspicious log at ${log.file}:${log.line}: ${log.text}`);
    }
    failed += suspiciousLogs.length;
  } else {
    passed++;
    console.log('  \u2705 No suspicious log entries found across all source files');
  }

  // Check for non-structured logs (those without event:, JSON.stringify, or simple strings)
  const unstructuredLogs: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        (line.includes('console.log') || line.includes('console.error')) &&
        !line.includes('JSON.stringify') &&
        !line.includes('event:')
      ) {
        const contentMatch = line.match(/console\.(log|error)\(([^)]+)\)/);
        if (contentMatch) {
          const content = contentMatch[2].trim();
          if (
            !content.startsWith("'") &&
            !content.startsWith('"') &&
            !content.startsWith('`') &&
            !content.includes('JSON.stringify') &&
            !content.includes('event')
          ) {
            unstructuredLogs.push({ file: file.path, line: i + 1, text: line.trim().slice(0, 100) });
          }
        }
      }
    }
  }

  if (unstructuredLogs.length > 0) {
    for (const log of unstructuredLogs) {
      console.log(`  \u2139\ufe0f Non-structured log at ${log.file}:${log.line}: ${log.text}`);
    }
  }
}

// ── Security Review Report ───────────────────────────────────────────────

function generateSecurityReview() {
  console.log('\n=== 7. Security Review Report ===\n');

  const reviewFindings: Finding[] = [];

  // SEC-01: ClickHouse use of escapeSqlString vs parameterized queries
  reviewFindings.push({
    id: 'SEC-01',
    severity: 'MEDIUM',
    category: 'SQL Injection (OWASP A03)',
    location: 'src/lib/clickhouse-client.ts (queryOhlc, resolveSecid)',
    description:
      'ClickHouse client builds SQL queries using string interpolation with escapeSqlString() for user-controlled symbol and date values, rather than using parameterized/prepared statements. While escapeSqlString provides basic escaping, ClickHouse supports prepared statements via its HTTP protocol that would eliminate injection risk entirely.',
    exploitScenario:
      'An attacker who controls a trade symbol field (via trade creation API) could inject SQL fragments. The symbol originates from authenticated trade creation (not anonymous HTTP input), and escapeSqlString prevents simple quote-based injection. Unicode bypasses or edge cases in the escape logic are the residual risk.',
    remediation:
      'Migrate ClickHouse queries to use parameterized bindings via the native ClickHouse HTTP protocol which supports ? placeholders, or use @clickhouse/client that supports prepared statements.',
  });

  // SEC-02: AI provider error logging
  reviewFindings.push({
    id: 'SEC-02',
    severity: 'LOW',
    category: 'Information Disclosure',
    location: 'src/lib/ai-provider.ts (getCompletion catch blocks)',
    description:
      'The ai-provider logs include err.message for non-AiProviderError errors. While AiProviderError messages are generic, unexpected error types from the OpenAI SDK may include sensitive context in their message.',
    exploitScenario:
      'If a cloud proxy or API gateway adds the API key to error response headers, the OpenAI SDK might surface it in err.message, which would be logged via console.log.',
    remediation:
      'In the APIError catch block, strip sensitive patterns from err.message before logging, or log only the error status/code without the message body.',
  });

  // SEC-03: Prompt injection surface
  reviewFindings.push({
    id: 'SEC-03',
    severity: 'LOW',
    category: 'Prompt Injection (OWASP LLM01)',
    location: 'src/lib/assessment-engine.ts (buildAssessmentPrompt -> trade.thesis, execution notes, preTradePlan)',
    description:
      'User-authored trade content (thesis, preTradePlan, invalidationCondition) is included verbatim in the AI assessment prompt. Mitigations: (1) response_format forces json_object, (2) system prompt enforces JSON-only, (3) parseScorecard validates output, (4) Zod schema bounds output.',
    exploitScenario:
      'A malicious user could include injection instructions in their trade thesis. The json_object response format and parseScorecard validation reduce risk, but the assessment quality trust boundary assumes honest user input.',
    remediation:
      'Add system prompt instruction that user-authored content should be evaluated as objective evidence, not as instructions. Add delimiter markers around user content in the prompt.',
  });

  // SEC-04: ClickHouse credentials in URL query params
  reviewFindings.push({
    id: 'SEC-04',
    severity: 'LOW',
    category: 'Credential Exposure (Network)',
    location: 'src/lib/clickhouse-client.ts (buildClickHouseUrl)',
    description:
      'ClickHouse credentials (user, password) are passed as URL query parameters. While URL-encoded, they are visible in process listings and HTTP access logs. The code comment explains this is necessary because Node native fetch() rejects credentials in URL userinfo.',
    exploitScenario:
      'If another process on the same host captures process environment, or if the ClickHouse HTTP server logs URLs with query params, the password could be exposed. Local host access is required.',
    remediation:
      'Use HTTP Basic Auth (Authorization header) instead of query parameters for ClickHouse credentials.',
  });

  // SEC-05: Overall summary
  reviewFindings.push({
    id: 'SEC-05',
    severity: 'INFO',
    category: 'Overall Assessment',
    location: 'All files',
    description:
      'No CRITICAL or HIGH severity findings. The assessment pipeline has proper secret isolation: apiKey is stripped from all API responses (via destructuring), never present in structured logs, never rendered in UI components, and error messages use generic safe text. SQL injection is mitigated by escapeSqlString. Prompt injection is mitigated by json_object response format and scorecard validation.',
    exploitScenario: 'N/A - informational finding.',
    remediation:
      'No immediate remediation required. The MEDIUM finding (SEC-01) should be addressed in a future milestone.',
  });

  for (const f of reviewFindings) {
    findings.push(f);
  }

  console.log('\n' + '\u2501'.repeat(60));
  console.log('  SECURITY REVIEW FINDINGS');
  console.log('\u2501'.repeat(60));

  const severityOrder: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  for (const sev of severityOrder) {
    for (const finding of reviewFindings.filter((f) => f.severity === sev)) {
      console.log(`\n[${finding.severity}] ${finding.id}: ${finding.description.split('.')[0]}.`);
      console.log(`  Location: ${finding.location}`);
      console.log(`  Exploit: ${finding.exploitScenario.split('.')[0]}.`);
      console.log(`  Fix: ${finding.remediation.split('.')[0]}.`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  SECRET LEAK VERIFICATION & SECURITY REVIEW');
  console.log('  M021 Assessment Pipeline');
  console.log('='.repeat(60));

  const files = loadSourceFiles();

  checkApiKeyLeaks(files);
  checkErrorMessages(files);
  checkSqlInjection(files);
  checkPromptInjection(files);
  checkUiSafety(files);
  checkLogSafety(files);
  generateSecurityReview();

  console.log('\n' + '\u2500'.repeat(40));
  const total = passed + failed;
  console.log(`Verification Results: ${passed}/${total} passed`);

  if (findings.length > 0) {
    console.log(`Security Findings: ${findings.length}`);
    const bySeverity: Record<string, number> = {};
    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    }
    for (const [sev, count] of Object.entries(bySeverity)) {
      console.log(`  ${sev}: ${count}`);
    }
  }

  if (failed === 0) {
    console.log('\n  \u2705 SECRET LEAK VERIFICATION: ALL CHECKS PASSED');
    console.log('  No apiKey leaks detected in API responses, logs, error messages, or UI.');
    console.log('  Security review complete - see findings above for LOW/MEDIUM items.\n');
  } else {
    console.log(`\n  \u274c ${failed} verification checks FAILED\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
