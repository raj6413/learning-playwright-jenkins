
# API Testing Strategy

## API Contract Testing

API contract testing verifies that providers and consumers agree on the API structure and behaviour.

Important checks include:
- Endpoint removal
- HTTP method changes
- Request property removal
- Response property type changes
- Newly required request properties
- Enum value removal

Breaking changes should be mapped to impacted automated tests.

## API Automation

A mature API automation framework should support:
- Positive and negative scenarios
- Authentication and authorization
- Schema validation
- Boundary testing
- Contract testing
- API response time validation

API test results should be connected to requirements and release quality gates.