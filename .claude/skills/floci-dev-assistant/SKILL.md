---
name: floci-dev-assistant
description: >
  Expert guide for developing with Floci — the Java/Quarkus-based open-source local AWS emulator.
  Use this skill whenever someone asks about adding a new AWS service to Floci, implementing AWS
  protocol-compatible handlers, writing integration or unit tests for Floci services, debugging
  AWS SDK compatibility issues, configuring storage modes, understanding Floci's architecture,
  working on the Floci codebase, or using Floci as a local AWS development environment.
  Always trigger this skill when the user mentions Floci, AWS emulator development, service
  implementation, AwsQueryController, AwsJson11Controller, StorageFactory, or any task involving
  the floci codebase — even if they don't explicitly say "Floci skill."
---

# Floci Developer Assistant

Floci is a Java 25 + Quarkus 3.x local AWS emulator. It listens on port **4566** and speaks
real AWS wire protocols — meaning any unmodified AWS SDK or CLI can point at it and just work.

Before diving into tasks, understand what kind of help is needed:

- **"Add a new service"** → Read `agents/service-implementer.md`
- **"Write tests"** → Read `agents/test-writer.md`
- **"Debug an AWS compatibility issue"** → Read `agents/debug-assistant.md`
- **"Deploy frontend to AWS (CDK + S3 + CloudFront)"** → Read `agents/cdk-frontend-deploy.md`
- **"Explain the architecture"** → Use the Architecture section below
- **"Configure storage / config entries"** → Use the Configuration section below
- **"Run or build"** → See Quick Commands below

---

## Quick Commands

```bash
./mvnw quarkus:dev                              # Dev mode with hot reload on port 4566
./mvnw test                                     # All tests
./mvnw test -Dtest=SsmIntegrationTest           # One test class
./mvnw test -Dtest=SsmIntegrationTest#putParameter  # One test method
./mvnw clean package -DskipTests               # Build JAR (skip tests)
docker compose up                               # Run via Docker
```

---

## Architecture (3 Layers)

```
Request → Controller/Handler → Service → Storage
              (thin)           (logic)    (via StorageFactory)
```

### Layer 1: Controller / Handler
- Parses AWS protocol input (form-encoded, JSON, XML, REST path)
- Produces AWS-compatible responses
- Must stay **thin** — no business logic here

### Layer 2: Service (`@ApplicationScoped`)
- All domain logic lives here
- Always throws `AwsException` for errors (never raw HTTP exceptions)
- Injected via `@Inject`

### Layer 3: Model
- Plain Java POJOs / records
- No framework annotations

### Key Infrastructure Classes

| Class | Purpose |
|---|---|
| `AwsQueryController` | Base for Query-protocol services (SQS, SNS, IAM, STS…) |
| `AwsJson11Controller` | Base for JSON 1.1 services (SSM, EventBridge, KMS…) |
| `AwsException` | Throw this for all AWS-level errors |
| `AwsExceptionMapper` | Converts `AwsException` to correct wire-format error response |
| `StorageFactory` | **Always** use this — never instantiate storage directly |
| `EmulatorConfig` | All configuration lives here |
| `ServiceRegistry` | Service metadata and enablement checks |
| `ResolvedServiceCatalog` | Register `ServiceDescriptor` for each service here |
| `XmlBuilder` | Build XML responses (do not concatenate strings) |
| `XmlParser` | Parse XML (do not use regex) |
| `AwsNamespaces` | Constants for AWS XML namespaces |
| `EmulatorLifecycle` | Load/flush hooks for startup and shutdown |

### Package Layout

```
io.github.hectorvent.floci.config         ← EmulatorConfig and config interfaces
io.github.hectorvent.floci.core.common    ← Shared infrastructure (see table above)
io.github.hectorvent.floci.core.storage   ← StorageBackend, StorageFactory
io.github.hectorvent.floci.lifecycle      ← EmulatorLifecycle
io.github.hectorvent.floci.services.<svc> ← One package per AWS service
  └── <Svc>Controller.java or <Svc>Handler.java
  └── <Svc>Service.java
  └── model/
```

---

## AWS Protocol Quick Reference

Floci must implement the same wire protocol that the real AWS uses.
**Never invent custom endpoints** — the AWS SDK must work without modification.

