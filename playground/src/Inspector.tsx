import { useMemo, useState } from 'react';
import { inspect } from '@divypandya/time-aware-theme/inspect';
import type { PresetEntry } from './presets';

/**
 * What the resolver produced at this minute, and whether it is legible.
 *
 * The contrast table is the part worth having. The package's claim is that
 * every declared pair stays above its level at every minute of the day; a
 * badge asserts that, and this lets someone check it by dragging a slider.
 * Scrub to the switch and the ratios fall to just above their floor.
 */
export function Inspector({
  preset,
  minute
}: {
  readonly preset: PresetEntry;
  readonly minute: number;
}) {
  const report = useMemo(
    () => inspect(preset.system, minute),
    [preset, minute]
  );
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(key);
        window.setTimeout(() => {
          setCopied((current) => (current === key ? null : current));
        }, 1200);
      },
      () => {
        // Clipboard access can be refused; the value is on screen regardless.
      }
    );
  };

  return (
    <aside className="inspector">
      <section>
        <h2>
          Contrast
          {report.snapshot.holding ? (
            <span className="badge">holding</span>
          ) : null}
        </h2>
        <table className="ratios">
          <tbody>
            {report.roles.map((role) => (
              <tr key={`${role.bg}-${role.fg}`}>
                <th scope="row">
                  {role.fg} <span className="muted">on</span> {role.bg}
                </th>
                <td>{role.actual.toFixed(2)}:1</td>
                <td className="need">{role.required}:1</td>
                <td data-pass={role.passes ? '' : undefined}>
                  {role.passes ? '✓' : 'FAIL'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Tokens</h2>
        <ul className="tokens">
          {report.tokens.map((token) => (
            <li key={token.key}>
              <button
                className="token"
                type="button"
                onClick={() => {
                  copy(token.key, token.css);
                }}
                title="Copy value"
              >
                <span className="dot" style={{ background: token.css }} />
                <span className="token-key">{token.key}</span>
                <span className="token-value">
                  {copied === token.key ? 'copied' : token.css}
                </span>
                {token.outOfGamut ? (
                  <span className="badge badge-warn">gamut</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Install</h2>
        <pre className="install">
          <code>{`npm i @divypandya/time-aware-theme`}</code>
        </pre>
        <pre className="install">
          <code>{`import ${camel(preset.id)} from
  '@divypandya/time-aware-theme/presets/${preset.id}';`}</code>
        </pre>
      </section>
    </aside>
  );
}

function camel(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
