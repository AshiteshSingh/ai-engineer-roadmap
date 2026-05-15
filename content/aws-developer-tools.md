# AWS Developer Tools & IaC

## The 30-Second Pitch

AWS Developer Tools & IaC is the ecosystem—CDK, SAM, CloudFormation, Terraform, AppConfig, CodeCatalyst, and Projen—that turns infrastructure from a manual, console-clicking liability into versioned, reviewable, testable code. The core bet: infrastructure defined as code is cheaper to change, safer to audit, and impossible to get wrong the same way twice. AWS CDK lets a TypeScript team write actual objects and classes instead of JSON; SAM gives Lambda developers a local Docker test harness; CloudFormation change sets make production deployments a reviewed PR instead of a blind apply; AppConfig lets you ship feature flags without a redeploy. The interview trap here is knowing when *not* to use CDK (multi-cloud) and when *not* to use Terraform (TypeScript shop, AWS-only, time-sensitive L3 constructs).

---

## 1. AWS CDK — Advanced Patterns

### CDK Construct Levels

The three-level hierarchy is the most tested CDK concept. Every level is the right choice in different contexts.

| Level | Class Prefix | Abstraction | When to Use |
|---|---|---|---|
| L1 (Cfn*) | `CfnBucket`, `CfnFunction` | 1:1 CloudFormation mapping, auto-generated | Need full CloudFormation property control; bleeding-edge features not yet in L2 |
| L2 | `s3.Bucket`, `lambda.Function` | Curated, opinionated, sensible defaults | 90% of real work; hides IAM boilerplate, auto-creates log groups |
| L3 (Patterns) | `ApplicationLoadBalancedFargateService`, `LambdaRestApi` | Multi-resource compositions | Greenfield apps; dramatically reduces line count |
| Custom L3 | Your `CompanyApiConstruct` | Encapsulated standards | Sharing conventions across 10+ teams (required versioning, encryption, tagging) |

**L1 escape hatch**: When L2 does not expose a property, drop down with `(bucket.node.defaultChild as s3.CfnBucket).websiteConfiguration = ...`. This is intentional design—not a hack.

```typescript
// L1 — full control, all CloudFormation properties available
const cfnBucket = new s3.CfnBucket(this, 'RawBucket', {
  bucketEncryption: {
    serverSideEncryptionConfiguration: [{
      serverSideEncryptionByDefault: { sseAlgorithm: 'aws:kms' },
    }],
  },
  versioningConfiguration: { status: 'Enabled' },
  objectLockEnabled: true,
});

// L2 — sensible defaults, grant methods, event notifications built in
const bucket = new s3.Bucket(this, 'AppBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.KMS_MANAGED,
  removalPolicy: cdk.RemovalPolicy.RETAIN, // never delete prod data
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});
bucket.grantReadWrite(myLambda); // generates exact IAM policy, no guesswork

// Custom L3 — encode company standards once, reuse everywhere
export class EncryptedBucket extends Construct {
  public readonly bucket: s3.Bucket;
  constructor(scope: Construct, id: string, props?: s3.BucketProps) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, 'Bucket', {
      versioned: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsBucket: ..., // company-standard access log bucket
      ...props,
    });
  }
}
```

### CDK App Structure Best Practices

Split stacks by **lifecycle** and **team ownership**. A Database stack and an API stack should not share a lifecycle—the API deploys 20 times a day, the database schema changes quarterly. Mixing them means every API deploy risks touching stateful resources.

```typescript
// bin/app.ts — entry point
const app = new cdk.App();

// Separate stacks by lifecycle + team ownership
new NetworkStack(app, 'Network', { env });      // slow-changing infra; VPC, subnets, TGW
new DatabaseStack(app, 'Database', { env });     // stateful — add stack policy + deletion protection
new ApiStack(app, 'Api', { env, dbStack });      // fast-changing; deploys on every merge to main
new MonitoringStack(app, 'Monitoring', { env }); // cross-cutting; alarms, dashboards, SNS topics

// Multi-environment: drive account/region from environment variables
// Set by CodePipeline or developer's AWS profile
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Pass typed props across stacks — no SSM lookups at synth time
interface ApiStackProps extends cdk.StackProps {
  dbStack: DatabaseStack;
}
// In ApiStack constructor:
// props.dbStack.table.grantReadWriteData(this.handler);
```

**Stack size limits**: CloudFormation caps at 500 resources per stack. Custom L3 constructs create many resources. Check with `cdk ls --long` and `cdk synth | wc -l` when stacks grow.

### CDK Aspects — Cross-Cutting Concerns

Aspects are visitors that traverse the entire construct tree after synthesis. They are the right place for security guardrails, cost tagging, and compliance enforcement—applied once at the app level, guaranteed on every resource.

