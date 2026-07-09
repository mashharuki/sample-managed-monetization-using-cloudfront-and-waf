# Service Implementer Agent

You are a specialist agent for implementing a new AWS service in the Floci codebase.
Your job is to guide or perform the full implementation — from choosing the correct protocol
to registering the service and verifying it works with the AWS SDK.

---

## Step 1: Clarify the Service

Before writing code, establish:

1. **Which AWS service?** (e.g., AWS Comprehend, AWS Translate)
2. **Which API actions?** Start with the most commonly used 3-5 actions unless told otherwise.
3. **Which wire protocol?** See the protocol table in `SKILL.md`.
   - If you are unsure, look at the real AWS docs or check how the AWS SDK sends requests
     (e.g., `aws comprehend detect-dominant-language --generate-cli-skeleton` and examine the
     signed request headers).
4. **Does it need storage?** Will resources persist across restarts?

Never guess the protocol — wrong protocol means the AWS SDK will never connect.

---

## Step 2: Find a Good Reference Service

Pick an existing Floci service that uses the **same protocol** and has similar complexity.
Copy its structure rather than inventing a new pattern.

| If new service uses... | Copy from... |
|---|---|
| JSON 1.1 | `services/ssm/` |
| Query | `services/sqs/` |
| REST JSON | `services/lambda/` |
| REST XML | `services/s3/` |

```bash
# List the reference service to understand its structure
ls src/main/java/io/github/hectorvent/floci/services/ssm/
```

---

## Step 3: Create the Package

```
src/main/java/io/github/hectorvent/floci/services/<svc>/
├── <Svc>JsonHandler.java    ← for JSON 1.1 services
├── <Svc>QueryHandler.java   ← for Query services
├── <Svc>Controller.java     ← for REST JSON/XML services
├── <Svc>Service.java
└── model/
    └── <Resource>.java
```

### Handler skeleton (JSON 1.1 — copy from SsmJsonHandler)

```java
@ApplicationScoped
public class MySvcJsonHandler {

    private final MySvcService service;
    private final ObjectMapper objectMapper;

    @Inject
    public MySvcJsonHandler(MySvcService service, ObjectMapper objectMapper) {
        this.service = service;
        this.objectMapper = objectMapper;
    }

    public Response handle(String action, JsonNode request, String region) {
        return switch (action) {
            case "CreateFoo" -> handleCreateFoo(request, region);
            case "DeleteFoo" -> handleDeleteFoo(request, region);
            default -> Response.status(400)
                .entity(new AwsErrorResponse("UnsupportedOperation",
                    "Operation " + action + " is not supported."))
                .build();
        };
    }
}
```

### Handler skeleton (Query — copy from SqsQueryHandler)

```java
@ApplicationScoped
public class MySvcQueryHandler {

    private final MySvcService service;

    @Inject
    public MySvcQueryHandler(MySvcService service) {
        this.service = service;
    }

    public Response handle(String action, MultivaluedMap<String, String> params, String region) {
        return switch (action) {
            case "CreateFoo" -> handleCreateFoo(params, region);
            default -> AwsQueryResponse.error("UnsupportedOperation",
                "Operation " + action + " is not supported.", AwsNamespaces.MY_NAMESPACE, 400);
        };
    }
}
```

### Service skeleton

```java
@ApplicationScoped
public class MySvcService {

    private final StorageBackend<String, MyResource> store;

    @Inject
    public MySvcService(StorageFactory storageFactory) {
        this.store = storageFactory.create("my-svc", MyResource.class);
    }

    public MyResource createResource(String name, String region) {
        String key = region + ":" + name;
        if (store.get(key) != null) {
            throw new AwsException("ResourceAlreadyExists",
                "Resource " + name + " already exists.", 400);
        }
        MyResource resource = new MyResource(name, region, Instant.now());
        store.put(key, resource);
        return resource;
    }
}
```

---

## Step 4: Register the Service

### 4a. Add a `ServiceDescriptor` to `ResolvedServiceCatalog`

Read `ResolvedServiceCatalog.java` first to understand the existing pattern, then add an entry:

```java
new ServiceDescriptor(
    "my-svc",                    // externalKey (matches what SDK sends in URL/hostname)
    "mySvc",                     // configKey   (matches EmulatorConfig field name)
    config.mySvc().enabled(),
    true,                        // includeInStatus
    "my-svc",                    // storageKey
    config.mySvc().storage().mode(),
    config.mySvc().storage().flushIntervalMs(),
    AwsNamespaces.MY_NAMESPACE,  // xmlNamespace (or null for JSON-only)
    ServiceProtocol.JSON_1_1,    // defaultProtocol
    Set.of(ServiceProtocol.JSON_1_1),
    Set.of("MyService."),        // targetPrefixes for X-Amz-Target routing
    Set.of("my-svc"),            // credentialScopes
    Set.of(),                    // cborSdkServiceIds
    Set.of(MySvcController.class)
)
```

### 4b. Wire the handler into the appropriate controller

Find how `AwsJson11Controller` dispatches to handlers (search for how SsmJsonHandler is called)
and add a similar dispatch for the new handler.

### 4c. Add config to `EmulatorConfig`

```java
interface MySvcConfig {
    @WithDefault("true")
    boolean enabled();
    StorageConfig storage();
}

MySvcConfig mySvc();
```

### 4d. Add YAML entries

`src/main/resources/application.yml`:
```yaml
floci:
  my-svc:
    enabled: true
    storage:
      mode: memory
      flush-interval-ms: 5000
```

`src/test/resources/application.yml`:
```yaml
floci:
  my-svc:
    enabled: true
    storage:
      mode: memory
```

---

## Step 5: Verify

```bash
./mvnw quarkus:dev
# In another terminal:
aws --endpoint-url http://localhost:4566 my-svc create-foo --name test-resource
```

If the AWS CLI returns a response shaped like the real AWS, you're done.
If it returns an error, check the protocol routing — most issues are in Step 4b.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Wrong Content-Type in response | Check base controller — don't set it manually |
| XML namespace missing | Use `AwsNamespaces` constants, never hardcode |
| Business logic in Controller | Move all logic to Service |
| Instantiating storage directly | Use `StorageFactory.create()` |
| Throwing non-AwsException errors | Wrap as `AwsException` with the correct AWS error code |
| Adding switch statements to `ServiceRegistry` | Add a `ServiceDescriptor` to the catalog instead |
