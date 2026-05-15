# AWS API Gateway & Networking

## The 30-Second Pitch

AWS API Gateway is a fully managed service that acts as the "front door" for backend services—[Lambda](/aws/lambda-serverless), [EC2, ECS](/aws/compute-containers), or any HTTP endpoint—handling request routing, authorization, throttling, and protocol translation at scale. It comes in three flavors: REST API (feature-rich, legacy), HTTP API (low-latency, cheap, the modern default), and WebSocket API (persistent bidirectional connections). Paired with AWS networking primitives—VPC, subnets, security groups, NACLs, NAT Gateways, and Transit Gateway—API Gateway is the backbone of serverless and [microservice](/microservices) architectures. In interviews, the ability to articulate when to use REST vs HTTP API, how Lambda authorizers work, and how traffic flows through a VPC from a private subnet out to the internet through a NAT Gateway separates strong candidates from weak ones.

## API Gateway Types

### REST API vs HTTP API vs WebSocket API

| Dimension | REST API | HTTP API | WebSocket API |
|---|---|---|---|
| Launch year | 2015 | 2019 | 2018 |
| Latency overhead | ~6-10 ms | ~1-2 ms | N/A (persistent) |
| Price (per million calls) | $3.50 | $1.00 | $1.00 + $0.25/million messages |
| Lambda proxy | Yes | Yes | Yes |
| Lambda custom integration | Yes | No | No |
| AWS service integration | Yes | No | No |
| Mock integration | Yes | No | No |
| VTL mapping templates | Yes | No | No |
| Request validation | Yes | No | No |
| Usage plans / API keys | Yes | No | No |
| Cognito authorizer | Yes | Yes | No |
| Lambda authorizer | Yes | Yes | Yes |
| IAM auth (SigV4) | Yes | Yes | No |
| JWT authorizer (native) | No | Yes | No |
| OIDC/OAuth2 (native) | No | Yes | No |
| Canary deployments | Yes | No | No |
| Stage variables | Yes | No (use env) | No |
| X-Ray tracing | Yes | Yes | No |
| Private APIs (VPC) | Yes | Yes | No |
| WAF integration | Yes | Yes | No |
| Response caching | Yes | No | No |
| Edge-optimized ([CloudFront](/aws-cloudfront-route53)) | Yes | No | No |

**Decision rule**: Default to **HTTP API** for new Lambda-backed REST workloads. Use **REST API** only if you need usage plans, API keys, VTL mapping templates, mock integrations, or edge optimization. Use **WebSocket API** for chat, live dashboards, multiplayer, or any bidirectional streaming use case.

```
REST API is NOT deprecated, but HTTP API is the go-forward choice for most new builds.
REST API is still required for: usage plans, AWS service integrations, mock, VTL transforms.
```

## Integration Types (REST API)

### Lambda Proxy Integration

The most common pattern. API Gateway forwards the raw HTTP request as a structured JSON event to Lambda and passes Lambda's return value directly back as the HTTP response. No mapping templates needed.

```json
// Event shape Lambda receives
{
  "httpMethod": "POST",
  "path": "/users",
  "headers": { "Authorization": "Bearer ...", "Content-Type": "application/json" },
  "queryStringParameters": { "page": "1" },
  "pathParameters": { "id": "123" },
  "body": "{\"name\":\"Alice\"}",
  "isBase64Encoded": false,
  "requestContext": {
    "accountId": "123456789",
    "stage": "prod",
    "requestId": "abc123",
    "identity": { "sourceIp": "1.2.3.4" }
  }
}
```

```javascript
// Lambda must return this exact shape
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"   // CORS header
    },
    body: JSON.stringify({ message: "ok" })
    // body must be a STRING, not an object
  };
};
```

**Key gotcha**: `body` must be a string. A common bug is returning `body: { key: value }` (object) — API Gateway will send an empty or broken response.

### Lambda Custom Integration (non-proxy)

You manually define request and response mapping templates in VTL. API Gateway transforms the HTTP request into a custom payload before calling Lambda, and transforms Lambda's response before sending to the client. Rarely used today but still tested in interviews.

```
HTTP Request → [Request Mapping Template (VTL)] → Lambda input
Lambda output → [Response Mapping Template (VTL)] → HTTP Response
```

### HTTP Integration

Forwards the request to any public HTTP endpoint (another service, third-party API). Can be a simple HTTP_PROXY (pass-through) or custom (with VTL transforms).

### AWS Service Integration

Directly invokes AWS service APIs without Lambda as middleware. Example: write to SQS, trigger Step Functions, or put items in [DynamoDB](/aws/dynamodb-data-services) directly from API Gateway. Reduces latency and cost by eliminating a Lambda hop.

```yaml
# CloudFormation: API Gateway writing directly to SQS (no Lambda)
IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:sqs:path/${AWS::AccountId}/${MyQueue}"
IntegrationHttpMethod: POST
RequestParameters:
  integration.request.header.Content-Type: "'application/x-www-form-urlencoded'"
RequestTemplates:
  application/json: "Action=SendMessage&MessageBody=$input.body"
```

### Mock Integration

Returns a static response from API Gateway itself — Lambda is never invoked. Used for stubs, CORS preflight OPTIONS responses, and testing pipelines without backend.

## Authorization

### Lambda Authorizers

A Lambda function you write that inspects the request and returns an [IAM](/aws/iam-security) policy document. API Gateway caches the result by the token value (TOKEN type) or full request context (REQUEST type).

**TOKEN authorizer**: receives only the Authorization header value. Used for bearer tokens (JWT, OAuth, custom tokens).

**REQUEST authorizer**: receives the full request context (headers, query params, stage variables). Used when authorization depends on more than just a token.

```javascript
// Token Lambda Authorizer
exports.handler = async (event) => {
  const token = event.authorizationToken; // e.g., "Bearer eyJ..."

  try {
    const decoded = verifyJwt(token); // your verification logic
    return {
      principalId: decoded.sub,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: event.methodArn  // or wildcard: "arn:aws:execute-api:*:*:*"
        }]
      },
      context: {           // optional: passed to Lambda as $context.authorizer.xxx
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role
      }
    };
  } catch {
    throw new Error("Unauthorized"); // API Gateway returns 401
  }
};
```

**Authorizer cache TTL**: Default 300 seconds, max 3600s, min 0 (disabled). Cache key is the token value for TOKEN type, or the combination of identity sources for REQUEST type. Cache invalidation happens automatically at TTL expiry. Disabling caching (TTL=0) means every request invokes the authorizer Lambda—costs more but guarantees freshness for revoked tokens.