```typescript
import { IConstruct } from 'constructs';

// Enforce KMS encryption on all S3 buckets — catches L1 and L2
class EnforceS3Encryption implements cdk.IAspect {
  visit(node: IConstruct) {
    if (node instanceof s3.CfnBucket) {
      node.bucketEncryption = {
        serverSideEncryptionConfiguration: [{
          serverSideEncryptionByDefault: { sseAlgorithm: 'aws:kms' },
        }],
      };
    }
  }
}

// Add cost allocation tags to every taggable resource
class AddCostTags implements cdk.IAspect {
  constructor(private readonly tags: Record<string, string>) {}
  visit(node: IConstruct) {
    if (cdk.TagManager.isTaggable(node)) {
      Object.entries(this.tags).forEach(([k, v]) =>
        cdk.Tags.of(node).add(k, v)
      );
    }
  }
}

// Enforce Lambda reserved concurrency (no unbounded functions in prod)
class EnforceLambdaConcurrency implements cdk.IAspect {
  visit(node: IConstruct) {
    if (node instanceof lambda.Function) {
      if (node.reservedConcurrentExecutions === undefined) {
        cdk.Annotations.of(node).addError(
          'Lambda functions must set reservedConcurrentExecutions'
        );
      }
    }
  }
}

// Apply at root — affects every stack, every resource
cdk.Aspects.of(app).add(new EnforceS3Encryption());
cdk.Aspects.of(app).add(new AddCostTags({ CostCenter: 'platform', Team: 'infra' }));
cdk.Aspects.of(app).add(new EnforceLambdaConcurrency());
```

### CDK Bootstrapping

Bootstrapping creates the CDKToolkit CloudFormation stack in each account/region before any CDK deployment. It provisions:
- S3 bucket: stores synthesized CloudFormation templates and Lambda ZIP assets
- ECR repository: stores Docker image assets
- IAM roles: `DeploymentActionRole`, `CloudFormationExecutionRole`, `LookupRole`, `FilePublishingRole`, `ImagePublishingRole`

```bash
# Bootstrap a single account
cdk bootstrap aws://123456789012/us-east-1

# Multi-account: trust a management/CI account to deploy to a workload account
# Run this in the WORKLOAD account, passing the CI account ID
cdk bootstrap aws://WORKLOAD_ACCOUNT/us-east-1 \
  --trust CICD_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Force-update bootstrap stack (e.g., after CDK major version upgrade)
cdk bootstrap --force

# Check bootstrap version required by current CDK
cdk bootstrap --show-template | grep BootstrapVersion
```

**Cross-account pattern**: CI/CD pipeline role in account A assumes `DeploymentActionRole` in account B. Account B's bootstrap was created with `--trust A`. No static credentials anywhere.

### CDK Watch & Hot-Swapping

For tight development loops on Lambda and ECS. Do not use in production.

```bash
# Skip CloudFormation change set for code-only changes — 3-5s vs 60-90s
cdk deploy --hotswap MyApiStack

# Continuously watch for changes and re-deploy
cdk watch MyApiStack
# cdk.json — configure watch patterns
# "watch": { "include": ["**"], "exclude": ["README.md", "cdk.out/**"] }
```

Hot-swap supports: Lambda function code, Lambda layers, ECS service task definition (image updates), Step Functions state machine definitions. It does NOT support IAM changes, VPC changes, or any resource creation/deletion. Those fall back to a full CloudFormation deployment automatically.

### CDK Nag — Security Validation

