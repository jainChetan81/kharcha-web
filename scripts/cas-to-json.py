"""Read a CAMS/KFintech CAS PDF with casparser and print its JSON on stdout.

Usage: cas-to-json.py <pdf>   (password on stdin, never on argv)
Errors: one line on stderr, exit 2 for a wrong password, 1 otherwise.
"""
import sys

from casparser import read_cas_pdf
from casparser.exceptions import IncorrectPasswordError

try:
    sys.stdout.write(read_cas_pdf(sys.argv[1], sys.stdin.readline().rstrip("\n"), output="json"))
except IncorrectPasswordError:
    sys.exit(2)
except Exception as error:  # noqa: BLE001 - surface one line, no PDF content
    print(type(error).__name__, file=sys.stderr)
    sys.exit(1)