| Protocol | Example Services | Request Shape | Response | Base Class |
|---|---|---|---|---|
| **Query** | SQS, SNS, IAM, STS, RDS, CloudFormation | form-encoded POST with `Action=` | XML | `AwsQueryController` |
| **JSON 1.1** | SSM, EventBridge, Kinesis, KMS, Cognito, Secrets Manager | POST with `X-Amz-Target` header | JSON | `AwsJson11Controller` |
| **REST JSON** | Lambda, API Gateway, SES v2 | REST path (GET/POST/DELETE…) | JSON | JAX-RS `@Path` |
| **REST XML** | S3 | REST path | XML | JAX-RS `@Path` |
| **TCP proxy** | ElastiCache, RDS | Raw socket | native | Custom proxy |

**Special cases to remember:**
- CloudWatch supports both Query AND JSON 1.1 — keep both aligned
- Cognito well-known endpoints (`/.well-known/openid-configuration`) are OIDC REST, not AWS management
- SQS and SNS have multiple compatibility paths — do not let them drift

---

## Error Handling

Always use `AwsException`:

```java
throw new AwsException("ParameterNotFound",
    "Parameter /app/db/host does not exist.", 400);
```

`AwsExceptionMapper` automatically converts this to the correct wire-format:
- JSON 1.1: `{"__type": "ParameterNotFound", "message": "..."}`
- Query (XML): `<ErrorResponse><Error><Code>ParameterNotFound</Code>...`

---

## Storage Rules

Storage modes supported: `memory`, `persistent`, `hybrid`, `wal`.

```java
// In a Service constructor — inject via StorageFactory
@Inject
public MyService(StorageFactory storageFactory) {
    this.store = storageFactory.create("my-service-key", MyModel.class);
}
```

When adding storage-backed behavior, update **all four** locations:
1. `EmulatorConfig` — add a `StorageConfig` entry
2. `src/main/resources/application.yml` — add default values
3. `src/test/resources/application.yml` — add test values (usually `memory` mode)
4. Register in `StorageFactory` if a new storage type is introduced

---

## Configuration

Config lives under `floci.*`. Environment variables follow `FLOCI_*` convention
(e.g., `floci.base-url` → `FLOCI_BASE_URL`).

When adding config:
1. Add a field to `EmulatorConfig` (or a nested config interface)
2. Add a default to `src/main/resources/application.yml`
3. Add a test default to `src/test/resources/application.yml` if needed
4. Update `docs/configuration/` if the setting is user-facing

---

## Adding a New AWS Service (checklist)

For a detailed walkthrough read `agents/service-implementer.md`.

1. Create package `services/<svc>/` with Handler, Service, `model/`
2. Choose the correct protocol (see table above)
3. Extend `AwsQueryController` or `AwsJson11Controller`, or add JAX-RS `@Path`
4. Implement a `switch` on `Action` / `X-Amz-Target`
5. Add a `ServiceDescriptor` to `ResolvedServiceCatalog`
6. Add config to `EmulatorConfig` and `application.yml`
7. Write `*IntegrationTest.java` (RestAssured + `@QuarkusTest`) and `*ServiceTest.java` (JUnit 5 unit tests)

---

## Writing Tests (quick reference)

For a detailed guide read `agents/test-writer.md`.

**Integration test skeleton (JSON 1.1 protocol):**

```java
@QuarkusTest
class MyServiceIntegrationTest {
    @Test
    void createResource() {
        given()
            .header("X-Amz-Target", "MyService.CreateResource")
            .contentType("application/x-amz-json-1.1")
            .body("""{"Name": "test"}""")
        .when()
            .post("/")
        .then()
            .statusCode(200)
            .body("ResourceId", notNullValue());
    }
}
```

**Unit test skeleton:**

```java
class MyServiceTest {
    private MyService service;

    @BeforeEach
    void setUp() {
        service = new MyService(new InMemoryStorage<>());
    }

    @Test
    void createThrowsWhenNameExists() {
        service.create("foo");
        assertThrows(AwsException.class, () -> service.create("foo"));
    }
}
```

---

## Debugging AWS Compatibility Issues

For a systematic approach read `agents/debug-assistant.md`.

Quick checklist:
- Is the response shape exactly matching AWS? (field names, nesting, casing)
- Is the error code matching what the real AWS returns?
- Is the Content-Type correct for the protocol?
- Does the XML namespace match `AwsNamespaces` constants?
- Is the AWS SDK using `X-Amz-Target` (JSON 1.1) or `Action=` (Query)?

---

## Commit Message Format (Conventional Commits)

| Prefix | When | Bump |
|---|---|---|
| `feat:` | New AWS API action or service | minor |
| `fix:` | Bug fix or AWS compat correction | patch |
| `perf:` | Performance improvement | patch |
| `docs:` | Documentation only | none |
| `chore:` | Build, CI, dependencies | none |
| `BREAKING CHANGE:` | In footer or `!` suffix | major |

Do **not** add `Co-Authored-By` trailers for AI tools.
