# AWS Step Functions & Workflow Orchestration

## The 30-Second Pitch

AWS Step Functions is a serverless orchestration service that coordinates distributed components of an application using visual workflows defined in Amazon States Language (ASL). It solves the most painful problem in distributed systems: managing state, retries, error handling, and sequencing across multiple services without building custom coordination logic. Instead of embedding orchestration code inside [Lambda](/aws/lambda-serverless) functions that call other functions, you define a state machine—Step Functions handles durability, retries, timeouts, and gives you full execution visibility from the console. Two workflow types cover opposite ends of the spectrum: Standard Workflows for long-running, auditable business processes; Express Workflows for high-throughput, cost-sensitive event processing. SDK integrations let state machines call DynamoDB, SQS, SNS, SageMaker, ECS, and dozens more services directly—no Lambda glue code required.

## How It Actually Works

```
[Trigger: API GW / EventBridge / SDK call / EventBridge Scheduler]
                    |
            [Step Functions Service]
                    |
         [State Machine definition (ASL)]
                    |
    [State 1] --> [State 2] --> [State 3] --> [End]
         |              |             |
      [Retry]        [Choice]     [Parallel]
      [Catch]        branches     branches
         |
    [Compensation state on failure]
```

Each state machine execution is an independent run with its own execution ID, input, and history. Standard Workflow executions are persisted for up to 1 year. Express Workflow executions are ephemeral—you must pipe logs to CloudWatch to observe them.

**Execution role**: The state machine runs with an [IAM](/aws/iam-security) execution role. Every SDK integration call uses that role's permissions—no ambient credentials.

---

## 1. Standard vs Express Workflows

| Property | Standard | Express |
|---|---|---|
| Max duration | 1 year | 5 min (sync) / unlimited (async) |
| Execution semantics | Exactly-once | At-least-once |
| Execution history | Stored in Step Functions API (1 year) | None built-in; send to CloudWatch Logs |
| Pricing | $0.025 per 1,000 state transitions | $1/M executions + $0.00001 per GB-sec duration |
| Audit trail | Full input/output per state in API | Only what you log to CloudWatch |
| State input/output limit | 256 KB | 256 KB |
| Max execution rate | ~2,000/sec (soft) | >100,000/sec |
| Idempotency | Exactly-once per state | At-least-once—design for idempotency |
| Use cases | Order management, payment flows, ML pipelines, human approval, compliance workflows | IoT event processing, streaming transforms, microservice orchestration at scale |

**Decision guide**:

- Need an audit trail or human-readable execution history? Standard.
- Need to query "what happened to execution X" from an API? Standard.
- Human approval step involved? Standard (executions last up to 1 year).
- Running > 1,000 executions/sec or cost is a concern? Express.
- Processing IoT events, real-time stream records, or Kinesis/SQS triggers? Express.
- Mixing both: trigger an Express Workflow from a Standard Workflow for high-volume sub-processing while keeping durable state in the outer Standard machine.

---

## 2. Amazon States Language (ASL) — Core Reference

ASL is a JSON-based language for defining state machines. Every state machine has a `StartAt` key pointing to the first state, and a `States` map of state definitions.

```json
{
  "Comment": "Description of the workflow",
  "StartAt": "FirstState",
  "States": {
    "FirstState": { "Type": "...", "Next": "SecondState" },
    "SecondState": { "Type": "...", "End": true }
  }
}
```

### 2.1 Task State

Invokes a resource—Lambda, SDK integration, Activity, or HTTP endpoint.

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder",
  "Parameters": {
    "orderId.$": "$.orderId",
    "source": "STEP_FUNCTIONS"
  },
  "ResultSelector": {
    "isValid.$": "$.Payload.isValid",
    "validatedAt.$": "$.Payload.timestamp"
  },
  "ResultPath": "$.validation",
  "OutputPath": "$",
  "TimeoutSeconds": 30,
  "HeartbeatSeconds": 10,
  "Retry": [
    {
      "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2
    }
  ],
  "Catch": [
    {"ErrorEquals": ["InvalidOrder"], "Next": "HandleRejection", "ResultPath": "$.error"}
  ],
  "Next": "NextState"
}
```

**Path fields** (critical to understand):
- `Parameters`: transform/filter the input before passing to the resource; `.$` suffix means "read from input path"
- `ResultSelector`: filter/reshape the raw resource output before merging
- `ResultPath`: where in the current state data to place the result; `"$.validation"` keeps original input intact and adds the result at that key; `null` discards result
- `OutputPath`: filter what gets passed to the next state

### 2.2 Choice State

Conditional branching—no `Next` at the top level; routing is in `Choices`.

```json
{
  "Type": "Choice",
  "Choices": [
    {
      "And": [
        {"Variable": "$.fraudScore", "NumericLessThan": 0.8},
        {"Variable": "$.inStock", "BooleanEquals": true}
      ],
      "Next": "ChargePayment"
    },
    {
      "Variable": "$.orderTotal",
      "NumericGreaterThanEquals": 10000,
      "Next": "RequireManualApproval"
    },
    {
      "Variable": "$.customerId",
      "IsNull": true,
      "Next": "HandleMissingCustomer"
    }
  ],
  "Default": "NotifyRejection"
}
```

Comparison operators: `StringEquals`, `StringMatches` (glob), `NumericEquals`, `NumericGreaterThan`, `NumericLessThan`, `BooleanEquals`, `TimestampGreaterThan`, `IsNull`, `IsPresent`, `IsString`, `IsNumeric`. Compound: `And`, `Or`, `Not`.

### 2.3 Wait State

Pause execution for a duration or until a timestamp.

```json
{
  "Type": "Wait",
  "Seconds": 300,
  "Next": "RetryPayment"
}

