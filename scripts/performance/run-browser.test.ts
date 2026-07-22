import { describe, expect, it } from 'vitest'
import {
  artifactName,
  assertLoopbackAppUrl,
  buildRunnerMetadata,
  calculateClsSessionWindow,
  cameraReadinessFromObservedMarks,
  classifyJavascriptResource,
  deterministicGzip,
  deterministicGzipBytes,
  longestInteractionDuration,
  millisecondsUntilSafeTotp,
  nextDifferentOptionValue,
  normalizeResourceInventory,
  parseCliArgs,
  resolveAuthFixture,
  resolveFixtureManifest,
  resolveRouteTemplate,
  totpCode,
} from './run-browser.mjs'

describe('browser performance runner argument boundary', () => {
  const valid = [
    '--app-url', 'http://127.0.0.1:3100',
    '--fixture-manifest', 'fixtures.json',
    '--auth', 'auth.json',
    '--output-dir', 'artifacts',
    '--commit', 'a'.repeat(40),
  ]

  it('parses the complete strict command line', () => {
    expect(parseCliArgs(valid)).toEqual({
      'app-url': 'http://127.0.0.1:3100',
      'fixture-manifest': 'fixtures.json',
      auth: 'auth.json',
      'output-dir': 'artifacts',
      commit: 'a'.repeat(40),
    })
  })

  it('rejects missing, duplicate, unknown, and malformed commit inputs', () => {
    expect(() => parseCliArgs(valid.slice(0, -2))).toThrow(/--commit/u)
    expect(() => parseCliArgs([...valid, '--auth', 'other.json'])).toThrow(/Duplicate/u)
    expect(() => parseCliArgs([...valid, '--retries', '1'])).toThrow(/Unknown/u)
    expect(() => parseCliArgs([...valid.slice(0, -1), 'ABC'])).toThrow(/40-character/u)
  })

  it('hard-rejects every non-loopback or decorated app URL', () => {
    expect(assertLoopbackAppUrl('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100')
    expect(assertLoopbackAppUrl('https://localhost:3443')).toBe('https://localhost:3443')
    expect(assertLoopbackAppUrl('http://[::1]:3100')).toBe('http://[::1]:3100')
    for (const input of [
      'https://posture.example',
      'http://127.0.0.2:3100',
      'ftp://127.0.0.1',
      'http://user:password@127.0.0.1:3100',
      'http://127.0.0.1:3100/dashboard',
      'http://127.0.0.1:3100/?x=1',
    ]) {
      expect(() => assertLoopbackAppUrl(input), input).toThrow(/app-url/u)
    }
  })
})

describe('fixture and auth contracts', () => {
  it('selects a deterministic different assessment option', () => {
    expect(nextDifferentOptionValue(['first', 'second', 'third'], 'first')).toBe('second')
    expect(nextDifferentOptionValue(['first', 'second', 'third'], 'third')).toBe('first')
    expect(nextDifferentOptionValue(['', 'first', 'second'], '')).toBe('first')
    expect(nextDifferentOptionValue(['only'], 'only')).toBeNull()
    expect(nextDifferentOptionValue(['first', 'second'], 'missing')).toBe('first')
  })

  it('resolves the documented browser fixture shape', () => {
    expect(resolveFixtureManifest({
      browser: {
        fixture_id: 'seeded_records_1000',
        client_id: 'client-1',
        assessment_id: 'assessment-1',
        client_display_name: 'Performance Fixture',
        client_search_query: 'Performance',
      },
    })).toEqual({
      fixtureId: 'seeded_records_1000',
      clientId: 'client-1',
      assessmentId: 'assessment-1',
      clientDisplayName: 'Performance Fixture',
      clientSearchQuery: 'Performance',
    })
  })

  it('supports explicit top-level aliases and derives a search prefix', () => {
    expect(resolveFixtureManifest({
      client_id: 'client_2',
      assessment_id: 'assessment_2',
      client_display_name: 'Beta Person',
    })).toMatchObject({ clientSearchQuery: 'Beta' })
  })

  it('fails closed when route placeholders cannot be resolved', () => {
    expect(() => resolveFixtureManifest({ browser: { client_id: 'x' } })).toThrow(/assessment_id/u)
    expect(() => resolveFixtureManifest({
      browser: {
        client_id: 'bad/id',
        assessment_id: 'assessment',
        client_display_name: 'Fixture Person',
        client_search_query: 'Fixture',
      },
    })).toThrow(/URL-safe/u)
  })

  it('accepts both existing auth fixture spellings without exposing secrets', () => {
    expect(resolveAuthFixture({ email: 'a@example.test', password: 'password', secret: 'JBSWY3DPEHPK3PXP' }))
      .toEqual({ email: 'a@example.test', password: 'password', totpSecret: 'JBSWY3DPEHPK3PXP' })
    expect(resolveAuthFixture({ practitioner: { email: 'b@example.test', password: 'password', totp_secret: 'ABC' } }))
      .toMatchObject({ email: 'b@example.test', totpSecret: 'ABC' })
    expect(resolveAuthFixture({ credentials: [
      { fixture_id: 'small', email: 'small@example.test', password: 'password', totp_secret: 'ABC' },
      { fixture_id: 'seeded_records_1000', email: 'large@example.test', password: 'password', totp_secret: 'XYZ' },
    ] }, 'seeded_records_1000')).toEqual({
      email: 'large@example.test',
      password: 'password',
      totpSecret: 'XYZ',
    })
    expect(() => resolveAuthFixture({ credentials: [
      { fixture_id: 'small', email: 'small@example.test', password: 'password', totp_secret: 'ABC' },
      { fixture_id: 'large', email: 'large@example.test', password: 'password', totp_secret: 'XYZ' },
    ] })).toThrow(/no credential/u)
    expect(() => resolveAuthFixture({ email: 'a@example.test' })).toThrow(/password/u)
  })

  it('substitutes only the frozen route placeholders', () => {
    const fixture = { clientId: 'client-1', assessmentId: 'assessment-1' }
    expect(resolveRouteTemplate('/clients/{client_id}', fixture)).toBe('/clients/client-1')
    expect(resolveRouteTemplate('/assessments/{assessment_id}', fixture)).toBe('/assessments/assessment-1')
  })
})

describe('Web Vitals calculations', () => {
  it('calculates the maximum CLS session window with 1s/5s boundaries', () => {
    expect(calculateClsSessionWindow([
      { startTime: 100, value: 0.02, hadRecentInput: false },
      { startTime: 900, value: 0.03, hadRecentInput: false },
      { startTime: 1_950, value: 0.50, hadRecentInput: false },
      { startTime: 2_000, value: 0.80, hadRecentInput: true },
      { startTime: 2_800, value: 0.04, hadRecentInput: false },
      { startTime: 7_901, value: 0.01, hadRecentInput: false },
    ])).toBeCloseTo(0.54)
  })

  it('takes the longest new Event Timing interaction for one document', () => {
    const entries = [
      { document_id: 'old', entry_type: 'event', interaction_id: 1, start_time: 50, duration_milliseconds: 120 },
      { document_id: 'doc', entry_type: 'event', interaction_id: 0, start_time: 101, duration_milliseconds: 500 },
      { document_id: 'doc', entry_type: 'event', interaction_id: 2, start_time: 101, duration_milliseconds: 48 },
      { document_id: 'doc', entry_type: 'event', interaction_id: 2, start_time: 110, duration_milliseconds: 80 },
    ]
    expect(longestInteractionDuration(entries, 'doc', 100)).toBe(80)
    expect(longestInteractionDuration(entries, 'missing', 100)).toBeNull()
  })
})

describe('camera timing provenance', () => {
  it('cannot pass from a ready label without both application-owned marks', () => {
    expect(cameraReadinessFromObservedMarks({
      readiness: 'Posture model ready (GPU)',
      cameraError: '',
      startMarks: [],
      endMarks: [],
    })).toMatchObject({
      outcome: 'pending_missing_app_marks',
      durationMilliseconds: null,
      start_mark_count: 0,
      end_mark_count: 0,
    })
    expect(cameraReadinessFromObservedMarks({
      readiness: 'Posture model ready (GPU)',
      cameraError: '',
      startMarks: [125],
      endMarks: [],
    }).outcome).not.toBe('success')
  })

  it('recognizes the application readiness alert even when its copy omits the word failed', () => {
    expect(cameraReadinessFromObservedMarks({
      readiness: 'Live pose-model initialization timed out. Retry Model',
      cameraError: '',
      poseFailed: true,
      startMarks: [100],
      endMarks: [],
    })).toMatchObject({
      outcome: 'failure',
      detail: 'Live pose-model initialization timed out. Retry Model',
    })
  })

  it('uses only an observed end mark at or after the latest observed start mark', () => {
    expect(cameraReadinessFromObservedMarks({
      readiness: 'Posture model ready (CPU)',
      cameraError: '',
      startMarks: [100, 400],
      endMarks: [350, 925],
    })).toMatchObject({
      outcome: 'success',
      durationMilliseconds: 525,
      observed_start_milliseconds: 400,
      observed_end_milliseconds: 925,
    })
    expect(cameraReadinessFromObservedMarks({
      readiness: 'Posture model ready (CPU)',
      cameraError: '',
      startMarks: [400],
      endMarks: [350],
    }).outcome).toBe('pending_missing_app_marks')
  })
})

describe('deterministic JavaScript accounting', () => {
  const origin = 'http://127.0.0.1:3100'
  const allowed = ['/mediapipe/', '/muscle-viewer/']
  const never = ['/_next/static/']

  it('includes Next assets and excludes only exact allowed same-origin prefixes', () => {
    expect(classifyJavascriptResource('/_next/static/chunks/app.js', origin, allowed, never)).toEqual({
      included: true,
      matchedAllowedPrefix: null,
      resourceUrl: '/_next/static/chunks/app.js',
    })
    expect(classifyJavascriptResource('/mediapipe/pose.js', origin, allowed, never)).toEqual({
      included: false,
      matchedAllowedPrefix: '/mediapipe/',
      resourceUrl: '/mediapipe/pose.js',
    })
    expect(classifyJavascriptResource('/mediapipe-other/pose.js', origin, allowed, never).included).toBe(true)
    expect(classifyJavascriptResource('https://cdn.example/mediapipe/pose.js', origin, allowed, never).included).toBe(true)
  })

  it('uses deterministic gzip level 9 output and safe artifact names', () => {
    const source = 'const posture = true;\n'.repeat(100)
    expect(deterministicGzipBytes(source)).toBe(deterministicGzipBytes(Buffer.from(source)))
    expect(deterministicGzipBytes(source)).toBeGreaterThan(0)
    expect(deterministicGzip(source).readUInt32LE(4)).toBe(0)
    expect(artifactName('/clients/{client_id}')).toBe('clients_client_id')
  })

  it('normalizes resource inventories independently of response arrival order', () => {
    const first = [
      { resource_url: '/z.js', gzip_bytes: 10 },
      { resource_url: '/a.js', gzip_bytes: 20 },
      { resource_url: '/m.js', gzip_bytes: 10 },
    ]
    const second = [first[2], first[0], first[1]]
    expect(normalizeResourceInventory(first)).toEqual(normalizeResourceInventory(second))
    expect(first.map((entry) => entry.resource_url)).toEqual(['/z.js', '/a.js', '/m.js'])
  })
})

describe('runner provenance', () => {
  const budget = {
    throttling: {
      download_bits_per_second: 10_000_000,
      download_bytes_per_second: 1_250_000,
      cpu_slowdown_factor: 4,
    },
  }

  it('marks only the exact frozen GitHub environment as official', () => {
    const metadata = buildRunnerMetadata('123.0.1', budget, {
      GITHUB_ACTIONS: 'true',
      RUNNER_OS: 'Linux',
      ImageOS: 'ubuntu24',
      ImageVersion: '20260720.1',
      RUNNER_ARCH: 'X64',
      PERFORMANCE_APPLICATION_MODE: 'production_next_start',
      PERFORMANCE_DATABASE: 'local_supabase',
    })
    expect(metadata.officialEnvironment).toBe(process.versions.node.startsWith('22.'))
    expect(metadata.runnerFingerprint).toMatchObject({
      runner_provider: 'github_actions',
      runner_image: 'ubuntu-24.04',
      runner_image_version: '20260720.1',
      runner_architecture: 'x64',
      browser_name: 'chromium',
      browser_build: '123.0.1',
    })
    expect(metadata.actualProfiles.throttled_browser_camera).toMatchObject({
      application_mode: 'production_next_start',
      database: 'local_supabase',
      download_bits_per_second: 10_000_000,
      download_bytes_per_second: 1_250_000,
      cpu_slowdown_factor: 4,
    })
    expect(metadata.actualProfiles.throttled_browser_camera).not.toHaveProperty('runner_image_version')
    expect(metadata.actualProfiles.deterministic_bundle).toMatchObject({
      accounting_mode: 'deterministic_gzip',
      gzip_level: 9,
      gzip_mtime_seconds: 0,
    })
    expect(Object.keys(metadata.actualProfiles.throttled_browser_camera).sort()).toEqual([
      'application_mode',
      'browser_engine',
      'cpu_slowdown_factor',
      'database',
      'device_pixel_ratio',
      'download_bits_per_second',
      'download_bytes_per_second',
      'measurement_retries',
      'network_profile',
      'node_major',
      'runner_architecture',
      'runner_image',
      'runner_provider',
      'viewport_height_css_pixels',
      'viewport_width_css_pixels',
      'workers',
    ].sort())
  })

  it('does not bless a developer laptop or unverified app/database mode', () => {
    const metadata = buildRunnerMetadata('123.0.1', budget, {})
    expect(metadata.officialEnvironment).toBe(false)
    expect(metadata.actualProfiles.throttled_browser_camera.application_mode).toBe('unverified')
    expect(metadata.actualProfiles.throttled_browser_camera.database).toBe('unverified')
  })
})

describe('TOTP login helper', () => {
  it('matches the RFC 6238 SHA-1 vector', () => {
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, { digits: 8 })).toBe('94287082')
  })

  it('waits only when the current code is about to roll over', () => {
    expect(millisecondsUntilSafeTotp(5_000)).toBe(0)
    expect(millisecondsUntilSafeTotp(28_000)).toBe(2_050)
  })
})