[cdk-nag](https://github.com/cdklabs/cdk-nag) applies opinionated security rule packs at synth time. Fails the build before a single API call is made to AWS.

```typescript
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

// Apply to entire app — runs during cdk synth
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Common failures and what they catch:
// AwsSolutions-S1: S3 bucket missing server access logging
// AwsSolutions-S2: S3 bucket allows public read
// AwsSolutions-L1: Lambda not using latest runtime
// AwsSolutions-IAM4: IAM policy uses AWS managed policy (too broad)
// AwsSolutions-ECS2: ECS task definition missing log configuration

// Suppress a specific rule with documented justification
NagSuppressions.addResourceSuppressions(
  myLambda,
  [{ id: 'AwsSolutions-IAM4', reason: 'Lambda basic execution role is scoped to logs only' }],
  true // applies to child constructs too
);

// Suppress at stack level — use sparingly
NagSuppressions.addStackSuppressions(this, [
  { id: 'AwsSolutions-S1', reason: 'Access logs bucket itself does not need access logs' },
]);
```

### CDK Pipelines — Self-Mutating Pipeline

CDK Pipelines is a construct library built on CodePipeline. The "self-mutating" property means the pipeline's first stage always re-synthesizes and updates the pipeline itself before deploying the application—so adding a new stage to your CDK code also adds it to the running pipeline automatically.

```typescript
import * as pipelines from 'aws-cdk-lib/pipelines';

const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
  pipelineName: 'MyServicePipeline',
  synth: new pipelines.ShellStep('Synth', {
    input: pipelines.CodePipelineSource.gitHub('org/repo', 'main', {
      authentication: cdk.SecretValue.secretsManager('github-token'),
    }),
    commands: [
      'npm ci',
      'npm run build',
      'npx cdk synth',
    ],
  }),
  selfMutation: true,         // pipeline updates itself first — always on for prod
  dockerEnabledForSynth: true, // needed if Dockerfile assets are in the app
  codeBuildDefaults: {
    buildEnvironment: {
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      computeType: codebuild.ComputeType.MEDIUM,
    },
  },
});

// Staging: automated tests gate promotion
pipeline.addStage(new AppStage(this, 'Staging', { env: stagingEnv }), {
  pre: [new pipelines.ShellStep('UnitTests', {
    commands: ['npm ci', 'npm test'],
  })],
  post: [new pipelines.ShellStep('IntegTests', {
    envFromCfnOutputs: { API_URL: stagingApiUrl }, // inject stack outputs
    commands: ['npm run test:integration'],
  })],
});

// Production: manual approval gate
pipeline.addStage(new AppStage(this, 'Production', { env: prodEnv }), {
  pre: [new pipelines.ManualApprovalStep('PromoteToProd')],
});
```

**Why self-mutation matters**: Without it, adding a new account to your deployment requires someone to manually edit the pipeline in the console or run a separate `cdk deploy`. With self-mutation, the pipeline configuration is just code in the repo—reviewed, versioned, and auto-applied on merge.

---

## 2. AWS SAM — Serverless Application Model

### SAM vs CDK

| Dimension | SAM | CDK |
|---|---|---|
| Learning curve | Low — YAML with Lambda shortcuts | Medium — TypeScript/Python/Java required |
| Local testing | First-class (`sam local invoke`, Docker) | Third-party tools (LocalStack, aws-cdk-local) |
| Language | YAML transform over CloudFormation | TypeScript, Python, Java, Go, .NET |
| Type safety | None | Full TypeScript type checking |
| Best for | Pure Lambda + API Gateway apps | Complex multi-service, multi-team architectures |
| Deployment | `sam deploy` → CloudFormation | `cdk deploy` → CloudFormation |
| Asset management | `sam build` (Lambda-compatible Docker) | `cdk synth` bundler (esbuild, Docker) |
| Ecosystem | SAM CLI, `sam accelerate` | CDK Pipelines, construct library, cdk-nag |
| Construct reuse | Low (copy-paste YAML) | High (npm packages, custom constructs) |

**Decision rule**: SAM if the team is ops-leaning and the app is Lambda + API Gateway + DynamoDB only. CDK if the team writes TypeScript daily and the architecture involves ECS, RDS, Step Functions, or cross-stack dependencies.

### SAM Template Reference

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Orders service

Globals:
  Function:
    Timeout: 30
    MemorySize: 512
    Runtime: nodejs20.x
    Architectures: [arm64]        # Graviton2 — 20% cheaper, faster cold starts
    Environment:
      Variables:
        TABLE_NAME: !Ref OrdersTable
        POWERTOOLS_SERVICE_NAME: orders
    Tracing: Active               # X-Ray active tracing on all functions
    Layers:
      - !Ref PowertoolsLayer

Resources:
  OrdersFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/orders/handler.handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref OrdersTable
        - SQSSendMessagePolicy:
            QueueName: !GetAtt DeadLetterQueue.QueueName
      Events:
        CreateOrder:
          Type: Api
          Properties:
            Path: /orders
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
        ProcessOrder:
          Type: SQS
          Properties:
            Queue: !GetAtt OrderQueue.Arn
            BatchSize: 10
            FunctionResponseTypes:
              - ReportBatchItemFailures  # partial batch failure support
            FilterCriteria:
              Filters:
                - Pattern: '{"body": {"status": ["PENDING"]}}'

  OrdersTable:
    Type: AWS::Serverless::SimpleTable
    Properties:
      PrimaryKey:
        Name: orderId
        Type: String
      BillingMode: PAY_PER_REQUEST
    DeletionPolicy: Retain        # do not drop prod table on stack delete

  PowertoolsLayer:
    Type: AWS::Serverless::LayerVersion
    Properties:
      LayerName: PowertoolsLayer
      ContentUri: layers/powertools/
      CompatibleRuntimes: [nodejs20.x]
    Metadata:
      BuildMethod: nodejs20.x
```

### SAM Local Testing

```bash
# Start local API Gateway with environment overrides
sam local start-api \
  --env-vars env.json \
  --docker-network my-network \  # connect to local DynamoDB container
  --warm-containers EAGER        # keep containers warm between invocations

# Invoke a single function directly (no HTTP)
sam local invoke OrdersFunction \
  --event events/create-order.json \
  --env-vars env.json

# Start local DynamoDB for integration tests
docker run -d -p 8000:8000 --name dynamodb-local amazon/dynamodb-local

# Create the table in local DynamoDB
aws dynamodb create-table \
  --table-name orders-local \
  --attribute-definitions AttributeName=orderId,AttributeType=S \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000

# Run integration tests against the local stack
TABLE_NAME=orders-local \
  AWS_ENDPOINT_URL=http://localhost:8000 \
  AWS_ACCESS_KEY_ID=local \
  AWS_SECRET_ACCESS_KEY=local \
  npm test

# Build in Lambda-compatible Docker container (catches native module issues)
sam build --use-container

# First deploy — interactive guided flow; saves samconfig.toml
sam deploy --guided

# Subsequent deploys use saved config
sam deploy
```

**SAM local limitations**: Authorizers (Cognito, custom Lambda) are not fully emulated. EventBridge, S3 event triggers, and Step Functions integrations require mocking. Layer limits can differ from Lambda limits. Not a replacement for integration tests against a real staging environment.

### SAM Accelerate (sam sync)

```bash
# Sync code changes directly to already-deployed Lambda — skips CloudFormation
sam sync \
  --stack-name my-orders-stack \
  --watch \
  --resource-id OrdersFunction  # sync only this function

# Under the hood: updates Lambda function code via UpdateFunctionCode API
# No change set, no rollback — development only
```

---

## 3. AWS CloudFormation — Advanced Topics

### Change Sets

Change sets are the production deployment safety net. Always use them. Never `aws cloudformation update-stack` directly in production.

```bash
# Create a change set — no changes applied yet
aws cloudformation create-change-set \
  --stack-name my-app-prod \
  --template-body file://template.yaml \
  --change-set-name deploy-2026-03-28 \
  --parameters ParameterKey=Env,ParameterValue=prod \
  --capabilities CAPABILITY_NAMED_IAM

# Wait for change set to be created
aws cloudformation wait change-set-create-complete \
  --change-set-name deploy-2026-03-28 \
  --stack-name my-app-prod

# Review what will change — look for Replacement=True (resource will be recreated)
aws cloudformation describe-change-set \
  --change-set-name deploy-2026-03-28 \
  --stack-name my-app-prod \
  --query 'Changes[*].ResourceChange.{Action:Action,Resource:LogicalResourceId,Replace:Replacement}'

# Apply only after review
aws cloudformation execute-change-set \
  --change-set-name deploy-2026-03-28 \
  --stack-name my-app-prod

# CDK uses change sets by default — cdk deploy runs create-change-set then execute
# Skip change set review in CDK with --no-change-set-approval (not recommended for prod)
```

**Replacement flag**: When `Replacement: True` appears for a stateful resource (RDS, DynamoDB, ElastiCache), stop. A replacement means CloudFormation will delete the old resource and create a new one. That is data loss. The fix is usually a two-step deploy: rename the resource in a separate stack, or use `UpdateReplacePolicy: Retain`.

### Stack Policies

Stack policies prevent accidental replace/delete on stateful resources. Applied once; override with a temporary policy for intentional schema migrations.

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "Update:*",
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["Update:Replace", "Update:Delete"],
      "Resource": "LogicalResourceId/ProductionDatabase"
    },
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["Update:Replace", "Update:Delete"],
      "Resource": "LogicalResourceId/UsersTable"
    }
  ]
}
```

```bash
# Apply stack policy
aws cloudformation set-stack-policy \
  --stack-name my-app-prod \
  --stack-policy-body file://stack-policy.json

# Temporarily override for intentional migration (scoped to this update only)
aws cloudformation update-stack \
  --stack-name my-app-prod \
  --stack-policy-during-update-body '{"Statement":[{"Effect":"Allow","Principal":"*","Action":"Update:*","Resource":"*"}]}'
```

### Drift Detection

Drift occurs when someone modifies a CloudFormation-managed resource outside of CloudFormation (console click, CLI, Terraform managing the same resource). CDK Aspects and stack policies prevent drift from being introduced through automation—but humans still click things.

```bash
# Initiate drift detection (async)
aws cloudformation detect-stack-drift --stack-name my-app-prod

# Check status
aws cloudformation describe-stack-drift-detection-status \
  --stack-drift-detection-id <id-from-above>

# Get per-resource drift details
aws cloudformation describe-stack-resource-drifts \
  --stack-name my-app-prod \
  --stack-resource-drift-status-filters MODIFIED DELETED
```

Best practice: run drift detection on a weekly EventBridge schedule; publish results to SNS; alert on-call if any drift detected. Drift is a compliance signal, not just an ops signal.

### CloudFormation Custom Resources

Custom resources let you run arbitrary code during CloudFormation create/update/delete. Use them to call external APIs, seed initial data, or manage resources CloudFormation does not natively support.

```typescript
// CDK AwsCustomResource — call any AWS SDK action during deployment
// No Lambda function to write or manage
const customResource = new custom_resources.AwsCustomResource(this, 'SeedConfig', {
  onCreate: {
    service: 'DynamoDB',
    action: 'putItem',
    parameters: {
      TableName: table.tableName,
      Item: {
        pk: { S: 'config' },
        schemaVersion: { N: '1' },
        featureFlags: { S: JSON.stringify({ newCheckout: false }) },
      },
    },
    physicalResourceId: custom_resources.PhysicalResourceId.of('SeedConfig-v1'),
  },
  onUpdate: {
    // re-run on each deploy to keep config in sync
    service: 'DynamoDB',
    action: 'putItem',
    parameters: { /* same */ },
    physicalResourceId: custom_resources.PhysicalResourceId.of('SeedConfig-v1'),
  },
  policy: custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
    resources: [table.tableArn],
  }),
});
customResource.node.addDependency(table);
```

### StackSets — Multi-Account/Region Deployments

StackSets deploy a single CloudFormation template to multiple accounts and regions simultaneously. The canonical use cases are organization-wide security baselines (CloudTrail, Config, GuardDuty, SecurityHub) and account vending machine patterns.

| Mode | How Targets Are Managed | Best For |
|---|---|---|
| Service-managed | AWS Organizations OUs; auto-deploys to new accounts | Large orgs; security baselines |
| Self-managed | Explicit account/region lists | Small orgs; limited deployments |

```bash
# Service-managed StackSet — deploy CloudTrail to all accounts in an OU
aws cloudformation create-stack-set \
  --stack-set-name OrgSecurityBaseline \
  --template-body file://security-baseline.yaml \
  --permission-model SERVICE_MANAGED \
  --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false

# Deploy to all accounts in a specific OU
aws cloudformation create-stack-instances \
  --stack-set-name OrgSecurityBaseline \
  --deployment-targets OrganizationalUnitIds=ou-xxxx-yyyyyyy \
  --regions us-east-1 eu-west-1 ap-southeast-1 \
  --operation-preferences \
    FailureToleranceCount=2 \      # allow 2 account failures before stopping
    MaxConcurrentCount=10           # deploy to 10 accounts in parallel
```

---

## 4. Terraform on AWS

### State Management Best Practices

Remote state in S3 with DynamoDB locking is the production minimum. Every team that runs `terraform apply` locally against shared state without locking eventually corrupts it.

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "tf-state-mycompany-prod"
    key            = "envs/prod/main.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/mrk-abc123"
    dynamodb_table = "tf-state-lock"  # prevents concurrent applies
  }
}