// Or pause until a timestamp from the execution input:
{
  "Type": "Wait",
  "TimestampPath": "$.scheduledAt",
  "Next": "ProcessScheduledOrder"
}
```

`SecondsPath` lets you read the wait duration from the execution data dynamically.

### 2.4 Parallel State

Fork multiple branches simultaneously. All branches must complete before the workflow continues. Output is an array of each branch's output, in order.

```json
{
  "Type": "Parallel",
  "Branches": [
    {
      "StartAt": "CheckInventory",
      "States": {
        "CheckInventory": {
          "Type": "Task",
          "Resource": "arn:aws:lambda:...:function:CheckInventory",
          "End": true
        }
      }
    },
    {
      "StartAt": "FraudCheck",
      "States": {
        "FraudCheck": {
          "Type": "Task",
          "Resource": "arn:aws:lambda:...:function:FraudCheck",
          "End": true
        }
      }
    }
  ],
  "ResultPath": "$.checks",
  "Next": "EvaluateChecks"
}
```

If any branch fails and has no `Catch`, the Parallel state fails and its `Catch` or the parent `Catch` handles it.

### 2.5 Map State

Iterate over an array, processing each item (optionally in parallel).

```json
{
  "Type": "Map",
  "ItemsPath": "$.orderItems",
  "ItemSelector": {
    "itemId.$": "$$.Map.Item.Value.id",
    "quantity.$": "$$.Map.Item.Value.quantity"
  },
  "MaxConcurrency": 10,
  "ToleratedFailurePercentage": 0,
  "Iterator": {
    "StartAt": "ProcessItem",
    "States": {
      "ProcessItem": {
        "Type": "Task",
        "Resource": "arn:aws:lambda:...:function:ProcessItem",
        "End": true
      }
    }
  },
  "ResultPath": "$.processedItems",
  "Next": "FinalizeOrder"
}
```

`MaxConcurrency: 0` = unlimited parallel. `$$.Map.Item.Index` and `$$.Map.Item.Value` are the context object fields available inside the iterator. For large-scale processing, use Distributed Map (see Section 6).

### 2.6 Pass State

Transform input, inject static data, or stub out states during testing.

```json
{
  "Type": "Pass",
  "Result": {
    "environment": "production",
    "version": "2.0"
  },
  "ResultPath": "$.metadata",
  "Next": "ProcessWithMetadata"
}
```

Essential for testing: replace Task states with Pass states returning mock data to test workflow branching logic without invoking real resources.

### 2.7 Succeed / Fail States

```json
{"Type": "Succeed"}

