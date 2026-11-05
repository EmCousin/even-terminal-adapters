# Even Terminal adapters

Use OpenCode and T3 Code from the Terminal app on Even G2 glasses. Each adapter
runs as a separate HTTP service. Select **Claude** as the provider in the phone
app for protocol compatibility. Each coding app keeps its configured models.

| Adapter | Default port | Live responses | History and prompts | Approvals and question replies | Interrupt |
| --- | --- | --- | --- | --- | --- |
| [OpenCode](adapters/opencode/README.md) | 3458 | Upstream event stream | Yes | Yes | Yes |
| [T3 Code](adapters/t3-code/README.md) | 3459 | CLI polling | Yes | In the T3 app | In the T3 app |

## Start an adapter

Requires Node.js 22 or newer, the Terminal app on your glasses, and the coding app
running on the same computer under your user account.

1. Clone the repository and install its dependencies.

   ```sh
   git clone https://github.com/EmCousin/even-terminal-adapters.git
   cd even-terminal-adapters
   npm ci
   ```

2. Generate a private token. Save it and reuse it when restarting the adapter.

   ```sh
   export BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
   ```

3. Start the adapter you want to use.

   ```sh
   npm run start:opencode
   ```

   For T3 Code, set a registered project path and a bind address reachable from
   the phone, then start its adapter.

   ```sh
   export PROJECT_DIR=/absolute/path/to/your/project
   export BIND_HOST=0.0.0.0
   npm run start:t3
   ```

4. Add a host in the Terminal app on your phone. Use your computer's Tailscale IP,
   the adapter's port, the saved token, and **Claude** as the provider.

Keep Tailscale connected on the phone and computer. Keep the coding app and the
adapter running. Traffic is HTTP, so use Tailscale or a trusted LAN. Do not expose
these ports to the public internet. OpenCode binds to all interfaces. T3 defaults
to loopback until you set `BIND_HOST`.

## Run as Linux services

The included systemd user units use the mise Node shim. If Node is installed
another way, replace the executable path in each unit's `ExecStart`.

1. Install the complete directory structure. The adapters import `shared/`, so
   copying an individual adapter directory is insufficient. Use a real install
   directory. Symlinked entrypoints are unsupported.

   ```sh
   install -d "$HOME/.local/lib/even-terminal-adapters"
   cp -R adapters shared services package.json package-lock.json LICENSE \
     "$HOME/.local/lib/even-terminal-adapters/"
   (cd "$HOME/.local/lib/even-terminal-adapters" && npm ci --omit=dev)
   ```

2. Create private environment files in `~/.config/even-terminal/`. Use mode `0600`.
   Existing environment files from the standalone adapters can be reused.

   | File | Settings |
   | --- | --- |
   | `opencode.environment` | `BRIDGE_TOKEN`, optionally `PORT=3458` and `PROJECT_DIR` |
   | `t3.environment` | `BRIDGE_TOKEN`, `PROJECT_DIR`, `BIND_HOST=0.0.0.0`, optionally `PORT=3459` and `T3_CLI` |

   Set each `BRIDGE_TOKEN` to a saved random token. Set T3's `PROJECT_DIR` to an
   absolute registered project path. Never commit environment files or tokens.

3. Install and start the units for the adapters you use.

   ```sh
   install -d "$HOME/.config/systemd/user"
   cp services/even-terminal-opencode.service services/even-terminal-t3.service \
     "$HOME/.config/systemd/user/"
   systemctl --user daemon-reload
   systemctl --user enable --now even-terminal-opencode even-terminal-t3
   ```

For existing services, restart each one after replacing its unit. Ports, tokens,
and service names stay the same, so existing phone host entries remain valid.
Keep the old standalone install directories until you verify both hosts.

Inspect a service with `systemctl --user status even-terminal-t3` or
`journalctl --user -u even-terminal-t3 -n 30`. Substitute `opencode` for the other
adapter. Stop an adapter with `systemctl --user disable --now even-terminal-t3`.

## Development

One package and lockfile cover both adapters. Provider-specific clients, protocol
translation, and tests live under `adapters/<name>/`. SSE replay and its tests live
under `shared/`. There is no common upstream client abstraction.

```sh
npm ci
npm test
npm run check
```

Use `npm run test:opencode` or `npm run test:t3` for one adapter and the shared
replay tests. Tests use mock servers or clients. They do not change real sessions.

This repository was renamed from `even-terminal-opencode`. The OpenCode Git
history is preserved.

## License

[MIT](LICENSE).
