"""Archon Monitor Daemon entry point — run with: python3 -m src.archon_monitor

Starts the persistent MonitorDaemon singleton that serves all Claude Code
sessions over Unix socket at ~/.archon/monitor/monitor.sock.

Designed to be managed by launchd (com.archon.monitor) with KeepAlive=true.
"""
import asyncio
import logging
import signal
import sys

from .daemon import LOG_FILE, MonitorDaemon


async def _main() -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s: %(message)s",
        handlers=[
            logging.FileHandler(str(LOG_FILE)),
            logging.StreamHandler(sys.stderr),
        ],
    )

    daemon = MonitorDaemon()
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _handle_signal() -> None:
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _handle_signal)

    await daemon.start()
    run_task = asyncio.create_task(daemon.run_forever())

    await stop_event.wait()
    run_task.cancel()
    try:
        await run_task
    except asyncio.CancelledError:
        pass
    await daemon.stop()


if __name__ == "__main__":
    asyncio.run(_main())