{
  "Type": "Fail",
  "Error": "OrderRejected",
  "Cause": "Fraud score exceeded threshold"
}
```

`Fail` with `Error.$` and `Cause.$` can read dynamic values from the execution context (requires `"Parameters"` in newer ASL versions).

### 2.8 Complete Order Processing Example

```json
{
  "Comment": "Order Processing Workflow",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder",
      "ResultPath": "$.validation",
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {"ErrorEquals": ["InvalidOrder"], "Next": "NotifyCustomerRejection", "ResultPath": "$.error"}
      ],
      "Next": "ParallelChecks"
    },
    "ParallelChecks": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "CheckInventory",
          "States": {
            "CheckInventory": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:CheckInventory",
              "End": true
            }
          }
        },
        {
          "StartAt": "FraudCheck",
          "States": {
            "FraudCheck": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:FraudCheck",
              "End": true
            }
          }
        }
      ],
      "ResultPath": "$.checks",
      "Next": "EvaluateChecks"
    },
    "EvaluateChecks": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            {"Variable": "$.checks[0].inStock", "BooleanEquals": true},
            {"Variable": "$.checks[1].fraudScore", "NumericLessThan": 0.8}
          ],
          "Next": "ChargePayment"
        }
      ],
      "Default": "NotifyCustomerRejection"
    },
    "ChargePayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ChargePayment",
      "ResultPath": "$.payment",
      "Catch": [
        {"ErrorEquals": ["PaymentFailed"], "Next": "HandlePaymentFailure", "ResultPath": "$.error"}
      ],
      "Next": "FulfillOrder"
    },
    "FulfillOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Orders",
        "Item": {
          "orderId": {"S.$": "$.orderId"},
          "status": {"S": "FULFILLED"},
          "timestamp": {"S.$": "$$.Execution.StartTime"}
        }
      },
      "Next": "SendConfirmation"
    },
    "SendConfirmation": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:OrderConfirmations",
        "Message.$": "States.Format('Order {} confirmed', $.orderId)"
      },
      "End": true
    },
    "NotifyCustomerRejection": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:OrderRejections",
        "Message.$": "States.Format('Order {} rejected', $.orderId)"
      },
      "End": true
    },
    "HandlePaymentFailure": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:HandlePaymentFailure",
      "End": true
    }
  }
}
```

---

## 3. SDK Integrations — Calling AWS Services Directly

SDK integrations let Step Functions call AWS service APIs without a Lambda intermediary. This eliminates Lambda cold starts, reduces cost, and simplifies IAM (the state machine role has the permission, not a Lambda function).

### Integration Patterns

| Pattern | Syntax | Behavior | Use when |
|---|---|---|---|
| Request-Response | default (no suffix) | Sends request, moves to next state immediately | Fire-and-forget; async trigger |
| Sync | `.sync:2` | Waits for the job/task to complete | ECS, SageMaker, Glue, Batch, CodeBuild |
| waitForTaskToken | `.waitForTaskToken` | Pauses until external callback; passes task token | Human approval, external system callbacks |

### Direct Integration Examples

```json
// Write to DynamoDB — no Lambda required
{
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:putItem",
  "Parameters": {
    "TableName": "Orders",
    "Item": {
      "orderId": {"S.$": "$.orderId"},
      "status": {"S": "CONFIRMED"},
      "timestamp": {"S.$": "$$.Execution.StartTime"},
      "ttl": {"N.$": "States.MathAdd($$Execution.StartTime, 2592000)"}
    }
  },
  "Next": "NextState"
}

// Send SQS message and wait for task token (external callback)
{
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "Parameters": {
    "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/approval-queue",
    "MessageBody": {
      "taskToken.$": "$$.Task.Token",
      "orderId.$": "$.orderId",
      "amount.$": "$.amount"
    }
  },
  "HeartbeatSeconds": 86400,
  "Next": "ApprovalReceived"
}

// Publish SNS notification
{
  "Type": "Task",
  "Resource": "arn:aws:states:::sns:publish",
  "Parameters": {
    "TopicArn": "arn:aws:sns:us-east-1:123456789012:OrderAlerts",
    "Subject": "Order Confirmed",
    "Message.$": "States.JsonToString($.orderSummary)"
  },
  "Next": "NextState"
}

// Run ECS Fargate task and wait for it to finish
{
  "Type": "Task",
  "Resource": "arn:aws:states:::ecs:runTask.sync:2",
  "Parameters": {
    "LaunchType": "FARGATE",
    "Cluster": "arn:aws:ecs:us-east-1:123456789012:cluster/processing-cluster",
    "TaskDefinition": "arn:aws:ecs:us-east-1:123456789012:task-definition/batch-processor:3",
    "NetworkConfiguration": {
      "AwsvpcConfiguration": {
        "Subnets": ["subnet-abc123"],
        "SecurityGroups": ["sg-def456"],
        "AssignPublicIp": "DISABLED"
      }
    },
    "Overrides": {
      "ContainerOverrides": [
        {
          "Name": "processor",
          "Environment": [{"Name": "JOB_ID", "Value.$": "$.jobId"}]
        }
      ]
    }
  },
  "Next": "ProcessResults"
}

// Invoke Amazon Bedrock model directly
{
  "Type": "Task",
  "Resource": "arn:aws:states:::bedrock:invokeModel",
  "Parameters": {
    "ModelId": "anthropic.claude-3-sonnet-20240229-v1:0",
    "Body": {
      "anthropic_version": "bedrock-2023-05-31",
      "max_tokens": 512,
      "messages": [
        {
          "role": "user",
          "content.$": "States.Format('Summarize this order: {}', States.JsonToString($.orderDetails))"
        }
      ]
    }
  },
  "ResultSelector": {
    "summary.$": "$.Body.content[0].text"
  },
  "ResultPath": "$.aiSummary",
  "Next": "StoreResult"
}

