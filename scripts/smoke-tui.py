# /// script
# requires-python = ">=3.10"
# dependencies = ["pyte==0.8.2"]
# ///
"""Check both plugins through the real OpenCode terminal loader.

Run `uv run scripts/smoke-tui.py` after configuring the built packages in
cli.json. This opens /plugins without sending a model prompt or restarting
the shared server. It requires a working local OpenCode installation.
"""

import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import termios
import time

import pyte


def plugin_screen():
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
    env = os.environ.copy()
    settings = json.loads(env.get("OPENCODE_CLI_CONFIG_CONTENT", "{}"))
    settings.update(animations=False, tabs={"mode": "off"})
    env.update(
        TERM="xterm-256color",
        COLORTERM="truecolor",
        OPENCODE_CLI_CONFIG_CONTENT=json.dumps(settings),
    )
    process = subprocess.Popen(
        ["opencode"], stdin=slave, stdout=slave, stderr=slave,
        env=env, start_new_session=True,
    )
    os.close(slave)
    screen = pyte.Screen(140, 45)
    stream = pyte.Stream(screen)
    started = time.monotonic()
    typed_at = None
    entered = False
    try:
        while time.monotonic() - started < 20 and process.poll() is None:
            text = "\n".join(line.rstrip() for line in screen.display)
            if typed_at is None and "Ask anything" in text:
                os.write(master, b"/plugins")
                typed_at = time.monotonic()
            if typed_at is not None and not entered and time.monotonic() - typed_at > 1:
                os.write(master, b"\r")
                entered = True
            if (entered and "check for updates" in text and "Server" in text
                    and "Finishing startup" not in text
                    and time.monotonic() - typed_at > 6):
                return text
            if select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                stream.feed(data.decode(errors="replace"))
                if b"\x1b[6n" in data:
                    os.write(master, b"\x1b[1;1R")
        raise RuntimeError("OpenCode did not display the plugin list")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        os.close(master)


screen = plugin_screen()
print(screen)
tui = screen.split("TUI", 1)[1].split("Server", 1)[0]
for plugin in ("kit.pr-tracker", "kit.session-recap"):
    rows = [line for line in tui.splitlines() if plugin in line]
    if len(rows) != 1 or "failed" in rows[0]:
        raise SystemExit(f"FAIL: {plugin} is not active in the TUI")
print("PASS: both Kit plugins loaded in the real OpenCode TUI")
