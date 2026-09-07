/**
 * Tests for docker-entrypoint.sh runtime-config.js generation.
 * Runs the actual entrypoint script against a temp directory to verify
 * the real serialization, not a reimplementation.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ENTRYPOINT = join(__dirname, '..', '..', 'docker-entrypoint.sh');

/**
 * Runs the real docker-entrypoint.sh with CONFIG_DIR pointing to a temp
 * directory, then reads and evaluates the produced runtime-config.js.
 */
function runEntrypoint(env: Record<string, string>): { js: string; parsed: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'entrypoint-test-'));
  try {
    // Create a minimal index.html so the sed injection succeeds
    writeFileSync(join(dir, 'index.html'), '<!doctype html><head></head><body></body>');

    // Run the real entrypoint with CONFIG_DIR overridden and `true` as the
    // exec'd command so it exits cleanly.
    execFileSync('bash', [ENTRYPOINT, 'true'], {
      encoding: 'utf8',
      env: { CONFIG_DIR: dir, PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const js = readFileSync(join(dir, 'runtime-config.js'), 'utf8').trim();

    // Evaluate the JS in a sandboxed context to extract the config.
    // Provide atob/TextDecoder since they aren't in Node's global by default
    // in all versions.
    const window: Record<string, unknown> = {};
    const fn = new Function(
      'window', 'atob', 'TextDecoder', 'Uint8Array',
      js,
    );
    fn(window, (s: string) => Buffer.from(s, 'base64').toString('binary'),
       TextDecoder, Uint8Array);

    return { js, parsed: window.__APP_CONFIG__ as Record<string, string> };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('docker-entrypoint config injection', () => {
  it('serializes plain values safely', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: 'eastus2',
      SPEECH_RESOURCE_NAME: 'my-speech',
      TRANSLATOR_ENDPOINT: 'https://translator.example.com',
      TRANSLATOR_REGION: 'westus',
      AZURE_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
      AZURE_TENANT_ID: '22222222-2222-4222-8222-222222222222',
      SIGNALING_ENDPOINT: 'https://api.example.com',
    });
    expect(parsed.speechRegion).toBe('eastus2');
    expect(parsed.translatorEndpoint).toBe('https://translator.example.com');
    expect(parsed.azureClientId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('handles empty environment variables', () => {
    const { parsed } = runEntrypoint({});
    expect(parsed.speechRegion).toBe('');
    expect(parsed.azureClientId).toBe('');
    expect(parsed.signalingEndpoint).toBe('');
  });

  it('handles quotes and backslashes', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: 'region"with"quotes',
      SPEECH_RESOURCE_NAME: 'path\\to\\resource',
    });
    expect(parsed.speechRegion).toBe('region"with"quotes');
    expect(parsed.speechResourceName).toBe('path\\to\\resource');
  });

  it('handles carriage returns and newlines', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: "line1\nline2",
      SPEECH_RESOURCE_NAME: "cr\rhere",
      TRANSLATOR_ENDPOINT: "crlf\r\nend",
    });
    expect(parsed.speechRegion).toBe("line1\nline2");
    expect(parsed.speechResourceName).toBe("cr\rhere");
    expect(parsed.translatorEndpoint).toBe("crlf\r\nend");
  });

  it('handles </script> sequences without injection', () => {
    const { js, parsed } = runEntrypoint({
      SPEECH_REGION: 'before</script><script>alert(1)</script>after',
    });
    expect(parsed.speechRegion).toBe('before</script><script>alert(1)</script>after');
    // The raw JS must not contain an unencoded </script> that would break HTML parsing
    const b64Match = js.match(/atob\("([^"]+)"\)/);
    expect(b64Match).toBeTruthy();
    // The base64 payload should not decode to a literal </script>
    // (it's inside the JSON string with proper escaping, but the JS source itself
    // must not have </script> outside the base64 blob)
    const jsWithoutB64 = js.replace(b64Match![0], '""');
    expect(jsWithoutB64).not.toContain('</script>');
  });

  it('handles shell metacharacters', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: '$(whoami)',
      SPEECH_RESOURCE_NAME: '`id`',
      TRANSLATOR_ENDPOINT: 'foo;rm -rf /',
      TRANSLATOR_REGION: 'foo|bar/baz',
      AZURE_CLIENT_ID: 'a&b<c>d',
    });
    expect(parsed.speechRegion).toBe('$(whoami)');
    expect(parsed.speechResourceName).toBe('`id`');
    expect(parsed.translatorEndpoint).toBe('foo;rm -rf /');
    expect(parsed.translatorRegion).toBe('foo|bar/baz');
    expect(parsed.azureClientId).toBe('a&b<c>d');
  });

  it('handles Unicode characters', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: '日本語テスト',
      SPEECH_RESOURCE_NAME: 'émojis: 🎉🚀',
      TRANSLATOR_ENDPOINT: 'Ñoño',
    });
    expect(parsed.speechRegion).toBe('日本語テスト');
    expect(parsed.speechResourceName).toBe('émojis: 🎉🚀');
    expect(parsed.translatorEndpoint).toBe('Ñoño');
  });

  it('handles trailing whitespace', () => {
    const { parsed } = runEntrypoint({
      SPEECH_REGION: 'value   ',
      SPEECH_RESOURCE_NAME: '  leading',
      TRANSLATOR_ENDPOINT: ' both ',
    });
    expect(parsed.speechRegion).toBe('value   ');
    expect(parsed.speechResourceName).toBe('  leading');
    expect(parsed.translatorEndpoint).toBe(' both ');
  });

  it('produces valid JS without unsafe-inline patterns', () => {
    const { js } = runEntrypoint({ SPEECH_REGION: 'test' });
    // Must be a window.__APP_CONFIG__ assignment (external script, no inline)
    expect(js).toContain('window.__APP_CONFIG__=');
    expect(js).not.toContain('<script');
  });
});
