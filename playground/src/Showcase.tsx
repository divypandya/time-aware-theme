/**
 * A small but real interface, themed entirely from the `--tat-*` tokens.
 *
 * Swatches tell you what the colours are; they do not tell you whether a theme
 * is pleasant to read a table in at 4am. The point of a playground is that the
 * answer to the second question is the one people actually have, so this is an
 * interface rather than a palette.
 */
export function Showcase() {
  return (
    <div className="showcase">
      <nav className="nav" aria-label="Example navigation">
        <span className="nav-brand">Northwind</span>
        <span className="nav-links">
          <a className="nav-link is-current" href="#showcase">
            Overview
          </a>
          <a className="nav-link" href="#showcase">
            Reports
          </a>
          <a className="nav-link" href="#showcase">
            Settings
          </a>
        </span>
        <button className="btn btn-accent" type="button">
          New report
        </button>
      </nav>

      <section className="panel">
        <h3>Quarterly summary</h3>
        <p className="muted">
          Body copy at the size most of an interface actually is. If a theme is
          going to be tiring, this is where it shows — not in a swatch.
        </p>

        <div className="row">
          <button className="btn btn-accent" type="button">
            Primary
          </button>
          <button className="btn" type="button">
            Secondary
          </button>
          <span className="chip">Draft</span>
          <span className="chip chip-accent">Live</span>
        </div>

        <label className="field">
          <span>Search</span>
          <input defaultValue="revenue by region" type="text" />
        </label>
      </section>

      <section className="panel">
        <table>
          <caption className="muted">Top regions, last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col">Revenue</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['North', '£128,400', '+4.2%'],
              ['South', '£96,110', '−1.8%'],
              ['Central', '£74,905', '+11.6%']
            ].map(([region, revenue, change]) => (
              <tr key={region}>
                <th scope="row">{region}</th>
                <td>{revenue}</td>
                <td>{change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <pre>
          <code>{`import dawnToDusk from '@divypandya/time-aware-theme/presets/dawn-to-dusk';
import { createThemeController } from '@divypandya/time-aware-theme/dom';

createThemeController({ system: dawnToDusk, document }).start();`}</code>
        </pre>
      </section>
    </div>
  );
}
