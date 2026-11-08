"""Runs the development server for browser checks with photographs kept on local disk.

    uv run --env-file ../../.env python tools/studio_scratch_server.py [--port 8001]

The environment file selects the development R2 buckets, and an upload made while exploring the
Studio would land there for good. This launcher forces the filesystem media store with a fresh
directory, then loads the settings the server will use and refuses to start unless they say
filesystem. Only the store name is checked or printed.
"""

import argparse
import os
import subprocess
import sys
import tempfile

MARKER = "media-store="
PROBE = f"from django.conf import settings; print('{MARKER}' + settings.MEDIA_STORE)"


def isolated_environment(media_root):
    environment = dict(os.environ)
    environment["MEDIA_STORE"] = "filesystem"
    environment["MEDIA_ROOT"] = media_root

    return environment


def effective_store(environment):
    probe = subprocess.run(
        [sys.executable, "manage.py", "shell", "-c", PROBE],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in probe.stdout.splitlines() if line.startswith(MARKER)]

    return lines[-1].removeprefix(MARKER) if probe.returncode == 0 and lines else None


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", default="8001")
    arguments = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="serendipeak-media-") as media_root:
        environment = isolated_environment(media_root)
        if effective_store(environment) != "filesystem":
            sys.exit("Refusing to start: the media store is not the local filesystem.")

        print(f"Photographs of this server go to {media_root} and are deleted when it stops.")
        subprocess.run(
            [sys.executable, "manage.py", "runserver", "--noreload", arguments.port],
            env=environment,
            check=False,
        )


if __name__ == "__main__":
    main()