**Common mistake**: Setting `Resource: event.methodArn` restricts the policy to only the exact method+path that triggered the authorizer. If the client calls `/users` and then `/orders`, the policy from the first call won't work for the second. Use a wildcard resource (`arn:aws:execute-api:region:account:api-id/stage/*/*`) unless you need fine-grained per-route authorization.

### Cognito Authorizers

API Gateway validates JWTs from a Cognito User Pool natively—no Lambda needed. It checks the token signature against the pool's JWKS endpoint and verifies `iss`, `aud`, `exp`, and `token_use` claims.

```yaml
# CloudFormation REST API Cognito Authorizer
CognitoAuthorizer:
  Type: AWS::ApiGateway::Authorizer
  Properties:
    Type: COGNITO_USER_POOLS
    IdentitySource: method.request.header.Authorization
    ProviderARNs:
      - !GetAtt UserPool.Arn
    RestApiId: !Ref MyApi
    Name: CognitoAuth
```

For HTTP API, use a JWT authorizer (same concept, but natively supports any OIDC/OAuth2 provider, not just Cognito):

```yaml
Auth:
  DefaultAuthorizer: MyCognitoAuthorizer
  Authorizers:
    MyCognitoAuthorizer:
      JwtConfiguration:
        issuer: !Sub "https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}"
        audience:
          - !Ref UserPoolClient
      IdentitySource: "$request.header.Authorization"
```

### IAM Authorization (SigV4)

The request must be signed with AWS Signature Version 4. The caller needs an [IAM](/aws/iam-security) identity (user, role) with `execute-api:Invoke` permission on the API resource. Used for service-to-service calls within AWS, or CLI/SDK access.

```bash
# Calling an IAM-protected API with awscurl
awscurl --service execute-api \
  -X POST "https://abc123.execute-api.us-east-1.amazonaws.com/prod/items" \
  -d '{"name":"test"}' \
  --region us-east-1
```

### API Keys and Usage Plans

API keys are alphanumeric strings passed via the `x-api-key` header. They are NOT a security mechanism on their own (keys are visible in client-side code). Their purpose is **quota enforcement and throttling per consumer**, not authentication.

**Usage plans** define throttle (requests per second, burst) and quota (requests per day/week/month) limits. You associate one or more API stages with a plan, then add API keys to the plan.

```
Usage Plan: "free-tier"
  throttle: 10 req/sec, burst: 20
  quota: 1000 req/day
  associated stages: my-api/prod
  API keys: key-abc, key-xyz

Usage Plan: "premium"
  throttle: 1000 req/sec, burst: 2000
  quota: unlimited
  API keys: key-enterprise
```

Always combine API keys with a real authorizer (Cognito or Lambda) when security is required. For WAF-based rate limiting and IP allowlisting, see [Security Services](/aws-security-services).

## Stages & Deployment

### Stages

A stage is a named reference to a deployment snapshot (e.g., `dev`, `staging`, `prod`). Each stage has its own URL, stage variables, logging configuration, throttling settings, and cache settings.

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/{resource}
```

**Stage variables**: Key-value pairs attached to a stage. Referenced in integration URIs, mapping templates, and authorizer configuration as `${stageVariables.varName}`. Primary use case: pointing different stages at different Lambda function aliases or HTTP endpoints without changing the API definition.

```yaml
# Using stage variables to route to Lambda aliases
IntegrationUri: !Sub "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:MyFunction:${stageVariables.lambdaAlias}"
# dev stage: lambdaAlias = dev
# prod stage: lambdaAlias = prod
```

### Canary Deployments

REST API only. A canary release sends a configurable percentage of traffic to a new deployment version while the rest continues hitting the current version. Used to validate changes before full rollout.

```
Stage: prod
  Base deployment: v1 (receives 90% of traffic)
  Canary deployment: v2 (receives 10% of traffic)
  canarySettings.percentTraffic: 10
  canarySettings.useStageCache: false
```

After validation, promote the canary (makes v2 the base) or rollback (delete the canary). CloudWatch metrics are available per canary vs base.

### Deployment Strategies Summary

| Strategy | API Type | Mechanism |
|---|---|---|
| All-at-once | Both | New deployment replaces current stage |
| Canary | REST only | Split traffic by percentage |
| Lambda alias weighted routing | Both | Shift traffic at Lambda level, not API Gateway level |
| Blue/Green via custom domain | Both | Update base path mapping between two API stages |

**Lambda alias routing** is often the better canary approach for HTTP API: create `v1` and `v2` Lambda versions, set an alias that routes 90% to v1 and 10% to v2, and point API Gateway at the alias.

## Request/Response: Mapping Templates & Validation

### VTL Mapping Templates (REST API Only)

Velocity Template Language (VTL) is used in REST API to transform requests before they reach the backend and transform responses before they go to the client. Required when using custom Lambda integration, AWS service integration, or when you need to massage payloads.

```vtl
## Request mapping template: extract fields from JSON body
#set($inputRoot = $input.path('$'))
{
  "userId": "$context.authorizer.userId",
  "action": "$inputRoot.action",
  "timestamp": "$context.requestTimeEpoch",
  "stage": "$stageVariables.environment"
}
```

```vtl
## Response mapping template: reshape Lambda output
#set($outputRoot = $input.path('$'))
{
  "data": $outputRoot.items,
  "count": $outputRoot.totalCount,
  "requestId": "$context.requestId"
}
```

**VTL cheat sheet**:
- `$input.body` — raw request body as string
- `$input.path('$.field')` — JSONPath extraction
- `$context.requestId` — unique request ID
- `$context.authorizer.xxx` — values from Lambda authorizer context
- `$stageVariables.xxx` — stage variable values
- `$util.escapeJavaScript(str)` — escape for safe embedding
- `$util.urlEncode(str)` — URL encoding
- `#if / #else / #end`, `#foreach / #end` — control flow

### Request Validation

REST API only. Define **models** (JSON Schema) and attach a **request validator** to a method that checks:
- Request body against a model
- Required query string parameters
- Required headers

If validation fails, API Gateway returns a 400 immediately without invoking Lambda.

```json
// Model (JSON Schema draft 4)
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "required": ["email", "name"],
  "properties": {
    "email": { "type": "string", "format": "email" },
    "name": { "type": "string", "minLength": 1, "maxLength": 100 },
    "age": { "type": "integer", "minimum": 0 }
  },
  "additionalProperties": false
}
```

