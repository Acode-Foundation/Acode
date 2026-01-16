# Acode Development Container (Manual Docker Build)

FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

ARG ANDROID_SDK_VERSION=35
ARG ANDROID_BUILD_TOOLS_VERSION=35.0.0
ARG NODE_MAJOR=22

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"

# Install essential packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    unzip \
    git \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Java 21 (Temurin JDK)
RUN curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-21-jdk \
    && rm -rf /var/lib/apt/lists/*

# Set JAVA_HOME dynamically based on installed JDK
RUN JAVA_DIR=$(dirname $(dirname $(readlink -f $(which java)))) \
    && echo "export JAVA_HOME=$JAVA_DIR" >> /etc/profile.d/java.sh \
    && echo "export JAVA_HOME=$JAVA_DIR" >> ~/.bashrc
ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-arm64

# Install Node.js via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Install Android SDK command-line tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && cd ${ANDROID_HOME}/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip \
    && unzip -q cmdline-tools.zip \
    && rm cmdline-tools.zip \
    && mv cmdline-tools latest

# Accept Android SDK licenses and install required components
RUN yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --licenses 2>/dev/null || true \
    && ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --update \
    && ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager \
        "platform-tools" \
        "platforms;android-${ANDROID_SDK_VERSION}" \
        "build-tools;${ANDROID_BUILD_TOOLS_VERSION}"

# Install Gradle
ARG GRADLE_VERSION=8.11
RUN wget -q https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip \
    && ln -s /opt/gradle-${GRADLE_VERSION}/bin/gradle /usr/local/bin/gradle

WORKDIR /workspaces/acode

LABEL maintainer="Acode Foundation"
LABEL description="Development environment for building Acode - Code Editor for Android"