# Create the locking table (bootstrapped manually or via a separate root module)
resource "aws_dynamodb_table" "tf_lock" {
  name         = "tf-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute { name = "LockID"; type = "S" }
}
```

### Terragrunt for DRY Multi-Account

Terragrunt wraps Terraform to handle per-environment remote state automatically and to share module configurations without copy-pasting backend blocks.

```
infra/
  terragrunt.hcl           # root: backend template, provider config
  envs/
    prod/
      vpc/terragrunt.hcl   # inputs, dependency on nothing
      app/terragrunt.hcl   # inputs, dependency on vpc outputs
      db/terragrunt.hcl    # inputs, dependency on vpc outputs
    staging/
      vpc/terragrunt.hcl
      app/terragrunt.hcl
```

```hcl
# infra/terragrunt.hcl — root config
remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite"
  }
  config = {
    bucket         = "tf-state-${get_aws_account_id()}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "tf-state-lock"
  }
}

# infra/envs/prod/app/terragrunt.hcl
include "root" { path = find_in_parent_folders() }
terraform { source = "../../../../modules/app" }
dependency "vpc" { config_path = "../vpc" }
inputs = {
  vpc_id     = dependency.vpc.outputs.vpc_id
  subnet_ids = dependency.vpc.outputs.private_subnet_ids
}
```

### CDK vs Terraform Decision Matrix

| Dimension | CDK | Terraform |
|---|---|---|
| Language | TypeScript, Python, Java, Go, .NET | HCL (domain-specific) |
| Multi-cloud | AWS only (AWS CDK); multi-cloud via CDK for Terraform | AWS, Azure, GCP, on-prem |
| State management | CloudFormation (managed by AWS) | Manual (S3 + DynamoDB or Terraform Cloud) |
| Drift detection | CloudFormation drift detection | `terraform plan` shows drift |
| L3 constructs | Rich library (ApplicationLoadBalancedFargateService, etc.) | Modules (less opinionated, more manual) |
| Type safety | Full TypeScript; IDE autocomplete | Basic; limited IDE support |
| Import existing resources | `cdk import` (newer, improving) | `terraform import` (mature) |
| Community | Growing; AWS-backed | Massive; vendor-neutral |
| AWS integration | Native; no extra credentials | Requires AWS provider config |
| Best for | TypeScript teams, AWS-only, new greenfield | Multi-cloud; ops-leaning teams; existing HCL investment |

**Pragmatic rule**: If the entire company is AWS and engineers already write TypeScript, CDK wins on productivity. If the platform team supports AWS + GCP + Azure, Terraform wins on consistency.

---

## 5. Projen — Project Scaffolding

Projen is a code-first project configuration tool. Instead of hand-maintaining `package.json`, `tsconfig.json`, `.eslintrc`, `.prettierrc`, `.github/workflows/*.yml`, you declare them in `.projenrc.ts` and Projen generates the files. Generated files are marked read-only—no one edits them directly; they submit a PR to `.projenrc.ts` and run `npx projen`.

The value compounds across teams: your platform team publishes a `CompanyAwsCdkApp` Projen type; every new CDK service project is provisioned in minutes with canonical ESLint rules, security checks, and a working CI/CD workflow already wired.

```typescript
// .projenrc.ts
import { awscdk } from 'projen';

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.130.0',
  defaultReleaseBranch: 'main',
  name: 'orders-service',
  description: 'Orders domain service',
  deps: [
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/tracer',
    '@aws-lambda-powertools/metrics',
    'aws-lambda',
  ],
  devDeps: [
    '@types/aws-lambda',
    'cdk-nag',
    'aws-cdk-lib',          // peer dep
    'constructs',           // peer dep
  ],
  tsconfig: {
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
  },
  github: true,
  eslint: true,
  jest: true,
  prettier: true,
  jestOptions: {
    jestConfig: {
      coverageThreshold: {
        global: { branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});

project.synth(); // generates all config files
```

```bash
# Regenerate all managed files after changing .projenrc.ts
npx projen

# Managed files have this header — do not edit manually:
# ~~ Generated by projen. To modify, edit .projenrc.ts and run "npx projen".
```

---

## 6. AWS CodeCatalyst — Modern Dev Portal

CodeCatalyst is AWS's unified developer portal: issues, source repos, CI/CD workflows, and cloud dev environments in one place. It is positioned as a GitHub/GitLab alternative for teams that want zero credential management and deep AWS integration.

### Key Concepts

- **Space**: organization-level container; billing and member management
- **Project**: product-level container; repos, issues, CI/CD workflows
- **Dev Environment**: cloud IDE (VS Code Remote / JetBrains Gateway / SSH) with pre-provisioned compute; all dev dependencies in a `devfile.yaml`; no local setup required
- **Workflows**: YAML-based CI/CD (GitHub Actions-compatible syntax); native CDK deploy action; native SAM deploy action
- **Blueprints**: project templates (serverless API, React full-stack, microservices) with pre-wired CI/CD; one-click project creation

```yaml
# .codecatalyst/workflows/deploy.yaml
Name: DeployOrders
Triggers:
  - Type: PUSH
    Branches: [main]
Actions:
  Build:
    Identifier: aws/build@v1
    Inputs:
      Sources: [WorkflowSource]
    Configuration:
      Steps:
        - Run: npm ci
        - Run: npm test
        - Run: npx cdk synth
    Outputs:
      Artifacts:
        - Name: CdkOut
          Files: [cdk.out/**/*]
  Deploy:
    DependsOn: [Build]
    Identifier: aws/cdk-deploy@v1
    Inputs:
      Artifacts: [CdkOut]
    Configuration:
      StackName: orders-prod
      Region: us-east-1
    Environment:
      Name: production
      Connections:
        - AccountId: '123456789012'
          Role: CodeCatalystDeployRole
