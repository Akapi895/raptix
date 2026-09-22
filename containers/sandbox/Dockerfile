# Production sandbox image for command capabilities.
#
# It carries only the tools the catalog declares, runs as a non-root user, and
# has no shell-based entrypoint: execution invokes a binary directly. Build with:
#
#   docker build -f containers/sandbox/Dockerfile -t raptix/sandbox:latest .
#
# and point config at it with:
#
#   sandbox:
#     mode: container
#     image: raptix/sandbox:latest
FROM alpine:3.20

RUN apk add --no-cache nmap nmap-scripts \
    && addgroup -S sandbox \
    && adduser -S -G sandbox -h /home/sandbox sandbox

USER sandbox
WORKDIR /home/sandbox

# No ENTRYPOINT: execution passes the capability binary and validated args as the
# container command, so user input never reaches a shell.
