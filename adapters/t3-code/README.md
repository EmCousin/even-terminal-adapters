# Even Terminal for T3 Code

Use T3 Code threads from the Terminal app on Even G2 glasses. The bridge uses the
installed `t3 thread` CLI and the running desktop app. It does not start a separate
Codex session or read or modify the T3 database.

## Connect the adapter

Add a host in the Terminal app on your phone:

| Setting | Value |
| --- | --- |
| Name | T3 Code |
| Provider | Claude (wire compatibility; T3 keeps its own model) |
| Host | Your computer's Tailscale IP, from `tailscale ip -4` |
| Port | 3459 |
| Token | The value of `BRIDGE_TOKEN` configured for this adapter |

Keep Tailscale connected on your phone and computer and keep T3 Code open.
Set `PROJECT_DIR` to a project path registered in T3 Code. The bridge lists threads
from that project. Pass an absolute registered project path as `cwd` when creating
a thread in another project.

## Supported actions

- Browse threads, open history, send voice prompts, and start threads.
- Follow incremental responses, completion, and busy or waiting status.
- Reconnect with SSE replay or poll messages by cursor.

Responses are refreshed about every 1.5 seconds, plus CLI execution time. History
contains the latest 100 messages. The replay buffer holds 500 events per watched
thread and is lost on service restart; history remains in T3 Code.

The installed T3 CLI does not expose interrupt, permission approval, or question
replies. These controls return HTTP 501. Use the T3 Code app for them; waiting
threads show a notification on the glasses. Tool activity is not exposed by this
CLI. This bridge therefore does not provide full OpenCode bridge feature parity.

## Service

For installation, service commands, and private environment files, see the
[root setup guide](../../README.md#run-as-linux-services).

The host uses bearer authentication, including token query parameters for SSE
compatibility. Never publish the token. The bridge defaults to loopback. To reach it from
your phone, set `BIND_HOST=0.0.0.0` or an available Tailscale interface address.
Use Tailscale or a trusted LAN and do not forward the port to the public internet.

## Development

Requires Node 22+, a registered T3 project, and the T3 CLI installed by the desktop
app. Set `BRIDGE_TOKEN` and `PROJECT_DIR` for the npm and service commands.
Without `PROJECT_DIR`, the runtime uses its current directory, which must be a
registered T3 project. Optional settings are `PORT` (3459), `BIND_HOST` (loopback
by default), and `T3_CLI`.

```sh
npm ci
npm run test:t3
npm run check
npm run start:t3
```

Run these commands from the repository root. Tests use a mock client and do not
start agents or change your real threads.

MIT license.