```

### CodeCatalyst vs GitHub

| Dimension | CodeCatalyst | GitHub |
|---|---|---|
| Auth to AWS | Roles (no credentials) | OIDC or stored secrets |
| Dev environments | Managed cloud IDEs (included) | Codespaces (separate pricing) |
| CI/CD | Workflows (native CDK/SAM actions) | Actions (rich marketplace) |
| Ecosystem | AWS-only; limited third-party | Massive marketplace, 20k+ actions |
| Pricing | Free tier; pay per build minute + dev env hour | Free tier; Actions minutes paid |
| Best for | Teams going all-in on AWS; zero-credential policy | Teams with existing GitHub ecosystem |

---

## 7. AWS AppConfig — Feature Flags & Dynamic Config

AppConfig decouples configuration from deployment. Change a feature flag, a rate limit, or a circuit breaker threshold without deploying code. Changes can be validated before rollout and rolled back automatically when CloudWatch alarms fire.

### Core Concepts

| Concept | What It Is |
|---|---|
| Application | Logical grouping (e.g., "orders-service") |
| Environment | prod, staging, dev — separate deployment targets |
| Configuration Profile | A specific config (e.g., "feature-flags", "rate-limits") |
| Deployment Strategy | How fast the change rolls out (linear, exponential, all-at-once) |
| Validator | JSON Schema or Lambda function — validates before rollout |

### Config Sources

- **AppConfig hosted**: managed storage; version history; recommended for most cases
- **SSM Parameter Store**: existing SSM params; useful for simple key-value config
- **S3**: large configs; JSON/YAML/TOML files
- **Secrets Manager**: for configs that are also secrets (not recommended — use Secrets Manager directly)
- **SSM Document**: YAML documents with type validation

### Deployment Strategies

| Strategy | Use Case | Risk |
|---|---|---|
| `AppConfig.AllAtOnce` | Non-production; internal tools | High — instant full rollout |
| `AppConfig.Linear50PercentEvery30Seconds` | Fast rollout with monitoring window | Medium |
| `AppConfig.Canary10Percent20Minutes` | Production feature flags | Low — catches issues early |
| Custom | Define bake time, growth rate, growth type | Tunable |

### Lambda Integration with Caching

```typescript
import {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
} from '@aws-sdk/client-appconfigdata';

