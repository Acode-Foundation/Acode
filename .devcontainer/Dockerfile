# Acode Development Container
#
# Devcontainer usage: automatic via devcontainer.json
# Standalone usage:
#   docker build --target standalone -t acode-dev .devcontainer/
#   docker run -it -v $(pwd):/workspaces/acode acode-dev

FROM mcr.microsoft.com/devcontainers/java:1-21-bullseye AS base

ARG ANDROID_PLATFORM=36
ARG ANDROID_BUILD_TOOLS=36.0.0
ARG CMDLINE_TOOLS_VERSION=11076708
ARG NODE_VERSION=22
ARG GRADLE_VERSION=8.11

ENV GRADLE_HOME=/opt/gradle

# removes broken yarn repo present in base image
RUN rm -f /etc/apt/sources.list.d/yarn.list

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Gradle
RUN wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip \
    && ln -s /opt/gradle-${GRADLE_VERSION} ${GRADLE_HOME}

ENV PATH="${PATH}:${GRADLE_HOME}/bin"

WORKDIR /workspaces/acode

LABEL org.opencontainers.image.authors="Acode Foundation <https://github.com/Acode-Foundation/Acode>"
LABEL description="Development environment for building Acode - Code Editor for Android"


# Devcontainer stage
# Android SDK and Node handled by devcontainer features.
FROM base AS devcontainer


# Standalone stage 
# Includes Android SDK and Node/pnpm for plain docker build/run usage.
FROM base AS standalone

ENV ANDROID_HOME=/usr/local/lib/android
ENV ANDROID_SDK_ROOT=/usr/local/lib/android
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}"

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

# Install fnm and Node.js
ENV FNM_DIR=/usr/local/fnm
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "${FNM_DIR}" --skip-shell \
    && eval "$(${FNM_DIR}/fnm env)" \
    && fnm install ${NODE_VERSION} \
    && fnm default ${NODE_VERSION} \
    && npm install -g pnpm

ENV PATH="${FNM_DIR}/aliases/default/bin:${PATH}"