```yaml
# Method with validator
RequestValidatorId: !Ref BodyValidator
RequestModels:
  application/json: UserModel
```

This is a huge latency and cost win—malformed requests never hit your Lambda.

## Throttling & Quotas

### Account-Level Limits

Every AWS account in a region has default limits:
- **10,000 requests/second** (steady-state throughput)
- **5,000 burst** (token bucket: requests above the steady rate can burst up to this limit, depleted at 5,000/second)

These limits are shared across all APIs in the account+region. Exceeding them returns HTTP 429 "Too Many Requests".

### Stage-Level Throttling

You can set lower throttle limits per stage to protect downstream services. Stage throttling overrides the account limit (you can't exceed the account limit, only restrict below it).

### Method-Level Throttling

For granular control, set throttle limits on individual methods (e.g., POST /expensive has lower limits than GET /cheap).

```yaml
# Stage method settings
MethodSettings:
  - ResourcePath: /search
    HttpMethod: POST
    ThrottlingRateLimit: 50    # req/sec
    ThrottlingBurstLimit: 100
  - ResourcePath: /*
    HttpMethod: "*"
    ThrottlingRateLimit: 1000
    ThrottlingBurstLimit: 2000
```

### Token Bucket Algorithm

API Gateway uses a token bucket:
- Bucket refills at the **rate limit** (tokens/second)
- Bucket capacity = **burst limit**
- Each request consumes one token
- When bucket is empty: 429

```
burst = 5000, rate = 10000/sec
t=0: full bucket (5000 tokens)
t=0: 5000 simultaneous requests → bucket empty, all served
t=0.5s: 5000 new tokens added (10000/sec × 0.5s)
t=0.5s: another burst of 5000 → served
```

### Usage Plans vs Account Throttle

| Level | Where Set | Who It Protects |
|---|---|---|
| Account | AWS Support request | Entire account from runaway costs |
| Stage | API Gateway console/IaC | Downstream Lambda from overload |
| Method | API Gateway console/IaC | Specific expensive endpoints |
| Usage plan | Per API key | Individual consumer from abusing shared API |

## CORS

CORS applies when a browser makes requests to a different origin than the page. API Gateway must return the correct headers.

### HTTP API CORS (Preferred)

HTTP API has built-in CORS configuration—no Lambda changes needed:

```yaml
CorsConfiguration:
  AllowOrigins:
    - "https://myapp.com"
    - "https://staging.myapp.com"
  AllowMethods:
    - GET
    - POST
    - PUT
    - DELETE
  AllowHeaders:
    - Content-Type
    - Authorization
  ExposeHeaders:
    - X-Request-Id
  MaxAge: 86400          # preflight cache in seconds
  AllowCredentials: true  # only if you need cookies/auth headers
```

### REST API CORS

Must be configured per method. API Gateway generates an OPTIONS mock integration for preflight, and your Lambda must return `Access-Control-Allow-Origin` in the response headers.

```javascript
// Lambda must explicitly return CORS headers on every response
return {
  statusCode: 200,
  headers: {
    "Access-Control-Allow-Origin": "https://myapp.com",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
  },
  body: JSON.stringify(result)
};
```

### Common CORS Mistakes

1. **Wildcard + credentials**: `Access-Control-Allow-Origin: *` cannot be combined with `Access-Control-Allow-Credentials: true`. Browsers reject this. Use an explicit origin.
2. **Forgetting OPTIONS on private APIs**: Preflight requests don't include the Authorization header, so a Lambda authorizer must allow OPTIONS without a token, or you must exclude OPTIONS from authorization.
3. **Only enabling CORS on success paths**: Error responses from Lambda (4xx, 5xx returned by Lambda, not by API Gateway) also need CORS headers. Include them in catch blocks.
4. **API Gateway gateway responses**: When API Gateway itself returns an error (401, 403, 429, 500), Lambda never runs. Configure CORS headers on gateway responses too:

```yaml
GatewayResponse:
  Type: AWS::ApiGateway::GatewayResponse
  Properties:
    ResponseType: DEFAULT_4XX
    RestApiId: !Ref MyApi
    ResponseParameters:
      gatewayresponse.header.Access-Control-Allow-Origin: "'https://myapp.com'"
```

5. **Forgetting to deploy after enabling CORS**: REST API changes require a new deployment to take effect.

## Private APIs & VPC Integration

See also [VPC & Networking](/aws-vpc-networking) for subnet design, VPC Endpoints, and Transit Gateway details.

### Private APIs

A private API is accessible only from within your VPC via an Interface VPC Endpoint (service: `execute-api`). No traffic reaches the public internet.

```
Architecture:
[Lambda/EC2 in VPC] → [Interface VPC Endpoint (execute-api)] → [Private API Gateway] → [Lambda]
```

**Resource policy** on the API controls which VPCs/VPC endpoints can access it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789:api-id/*",
      "Condition": {
        "StringNotEquals": {
          "aws:SourceVpc": "vpc-abc123"
        }
      }
    },
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789:api-id/*"
    }
  ]
}
```

**Critical**: A private API with a resource policy still requires explicit ALLOW statements. The Deny-without-vpc-condition + Allow pattern is the standard: deny any caller NOT from the specified VPC, allow everything else (which effectively means only VPC traffic passes).

### VPC Link (Lambda in VPC → HTTP integration)

When your backend is an ALB, NLB, or Cloud Map service inside a VPC, use VPC Link so API Gateway can route traffic into the VPC without a public endpoint.

```
[Client] → [API Gateway] → [VPC Link] → [NLB] → [ECS/EC2 service in private subnet]
```

REST API uses NLB-based VPC Link. HTTP API uses a newer VPC Link that supports both NLB and ALB.

## WebSocket APIs

### Connection Lifecycle

WebSocket APIs have three built-in routes:
- `$connect`: invoked when a client opens a connection. Return non-2xx to reject.
- `$disconnect`: invoked after a connection closes (best-effort, not guaranteed).
- `$default`: catches any message that doesn't match a custom route key.

Custom routes match on a **route selection expression** (default: `$request.body.action`). If a message body is `{"action":"chat","text":"hello"}`, API Gateway routes to the `chat` route.

```javascript
// $connect handler — validate token, store connectionId
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;

  if (!validateToken(token)) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  await ddb.put({
    TableName: process.env.CONNECTIONS_TABLE,
    Item: {
      connectionId,
      userId: getUserIdFromToken(token),
      ttl: Math.floor(Date.now() / 1000) + 7200  // 2-hour TTL
    }
  }).promise();

  return { statusCode: 200, body: "Connected" };
};
```

### Sending Messages Back to Clients

Lambda cannot push to WebSocket connections directly. It uses the **@connections API** (a Management API endpoint for the WebSocket stage):

```javascript
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");

const apiClient = new ApiGatewayManagementApiClient({
  endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
});

// Send to specific connection
await apiClient.send(new PostToConnectionCommand({
  ConnectionId: targetConnectionId,
  Data: JSON.stringify({ type: "message", text: "Hello from server" })
}));

// Broadcast: scan DynamoDB for all connectionIds, send to each
const connections = await ddb.scan({ TableName: process.env.CONNECTIONS_TABLE }).promise();
await Promise.all(connections.Items.map(conn =>
  apiClient.send(new PostToConnectionCommand({
    ConnectionId: conn.connectionId,
    Data: JSON.stringify({ type: "broadcast", text: "Hello everyone" })
  })).catch(err => {
    if (err.$metadata?.httpStatusCode === 410) {
      // Gone — connection is stale, delete from table
      return ddb.delete({ TableName: process.env.CONNECTIONS_TABLE, Key: { connectionId: conn.connectionId } }).promise();
    }
    throw err;
  })
));
```

### Connection Table Pattern

Standard DynamoDB schema for WebSocket connection management:

```
Table: Connections
PK: connectionId (String)
Attributes:
  userId       (String)  — for user-to-connection lookup
  roomId       (String)  — for room-based messaging
  ttl          (Number)  — DynamoDB TTL to auto-expire stale records

GSI: UserIndex
  PK: userId
  SK: connectionId
  — enables "send to all connections of user X"

GSI: RoomIndex
  PK: roomId
  SK: connectionId
  — enables "broadcast to all members of room Y"
```

**WebSocket limits**:
- Connection duration: max 2 hours (hard limit, not configurable)
- Idle timeout: 10 minutes
- Max message size: 128 KB
- Max concurrent connections: 500 by default (can be raised)

## API Gateway + Lambda Patterns

### Monolithic Lambda

All routes handled by a single Lambda function. A routing library (e.g., `aws-lambda-fastify`, `serverless-express`, or a custom router) dispatches to the right handler based on method + path.

```javascript
// Monolithic Lambda with manual routing
exports.handler = async (event) => {
  const { httpMethod, path } = event;
  const route = `${httpMethod} ${path.replace(/\/[0-9a-f-]{36}/g, '/:id')}`;

  const routes = {
    "GET /users":     handlers.listUsers,
    "POST /users":    handlers.createUser,
    "GET /users/:id": handlers.getUser,
    "PUT /users/:id": handlers.updateUser,
  };

  const handler = routes[route];
  if (!handler) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  return handler(event);
};
```

**Pros**: Single deployment unit, shared warm container (no per-function cold starts for all routes), simpler local development, one IAM role.

**Cons**: Any change deploys everything; container size grows with all dependencies; harder to apply per-route throttling; all routes share the same memory/timeout config; one noisy route can starve others.

### Microservice Lambda

One (or a few) Lambda functions per business domain. Each has its own API Gateway integration.

```
/users/*     → UsersLambda     (512 MB, 30s timeout)
/orders/*    → OrdersLambda    (256 MB, 10s timeout)
/inference/* → InferenceLambda (3008 MB, 900s timeout)
```

**Pros**: Independent deployment and scaling; right-sized memory/timeout per function; blast radius containment; separate IAM roles; cleaner ownership.

**Cons**: More cold starts per service; more infrastructure to manage; cross-function calls become network hops.

**Real-world guidance**: Start monolithic (simpler), split when a domain has meaningfully different scaling needs, timeout requirements, or ownership boundaries. Never split purely for theoretical purity—operational overhead is real.

### Lambda Power Tuning

Lambda memory directly controls vCPU allocation. The optimal memory setting is not always the minimum—higher memory can reduce duration enough that the total compute cost (GB-seconds) is lower despite the higher per-second cost.

```
128 MB, 3000 ms → 0.128 GB × 3 s = 0.384 GB-s
1024 MB, 200 ms → 1.024 GB × 0.2 s = 0.2048 GB-s (cheaper AND faster)
```

Use the AWS Lambda Power Tuning open-source tool (Step Functions state machine) to find the optimal setting empirically.

## AppSync: GraphQL Alternative

### What AppSync Is

AppSync is AWS's managed GraphQL service. It handles schema definition, resolver execution, real-time subscriptions, and offline sync. It's the right tool when clients need flexible queries (fetch exactly what they want), multiple data sources in one call, or real-time push (subscriptions).

### Architecture

```
[Client (web/mobile)]
       |
       | GraphQL query/mutation/subscription
       v
[AppSync] ← schema.graphql defines all types and operations
       |
       | per-field/per-type resolvers
       v
[Data Sources]
  - DynamoDB (direct mapping, no Lambda needed)
  - Lambda (arbitrary logic)
  - RDS (via RDS Data API)
  - HTTP (external REST APIs)
  - OpenSearch
  - EventBridge (mutations → events)
  - None (local resolver, in-memory)
```

### Resolver Pipeline

AppSync resolvers consist of a **request mapping template** (VTL or JavaScript) and a **response mapping template**. A **pipeline resolver** chains multiple functions sequentially:

```
Mutation.createOrder →
  [Function 1: validateInventory (DynamoDB GetItem)] →
  [Function 2: chargePayment (Lambda)] →
  [Function 3: createOrder (DynamoDB PutItem)] →
  [Function 4: sendConfirmation (EventBridge PutEvents)]
```

This replaces multi-hop orchestration in Lambda with a declarative pipeline.

### Real-Time Subscriptions

```graphql
type Subscription {
  onMessageAdded(roomId: ID!): Message
    @aws_subscribe(mutations: ["addMessage"])
}
```

When a `addMessage` mutation resolves, AppSync automatically pushes the result to all WebSocket-connected subscribers matching the subscription filter. Backed by AWS IoT/Mqtt under the hood—no WebSocket API Gateway needed.

### AppSync vs API Gateway + Lambda

| Dimension | AppSync | API Gateway + Lambda |
|---|---|---|
| Query flexibility | Client-driven (GraphQL) | Fixed endpoints (REST) |
| Real-time | Built-in subscriptions | Need WebSocket API |
| Data sources | Direct DynamoDB/RDS (no Lambda) | Always need Lambda for AWS services |
| Complexity | Higher (schema, resolvers, VTL/JS) | Lower (just Lambda) |
| Caching | Per-resolver TTL | Per-stage, all-or-nothing |
| Auth | Multiple per-field | Per-method or per-stage |
| Use case | Mobile apps, dashboards, social | Typical REST microservices |

## VPC & Networking Deep Dive

### VPC Fundamentals

A **Virtual Private Cloud (VPC)** is a logically isolated network within an AWS region. You define:
- **CIDR block**: the IP address range for the VPC (e.g., `10.0.0.0/16` → 65,536 IPs)
- **Subnets**: subdivisions of the VPC CIDR, each tied to a single AZ
- **Route tables**: per-subnet rules for where to send traffic
- **Internet Gateway**: enables internet access for public subnets
- **NAT Gateway**: enables internet access for private subnet resources (outbound only)

### Public vs Private Subnets

```
VPC: 10.0.0.0/16

Public Subnet A (10.0.1.0/24, us-east-1a)
  Route Table:
    10.0.0.0/16 → local
    0.0.0.0/0   → igw-xxx (Internet Gateway)
  Resources: ALB, NAT Gateway, Bastion host

Private Subnet A (10.0.2.0/24, us-east-1a)
  Route Table:
    10.0.0.0/16 → local
    0.0.0.0/0   → nat-xxx (NAT Gateway in public subnet)
  Resources: Lambda (VPC-bound), ECS tasks, RDS

Isolated Subnet A (10.0.3.0/24, us-east-1a)
  Route Table:
    10.0.0.0/16 → local
    (no internet route)
  Resources: RDS, ElastiCache (no outbound internet needed)
```

**Public subnet**: has a route to an Internet Gateway; resources need a public IP (Elastic IP or auto-assigned) to be reachable from the internet.

**Private subnet**: resources have private IPs only; outbound internet via NAT Gateway; inbound internet not possible directly.

**Isolated subnet**: no internet route at all; used for databases that only need intra-VPC access.

### Security Groups vs NACLs

| Dimension | Security Group | NACL |
|---|---|---|
| Scope | Instance/ENI level | Subnet level |
| State | Stateful (return traffic auto-allowed) | Stateless (must allow both directions) |
| Rules | Allow only | Allow and Deny |
| Rule evaluation | All rules evaluated | Rules evaluated in order, first match wins |
| Default | Deny all inbound, allow all outbound | Allow all inbound and outbound |
| Use for | Primary access control for resources | Coarse-grained subnet perimeter |

**Security group chaining**: Rather than allowing IPs, reference another security group as the source:

```
ALB Security Group (alb-sg):
  inbound: 443 from 0.0.0.0/0

App Security Group (app-sg):
  inbound: 8080 from alb-sg  ← only ALB can reach app

DB Security Group (db-sg):
  inbound: 5432 from app-sg  ← only app can reach DB
```

This is the standard three-tier pattern. Never open DB ports to `0.0.0.0/0`.

### NAT Gateway

A managed service in a public subnet that allows private subnet resources to initiate outbound internet connections (e.g., Lambda pulling packages, ECS pulling ECR images, calling external APIs) without exposing inbound ports.

```
[Private Subnet Lambda]
  → Route Table: 0.0.0.0/0 → nat-xxx
  → [NAT Gateway in Public Subnet]
  → [Internet Gateway]
  → [Internet]
```

**Cost**: ~$0.045/hour + $0.045/GB processed. For high-bandwidth use cases, consider VPC endpoints (PrivateLink) for AWS services instead of routing through NAT—it's cheaper and faster.

**NAT Gateway is AZ-specific**: For HA, deploy one NAT Gateway per AZ and configure each private subnet to use the NAT in its own AZ. Cross-AZ NAT traffic incurs data transfer charges.

### VPC Endpoints

Allow private connectivity to AWS services without internet routing. Two types:

**Gateway Endpoint** (free): [S3](/aws/storage-s3) and DynamoDB only. A route is added to the route table pointing to the endpoint.

**Interface Endpoint** (PrivateLink, ~$0.01/hour/AZ): Creates an ENI in your subnet with a private IP. Works for most AWS services (SQS, SNS, Secrets Manager, API Gateway, etc.).

```
Private Lambda → VPC Endpoint for S3 (Gateway) → S3 (no NAT, no internet)
Private Lambda → VPC Interface Endpoint for Secrets Manager → Secrets Manager (no NAT)
```

**This is a critical cost optimization**: Lambda functions in a VPC that call S3 or DynamoDB via the public endpoint go through the NAT Gateway, incurring per-GB charges. Gateway endpoints are free and bypass NAT entirely.

### VPC Peering

Connects two VPCs (same or different account, same or different region) with a direct network route. Traffic uses AWS's private network, not the internet.

```
VPC A (10.0.0.0/16) ←→ Peering Connection ←→ VPC B (172.16.0.0/16)
```

**Limitations**:
- **Non-transitive**: If A peers with B and B peers with C, A cannot reach C through B. Each pair needs its own peering connection.
- **No overlapping CIDRs**: VPCs being peered cannot have overlapping IP ranges.
- After creating the peering connection, you must **manually add routes** in both VPCs' route tables pointing to the peer's CIDR.
- Security groups can reference peered VPC security groups for cross-account, but the VPCs must be in the same region.

### Transit Gateway

Solves the non-transitive peering problem. A central hub that VPCs and VPNs/Direct Connect attach to. Any attached network can route to any other attached network through the TGW.

```
            [Transit Gateway]
           /    |    |    \
       VPC-A  VPC-B  VPC-C  [On-Prem via VPN/DX]
```

- TGW route tables control which attachments can communicate
- Supports inter-region peering (TGW to TGW)
- Costs: ~$0.05/attachment/hour + $0.02/GB
- Replaces N×(N-1)/2 peering connections with N attachments

**VPC Peering vs Transit Gateway**:
- Few VPCs (≤5), simple topology: use VPC Peering (no cost per connection, only data transfer)
- Many VPCs, hub-and-spoke or full-mesh, or connecting to on-prem: use Transit Gateway

### PrivateLink (VPC Endpoint Services)

Allows you to expose your own service (backed by an NLB) to other VPCs or AWS accounts without VPC peering. The consumer creates an Interface Endpoint to your service; traffic never crosses the internet. This is how AWS builds Interface Endpoints internally.

```
Provider VPC:
  [Service on ECS] ← [NLB] ← [Endpoint Service]

Consumer VPC:
  [Lambda/EC2] → [Interface Endpoint] → [Endpoint Service in Provider VPC]
```

Use cases: SaaS providers offering private connectivity, sharing services across organizational units without full VPC peering, marketplace integrations.

### Route Tables Deep Dive

Every subnet is associated with exactly one route table (default: the VPC's main route table). Routes are evaluated longest-prefix-match (most specific wins).

```
# Main route table (private subnet)
Destination         Target
10.0.0.0/16        local              ← all VPC traffic
10.1.0.0/16        pcx-xxx            ← peered VPC
172.31.0.0/16      tgw-xxx            ← on-prem via TGW
pl-xxxxxxxx        vpce-xxx           ← S3 Gateway Endpoint (managed prefix list)
0.0.0.0/0          nat-xxx            ← all other internet traffic via NAT
```

**Prefix lists**: A managed list of CIDR blocks for an AWS service (e.g., `pl-63a5400a` for S3 in us-east-1). Used in route tables and security group rules to avoid hardcoding IPs.

### DNS in VPC

- **`enableDnsSupport`** (default: true): VPC has a DNS resolver at `169.254.169.253` (or VPC base +2 address, e.g., `10.0.0.2`).
- **`enableDnsHostnames`** (default: false for custom VPCs): EC2 instances get public DNS hostnames.
- **Private hosted zones** (Route 53): Associate a private zone with VPCs for internal DNS (`db.internal → 10.0.2.50`).
- **VPC Endpoint DNS**: Interface endpoints create private DNS entries that override the public AWS service DNS within the VPC (e.g., `secretsmanager.us-east-1.amazonaws.com` resolves to the endpoint IP, not the public IP).

## Common Interview Questions

**Q: What is the difference between REST API and HTTP API in API Gateway? When would you use each?**

**A:** HTTP API is the newer, cheaper ($1.00/million vs $3.50/million), lower-latency option that covers ~90% of use cases: JWT authorization, Lambda proxy, HTTP proxy, CORS, VPC Link. REST API is the older, feature-rich option required when you need usage plans and API keys, VTL mapping templates, mock integrations, direct AWS service integrations (SQS, DynamoDB without Lambda), edge-optimized deployment, canary deployments, or response caching. Default to HTTP API for all new builds; use REST API only when a specific feature demands it.

---

**Q: How does a Lambda authorizer work and what are the security implications of the cache?**

**A:** A Lambda authorizer is a function you write that receives request data (a token or full request context), validates it (verify JWT signature, check an introspection endpoint, query a database), and returns an IAM policy document granting or denying `execute-api:Invoke`. API Gateway caches the returned policy by the identity source (token value) for the configured TTL (0-3600 seconds, default 300). The security implication: if a token is revoked (user logs out, admin invalidates a session), the cached policy is still valid until TTL expires. For high-security scenarios, set TTL to 0 (no cache), or use Cognito's built-in token validation (Cognito itself handles revocation via the refresh token flow). For performance-sensitive APIs with longer-lived tokens (e.g., service-to-service JWTs with a 1-hour expiry), a 300-second cache TTL is a reasonable balance.

---

**Q: A Lambda function is in a private VPC subnet and needs to call DynamoDB and an external third-party API. Walk me through the networking required.**

**A:** Two separate paths: For DynamoDB, use a **Gateway VPC Endpoint** — free, no NAT needed, just add a route to the route table pointing the DynamoDB prefix list at the endpoint. For the third-party API (public internet), a **NAT Gateway** in a public subnet is required. The private subnet's route table sends `0.0.0.0/0` to the NAT Gateway; the NAT Gateway's public subnet route table sends `0.0.0.0/0` to the Internet Gateway. The Lambda gets a private IP; the NAT Gateway holds an Elastic IP that appears as the source to the external service. Never put the Lambda in a public subnet just to avoid NAT — public-subnet Lambda still can't reach the internet without an Elastic IP on the ENI, and it creates unnecessary security exposure.

---

**Q: Explain how VPC peering differs from Transit Gateway, and when you'd use each.**

**A:** VPC peering is a direct, non-transitive, one-to-one connection between two VPCs. Non-transitive means A↔B and B↔C does not give A↔C. It requires manual route table entries in both VPCs. It's cheaper (no per-hour charge, only standard data transfer) and lower latency. Use it for simple topologies (2-5 VPCs). Transit Gateway is a regional hub: VPCs and VPNs attach to it, and TGW route tables control routing. It's transitive by design, supports hundreds of attachments, integrates with Direct Connect, and can peer between regions. Use TGW when you have many VPCs, need centralized egress/inspection (attach a firewall VPC), need on-prem connectivity shared across multiple VPCs, or need inter-region routing. Cost ~$0.05/attachment/hour makes it overkill for 2 VPCs.

---

**Q: What are NACLs and how do they differ from security groups? When would you use a NACL?**

**A:** Security groups are stateful, instance-level firewalls that only allow rules (no explicit deny). Return traffic for allowed connections is automatically permitted. NACLs are stateless, subnet-level firewalls with numbered rules evaluated in order, supporting both allow and deny. Because they're stateless, you must explicitly allow both inbound and outbound for any connection (including ephemeral ports 1024-65535 for return traffic). In practice, security groups handle 99% of access control. NACLs are used for: (1) explicit blocking of known-bad IP ranges (DDoS mitigation — blacklist IPs quickly at the subnet level), (2) defense-in-depth as a secondary perimeter, (3) regulatory compliance requiring subnet-level controls. Don't try to replace security groups with NACLs — their stateless nature makes them error-prone for general use.

---

**Q: Explain CORS in API Gateway. What's the most common mistake?**

**A:** CORS is enforced by browsers when JavaScript makes cross-origin requests. The browser sends a preflight OPTIONS request; the server must respond with `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers`. For HTTP API, configure CORS in the API definition — it's declarative and simple. For REST API, you must: (1) create a mock OPTIONS integration with the CORS headers, (2) ensure your Lambda returns CORS headers on every response including error paths, AND (3) configure CORS headers on API Gateway's own gateway responses (401, 403, 429, 500) — these bypass Lambda entirely. The most common mistake is configuring CORS only on the happy path, then getting CORS errors on 401 responses because the gateway response doesn't include the `Access-Control-Allow-Origin` header and the browser can't read the error body.

---

**Q: How do you broadcast a message to all connected WebSocket clients in API Gateway?**

**A:** Store each `connectionId` in DynamoDB when `$connect` fires. To broadcast, scan (or query a GSI) the connections table to get all active `connectionId` values, then call `POST /v1/connections/{connectionId}` on the `@connections` Management API endpoint for each. When a connection is gone (410 Gone response), delete it from DynamoDB. The TTL attribute on DynamoDB items handles cleanup of connections that dropped without `$disconnect` firing (which is not guaranteed). The Management API endpoint URL is `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}` — construct it from `event.requestContext.domainName` and `event.requestContext.stage`.

---

**Q: What is PrivateLink and when would you use it over VPC peering?**

**A:** PrivateLink exposes a specific service (backed by an NLB) to other VPCs as an Interface Endpoint, without peering the entire VPCs. The consumer creates an endpoint in their VPC that gets a private IP; they can only reach the specific service, not any other resource in the provider VPC. Use PrivateLink when: (1) you're a SaaS provider offering private connectivity to customers without granting them access to your whole VPC, (2) you want to share a specific internal service across multiple VPCs or accounts without the operational overhead of peering + route management, (3) you have overlapping CIDRs (peering doesn't work; PrivateLink doesn't care about CIDRs). Use VPC peering when two services need broad bi-directional access between VPCs (e.g., a microservices mesh where services call each other freely).

---

**Q: A REST API is returning 502 Bad Gateway errors intermittently. What do you investigate?**

**A:** A 502 from API Gateway means the integration (Lambda or HTTP backend) returned an invalid response. Investigation steps: (1) **CloudWatch Logs for API Gateway**: enable execution logging (INFO level) on the stage — it shows the exact request, the integration request/response, and the mapping template output. (2) **Lambda logs**: check for unhandled exceptions, timeouts (Lambda timeout < API Gateway integration timeout, default 29 seconds for REST API — hard limit), or malformed response body (body must be a string, not an object). (3) **Lambda metrics**: check `Errors`, `Throttles`, `Duration`. (4) **Integration response mapping**: for custom integration, a VTL error in the response template causes 502. (5) **Lambda concurrency limits**: if Lambda is throttling, API Gateway receives a 429 from Lambda and surfaces it as 502. Check `ConcurrentExecutions` vs the function's reserved concurrency setting.

---

**Q: How do stage variables work and what's the best pattern for multi-environment deployment?**

**A:** Stage variables are key-value pairs attached to a stage, referenced as `${stageVariables.name}` in integration URIs, authorizer configuration, and mapping templates. The best multi-environment pattern: create Lambda aliases (`dev`, `staging`, `prod`) pointing to specific function versions. In the API Gateway integration URI, reference `${stageVariables.lambdaAlias}`. Set `lambdaAlias=dev` on the dev stage, `lambdaAlias=prod` on the prod stage. This means: one API definition, one deployment, three stages, three Lambda aliases — each stage routes to the correct code version without any API changes. You also set the Lambda resource policy on the alias, not the `$LATEST`, so permissions are scoped per environment.

---

**Q: How does throttling work in API Gateway and what happens when limits are exceeded?**

**A:** API Gateway uses a token bucket per region per account. The account default is 10,000 requests/second steady-state with a 5,000-request burst. Exceeding returns HTTP 429 with the body `{"message":"Too Many Requests"}`. Throttling hierarchy: account limit → stage limit → method limit → usage plan limit (if API keys in use). Stage and method limits can only restrict below the account limit, not exceed it. Client retry strategy should use exponential backoff with jitter. In Lambda, you can also hit Lambda's own concurrency limits independently — that results in a 429 from Lambda surfaced as either 429 or 502 from API Gateway depending on whether the response mapping handles it.

## WebSocket API — Real-Time Bidirectional Communication

API Gateway WebSocket APIs maintain persistent connections between clients and the backend, enabling real-time applications without polling.

### Connection Lifecycle
```
Client                    API Gateway WebSocket               Lambda / Backend
  │──── WS Connect ──────────────────────►│
  │                                        │──── $connect route ────►│
  │                                        │◄─── 200 OK ─────────────│
  │◄── WS Established ─────────────────────│
  │                                        │
  │──── {"action":"message","text":"Hi"} ─►│
  │                                        │──── message route ──────►│
  │                                        │                           │── POST to callback URL ──►
  │◄─── {"type":"reply","text":"Hello"} ───│◄────────────────────────│
  │                                        │
  │──── WS Disconnect ─────────────────────►│
  │                                        │──── $disconnect route ──►│
```

### Route Keys
- `$connect`: invoked when client establishes connection; use to authenticate (check `Authorization` header or query param) and store `connectionId` in DynamoDB
- `$disconnect`: invoked when connection closes; clean up DynamoDB record
- `$default`: catch-all for messages that don't match any custom route
- Custom routes: match `action` field in message body (e.g., `{"action": "sendMessage", "text": "Hello"}` routes to `sendMessage`)

```javascript
// $connect Lambda handler — authenticate and store connection
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const userId = event.queryStringParameters?.userId;

  // Validate auth token
  if (!userId) return { statusCode: 401, body: 'Unauthorized' };

  // Store connection in DynamoDB with TTL
  await ddb.send(new PutItemCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Item: {
      connectionId: { S: connectionId },
      userId: { S: userId },
      connectedAt: { N: Date.now().toString() },
      ttl: { N: Math.floor(Date.now() / 1000 + 7200).toString() }, // 2hr TTL
    }
  }));

  return { statusCode: 200, body: 'Connected' };
};

// Sending messages back to connected clients (from any Lambda or service)
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const apiGw = new ApiGatewayManagementApiClient({
  endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
});

async function sendToConnection(connectionId, data) {
  try {
    await apiGw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    }));
  } catch (err) {
    if (err.statusCode === 410) {
      // Connection is stale — clean up DynamoDB
      await deleteConnection(connectionId);
    }
  }
}
```

### WebSocket Use Cases
- Live chat, collaborative editing, multiplayer games, live dashboards, order tracking
- Compare with Lambda Function URL streaming: Function URL streaming is one-directional (server → client); WebSocket is bidirectional

---

## HTTP API vs REST API — Detailed Comparison

| Feature | HTTP API | REST API |
|---|---|---|
| **Latency** | ~1ms overhead | ~6ms overhead |
| **Cost** | $1.00/M requests | $3.50/M (first 333M) |
| **JWT/OIDC Authorizer** | Native (no Lambda needed) | Lambda authorizer required |
| **Lambda Authorizer** | Yes (v2.0 payload) | Yes (v1.0 payload) |
| **Cognito Authorizer** | Yes (native) | Yes (native) |
| **IAM Auth** | Yes | Yes |
| **Private integrations** | Yes (VPC Link) | Yes (VPC Link) |
| **Request validation** | No | Yes (model-based) |
| **Caching** | No | Yes (per-stage, per-method) |
| **WAF integration** | Yes | Yes |
| **Stage variables** | Yes | Yes |
| **Usage plans + API keys** | No | Yes |
| **Canary deployments** | No | Yes |
| **CORS** | Native auto-config | Manual mock integration |
| **WebSocket** | No | No (separate product) |
| **Default: when to use** | New builds (cost + latency) | Existing, needs caching/validation/usage plans |

### HTTP API JWT Authorizer — Zero Lambda
```typescript
// CDK: HTTP API with native JWT auth (no Lambda authorizer needed)
const api = new apigatewayv2.HttpApi(this, 'Api', {
  corsPreflight: {
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
    allowOrigins: ['https://myapp.com'],
  },
});

const authorizer = new apigatewayv2_authorizers.HttpJwtAuthorizer('Authorizer',
  `https://cognito-idp.us-east-1.amazonaws.com/${userPool.userPoolId}`, {
  jwtAudience: [userPoolClient.userPoolClientId],
});

api.addRoutes({
  path: '/orders',
  methods: [apigatewayv2.HttpMethod.GET],
  integration: new apigatewayv2_integrations.HttpLambdaIntegration('OrdersIntegration', ordersFunction),
  authorizer,
});
```

---

## Private API + VPC Link — Internal Microservices

### Private REST API
- API only accessible from within a VPC (not public internet)
- Requires Interface VPC Endpoint for `execute-api` service in the VPC
- Resource policy must allow access from the VPC endpoint

See [VPC & Networking](/aws-vpc-networking) for full VPC Endpoint and PrivateLink deep-dive.

```json
// Private REST API resource policy
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "execute-api:Invoke",
    "Resource": "arn:aws:execute-api:us-east-1:123456789012:api-id/*",
    "Condition": {
      "StringEquals": {"aws:SourceVpce": "vpce-0123456789abcdef0"}
    }
  }]
}
```

### VPC Link (HTTP API) — ALB/NLB Integration
Route API Gateway traffic to private ALB or NLB inside a VPC without exposing them to the internet:

```typescript
// CDK: HTTP API → VPC Link → private ALB
const vpcLink = new apigatewayv2.VpcLink(this, 'VpcLink', {
  vpc,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

const albIntegration = new apigatewayv2_integrations.HttpAlbIntegration('AlbIntegration',
  privateAlbListener, { vpcLink });

api.addRoutes({
  path: '/internal/{proxy+}',
  methods: [apigatewayv2.HttpMethod.ANY],
  integration: albIntegration,
});
```

---

## API Gateway Caching (REST API)

Stage-level cache: cache responses from backend for a configurable TTL, reducing latency and backend load.

- Cache sizes: 0.5 GB to 237 GB; billed hourly (~$0.02–$3.80/hr depending on size)
- TTL: 0 to 3600 seconds (default 300s); per-method TTL override
- Cache key: by default, the full request path + query strings; can include headers and authorization header
- Cache invalidation: `Cache-Control: max-age=0` header (if enabled); manual flush via console/API
- Per-method caching: enable/disable caching per resource-method combination
- Encrypted at rest with KMS

```yaml
# CloudFormation: REST API stage with cache
ApiGatewayDeployment:
  Type: AWS::ApiGateway::Deployment
  Properties:
    RestApiId: !Ref RestApi
    StageName: prod
    MethodSettings:
      - ResourcePath: "/*"
        HttpMethod: "*"
        CachingEnabled: true
        CacheTtlInSeconds: 300
        CacheDataEncrypted: true
    CacheClusterEnabled: true
    CacheClusterSize: "0.5"
```

---

## Usage Plans & API Keys (REST API)

Throttle and monetize API access for external consumers.

```javascript
// Typical flow: create usage plan → create API key → associate
// API key is passed in X-Api-Key header

// Usage plan configuration
// burstLimit: max concurrent requests
// rateLimit: steady-state requests per second
// quota: requests per day/week/month

const usagePlan = {
  name: 'StandardTier',
  throttle: { burstLimit: 500, rateLimit: 100 },
  quota: { limit: 1000000, period: 'MONTH' },
};
```

Use cases: API marketplace (different tiers), partner integrations, internal rate limiting per team.
Note: HTTP API does not support usage plans — use WAF rate-based rules (see [Security Services](/aws-security-services)) or custom Lambda authorizer with rate limiting.

---

## Request Validation (REST API)

Validate request body, query parameters, and headers before passing to Lambda — reject invalid requests at the API Gateway layer, reducing Lambda invocations.

```json
// Model for request validation
{
  "title": "CreateOrderRequest",
  "type": "object",
  "required": ["customerId", "items"],
  "properties": {
    "customerId": { "type": "string", "minLength": 1 },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["productId", "quantity"],
        "properties": {
          "productId": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 }
        }
      }
    }
  }
}
```
- Validator types: body only, query params + headers only, both
- Invalid requests return 400 with a message before Lambda is invoked

---

## Red Flags to Avoid

- **"I'll just enable CORS with `*` and allow credentials."** Browser security forbids wildcard origin with credentials. Shows you haven't debugged a real CORS issue.
- **"Lambda authorizers are the most secure option."** Not without understanding cache TTL. A cached policy for a revoked token is a live vulnerability. Know when to set TTL=0.
- **"I'll put my Lambda in a public subnet so it can reach the internet."** Lambda in a public subnet still needs an Elastic IP on its ENI for outbound internet. The right answer is private subnet + NAT Gateway, or private subnet + VPC endpoints for AWS services.
- **"VPC peering is transitive."** It is not. Confusing peering with Transit Gateway is a common error.
- **"NACLs and security groups are the same thing."** Stateful vs stateless is the key distinction. Getting this wrong suggests shallow VPC knowledge.
- **"Just use REST API, it has more features."** Feature parity ignorance. HTTP API costs 71% less and has lower latency. Defaulting to REST API without justification wastes money.
- **"body: { key: value } in the Lambda response."** Body must be a string. This is an extremely common Lambda proxy bug — interviewers love this trap.
- **"I'll add CORS headers only in my Lambda success handler."** API Gateway 4xx/5xx from the gateway itself (throttling, auth failure) bypass Lambda entirely. Gateway responses need CORS headers too.
- **"For WebSocket, Lambda can push to clients directly."** Lambda cannot initiate WebSocket messages. It must use the `@connections` Management API.
- **"S3 and DynamoDB calls from my VPC Lambda go through the NAT Gateway."** They do by default — but they should go through free Gateway VPC Endpoints. Not knowing this means unnecessary per-GB charges.