const client = new AppConfigDataClient({});
let configToken: string | undefined;
let cachedConfig: FeatureFlags | undefined;

interface FeatureFlags {
  newCheckoutFlow: boolean;
  maxOrderItems: number;
  enableRecommendations: boolean;
}

// Call once per Lambda invocation — token has built-in TTL (poll interval)
// SDK caches within the execution environment between warm invocations
export async function getFeatureFlags(): Promise<FeatureFlags> {
  if (!configToken) {
    const session = await client.send(new StartConfigurationSessionCommand({
      ApplicationIdentifier: 'orders-service',
      EnvironmentIdentifier: 'production',
      ConfigurationProfileIdentifier: 'feature-flags',
      RequiredMinimumPollIntervalInSeconds: 30, // don't poll more than once per 30s
    }));
    configToken = session.InitialConfigurationToken!;
  }

  const response = await client.send(
    new GetLatestConfigurationCommand({ ConfigurationToken: configToken })
  );

  // Token rotates on every call — always update it
  configToken = response.NextPollConfigurationToken!;

  // Configuration is empty when nothing has changed since last poll
  if (response.Configuration && response.Configuration.length > 0) {
    cachedConfig = JSON.parse(
      Buffer.from(response.Configuration).toString('utf-8')
    ) as FeatureFlags;
  }

  return cachedConfig ?? { newCheckoutFlow: false, maxOrderItems: 50, enableRecommendations: false };
}
```

### AppConfig Lambda Extension

Instead of calling AppConfig data plane from each function, use the AWS-provided Lambda extension layer. It runs as a sidecar, polls AppConfig on a background thread, and exposes config over localhost HTTP. This eliminates IAM calls from the function code and adds automatic caching with configurable TTL.

```bash
# Add the extension layer (check current ARN for your region)
# ARN: arn:aws:lambda:us-east-1:027255383542:layer:AWS-AppConfig-Extension:128

