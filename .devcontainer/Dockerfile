# Acode Development Container - Standalone Docker Build
# 
# This Dockerfile is for MANUAL Docker builds (docker build/run).
# Usage:
#   docker build -t acode-dev .devcontainer/
#   docker run -it -v $(pwd):/workspaces/acode acode-dev

FROM mcr.microsoft.com/devcontainers/java:1-21-bullseye

ARG ANDROID_PLATFORM=35
ARG ANDROID_BUILD_TOOLS=35.0.0
ARG CMDLINE_TOOLS_VERSION=11076708
ARG NODE_VERSION=22
ARG GRADLE_VERSION=8.11

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV GRADLE_HOME=/opt/gradle
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${GRADLE_HOME}/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Gradle
RUN wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip \
    && ln -s /opt/gradle-${GRADLE_VERSION} ${GRADLE_HOME}

# Install fnm and Node.js
ENV FNM_DIR=/usr/local/fnm
ENV PATH="${FNM_DIR}:${PATH}"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "${FNM_DIR}" --skip-shell \
    && eval "$(${FNM_DIR}/fnm env)" \
    && fnm install ${NODE_VERSION} \
    && fnm default ${NODE_VERSION} \
    && npm install -g pnpm

ENV PATH="${FNM_DIR}/aliases/default/bin:${PATH}"

# Install Android SDK
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && cd ${ANDROID_HOME}/cmdline-tools \
    && wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" -O cmdline-tools.zip \
    && unzip -q cmdline-tools.zip \
    && rm cmdline-tools.zip \
    && mv cmdline-tools latest \
    && yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --licenses 2>/dev/null || true \
    && ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --update \
    && ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager \
        "platform-tools" \
        "platforms;android-${ANDROID_PLATFORM}" \
        "build-tools;${ANDROID_BUILD_TOOLS}"

WORKDIR /workspaces/acode

LABEL maintainer="Acode Foundation"
LABEL description="Development environment for building Acode - Code Editor for Android"
