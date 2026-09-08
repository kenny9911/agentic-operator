# Build only with a reviewed Node 26.8.1 Debian image digest. The resulting
# image ID must also be explicitly approved by the Skill runner host.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG PYTHON_DEBIAN_VERSION
USER root
RUN test "$(node -p 'process.versions.node')" = "26.8.1" \
    && test -n "$PYTHON_DEBIAN_VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends "python3=$PYTHON_DEBIAN_VERSION" \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/agentic /skill /scratch \
    && chown 65532:65532 /skill /scratch
COPY deploy/skill-runner/skill-runner.cjs /opt/agentic/skill-runner.cjs
USER 65532:65532
WORKDIR /scratch
ENTRYPOINT ["/usr/local/bin/node", "--disable-sigusr1", "/opt/agentic/skill-runner.cjs"]