# In CDK:
const extension = lambda.LayerVersion.fromLayerVersionArn(
  this, 'AppConfigExtension',
  `arn:aws:lambda:${this.region}:027255383542:layer:AWS-AppConfig-Extension:128`
);
fn.addLayers(extension);
```

```typescript
// With extension — simple HTTP call to localhost, no SDK
async function getConfig(): Promise<FeatureFlags> {
  const url = 'http://localhost:2772/applications/orders-service/environments/production/configurations/feature-flags';
  const response = await fetch(url);
  return response.json();
}
```

---

## Interview Q&A

**Q: What's the difference between CDK L1, L2, and L3 constructs? When do you use each?**

A: L1 (`CfnBucket`, `CfnFunction`) are 1:1 auto-generated CloudFormation mappings—every property available, nothing abstracted. Use L1 when you need a property that L2 does not yet expose, or when you need exact control over the CloudFormation resource. L2 (`s3.Bucket`, `lambda.Function`) are curated constructs with opinionated defaults, grant methods, and event wiring built in—use these for 90% of daily work. L3 are multi-resource compositions (`ApplicationLoadBalancedFargateService` creates ALB + target group + ECS service + IAM roles in one line)—use for greenfield architectures where the pattern matches exactly. Custom L3s encode your company's standards (required encryption, tagging, log groups) so teams cannot accidentally skip them.

---

**Q: How do CDK Aspects work and what are they used for?**

A: Aspects implement the visitor pattern—they receive every node in the construct tree after synthesis and can read or mutate it. Applied at the app level, an Aspect touches every resource in every stack. Common uses: enforce KMS encryption on all S3 buckets, add cost allocation tags to all taggable resources, validate that all Lambda functions set `reservedConcurrentExecutions`, check that all IAM roles have a description. Unlike writing checks in each construct, Aspects are centrally applied and cannot be accidentally omitted.

---

**Q: Compare CDK vs Terraform vs SAM — when do you choose each?**

A: SAM if the app is Lambda + API Gateway + DynamoDB and the team values local Docker testing with `sam local`. CDK if the team writes TypeScript, the architecture spans multiple AWS services, or construct reuse across teams is a priority. Terraform if the team manages multi-cloud infrastructure (AWS + GCP + Azure) or has significant existing HCL investment. The Terraform-vs-CDK debate is mostly moot if you are AWS-only and writing TypeScript—CDK's L3 constructs and type safety are a meaningful productivity advantage over HCL modules.

---

**Q: How does CDK Pipelines self-mutate? Why is this useful?**

A: The pipeline's first action synthesizes the CDK app and compares the resulting pipeline definition to the currently running pipeline. If they differ, it updates the pipeline (adds/removes stages, changes build images, updates source connections) before proceeding to deploy the application. Without self-mutation, you would need a human to run `cdk deploy` on the pipeline stack any time the pipeline itself changes. With it, adding a new staging environment is a three-line code change that goes through PR review and gets applied automatically on merge—the pipeline configuration is just code.

---

**Q: How do you handle stateful resources (RDS, DynamoDB) safely in CloudFormation/CDK deployments?**

A: Four layers of protection. First, `removalPolicy: cdk.RemovalPolicy.RETAIN` on the CDK resource—CloudFormation `DeletionPolicy: Retain` means the resource is not deleted when the stack is deleted. Second, stack policies that deny `Update:Replace` and `Update:Delete` on the logical resource IDs. Third, RDS/DynamoDB deletion protection enabled at the resource level (separate from CloudFormation). Fourth, change set review before every production apply—look for `Replacement: True` on any stateful resource and stop immediately if found. For schema migrations, use a separate migration Lambda invoked via CloudFormation custom resource, not in-band stack updates.

---

**Q: How would you implement feature flags in a Lambda-based application?**

A: AppConfig with the Lambda extension layer is the recommended pattern. AppConfig provides deployment strategies (canary, linear), automatic CloudWatch alarm rollback, JSON Schema validation before rollout, and version history. The Lambda extension runs as a sidecar, caches config locally with a configurable TTL (default 45s), and exposes it over `localhost:2772`—no SDK calls from the function path, no added latency on warm invocations. For simpler cases, SSM Parameter Store with `GetParameter` (with `--with-decryption` for SecureString) is acceptable but has no deployment strategy or rollback.

---

**Q: What is StackSets and how would you use it for organization-wide security baselines?**

A: StackSets deploy a single CloudFormation template to multiple AWS accounts and regions simultaneously. For security baselines, use service-managed StackSets (requires AWS Organizations) with `AutoDeployment: Enabled`—new accounts added to a target OU automatically get the baseline deployed. A typical org security baseline StackSet enables CloudTrail with S3 + CloudWatch Logs, activates AWS Config with required rules (encrypted EBS volumes, MFA on root, no public S3 buckets), enables GuardDuty delegated to the security account, and enables SecurityHub. Set `FailureToleranceCount: 2` so one failed account does not block all others.

---

**Q: How do you test CDK infrastructure code?**

A: Three layers. Unit tests use CDK's `assertions` module (`Template.fromStack(stack).hasResourceProperties(...)`)—fast, no AWS calls, run in CI on every commit. Integration tests use `integ-runner` and `integ-tests` CDK construct library—deploy a real stack in a sandbox account, run assertions against live resources, then destroy. Snapshot tests capture the entire synthesized CloudFormation template and fail when it changes unexpectedly—useful for catching unintended drift in shared constructs. Additionally, `cdk-nag` fails the synth on security policy violations before any code reaches AWS.

---

**Q: Explain SAM local testing — what are its limitations?**

A: `sam local invoke` runs your Lambda handler in a Docker container that approximates the Lambda execution environment. `sam local start-api` starts a local API Gateway emulator. Both are useful for fast iteration on handler logic and for catching packaging issues (missing dependencies, native module incompatibilities). Limitations: Cognito authorizers, IAM authorizers, and custom Lambda authorizers are not emulated. EventBridge event schemas, S3 event triggers, and DynamoDB Streams differ from production. Lambda Destinations are not supported. Timeout/memory limits are not enforced. Layer paths differ from production. For critical path testing, run against a real AWS staging environment—`sam sync --watch` makes this fast enough for iterative dev.

---

**Q: How would you manage secrets in a CDK application across environments?**

A: Never hardcode secrets in CDK code or synthesized templates. For cross-stack references to secret ARNs, use `cdk.SecretValue.secretsManager('prod/db/password')` in CDK—this writes the secret reference (not the value) into the CloudFormation template, and CloudFormation resolves it at deploy time. For Lambda/ECS environment variables, pass the secret ARN and use the AWS SDK to fetch at runtime (with caching). For database passwords, use Secrets Manager RDS integration—RDS can auto-rotate with zero Lambda code. For CI/CD, use `cdk.SecretValue.secretsManager` to reference GitHub tokens for CodePipeline sources. Never use SSM SecureString for high-sensitivity secrets—use Secrets Manager for rotation, cross-account access, and fine-grained IAM conditions.

---

## Red Flags to Avoid

- Using `cdk deploy --hotswap` or `cdk watch` in production pipelines — hotswap bypasses change set safety and can silently fail for non-trivial changes
- Not setting `removalPolicy: RETAIN` on databases, S3 buckets with user data, or Cognito User Pools before production launch
- Importing the same resource into multiple CDK stacks without `export/import` — use `Fn.importValue` / `stack.exportValue` to explicitly cross stack boundaries
- Running `terraform apply` without a prior `terraform plan` review in production, or without DynamoDB state locking configured
- Ignoring `Replacement: True` in CloudFormation change sets — this signals data loss for stateful resources
- Checking in CDK context values (`cdk.context.json`) that resolve environment-specific values (VPC IDs, AMI IDs) without understanding that stale context causes silent drift
- Using `aws cloudformation update-stack` directly in production instead of change sets — no preview, no audit trail of what changed
- Storing secrets in CloudFormation parameters with `NoEcho: true` — they still appear in CloudFormation events; use Secrets Manager references instead
- Skipping CDK bootstrapping multi-account trust setup and using admin credentials in CI instead
- Building a StackSet for every config change — StackSets are powerful but have eventual consistency; org-wide changes can take 30+ minutes to propagate; plan for that

---

## See Also

- [CI/CD & DevOps](/aws-cicd-devops) — CodePipeline and CodeBuild integration with CDK Pipelines
- [Lambda & Serverless](/aws-lambda-serverless) — SAM as the primary Lambda development workflow
- [IAM & Security](/aws-iam-security) — CDK IAM constructs, bootstrapping roles, and least-privilege patterns
- [AWS Architecture](/aws-architecture) — IaC as an operational excellence pillar
- [Compute & Containers](/aws-compute-containers) — CDK L3 constructs for ECS and EKS deployments
- [Messaging & Events](/aws-messaging-events) — AppConfig for feature flags in event-driven architectures
- [Cost Optimization](/aws-cost-optimization) — CDK Aspects for organization-wide cost allocation tagging
