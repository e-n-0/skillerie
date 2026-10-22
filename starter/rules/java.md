---
paths:
  - "**/*.java"
  - "**/pom.xml"
  - "**/build.gradle*"
---

# Java

## Architecture

- Keep service boundaries and domain responsibilities clear.
- Use ports and adapters where they fit the service's integration boundaries.
- Keep domain logic independent of transport and persistence details.

## Style and errors

- Follow the project's Java version and established nullability conventions.
- Use `Optional<T>` for absent return values where it fits the API contract.
- Use specific exceptions for domain failures.
- Avoid catching `Exception` broadly; catch the types the code can handle.
- For HTTP APIs, follow the project's error response conventions and use
  standard problem details when the service supports them.

## Testing and dependencies

- Use the test framework configured by the repository.
- Cover positive and negative behavior.
- Prefer versions compatible with the project's declared toolchain and
  dependency policy.
- Run the repository's focused test and build commands. Use broader validation
  when the change warrants it.
