# Native release includes the compiler assets required for real lab enrolment.
FROM python:3.13-slim@sha256:bb2988715db2cf7ace7b53f38f3cffbef7c7046a656bee66245eb0ed386e2e81 AS native
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -fL https://github.com/BishopFox/sliver/releases/download/v1.7.7/sliver-server_linux-amd64 -o /sliver-server \
 && echo '10c78c3b6e9398797d3c1546c95c2db507f64d4bbd9932068a89ee4a8889e0c5  /sliver-server' | sha256sum -c - \
 && chmod 755 /sliver-server
RUN git clone --depth 1 --branch v1.7.7 --filter=blob:none --sparse https://github.com/BishopFox/sliver.git /src \
 && git -C /src sparse-checkout set protobuf \
 && test "$(git -C /src rev-parse HEAD)" = 0aa7e5bf962414823f12c3a8ea1f667f61b19ce2
RUN pip install --no-cache-dir grpcio-tools==1.71.0 grpcio==1.71.0 protobuf==5.29.4
WORKDIR /src/protobuf
RUN mkdir /gen && python -m grpc_tools.protoc -I. --python_out=/gen --grpc_python_out=/gen \
    commonpb/common.proto clientpb/client.proto sliverpb/sliver.proto rpcpb/services.proto \
 && PYTHONPATH=/gen python -c 'import rpcpb.services_pb2_grpc'

FROM python:3.13-slim@sha256:bb2988715db2cf7ace7b53f38f3cffbef7c7046a656bee66245eb0ed386e2e81
RUN useradd --uid 10001 --create-home c2bridge && mkdir /state /app && chown c2bridge:c2bridge /state
RUN pip install --no-cache-dir grpcio==1.71.0 protobuf==5.29.4
COPY --from=native /sliver-server /usr/local/bin/sliver-server
COPY --from=native /gen /app/gen
COPY --from=native /src/LICENSE /app/SLIVER_LICENSE
COPY infra/containers/sliver-bridge/sliver_bridge.py infra/containers/sliver-bridge/entrypoint.sh /app/
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh
USER c2bridge
ENV HOME=/state
EXPOSE 9000
CMD ["/app/entrypoint.sh"]
