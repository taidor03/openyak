"""Standalone entry point for OpenYak backend in desktop mode.

Usage:
    python run.py --port 8100 --data-dir /path/to/app/data
"""

import argparse
import faulthandler
import os
import sys
import traceback


def _patch_macos_26_compat() -> None:
    """Patch platform.mac_ver() on macOS 26+ to return a version tuple
    compatible with oscrypto and other libraries that expect integer
    version components.

    On Darwin >= 26, the native mac_ver() returns ('26.2', ('', '', ''), 'arm64')
    with empty-string versioninfo, causing int('') crashes in libraries like
    oscrypto, pyhanko, xhtml2pdf.

    We rewrite the versioninfo tuple to (26, 2, 0) based on the major.minor
    from the release string, keeping the rest of the signature unchanged.
    """
    if sys.platform != "darwin":
        return

    import platform as _plat

    _orig_mac_ver = _plat.mac_ver

    def _fixed_mac_ver():
        release, versioninfo, machine = _orig_mac_ver()
        # On Darwin 26+, versioninfo contains empty strings instead of ints.
        if versioninfo and versioninfo[0] == "" and release:
            parts = release.split(".")
            major = int(parts[0]) if parts else 26
            minor = int(parts[1]) if len(parts) > 1 else 0
            patch = int(parts[2]) if len(parts) > 2 else 0
            versioninfo = (str(major), str(minor), str(patch))
        return release, versioninfo, machine

    _plat.mac_ver = _fixed_mac_ver


def _install_crash_reporter() -> None:
    """Install global crash handlers so unhandled exceptions are always logged to stderr.

    stderr is piped to backend.log by the desktop shell (Tauri/Electron),
    so this ensures crash tracebacks are captured for diagnosis.
    """
    # faulthandler: prints C-level tracebacks on segfaults, aborts, etc.
    faulthandler.enable(file=sys.stderr, all_threads=True)

    # sys.excepthook: catches unhandled Python exceptions in the main thread
    _original_excepthook = sys.excepthook

    def _crash_excepthook(exc_type, exc_value, exc_tb):
        msg = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        # Write with a clear marker so the desktop shell can detect it
        sys.stderr.write(f"\n[FATAL CRASH] Unhandled exception:\n{msg}\n")
        sys.stderr.flush()
        _original_excepthook(exc_type, exc_value, exc_tb)

    sys.excepthook = _crash_excepthook

    # threading.excepthook: catches unhandled exceptions in spawned threads
    import threading

    _original_thread_excepthook = threading.excepthook

    def _thread_crash_hook(args):
        msg = "".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback))
        sys.stderr.write(
            f"\n[FATAL CRASH] Unhandled exception in thread {args.thread}:\n{msg}\n"
        )
        sys.stderr.flush()
        _original_thread_excepthook(args)

    threading.excepthook = _thread_crash_hook


def main() -> None:
    _patch_macos_26_compat()
    _install_crash_reporter()

    parser = argparse.ArgumentParser(description="OpenYak backend server")
    parser.add_argument("--port", type=int, default=8090, help="Port to listen on")
    parser.add_argument("--data-dir", type=str, default=None, help="Data directory (for desktop mode)")
    parser.add_argument("--resource-dir", type=str, default=None, help="Resource directory (bundled assets from Tauri)")
    args = parser.parse_args()

    # If a data directory is specified, change to it so that SQLite DB,
    # uploads, and other data files are created there.
    if args.data_dir:
        os.makedirs(args.data_dir, exist_ok=True)
        os.chdir(args.data_dir)

    # Store resource dir as env var so the app can find bundled assets (e.g. Node.js)
    if args.resource_dir:
        os.environ["OPENYAK_RESOURCE_DIR"] = args.resource_dir

    import uvicorn
    from app.main import create_app

    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
