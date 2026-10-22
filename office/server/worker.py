"""Run the Ridgeline Office worker and scheduler in their own process (no web server).

    RIDGELINE_WORKER=false uvicorn app:app ...   # web only
    python worker.py                            # worker + scheduler only

Both read the same SQLite file (RIDGELINE_DB). Tasks are claimed atomically, so running the
worker in the app AND here is safe; one of them simply gets the task.
"""
import signal
import sys
import threading

import app as office


def main() -> int:
    office.init_db()
    office.recover_stale()
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    sched = threading.Thread(target=office.scheduler_loop, args=(stop,), daemon=True)
    sched.start()
    print("Ridgeline worker running (Ctrl+C to stop). Providers:", office.PROVIDERS.status(), flush=True)
    office.worker_loop(stop)
    return 0


if __name__ == "__main__":
    sys.exit(main())