// Put object to S3
{
  "Type": "Task",
  "Resource": "arn:aws:states:::s3:putObject",
  "Parameters": {
    "Bucket": "output-bucket",
    "Key.$": "States.Format('reports/{}/{}.json', $.date, $.reportId)",
    "Body.$": "States.JsonToString($.reportData)"
  },
  "Next": "NotifyCompletion"
}
```

**Intrinsic functions** (available in Parameters/ResultSelector): `States.Format`, `States.JsonToString`, `States.StringToJson`, `States.Array`, `States.ArrayPartition`, `States.ArrayContains`, `States.ArrayRange`, `States.MathAdd`, `States.MathRandom`, `States.Base64Encode`, `States.Base64Decode`, `States.Hash`, `States.UUID`.

---

## 4. Error Handling

### Retry Configuration

```json
"Retry": [
  {
    "ErrorEquals": [
      "Lambda.ServiceException",
      "Lambda.AWSLambdaException",
      "Lambda.SdkClientException",
      "Lambda.TooManyRequestsException"
    ],
    "IntervalSeconds": 1,
    "MaxAttempts": 3,
    "BackoffRate": 2,
    "MaxDelaySeconds": 10,
    "JitterStrategy": "FULL"
  },
  {
    "ErrorEquals": ["States.TaskFailed"],
    "IntervalSeconds": 5,
    "MaxAttempts": 2,
    "BackoffRate": 1.5
  }
]
```

- `BackoffRate`: multiplier applied to `IntervalSeconds` after each retry (exponential backoff)
- `MaxDelaySeconds`: cap the maximum interval so retries don't stretch indefinitely
- `JitterStrategy: "FULL"`: randomizes delay between 0 and the computed interval—prevents thundering herd when many executions retry simultaneously

**Built-in error codes**:
- `States.TaskFailed` — task returned a failure
- `States.Timeout` — task exceeded `TimeoutSeconds`
- `States.HeartbeatTimeout` — no heartbeat received within `HeartbeatSeconds`
- `States.Runtime` — runtime error (malformed input/output, resource not found)
- `States.Permissions` — IAM permissions error
- `States.NoChoiceMatched` — Choice state had no matching rule and no `Default`
- `States.ResultPathMatchFailure` — `ResultPath` could not be applied
- `States.BranchFailed` — a branch of a Parallel state failed
- `States.ExceedToleratedFailureThreshold` — Map state exceeded `ToleratedFailurePercentage`
- `States.ALL` — wildcard matching any error

### Catch (Dead-Letter Equivalent)

```json
"Catch": [
  {
    "ErrorEquals": ["PaymentFailed"],
    "Next": "HandlePaymentFailure",
    "ResultPath": "$.error"
  },
  {
    "ErrorEquals": ["InventoryUnavailable"],
    "Next": "NotifyOutOfStock",
    "ResultPath": "$.error"
  },
  {
    "ErrorEquals": ["States.ALL"],
    "Next": "HandleGenericError",
    "ResultPath": "$.error"
  }
]
```

Order matters: Step Functions evaluates catches top-to-bottom and stops at the first match. Put specific errors before `States.ALL`. Use `ResultPath: "$.error"` (not `null`) to preserve the original input and add the error details—otherwise you lose the execution context in the error handler.

### Compensation / Saga Pattern

For distributed transactions where 2-phase commit is impractical, implement forward + compensation paths:

```
Forward path:
  ReserveInventory → ChargePayment → ConfirmOrder → Ship → [Success]

Compensation path (triggered by Catch):
  CancelShipment → RefundPayment → ReleaseInventory → NotifyFailure → [End]
```

Implementation in Step Functions:

```json
{
  "ChargePayment": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:...:function:ChargePayment",
    "ResultPath": "$.payment",
    "Catch": [
      {
        "ErrorEquals": ["States.ALL"],
        "Next": "CompensateInventory",
        "ResultPath": "$.error"
      }
    ],
    "Next": "ConfirmOrder"
  },
  "CompensateInventory": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:...:function:ReleaseInventory",
    "ResultPath": "$.compensation",
    "Next": "NotifyFailure"
  },
  "NotifyFailure": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sns:publish",
    "Parameters": {
      "TopicArn": "arn:aws:sns:...:OrderFailures",
      "Message.$": "States.Format('Order {} failed: {}', $.orderId, $.error.Cause)"
    },
    "Next": "OrderFailed"
  },
  "OrderFailed": {
    "Type": "Fail",
    "Error": "OrderFailed",
    "Cause": "Payment failed; inventory released"
  }
}
```

For complex multi-step compensation, consider a dedicated compensation sub-workflow invoked via Step Functions `startExecution` from the Catch handler.

---

## 5. Human Approval Pattern (waitForTaskToken)

Long-running approval workflows are one of Standard Workflow's strongest use cases. A state machine pauses indefinitely (up to 1 year) waiting for a human to respond.

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "Parameters": {
    "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/approval-queue",
    "MessageBody": {
      "taskToken.$": "$$.Task.Token",
      "orderId.$": "$.orderId",
      "amount.$": "$.amount",
      "requestedBy.$": "$.userId",
      "approvalUrl": "https://internal-tools.example.com/approve"
    }
  },
  "HeartbeatSeconds": 86400,
  "TimeoutSeconds": 604800,
  "Catch": [
    {"ErrorEquals": ["States.HeartbeatTimeout"], "Next": "ApprovalTimedOut", "ResultPath": "$.error"},
    {"ErrorEquals": ["ApprovalRejected"], "Next": "HandleRejection", "ResultPath": "$.error"}
  ],
  "Next": "ProcessApprovedOrder"
}
```

**Approval callback mechanism** (API Gateway + Lambda):

```javascript
// Lambda triggered by approver clicking link in email
const { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } = require('@aws-sdk/client-sfn');
const sfn = new SFNClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  const { taskToken, decision, comment } = JSON.parse(event.body);

  if (decision === 'approve') {
    await sfn.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({ approved: true, approvedBy: event.requestContext.identity.user, comment })
    }));
  } else {
    await sfn.send(new SendTaskFailureCommand({
      taskToken,
      error: 'ApprovalRejected',
      cause: comment
    }));
  }

  return { statusCode: 200, body: JSON.stringify({ message: 'Decision recorded' }) };
};
```

`HeartbeatSeconds` is distinct from `TimeoutSeconds`: heartbeat fails if no `SendTaskHeartbeat` call arrives within the window—useful if a background process is expected to report progress. For human approval steps, set only `TimeoutSeconds` (overall deadline).

---

## 6. Distributed Map — Large-Scale Parallel Processing

The inline Map state (Section 2.5) is capped by the execution context. Distributed Map breaks that ceiling: it spawns child executions, reading input from S3 directly, and can process up to 10 million items.

```json
{
  "Type": "Map",
  "ItemReader": {
    "Resource": "arn:aws:states:::s3:getObject",
    "Parameters": {
      "Bucket": "data-bucket",
      "Key": "input/million-records.csv"
    },
    "ReaderConfig": {
      "InputType": "CSV",
      "CSVHeaderLocation": "FIRST_ROW"
    }
  },
  "MaxConcurrency": 500,
  "ToleratedFailurePercentage": 5,
  "ItemBatcher": {
    "MaxItemsPerBatch": 100,
    "MaxInputBytesPerBatch": 262144
  },
  "ItemProcessor": {
    "ProcessorConfig": {
      "Mode": "DISTRIBUTED",
      "ExecutionType": "EXPRESS"
    },
    "StartAt": "ProcessBatch",
    "States": {
      "ProcessBatch": {
        "Type": "Task",
        "Resource": "arn:aws:lambda:...:function:BatchProcessor",
        "End": true
      }
    }
  },
  "ResultWriter": {
    "Resource": "arn:aws:states:::s3:putObject",
    "Parameters": {
      "Bucket": "output-bucket",
      "Prefix": "results/run-01/"
    }
  },
  "Next": "AggregateResults"
}
```

Key properties:
- `Mode: DISTRIBUTED` — spawns child Step Functions executions (vs inline `Mode: INLINE` which runs in current execution context)
- `ExecutionType: EXPRESS` — child executions are Express Workflows (cheaper at scale)
- `ItemBatcher` — groups items into batches before passing to the processor; reduces Lambda invocation overhead
- `ToleratedFailurePercentage` — allows X% of items to fail without failing the entire Map (critical for large jobs where a few bad records are acceptable)
- `ResultWriter` — writes output to S3 instead of accumulating in execution memory (required for large outputs)
- `ReaderConfig.InputType`: `CSV`, `JSON` (array), `JSONL` (newline-delimited JSON)

**Use cases**: image resizing across 1M S3 objects, ML batch inference on a dataset, CSV transformation, log processing, bulk email sending.

---

## 7. Observability & Debugging

### Execution History (Standard Workflows)

Every state transition is recorded: state entered, state exited, input, output, error. Query via API:

```bash
aws stepfunctions get-execution-history \
  --execution-arn arn:aws:states:us-east-1:123456789012:execution:OrderWorkflow:abc-123 \
  --query 'events[?type==`TaskFailed`]'
```

The Step Functions console shows a visual graph with color-coded state status (green=success, red=failed, yellow=in-progress). Click any state to see the exact input and output, which is the fastest debugging path for data transformation issues.

### Express Workflow Logging

Express Workflows require explicit CloudWatch Logs configuration:

```json
// CloudFormation
{
  "LoggingConfiguration": {
    "Destinations": [{"CloudWatchLogsLogGroup": {"LogGroupArn": "arn:aws:logs:..."}}],
    "IncludeExecutionData": true,
    "Level": "ALL"
  }
}
```

Log levels: `ALL` (every state transition + input/output), `ERROR` (only failed executions), `FATAL` (only fatal errors), `OFF`. Use `ALL` in development/staging; `ERROR` in production to reduce cost.

### X-Ray Tracing

Enable on the state machine to get a service map across Step Functions → Lambda → downstream services. Each state transition becomes a subsegment. Correlate with Lambda [Observability](/aws/observability) X-Ray traces.

```typescript
// CDK
new sfn.StateMachine(this, 'OrderWorkflow', {
  definition,
  tracingEnabled: true, // enables X-Ray
});
```

### CloudWatch Metrics

| Metric | What it tells you |
|---|---|
| `ExecutionsStarted` | Throughput; spike = upstream surge |
| `ExecutionsFailed` | Failure rate; alert on > 0 for critical workflows |
| `ExecutionThrottled` | State machine is hitting account concurrency limits |
| `ExecutionTime` | P99 duration; rising = slowdown in a downstream task |
| `ExecutionsAborted` | Executions stopped externally |

Recommended alarms: `ExecutionsFailed > 0` (critical path), `ExecutionThrottled > 0` (scaling issue), `ExecutionTime > SLA threshold`.

---

## 8. CDK Pattern — Self-Contained Workflow

```typescript
import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';

export class OrderWorkflowStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const validateFn = lambda.Function.fromFunctionArn(this, 'ValidateFn',
      `arn:aws:lambda:${this.region}:${this.account}:function:ValidateOrder`);
    const paymentFn = lambda.Function.fromFunctionArn(this, 'PaymentFn',
      `arn:aws:lambda:${this.region}:${this.account}:function:ChargePayment`);

    const orderTopic = new sns.Topic(this, 'OrderTopic');

    const logGroup = new logs.LogGroup(this, 'WorkflowLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Define states
    const validateTask = new tasks.LambdaInvoke(this, 'ValidateOrder', {
      lambdaFunction: validateFn,
      resultPath: '$.validation',
      retryOnServiceExceptions: true,
    });

    const chargePayment = new tasks.LambdaInvoke(this, 'ChargePayment', {
      lambdaFunction: paymentFn,
      resultPath: '$.payment',
    });

    const notifySuccess = new tasks.SnsPublish(this, 'NotifySuccess', {
      topic: orderTopic,
      message: sfn.TaskInput.fromJsonPathAt('$.orderId'),
      subject: 'Order Confirmed',
    });

    const orderFailed = new sfn.Fail(this, 'OrderFailed', {
      error: 'OrderFailed',
      cause: 'Validation or payment failed',
    });

    const invalidOrder = new sfn.Fail(this, 'InvalidOrder', {
      error: 'InvalidOrder',
    });

    // Wire up error handling on payment
    chargePayment.addCatch(orderFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Define workflow
    const definition = validateTask.next(
      new sfn.Choice(this, 'IsValid?')
        .when(
          sfn.Condition.booleanEquals('$.validation.Payload.isValid', true),
          chargePayment.next(notifySuccess)
        )
        .otherwise(invalidOrder)
    );

    // Create state machine
    new sfn.StateMachine(this, 'OrderWorkflow', {
      definition,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.hours(1),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });
  }
}
```

For Express Workflows via CDK, set `stateMachineType: sfn.StateMachineType.EXPRESS` and `logs.level: sfn.LogLevel.ALL` (execution history not stored otherwise).

---

## 9. EventBridge Scheduler + Step Functions

Schedule state machine executions without a Lambda trigger:

```typescript
// CDK: EventBridge Scheduler targeting Step Functions
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';

const schedulerRole = new iam.Role(this, 'SchedulerRole', {
  assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
});

stateMachine.grantStartExecution(schedulerRole);

new scheduler.CfnSchedule(this, 'NightlyETL', {
  scheduleExpression: 'cron(0 2 * * ? *)',  // 2am UTC daily
  flexibleTimeWindow: { mode: 'FLEXIBLE', maximumWindowInMinutes: 15 },
  target: {
    arn: stateMachine.stateMachineArn,
    roleArn: schedulerRole.roleArn,
    input: JSON.stringify({ run: 'nightly', date: '<aws.scheduler.scheduled-time>' }),
    retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 300 },
  },
});
```

EventBridge Scheduler vs EventBridge Rules for Step Functions triggers:
- Scheduler supports one-time schedules, flexible time windows (avoid thundering herds), and timezone-aware crons
- Scheduler has its own retry policy at the scheduler level before the state machine even starts
- Rules are better for event-driven triggers (S3 events, custom events); Scheduler for time-based triggers

**Common scheduled patterns**:
- Nightly ETL: cron to Standard Workflow → EMR or Fargate job
- Weekly report generation: cron to Express Workflow → S3 output → SES delivery
- Data pipeline: EventBridge Scheduler → Step Functions → Glue + Athena → S3 → SNS

---

## Interview Q&A

**Q: When would you use Step Functions over Lambda for orchestration?**
A: Use Step Functions when you have multi-step logic that requires: durable state between steps (Lambda is stateless), retry/catch at the orchestration level rather than buried inside function code, visibility into which step failed and what the input/output was, parallel branches with result correlation, or human approval steps that pause for hours or days. A Lambda function that calls other Lambdas and manages retries in code is an anti-pattern—you get no visibility, no built-in retry backoff, and failure handling becomes spaghetti. The threshold is roughly: 3+ sequential steps with error handling → use Step Functions.

---

**Q: Explain Standard vs Express Workflows — when do you use each?**
A: Standard is exactly-once, stores full execution history for 1 year, queryable via API, costs $0.025/1000 state transitions—use it for anything requiring an audit trail, human approval, or long-running processes (up to 1 year). Express is at-least-once, no built-in history (you pipe logs to CloudWatch), costs $1/M executions + duration—use it for high-volume, short-duration, cost-sensitive workloads. Key practical guide: if someone will ever ask "what happened to order #12345?", use Standard. If you're processing 50,000 IoT events per second, use Express. You can combine them: a Standard machine for the outer business process, Express child executions for high-volume inner processing via Distributed Map.

---

**Q: What is the Saga pattern and how do you implement it in Step Functions?**
A: Saga is the distributed systems alternative to 2-phase commit for multi-step transactions. Each step has a corresponding compensation action. If step N fails, you run compensation for steps N-1 through 1 in reverse. In Step Functions: each Task state that mutates state gets a `Catch` handler pointing to a compensation state. The compensation states form a chain that undoes each previous step. For example: `ReserveInventory → ChargePayment → ConfirmOrder`; if ChargePayment fails, Catch triggers `ReleaseInventory`. The key design constraint: every compensation action must be idempotent (it may be retried). Use `ResultPath: "$.error"` in Catch to preserve original input in compensation states so they have the data they need to undo the action.

---

**Q: How do you implement a human-in-the-loop approval step in a workflow?**
A: Use `waitForTaskToken`. The state sends a message (SQS, SNS, or EventBridge) containing `$$.Task.Token`—a cryptographically unique token for that execution+state. The state machine pauses. An approver receives a notification (email via SES, Slack via Lambda, or internal tool), reviews the request, and the approval system calls `SendTaskSuccess(taskToken, output)` to resume the workflow or `SendTaskFailure(taskToken, error, cause)` to trigger the Catch path. Use Standard Workflow—executions can pause for the full 1 year. Set `HeartbeatSeconds` if you want the step to fail if no activity occurs for a period (useful for escalation logic). API Gateway + Lambda is the standard callback mechanism.

---

**Q: What are SDK integrations in Step Functions and why are they better than Lambda glue?**
A: SDK integrations (also called optimized integrations) let Step Functions call AWS service APIs directly—DynamoDB, SQS, SNS, S3, ECS, SageMaker, Bedrock, Glue, etc.—without a Lambda function. They're better because: (1) no Lambda cold start, (2) no Lambda cost for simple operations like writing to DynamoDB, (3) no extra IAM role for a Lambda function that just calls one API, (4) the workflow definition is self-documenting—the DynamoDB write is visible in the state machine, not hidden inside a Lambda. The three patterns are: request-response (fire-and-forget), `.sync:2` (Step Functions polls for job completion), and `.waitForTaskToken` (external system calls back). Use `.sync:2` for long-running jobs like SageMaker training or Glue ETL—Step Functions handles the polling.

---

**Q: How does waitForTaskToken work?**
A: When a Task state executes with `Resource: "...service.waitForTaskToken"`, Step Functions generates a unique task token (`$$.Task.Token`) and injects it into the `Parameters`. The state machine pauses—no polling, no cost accumulation in the traditional sense. The token is passed to an external system (via SQS message, SNS notification, Lambda invocation, etc.). When the external system is done, it calls the Step Functions API: `SendTaskSuccess(taskToken, output)` resumes the workflow at the next state; `SendTaskFailure(taskToken, error, cause)` triggers the Catch path. `HeartbeatSeconds` defines a window—if no heartbeat or success/failure signal arrives within that window, the state fails with `States.HeartbeatTimeout`. Tokens are valid for the lifetime of the execution (up to 1 year for Standard Workflows).

---

**Q: Explain the Distributed Map state — what problems does it solve?**
A: The inline Map state is bounded by execution memory (256 KB state I/O limit) and runs in the parent execution context. Distributed Map removes that ceiling: it reads items directly from S3 (CSV, JSON, JSON Lines), spawns up to 40 concurrent child executions at any time (with up to 10,000,000 total items), and writes results back to S3 to avoid the memory limit. It solves the "process N million records in parallel" problem without building your own fan-out. Key features: `ToleratedFailurePercentage` lets a percentage of items fail without aborting the job (important for real-world dirty data); `ItemBatcher` groups items into batches before handing off to the processor (reduces per-invocation overhead); `ExecutionType: EXPRESS` for child executions keeps cost low at scale. Use case: ML batch inference on 1M images, transforming 500GB of CSV data, bulk DynamoDB writes.

---

