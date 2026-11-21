"""Sinh YT_PASSWORD_HASH:  python -m app.hashpw   (hỏi mật khẩu, không hiện trên màn hình)"""

from __future__ import annotations

import getpass
import sys

from .auth import hash_password


def main() -> int:
    pw = getpass.getpass("Mật khẩu: ")
    if len(pw) < 8:
        print("Mật khẩu nên dài ít nhất 8 ký tự.", file=sys.stderr)
        return 1
    if getpass.getpass("Nhập lại: ") != pw:
        print("Hai lần nhập không khớp.", file=sys.stderr)
        return 1
    print(f"YT_PASSWORD_HASH='{hash_password(pw)}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
