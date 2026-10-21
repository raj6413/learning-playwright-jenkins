FROM mcr.microsoft.com/playwright:v1.61.0-noble

USER root

RUN apt-get update && \
    apt-get install -y openjdk-21-jre-headless

ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
ENV PATH="$JAVA_HOME/bin:$PATH"

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .