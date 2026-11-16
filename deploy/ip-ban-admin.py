#!/usr/bin/env python3
"""Inspect one service's IPv4 cumulative failures; clear only with explicit --clear."""
import argparse
from contextlib import closing
import ipaddress
import json
from pathlib import Path
import sqlite3

SERVICES = {
    "sop": (Path("/var/lib/mxd-sop/ops.sqlite"), "auth_ip_failures"),
    "auto": (Path("/var/lib/mxd-auto-process/auto.sqlite"), "operator_ip_failures"),
}


def inspect_or_clear(database, table, ip, clear=False):
    """Use existing DB only, parameterize IP, and clear no other rows or sessions."""
    if table not in {value[1] for value in SERVICES.values()}:
        raise ValueError("Unknown service table")
    address = ipaddress.ip_address(ip)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if address.version != 4:
        raise ValueError("IPv6 is globally denied; only an IPv4 failure record can be cleared")
    canonical = str(address)
    mode = "rw" if clear else "ro"
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=" + mode, uri=True)) as connection, connection:
        row = connection.execute(f"SELECT failures FROM {table} WHERE ip = ?", (canonical,)).fetchone()
        if clear:
            connection.execute(f"DELETE FROM {table} WHERE ip = ?", (canonical,))
        return {"ip": canonical, "previous_failures": row[0] if row else 0, "cleared": bool(clear and row)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", choices=SERVICES)
    parser.add_argument("ip")
    parser.add_argument("--clear", action="store_true", help="Explicitly remove this service's cumulative count/ban")
    args = parser.parse_args()
    print(json.dumps(inspect_or_clear(*SERVICES[args.service], args.ip, args.clear)))
