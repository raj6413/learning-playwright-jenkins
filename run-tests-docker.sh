#!/bin/bash
set -e

# Default environment
ENV="${ENV:-qa}"

# Create host directories for artifacts
mkdir -p test-results playwright-report

# Execute Playwright inside Docker
docker run --rm --init --ipc=host \
  -e ENV="$ENV" \
  -v "$PWD/test-results:/app/test-results" \
  -v "$PWD/playwright-report:/app/playwright-report" \
  playwright-runner:latest \
  npx playwright test "$@" --no-deps