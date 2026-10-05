FROM golang:1.25-bookworm AS native
RUN git clone https://github.com/kgretzky/evilginx2.git /src \
 && git -C /src checkout 55579600ca826a94b328d5e0cb35740045a35b2e \
 && test "$(git -C /src rev-parse HEAD)" = 55579600ca826a94b328d5e0cb35740045a35b2e
WORKDIR /src
RUN CGO_ENABLED=0 go build -mod=readonly -o /evilginx .

FROM python:3.13-slim
RUN useradd --uid 10001 --create-home bridge \
 && mkdir /state /profiles /redirectors \
 && chown bridge:bridge /state /redirectors
COPY --from=native /evilginx /usr/local/bin/evilginx
COPY infra/containers/campaign-bridge/lab.yaml /profiles/lab.yaml
COPY infra/containers/campaign-bridge/evilginx_bridge.py /app/evilginx_bridge.py
USER bridge
ENV HOME=/state
EXPOSE 9000 8443
CMD ["python", "/app/evilginx_bridge.py"]
