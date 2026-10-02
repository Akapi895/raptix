# W00 runtime fixtures

`runtime-emitter-capture.json` is produced from the repository's actual Python
streaming emitter in an isolated no-network container. It invokes only emission
methods with harmless fake messages, not graph execution or tools.

Live/checkpoint outputs are deliberately separate: live tool result is full;
checkpoint copy is capped at 8000 characters plus the producer truncation marker.
This is source-emitter contract evidence, not live agent-run acceptance.