**Q: How would you debug a failed Step Functions execution?**
A: For Standard Workflows: open the execution in the console, find the red state, click it, view the Input tab (what data entered the state) and the Exception tab (error and cause). 80% of failures are immediately obvious from the exception message. For data transformation issues: look at the Output of the previous state—the data might not match what the next state expected. For IAM permission errors (`States.Permissions`): the error message names the exact IAM action that was denied—add that action to the execution role. For Express Workflows: go to CloudWatch Logs, filter for `executionFailed` events, look at the `cause` field. For intermittent failures: check CloudWatch metrics (`ExecutionsFailed` trend), enable X-Ray to trace downstream service calls, look for Lambda throttling events or DynamoDB capacity errors. Always reproduce in a test execution with `--input` that matches the failing execution's input from the history.

---

**Q: What's the difference between Catch and Retry in Step Functions?**
A: Retry handles transient failures—it re-executes the same state after a delay, up to `MaxAttempts` times. Use it for `Lambda.TooManyRequestsException` (throttling), `Lambda.ServiceException` (Lambda service errors), network timeouts. Retry is evaluated first, before Catch. Catch handles terminal failures—after all retries are exhausted, or for errors you don't want to retry. Catch redirects execution to a different state (error handler, compensation, notification). Use `Catch` for business errors (`PaymentFailed`, `InvalidOrder`), `States.ALL` as a fallback catch-all, and compensation states in Saga workflows. Order matters in both: Step Functions evaluates arrays top-to-bottom and stops at the first match—put specific errors before catch-alls.

---

**Q: Design a Step Functions workflow for processing 1 million S3 objects in parallel.**
A: Use Distributed Map with Mode DISTRIBUTED and ExecutionType EXPRESS. State machine: trigger via EventBridge Scheduler or S3 event. First state reads the list of objects (or pass a manifest S3 path as input). Distributed Map reads from S3 via ItemReader with a CSV/JSON manifest of object keys. `MaxConcurrency: 500` (tune based on Lambda concurrency limits). `ItemBatcher: MaxItemsPerBatch: 50` groups objects into batches to reduce per-invocation overhead. Each child execution (EXPRESS) runs a Lambda that processes its batch and writes results to S3. `ToleratedFailurePercentage: 1` allows up to 1% bad objects. `ResultWriter` writes child execution results to S3 prefix. Final state: aggregate results from S3 using Athena or a Lambda. IAM: execution role needs `s3:GetObject` on source bucket, `lambda:InvokeFunction`, `s3:PutObject` on output bucket, `states:StartExecution` for child EXPRESS executions.

---

**Q: Compare Step Functions orchestration vs EventBridge choreography for order processing.**
A: Orchestration (Step Functions): central coordinator knows the full workflow. If any step fails, the coordinator handles retry/catch/compensation. You can query execution state at any time. Easy to reason about the overall flow. Harder to add new services—you change the state machine. Choreography (EventBridge): each service publishes events and reacts to others' events. Services are fully decoupled—adding a new service means subscribing to existing events without changing other services. No central point of failure. But: no single place to see overall state, debugging requires correlating events across services, handling the "did all three services complete?" question requires a stateful tracker. Practical rule: use Step Functions orchestration for the core business process (order → payment → fulfillment) where correctness and visibility matter; use EventBridge choreography for downstream reactions (analytics, notifications, audit) where loose coupling matters more than coordination visibility.

---

## Red Flags to Avoid

- "We put all orchestration logic inside a Lambda that calls other Lambdas." — This is the Lambda-calls-Lambda anti-pattern: no visibility, no built-in retry, state tracking in application code. Use Step Functions.
- "We use Express Workflows for our payment processing." — Express is at-least-once. Payment processing requires exactly-once semantics. Use Standard Workflows for any money movement.
- "We don't need audit trail, it's just internal processing." — Standard Workflow execution history has saved countless post-incident investigations. The cost ($0.025/1000 transitions) is negligible vs the debugging value.
- "We put the task token in application database, not in the message." — Task tokens belong in the message payload going to the approver/external system. Storing separately adds a lookup step and a failure point.
- "We use `States.ALL` as the first Catch entry." — It matches everything, including errors you might want to handle differently. Always order Catch from most specific to most general.
- "Our compensation states don't handle idempotency." — Compensation actions will be retried on failure. `ReleaseInventory` must be safe to call twice. Design every compensation state as idempotent.
- "We use Parallel state for fire-and-forget fan-out." — Parallel waits for all branches. For fire-and-forget, use SNS + EventBridge fan-out or SQS. Use Parallel only when you need all results before proceeding.
- "We log at `OFF` level for Express Workflows in production." — You lose all observability. At minimum, use `ERROR` level logging to CloudWatch. Without it, debugging a failed Express execution is impossible.
- "We're not setting `MaxDelaySeconds` on retry." — Without a cap, exponential backoff on a 3-retry policy with `BackoffRate: 2` from `IntervalSeconds: 60` can delay up to 240 seconds. Set `MaxDelaySeconds` to bound worst-case latency.
- "We skip the execution role and use Lambda's role for service calls." — SDK integrations use the state machine's execution role, not Lambda's role. Failing to grant the right permissions to the execution role is the #1 cause of `States.Permissions` errors.
