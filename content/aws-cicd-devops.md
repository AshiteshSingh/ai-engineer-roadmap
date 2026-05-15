# AWS CI/CD & DevOps

## The 30-Second Pitch
AWS CI/CD & DevOps is the integrated ecosystem of services—CodeCommit, CodeBuild, CodeDeploy, CodePipeline, CloudFormation, CDK, and Systems Manager—that automate and govern the entire software delivery lifecycle on AWS. It solves the problem of manual, error-prone deployments and inconsistent infrastructure by giving teams a single-vendor, IAM-integrated, audit-trailed path from source code to production. Teams pick the AWS native toolchain for tight integration with [IAM](/aws/iam-security), CloudWatch, and every AWS resource (no separate credentials plumbing), for compliance (all API calls logged to CloudTrail), and for the unified billing and support model. The strategic tradeoff versus GitHub Actions + Terraform is flexibility for simplicity—AWS native tools are less portable but operationally tighter.

---

## 1. AWS CodeCommit

### What It Is
A fully managed, Git-compatible source control service. Repositories are hosted in AWS, are regionally redundant, and are encrypted at rest (KMS) and in transit (TLS). It was deprecated for new customers in July 2024—existing repos still work, but AWS is steering new workloads toward GitHub/GitLab with OIDC. **Interview insight:** Know why it's being deprecated and know the migration path, but also understand it deeply because many enterprises still run it.

### IAM Integration (Key Differentiator)
There are no per-repository passwords. Access is governed entirely by [IAM](/aws/iam-security):
- **IAM Users** get Git credentials via `aws iam upload-ssh-public-key` (SSH) or HTTP credentials generated from the IAM console.
- **IAM Roles** can be assumed by CodeBuild/CodePipeline/Lambda to access repos—no secrets to rotate.
- **IAM Policies** control repository-level actions: `codecommit:GitPull`, `codecommit:GitPush`, `codecommit:CreateBranch`, `codecommit:DeleteBranch`, `codecommit:GetMergeCommit`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codecommit:GitPull",
        "codecommit:GitPush"
      ],
      "Resource": "arn:aws:codecommit:us-east-1:123456789012:MyRepo",
      "Condition": {
        "StringEqualsIfExists": {
          "codecommit:References": [
            "refs/heads/main",
            "refs/heads/develop"
          ]
        }
      }
    }
  ]
}
```

### Triggers and Notifications
- **Repository Triggers**: Execute a Lambda function or publish to SNS on push events. Configured per branch pattern. Low-latency, direct.
- **Amazon EventBridge (CloudWatch Events)**: More powerful. CodeCommit emits events to the default event bus—`pullRequestCreated`, `pullRequestMerged`, `referenceUpdated`. Use EventBridge rules to fan out to multiple targets (Lambda, Step Functions, SQS, CodePipeline).

```json
// EventBridge rule: trigger CodePipeline on push to main
{
  "source": ["aws.codecommit"],
  "detail-type": ["CodeCommit Repository State Change"],
  "detail": {
    "event": ["referenceUpdated"],
    "referenceName": ["main"]
  }
}
```

### CodeCommit vs GitHub
| Dimension | CodeCommit | GitHub |
|---|---|---|
| Auth | IAM (no secrets) | PATs / App credentials / OIDC |
| Pull Requests | Basic (no review apps) | Full code review ecosystem |
| Actions/CI | CodeBuild only | GitHub Actions (rich marketplace) |
| Deprecation | Deprecated for new customers 2024 | Active development |
| Compliance | CloudTrail-native | Requires audit log configuration |
| Cross-account | Via IAM roles | Via GitHub App / OIDC |
| Pricing | $1/active user/mo, $0.06/GB | Free tier generous; Enterprise pricing |

**Migration path**: Clone CodeCommit repo → push to GitHub → configure OIDC trust → update pipelines to use GitHub source action.

---

## 2. AWS CodeBuild

### What It Is
A fully managed, serverless build service. You pay per build minute. No servers to manage. Each build runs in a fresh, isolated Docker container. The build is defined by a `buildspec.yml` file (or inline YAML in the project configuration).

### The buildspec.yml Anatomy

```yaml
version: 0.2

# Environment variables available to all phases
env:
  variables:
    IMAGE_REPO_NAME: "my-app"
    AWS_DEFAULT_REGION: "us-east-1"
  # Inject secrets from Parameter Store (decrypted at build time)
  parameter-store:
    DB_PASSWORD: "/myapp/prod/db-password"
  # Inject secrets from Secrets Manager
  secrets-manager:
    API_KEY: "myapp/api-key:API_KEY"
  # Export variables to subsequent actions in CodePipeline
  exported-variables:
    - IMAGE_TAG

phases:
  install:
    runtime-versions:
      nodejs: 18
      python: 3.11
    commands:
      - npm ci
      - pip install -r requirements.txt

  pre_build:
    commands:
      # Log in to ECR
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - export IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)
      - echo "Building image $IMAGE_REPO_NAME:$IMAGE_TAG"

  build:
    on-failure: ABORT  # ABORT (default) or CONTINUE
    commands:
      - npm test
      - docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .
      - docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG

  post_build:
    commands:
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG
      # Write image definition file for CodeDeploy/ECS action
      - printf '[{"name":"my-app","imageUri":"%s"}]' $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
    - appspec.yml
    - taskdef.json
  discard-paths: yes

# Secondary artifacts (multiple output locations)
secondary-artifacts:
  test-reports:
    files:
      - "coverage/**/*"
    base-directory: coverage

reports:
  jest-reports:
    files:
      - "test-results.xml"
    file-format: JUNITXML

cache:
  paths:
    - '/root/.npm/**/*'
    - 'node_modules/**/*'
```

### Build Phases (execution order)
1. `SUBMITTED` → `QUEUED` → `PROVISIONING` (container startup, ~30s)
2. `DOWNLOAD_SOURCE` → runs `install` → `pre_build` → `build` → `post_build`
3. `UPLOAD_ARTIFACTS` → `FINALIZING` → `COMPLETED` or `FAILED`

**Key**: If `build` fails and `on-failure: ABORT`, `post_build` is skipped. If `on-failure: CONTINUE`, post_build runs (useful for publishing test results even on failure).

### Compute Types
| Type | vCPU | Memory | Use Case |
|---|---|---|---|
| `BUILD_GENERAL1_SMALL` | 3 | 4 GB | Simple builds, unit tests |
| `BUILD_GENERAL1_MEDIUM` | 7 | 16 GB | Standard Docker builds |
| `BUILD_GENERAL1_LARGE` | 15 | 36 GB | Heavy builds, ML model training |
| `BUILD_GENERAL1_XLARGE` | 72 | 144 GB | Large parallel test suites |
| `BUILD_LAMBDA_1GB`–`10GB` | Varies | 1–10 GB | Lambda-backed builds (no Docker) |

### Docker Builds in CodeBuild
CodeBuild containers run in Docker themselves. To build Docker images, you need **privileged mode** enabled on the project. Without it, `docker build` fails.

```bash
# In pre_build: authenticate to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com

# Use BuildKit for faster builds with better caching
export DOCKER_BUILDKIT=1
docker build --cache-from ACCOUNT.dkr.ecr.REGION.amazonaws.com/myapp:cache \
             --build-arg BUILDKIT_INLINE_CACHE=1 \
             -t myapp:$IMAGE_TAG .
# Push cache layer separately
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/myapp:cache
```

### Caching Strategies
1. **Local cache** (fastest, ephemeral per fleet): `cache: { type: LOCAL, modes: [SOURCE, DOCKER_LAYER, CUSTOM] }`. Docker layer cache lives in the build fleet but is NOT guaranteed between builds.
2. **S3 cache** (slower, persistent): CodeBuild zips the `cache.paths` contents to S3 after build, restores at start of next build. Works across all build environments.
3. **ECR cache** (for Docker): Pull previously built image as `--cache-from`; only changed layers are rebuilt.

### VPC Integration
For builds that need to reach private resources (RDS, ElastiCache, internal APIs), configure the CodeBuild project with a VPC, subnets, and security groups. The build container runs inside your VPC. See [VPC & Networking](/aws-vpc-networking) for subnet selection and security group rules.

### Environment Variables Precedence (important for interviews)
Highest to lowest: **Start build override** > **Project-level env vars** > **buildspec env vars**. Never put secrets in plaintext project env vars—they show up in logs. Always use Parameter Store or Secrets Manager references.

---

## 3. AWS CodeDeploy

### What It Is
A deployment service that automates application deployments to EC2, [ECS](/aws/compute-containers), [Lambda](/aws/lambda-serverless), or on-premises servers. It handles the mechanics of the deployment (stopping old versions, starting new ones, health checks) so you define the strategy, not the shell scripts.

### Deployment Types

**In-Place (EC2/on-premises only)**
The running application on each instance is stopped, the new version is installed, and the application is restarted. Instance is out of service during update. Best for non-critical workloads or when rolling-restart downtime is acceptable.

**Blue/Green**
A new set of instances (green) is provisioned, the app is deployed and validated there, then traffic is shifted from old (blue) to new (green). Blue instances can be kept for rollback or terminated. Zero-downtime, instant rollback.

### Deployment Groups
A deployment group is the target set: a set of EC2 instances (via tags or Auto Scaling Groups), ECS service/cluster, or Lambda function. It also specifies:
- Deployment configuration (speed/batch size)
- Load balancer (for in-place deregistration / blue-green traffic shifting)
- Rollback settings
- CloudWatch alarm triggers for automatic rollback
- SNS notifications

### The AppSpec File

**For EC2/on-premises (`appspec.yml`)**:
```yaml
version: 0.0
os: linux
files:
  - source: /dist         # From the artifact
    destination: /opt/myapp

permissions:
  - object: /opt/myapp
    owner: ec2-user
    group: ec2-user
    mode: 755
    type:
      - directory
      - file

hooks:
  BeforeInstall:
    - location: scripts/stop_server.sh
      timeout: 300
      runas: root
  AfterInstall:
    - location: scripts/install_dependencies.sh
      timeout: 600
      runas: ec2-user
  ApplicationStart:
    - location: scripts/start_server.sh
      timeout: 300
      runas: ec2-user
  ValidateService:
    - location: scripts/health_check.sh
      timeout: 300
```

**Hook lifecycle for in-place EC2 deployments**:
```
BeforeBlockTraffic → BlockTraffic → AfterBlockTraffic
→ ApplicationStop
→ DownloadBundle → BeforeInstall → Install → AfterInstall
→ ApplicationStart → ValidateService
→ BeforeAllowTraffic → AllowTraffic → AfterAllowTraffic
```

**For ECS (`appspec.yml`)**:
```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: <TASK_DEFINITION>  # Replaced by CodePipeline action
        LoadBalancerInfo:
          ContainerName: "my-app"
          ContainerPort: 80
        PlatformVersion: "LATEST"

Hooks:
  - BeforeInstall: "LambdaFunctionToValidateBeforeInstall"
  - AfterInstall: "LambdaFunctionToValidateAfterInstall"
  - AfterAllowTestTraffic: "LambdaFunctionToValidateAfterTestTrafficShifts"
  - BeforeAllowTraffic: "LambdaFunctionToValidateBeforeTrafficShifts"
  - AfterAllowTraffic: "LambdaFunctionToValidateAfterTrafficShifts"
```

**For Lambda (`appspec.yml`)**:
```yaml
version: 0.0
Resources:
  - MyLambdaFunction:
      Type: AWS::Lambda::Function
      Properties:
        Name: "MyLambdaFunction"
        Alias: "MyLambdaFunctionAlias"
        CurrentVersion: "1"
        TargetVersion: "2"
Hooks:
  - BeforeAllowTraffic: "PreTrafficLambdaFunction"
  - AfterAllowTraffic: "PostTrafficLambdaFunction"
```

### Deployment Configurations
| Config | Description |
|---|---|
| `CodeDeployDefault.AllAtOnce` | All instances at once. Fastest, maximum downtime risk |
| `CodeDeployDefault.HalfAtATime` | 50% at a time. Half available during deploy |
| `CodeDeployDefault.OneAtATime` | One instance at a time. Slowest, safest |
| `CodeDeployDefault.LambdaAllAtOnce` | Lambda: all traffic immediately |
| `CodeDeployDefault.LambdaCanary10Percent5Minutes` | 10% for 5min, then 90% |
| `CodeDeployDefault.LambdaCanary10Percent30Minutes` | 10% for 30min, then 90% |
| `CodeDeployDefault.LambdaLinear10PercentEvery1Minute` | 10% every 1min until 100% |
| `CodeDeployDefault.ECSCanary10Percent5Minutes` | ECS: same canary pattern |
| Custom | Define `minimumHealthyHosts: { value: 75, type: FLEET_PERCENT }` |

### Automatic Rollback
Configure deployment group to auto-rollback when:
- Deployment fails (any hook exits non-zero)
- A specified CloudWatch alarm triggers during deployment window

```json
{
  "autoRollbackConfiguration": {
    "enabled": true,
    "events": ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  },
  "alarmConfiguration": {
    "enabled": true,
    "alarms": [{ "name": "5xxErrorRateAlarm" }]
  }
}
```

---

## 4. AWS CodePipeline

### What It Is
A fully managed continuous delivery service that models, visualizes, and automates release pipelines. A pipeline is a directed sequence of **stages**, each containing one or more **actions**. Pipelines are triggered by source changes and progress artifacts from stage to stage.

### Core Concepts

**Stages**: Logical grouping of actions (e.g., Source, Build, Test, Deploy). Stages execute sequentially. A stage can have parallel actions (within the stage). A stage can be blocked for manual approval.

**Actions**: The atomic unit of work. Types:
- `Source`: CodeCommit, S3, ECR, GitHub (via CodeStar Connection), Bitbucket
- `Build`: CodeBuild (invoke a build project)
- `Test`: CodeBuild, AWS Device Farm, third-party (BlazeMeter)
- `Deploy`: CodeDeploy, CloudFormation, ECS, Elastic Beanstalk, S3
- `Approval`: Manual approval (SNS notification → human approves/rejects in console/CLI)
- `Invoke`: Lambda function (custom logic)

**Artifacts**: Files passed between actions via [S3](/aws/storage-s3) (the pipeline's artifact bucket). Each action can declare `inputArtifacts` and `outputArtifacts`. CodePipeline zips/unzips them automatically.

```
Source (GitHub) → [SourceArtifact]
     ↓
Build (CodeBuild) ← [SourceArtifact]  → [BuildArtifact]
     ↓
Approval (Manual) ← notification via SNS
     ↓
Deploy (CodeDeploy) ← [BuildArtifact]
```

### A Full Pipeline Definition (CloudFormation excerpt)
```yaml
Resources:
  AppPipeline:
    Type: AWS::CodePipeline::Pipeline
    Properties:
      RoleArn: !GetAtt PipelineRole.Arn
      ArtifactStore:
        Type: S3
        Location: !Ref ArtifactBucket
        EncryptionKey:
          Id: !Ref PipelineKMSKey
          Type: KMS
      Stages:
        - Name: Source
          Actions:
            - Name: GitHub_Source
              ActionTypeId:
                Category: Source
                Owner: AWS
                Provider: CodeStarSourceConnection
                Version: "1"
              Configuration:
                ConnectionArn: !Ref GitHubConnection
                FullRepositoryId: "org/repo"
                BranchName: main
                OutputArtifactFormat: CODE_ZIP
              OutputArtifacts:
                - Name: SourceArtifact

        - Name: Build
          Actions:
            - Name: Build_and_Test
              ActionTypeId:
                Category: Build
                Owner: AWS
                Provider: CodeBuild
                Version: "1"
              InputArtifacts:
                - Name: SourceArtifact
              OutputArtifacts:
                - Name: BuildArtifact
              Configuration:
                ProjectName: !Ref CodeBuildProject
              RunOrder: 1

            # Parallel action in same stage
            - Name: Security_Scan
              ActionTypeId:
                Category: Test
                Owner: AWS
                Provider: CodeBuild
                Version: "1"
              InputArtifacts:
                - Name: SourceArtifact
              Configuration:
                ProjectName: !Ref SecurityScanProject
              RunOrder: 1  # Same RunOrder = parallel

        - Name: Approve_Prod
          Actions:
            - Name: Manual_Approval
              ActionTypeId:
                Category: Approval
                Owner: AWS
                Provider: Manual
                Version: "1"
              Configuration:
                NotificationArn: !Ref ApprovalSNSTopic
                CustomData: "Review staging results before promoting to prod"
                ExternalEntityLink: "https://staging.example.com/health"

        - Name: Deploy_Prod
          Actions:
            - Name: Deploy
              ActionTypeId:
                Category: Deploy
                Owner: AWS
                Provider: CodeDeploy
                Version: "1"
              InputArtifacts:
                - Name: BuildArtifact
              Configuration:
                ApplicationName: !Ref CodeDeployApp
                DeploymentGroupName: !Ref ProdDeploymentGroup
```

### Parallel Actions
Within a stage, actions with the same `RunOrder` number execute in parallel. Actions with a higher `RunOrder` wait for all lower-order actions in the stage to succeed.

```
Stage: Build
  RunOrder 1: [CodeBuild: unit-tests] [CodeBuild: lint]  ← parallel
  RunOrder 2: [CodeBuild: integration-tests]              ← waits for RunOrder 1
```

### Cross-Account Pipelines
To deploy from Account A's pipeline to Account B's resources:
1. The pipeline's S3 artifact bucket in Account A must have a bucket policy allowing Account B's deployment role.
2. The KMS key encrypting artifacts must have a key policy allowing Account B.
3. Account B must have a role (the "cross-account role") that Account A can assume (`sts:AssumeRole`).
4. The cross-account role in Account B has `codecodedeploy:*` or CloudFormation permissions needed for deployment.
5. In the pipeline's deploy action, specify `RoleArn` of the cross-account role.

```json
// Account A Pipeline's deploy action
{
  "name": "Deploy_to_Prod",
  "roleArn": "arn:aws:iam::ACCOUNT_B:role/CrossAccountDeployRole",
  "actionTypeId": { "provider": "CloudFormation" },
  "configuration": { ... }
}
```

### Source Providers Comparison
| Provider | Trigger | Auth | Notes |
|---|---|---|---|
| CodeCommit | EventBridge (instant) | IAM role | Native, no credentials |
| GitHub.com | Webhook via CodeStar Connection | OAuth App | Requires one-time console auth |
| GitHub Enterprise | Webhook via CodeStar Connection | OAuth App | Self-hosted support |
| Bitbucket | Webhook via CodeStar Connection | OAuth App | Same as GitHub flow |
| S3 | Polling (1 min) or EventBridge | IAM role | For zip artifacts, ML models |
| ECR | EventBridge (image push) | IAM role | Trigger on new image tag |

---

## 5. Pipeline Patterns

### Git Flow → Pipeline Mapping

```
Branch Strategy:          Pipeline Behavior:
─────────────────         ──────────────────
feature/*  ──push──→      [Lint + Unit Tests only, no deploy]
                          (PR to develop triggers CodeBuild check)

develop    ──merge──→     [Build → Test → Deploy to Dev]
                          (auto-deploy to dev environment)

release/*  ──create──→    [Build → Test → Deploy to Staging]
                          (QA gate; no auto-prod)

main       ──merge──→     [Build → Test → Manual Approval → Deploy to Prod]
                          (git tag triggers versioned release)

hotfix/*   ──push──→      [Fast-track: Build → Test → Manual Approval → Prod]
                          (bypasses staging; requires 2 approvals)
```

**Implementation**: Use separate CodePipeline pipelines per long-lived branch. Feature branch CI is handled by a CodeBuild project triggered via EventBridge on any `refs/heads/feature/*` push—not a full pipeline.

### Multi-Account Pipeline (Dev → Staging → Prod)

```
┌────────────────────────────────────────────────────────────────┐
│  TOOLS ACCOUNT (111111111111)                                   │
│  - CodePipeline                                                 │
│  - CodeBuild                                                    │
│  - Artifact S3 bucket (KMS encrypted)                          │
│  - ECR (cross-account pull allowed)                             │
└──────────────┬───────────────────────────────┬─────────────────┘
               │ AssumeRole                     │ AssumeRole
               ↓                               ↓
┌──────────────────────────┐     ┌──────────────────────────────┐
│  DEV ACCOUNT (222222)    │     │  STAGING ACCOUNT (333333)    │
│  CrossAccountDeployRole  │     │  CrossAccountDeployRole      │
│  ECS Cluster / Lambda    │     │  ECS Cluster / Lambda        │
└──────────────────────────┘     └──────────────────────────────┘
                                               │ Manual Approval
                                               ↓
                                 ┌──────────────────────────────┐
                                 │  PROD ACCOUNT (444444)       │
                                 │  CrossAccountDeployRole      │
                                 │  ECS Cluster / Lambda        │
                                 └──────────────────────────────┘
```

**Key setup steps**:
1. Create a dedicated **Tools account** (or use the Mgmt account—not recommended for security).
2. ECR repository in Tools account; grant `ecr:GetDownloadUrlForLayer` etc. to Dev/Staging/Prod account principals.
3. KMS key policy: `kms:Decrypt` for all deployment account roles.
4. S3 artifact bucket policy: `s3:GetObject` for all deployment account roles.
5. Each target account has an [IAM](/aws/iam-security) role with a trust policy trusting the Tools account pipeline execution role.

### Feature Branch Strategies

**Strategy 1: CodeBuild webhook (checks only)**
```yaml
# CodeBuild project filter groups
filterGroups:
  - - type: EVENT
      pattern: PULL_REQUEST_CREATED,PULL_REQUEST_UPDATED
    - type: HEAD_REF
      pattern: refs/heads/feature/.*
```
Builds run on PR open/update. Build status is reported back to GitHub as a commit status. No deployment.

**Strategy 2: Ephemeral environments per PR**
A Lambda function (triggered by CodePipeline or directly from GitHub webhook) calls CloudFormation `create-stack` with a stack name derived from the PR number. Teardown via a second Lambda on PR close/merge.

```python
# Lambda: create ephemeral env
def handler(event, context):
    pr_number = event['detail']['pullRequestId']
    stack_name = f"feature-pr-{pr_number}"
    cfn.create_stack(
        StackName=stack_name,
        TemplateURL=f"s3://{TEMPLATE_BUCKET}/feature-env.yaml",
        Parameters=[
            {'ParameterKey': 'PRNumber', 'ParameterValue': pr_number},
            {'ParameterKey': 'ImageTag', 'ParameterValue': event['detail']['sourceCommit']}
        ],
        Tags=[{'Key': 'ephemeral', 'Value': 'true'}],
        Capabilities=['CAPABILITY_IAM']
    )
```

---

## 6. Infrastructure as Code

### CloudFormation

**Mental model**: CloudFormation is a declarative state engine. You describe the desired state in a template (JSON/YAML). CloudFormation computes the diff between current state and desired state, then executes the changes in dependency order (using an internal DAG).

**Core concepts**:
- **Stack**: A single unit of deployment. All resources in a template are part of the same stack. Stack = unit of lifecycle management.
- **Change Set**: Preview of what changes will occur before executing. Always use change sets in production—never `update-stack` directly.
- **Drift Detection**: Compares actual resource configuration against what CloudFormation expects. Reports `DRIFTED`, `IN_SYNC`, or `NOT_CHECKED` per resource. Does NOT auto-remediate.
- **Stack Sets**: Deploy the same template across multiple AWS accounts and/or regions from a single operation. Requires `AWSCloudFormationStackSetAdministrationRole` in admin account and `AWSCloudFormationStackSetExecutionRole` in target accounts.
- **Nested Stacks**: A stack that is a resource (`AWS::CloudFormation::Stack`) in a parent stack. Enables template reuse and breaking up large templates. Parent passes parameters to child; child outputs are available via `!GetAtt NestedStack.Outputs.OutputName`.

```yaml
# Parent stack with nested stacks
Resources:
  NetworkStack:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: !Sub "https://s3.${AWS::Region}.amazonaws.com/${TemplateBucket}/network.yaml"
      Parameters:
        VpcCidr: "10.0.0.0/16"

  AppStack:
    Type: AWS::CloudFormation::Stack
    DependsOn: NetworkStack
    Properties:
      TemplateURL: !Sub "https://s3.${AWS::Region}.amazonaws.com/${TemplateBucket}/app.yaml"
      Parameters:
        VpcId: !GetAtt NetworkStack.Outputs.VpcId
        SubnetIds: !GetAtt NetworkStack.Outputs.PrivateSubnetIds

# Change set workflow
# aws cloudformation create-change-set --stack-name prod-stack --template-body file://template.yaml --change-set-name update-v2
# aws cloudformation describe-change-set --stack-name prod-stack --change-set-name update-v2
# aws cloudformation execute-change-set --stack-name prod-stack --change-set-name update-v2
```

**DeletionPolicy and UpdateReplacePolicy**:
```yaml
MyDatabase:
  Type: AWS::RDS::DBInstance
  DeletionPolicy: Snapshot    # Take snapshot before delete
  UpdateReplacePolicy: Snapshot  # Take snapshot if resource must be replaced during update
  Properties:
    ...
```

**Stack rollback behavior**: If any resource fails to create/update, CloudFormation rolls back the entire stack to the last known good state. Exception: `--disable-rollback` flag (useful for debugging but dangerous in prod).

### AWS CDK

**Mental model**: CDK is a layer on top of CloudFormation. You write infrastructure in a real programming language (TypeScript, Python, Java, Go, C#), and CDK synthesizes it to a CloudFormation template. The power is reusable abstractions, type safety, and your IDE's autocomplete.

**Construct levels**:
- **L1 (Cfn constructs)**: 1:1 mapping to CloudFormation resources. Auto-generated, verbose. `new ec2.CfnInstance(this, 'MyEC2', { ... })`.
- **L2 (curated constructs)**: High-level, opinionated abstractions with sane defaults. `new ec2.Instance(this, 'MyEC2', { instanceType: ec2.InstanceType.of(...) })`. Most used in practice.
- **L3 (patterns / Solutions Constructs)**: Opinionated combinations of L2 constructs. `new patterns.ApplicationLoadBalancedFargateService(this, 'Service', { ... })`. One-liner for ALB + ECS + IAM roles + logging.

```typescript
// CDK stack example: ECS service with auto-scaling
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';

export class AppStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'AppVpc', { maxAzs: 2 });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(
          ecr.Repository.fromRepositoryName(this, 'Repo', 'my-app')
        ),
        environment: {
          NODE_ENV: 'production',
        },
        secrets: {
          DB_PASSWORD: ecs.Secret.fromSecretsManager(
            secretsmanager.Secret.fromSecretNameV2(this, 'DbSecret', 'myapp/db-password')
          ),
        },
      },
    });

    // Auto-scaling
    const scaling = fargateService.service.autoScaleTaskCount({ maxCapacity: 10 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
  }
}
```

**CDK Aspects**: Cross-cutting concerns applied to the entire construct tree. Use to enforce policies (e.g., all [S3](/aws/storage-s3) buckets must have encryption, all [lambdas](/aws/lambda-serverless) must have X-Ray tracing).

```typescript
class EnforceEncryption implements cdk.IAspect {
  visit(node: IConstruct): void {
    if (node instanceof s3.CfnBucket) {
      if (!node.bucketEncryption) {
        cdk.Annotations.of(node).addError('S3 bucket must have encryption enabled');
      }
    }
  }
}

// Apply to entire app
cdk.Aspects.of(app).add(new EnforceEncryption());
```

**CDK Pipelines**: A self-mutating pipeline built with CDK. The pipeline's first action is `cdk deploy` of the pipeline itself—so changing the pipeline definition just requires a push. Uses CodePipeline under the hood.

```typescript
const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
  synth: new pipelines.ShellStep('Synth', {
    input: pipelines.CodePipelineSource.connection('org/repo', 'main', {
      connectionArn: 'arn:aws:codestar-connections:...',
    }),
    commands: ['npm ci', 'npm run build', 'npx cdk synth'],
  }),
});

pipeline.addStage(new AppStage(this, 'Dev', {
  env: { account: '222222222222', region: 'us-east-1' }
}), {
  post: [
    new pipelines.ShellStep('IntegTest', {
      commands: ['curl -f $ENDPOINT/health'],
      envFromCfnOutputs: { ENDPOINT: deployedStage.loadBalancerDnsName },
    }),
  ],
});

pipeline.addStage(new AppStage(this, 'Prod', { env: { ... } }), {
  pre: [new pipelines.ManualApprovalStep('PromoteToProd')],
});
```

**CDK commands**:
- `cdk synth`: Synthesize CloudFormation template (no deployment)
- `cdk diff`: Show what will change vs deployed stack
- `cdk deploy`: Deploy (synth + create change set + execute)
- `cdk destroy`: Destroy stack
- `cdk bootstrap`: Create the CDKToolkit stack (S3 bucket, ECR repo, IAM roles) in an account/region—required once per account/region before first deploy

### Terraform on AWS

**State management** (critical topic):
```hcl
# Remote state in S3 with DynamoDB locking
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/us-east-1/app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/..."

    # DynamoDB for state locking (prevents concurrent applies)
    dynamodb_table = "terraform-state-lock"
  }
}

# DynamoDB table for locking (must have LockID as partition key)
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}
```

**AWS provider configuration**:
```hcl
provider "aws" {
  region = "us-east-1"
  # For cross-account: assume a role
  assume_role {
    role_arn     = "arn:aws:iam::TARGET_ACCOUNT:role/TerraformDeployRole"
    session_name = "terraform-deploy"
  }
}

# Multiple providers for multi-region/multi-account
provider "aws" {
  alias  = "us_west"
  region = "us-west-2"
  assume_role {
    role_arn = "arn:aws:iam::TARGET_ACCOUNT:role/TerraformDeployRole"
  }
}
```

**Workspace pattern for multi-env**:
```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

**Key Terraform vs CDK/CloudFormation tradeoffs**:
| Dimension | Terraform | CDK/CloudFormation |
|---|---|---|
| Multi-cloud | Yes (provider model) | AWS only |
| State management | Explicit (S3/DynamoDB) | Managed by AWS |
| Language | HCL (simple) | Full language (TypeScript etc.) |
| Import existing | `terraform import` | `cdk import` (newer) |
| Drift handling | `terraform plan` shows drift | Drift detection + console |
| Rollback | Manual (re-apply old state) | Automatic on CloudFormation |

---

## 7. GitHub Actions with AWS (OIDC)

### Why OIDC (No Long-Lived Keys)
[IAM](/aws/iam-security) access keys (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) stored in GitHub secrets are a security liability—they don't expire, can be exfiltrated, and require manual rotation. OIDC federation lets GitHub Actions obtain short-lived credentials by exchanging a GitHub-signed JWT for temporary AWS credentials via `sts:AssumeRoleWithWebIdentity`. The credentials last ~1 hour and scope is defined by the IAM role's trust policy.

### Setup

**Step 1: Create OIDC provider in AWS (once per account)**:
```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

**Step 2: Create IAM role with trust policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          // Scope to specific repo and branch (principle of least privilege)
          "token.actions.githubusercontent.com:sub": "repo:org/repo:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

**Step 3: GitHub Actions workflow**:
```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required to request the JWT
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
          role-session-name: github-actions-deploy
          aws-region: us-east-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/my-app:$IMAGE_TAG .
          docker push $ECR_REGISTRY/my-app:$IMAGE_TAG

      - name: Deploy to ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: task-definition.json
          service: my-service
          cluster: my-cluster
          wait-for-service-stability: true
```

### Assume Role Patterns for Multi-Account
```yaml
# Assume a deployment role in a different account
- name: Configure AWS credentials (prod account)
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::PROD_ACCOUNT:role/GitHubDeployRole
    role-chaining: true   # Uses current credentials to assume next role
    aws-region: us-east-1
```

### Reusable Workflow Pattern
```yaml
# .github/workflows/deploy-reusable.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      role-arn:
        required: true
        type: string

jobs:
  deploy:
    environment: ${{ inputs.environment }}  # Uses GitHub Environment for approval gates
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ inputs.role-arn }}
          aws-region: us-east-1
      - run: # deploy commands
```

---

## 8. Container CI/CD

### ECR Image Scanning
ECR offers two scanning modes:
- **Basic scanning**: Uses Clair open-source CVE scanner. Triggered on push or on-demand. Free.
- **Enhanced scanning**: Uses Amazon Inspector. Continuous scanning (re-scans as new CVEs are published). Paid per image per month.

```bash
# Enable enhanced scanning on registry level
aws ecr put-registry-scanning-configuration \
  --scan-type ENHANCED \
  --rules '[{
    "repositoryFilters": [{"filter": "*", "filterType": "WILDCARD"}],
    "scanFrequency": "CONTINUOUS_SCAN"
  }]'
```

**Gate on scan results in CI**:
```bash
# Wait for scan to complete, fail build if CRITICAL findings
IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION

aws ecr wait image-scan-complete \
  --repository-name my-app \
  --image-id imageTag=$IMAGE_TAG

FINDINGS=$(aws ecr describe-image-scan-findings \
  --repository-name my-app \
  --image-id imageTag=$IMAGE_TAG \
  --query 'imageScanFindings.findingSeverityCounts.CRITICAL' \
  --output text)

if [ "$FINDINGS" != "None" ] && [ "$FINDINGS" -gt "0" ]; then
  echo "CRITICAL vulnerabilities found: $FINDINGS. Failing build."
  exit 1
fi
```

### ECR Lifecycle Policies
```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 10 production images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": { "type": "expire" }
    }
  ]
}
```

### ECS Rolling Deployment
The default [ECS](/aws/compute-containers) service update strategy. ECS gradually replaces old tasks with new ones. Controlled by two parameters on the service:
- `minimumHealthyPercent`: Minimum % of desired tasks that must stay running (e.g., 50 means half can be stopped to deploy).
- `maximumPercent`: Maximum % of desired tasks that can run simultaneously (e.g., 200 means double capacity during rollout).

```bash
# Register new task definition
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --query 'taskDefinition.taskDefinitionArn' --output text)

# Update service (triggers rolling deployment)
aws ecs update-service \
  --cluster my-cluster \
  --service my-service \
  --task-definition $TASK_DEF_ARN \
  --deployment-configuration "minimumHealthyPercent=50,maximumPercent=200" \
  --force-new-deployment
```

### ECS Blue/Green with CodeDeploy
[ECS](/aws/compute-containers) blue/green requires:
1. ECS service with `deploymentController: { type: CODE_DEPLOY }`
2. Two target groups on the ALB
3. CodeDeploy application with ECS deployment group

```yaml
# appspec.yml for ECS blue/green
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "<TASK_DEFINITION>"
        LoadBalancerInfo:
          ContainerName: "my-app"
          ContainerPort: 80
Hooks:
  - AfterAllowTestTraffic: "arn:aws:lambda:us-east-1:123456789012:function:ValidateGreen"
```

**Traffic shifting for ECS**: The test listener receives 100% traffic to green. After validation Lambda passes, production traffic shifts (AllAtOnce, Canary, or Linear). Blue remains available for immediate rollback until `terminationWaitTimeInMinutes` expires.

---

## 9. Deployment Strategies

### Blue/Green
**Mechanism**: Two identical production environments. Traffic lives on blue. Deploy to green. Switch traffic (DNS, load balancer, Route 53 weighted routing) to green. Blue is standby for instant rollback.

**Rollback**: Flip traffic back to blue (seconds).

**Cost**: Double infrastructure during transition.

**When to use**: High-stakes deployments where instant rollback capability justifies the cost. [Lambda](/aws/lambda-serverless) (CodeDeploy does this natively), [ECS](/aws/compute-containers), EC2 with ALB.

### Canary
**Mechanism**: Route a small percentage of traffic (e.g., 5% or 10%) to the new version. Monitor metrics. Gradually increase percentage. If metrics degrade, rollback. If stable, shift 100%.

**AWS implementations**:
- **Route 53 weighted routing**: `Weight: 5` for new version, `Weight: 95` for old.
- **ALB weighted target groups**: Two target groups with weighted forwarding.
- **[Lambda](/aws/lambda-serverless) aliases**: `aws lambda update-alias --routing-config AdditionalVersionWeights='{"2": 0.05}'`
- **CodeDeploy**: `LambdaCanary10Percent5Minutes` configs.
- **[API Gateway](/aws/api-gateway-networking) canary**: Built-in stage canary feature.

### Rolling
**Mechanism**: Update a fraction of instances/tasks at a time. At any point, some instances run old version and some run new. No extra infrastructure cost, but requires backward compatibility during transition.

**Risk**: Mixed-version state. Database schemas and API contracts must be backward compatible.

**ECS rolling**: Controlled by `minimumHealthyPercent` / `maximumPercent`.
**Kubernetes**: `RollingUpdate` strategy with `maxUnavailable` and `maxSurge`.

### Feature Flags
**Mechanism**: Code for both old and new behavior is deployed. A flag (config value) controls which path executes per user/request. Full deployment before any user sees the feature. Gradual rollout by flipping flags.

**AWS services**: AppConfig (part of Systems Manager) is AWS's native feature flag / config management service.

```python
# AppConfig example: check flag value
import boto3

appconfig = boto3.client('appconfigdata')

# Start session
session = appconfig.start_configuration_session(
    ApplicationIdentifier='my-app',
    EnvironmentIdentifier='production',
    ConfigurationProfileIdentifier='feature-flags',
    RequiredMinimumPollIntervalInSeconds=30
)

response = appconfig.get_latest_configuration(ConfigurationToken=session['InitialConfigurationToken'])
flags = json.loads(response['Configuration'].read())

if flags.get('new_checkout_flow', False):
    return new_checkout(cart)
else:
    return legacy_checkout(cart)
```

**Comparison**:
| Strategy | Downtime | Rollback Speed | Cost | Risk |
|---|---|---|---|---|
| Recreate | Yes | Fast (redeploy) | Low | High |
| Rolling | No | Slow (re-roll) | Low | Medium |
| Blue/Green | No | Instant | High (2x infra) | Low |
| Canary | No | Fast | Medium | Low |
| Feature flags | No | Instant (flag flip) | Low | Low |

---

## 10. Monitoring Deployments

### CloudWatch Alarms in Deployment Context
The key pattern: define alarms on metrics that indicate unhealthy deployments, then configure CodeDeploy or CodePipeline to automatically rollback when these alarms fire.

**Critical deployment metrics**:
- `5XXError` count on ALB/API Gateway
- `HealthyHostCount` on target groups (drops during bad deploy)
- Lambda `Errors` and `Duration`
- ECS `CPUUtilization` spike (runaway new task)
- Application-level: custom metrics (`PutMetricData`)

```bash
# CloudWatch alarm for 5xx rate
aws cloudwatch put-metric-alarm \
  --alarm-name "prod-5xx-rate-high" \
  --metric-name "HTTPCode_Target_5XX_Count" \
  --namespace "AWS/ApplicationELB" \
  --statistic Sum \
  --period 60 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions "arn:aws:sns:us-east-1:123456789012:deploy-alerts" \
  --dimensions "Name=LoadBalancer,Value=app/my-alb/1234567890abcdef"
```

**Linking alarms to CodeDeploy rollback**:
```json
{
  "alarmConfiguration": {
    "enabled": true,
    "ignorePollAlarmFailure": false,
    "alarms": [
      { "name": "prod-5xx-rate-high" },
      { "name": "prod-healthy-hosts-low" }
    ]
  },
  "autoRollbackConfiguration": {
    "enabled": true,
    "events": ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }
}
```

### Deployment Health Monitoring

**CloudWatch Synthetics Canaries**: Scheduled Lambda functions that simulate user journeys. Run every 1 minute. If they fail, the alarm fires → triggers rollback.

```javascript
// Synthetics canary: test the deployed endpoint
const synthetics = require('Synthetics');
const syntheticsConfiguration = synthetics.getConfiguration();

const apiCanaryBlueprint = async function () {
  const requestOptionsTemplate = {
    hostname: process.env.ENDPOINT,
    method: 'GET',
    path: '/health',
    port: 443,
    protocol: 'https:',
  };

  await synthetics.executeHttpStep('Verify health endpoint', requestOptionsTemplate);
};

exports.handler = async () => {
  return await apiCanaryBlueprint();
};
```

**Container Insights for ECS deployments**:
```bash
# Enable Container Insights on ECS cluster
aws ecs update-cluster-settings \
  --cluster my-cluster \
  --settings name=containerInsights,value=enabled
```

This gives you per-service CPU, memory, network, and storage metrics in CloudWatch, plus automated dashboards.

### Deployment Notifications and Audit Trail

**EventBridge + SNS pattern**:
```json
// EventBridge rule: notify on deployment state change
{
  "source": ["aws.codedeploy"],
  "detail-type": ["CodeDeploy Deployment State-change Notification"],
  "detail": {
    "state": ["FAILURE", "STOP", "SUCCESS"],
    "deploymentGroup": ["prod-deployment-group"]
  }
}
```

**CloudTrail**: Every CodePipeline, CodeBuild, CodeDeploy API call is logged to CloudTrail automatically. This is your immutable audit log: who started a deployment, when, with what source revision. Essential for compliance (SOC2, PCI-DSS). See [Observability](/aws-observability) for CloudWatch dashboards and alerting on deployment metrics.

---

## 11. AWS Systems Manager

### Parameter Store
Hierarchical key-value store for configuration data and secrets. Two tiers:
- **Standard**: Free, values up to 4 KB, no parameter policies.
- **Advanced**: $0.05/parameter/month, values up to 8 KB, TTL policies, notifications.

**SecureString parameters** are KMS-encrypted at rest.

```bash
# Write parameters
aws ssm put-parameter \
  --name "/myapp/prod/db-password" \
  --value "super-secret-password" \
  --type SecureString \
  --key-id "alias/myapp-key" \
  --tier Advanced

aws ssm put-parameter \
  --name "/myapp/prod/db-host" \
  --value "mydb.cluster-xyz.us-east-1.rds.amazonaws.com" \
  --type String

# Read in application
aws ssm get-parameter \
  --name "/myapp/prod/db-password" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text
```

**Hierarchy and versioning**: Parameters are versioned (1, 2, 3...). Use `GetParameter` with `--version` to pin to a specific version. Path-based hierarchy lets you `GetParametersByPath --path /myapp/prod/` to retrieve all prod configs at once.

**In CodeBuild buildspec**:
```yaml
env:
  parameter-store:
    DB_PASSWORD: "/myapp/prod/db-password"
    API_KEY: "/myapp/prod/api-key"
```

### Secrets Manager
For secrets that require **automatic rotation**. More expensive than Parameter Store but handles rotation for RDS, Redshift, DocumentDB, and custom Lambda-based rotation.

```python
import boto3, json

def get_secret(secret_name):
    client = boto3.client('secretsmanager', region_name='us-east-1')
    response = client.get_secret_value(SecretId=secret_name)
    # response['SecretString'] is JSON for DB credentials
    return json.loads(response['SecretString'])

creds = get_secret('myapp/prod/rds-credentials')
connection = psycopg2.connect(
    host=creds['host'],
    port=creds['port'],
    database=creds['dbname'],
    user=creds['username'],
    password=creds['password']
)
```

**Parameter Store vs Secrets Manager**:
| Feature | Parameter Store | Secrets Manager |
|---|---|---|
| Cost | Free (standard) / $0.05/param (advanced) | $0.40/secret/month + $0.05/10k API calls |
| Auto-rotation | No | Yes (Lambda-based) |
| Cross-account | Via resource policy | Via resource policy |
| Hierarchy | Yes (`/app/env/key`) | Via naming convention |
| Size limit | 4KB (8KB advanced) | 64KB |
| Best for | Config data, non-rotating secrets | Database passwords, API keys needing rotation |

### Session Manager
Secure browser-based or CLI shell access to EC2 instances (and on-prem via Hybrid Activations) **without SSH ports, bastion hosts, or SSH keys**. Sessions are IAM-controlled and fully logged to S3/CloudWatch.

```bash
# Start interactive session to EC2 instance
aws ssm start-session --target i-0123456789abcdef0

# Port forwarding (replace SSH tunnel)
aws ssm start-session \
  --target i-0123456789abcdef0 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["5432"]}'

# Tunnel to RDS via EC2 bastion (without SSH key)
aws ssm start-session \
  --target i-0123456789abcdef0 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["mydb.xyz.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["5432"]}'
```

**Requirements**: EC2 instance must have `AmazonSSMManagedInstanceCore` policy and the SSM Agent running.

### Run Command
Execute commands on multiple instances simultaneously without SSH. Uses SSM Documents (JSON/YAML runbooks).

```bash
# Run a shell command across instances with tag Environment=prod
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Environment,Values=prod" \
  --parameters 'commands=["sudo systemctl restart myapp"]' \
  --timeout-seconds 30 \
  --output-s3-bucket-name my-ssm-logs \
  --output-s3-key-prefix run-command-logs/

# Check command status
aws ssm list-command-invocations \
  --command-id <command-id> \
  --details
```

### Patch Manager
Automate OS patching across EC2 instances. Define **Patch Baselines** (which patches to approve/reject) and **Maintenance Windows** (when to apply them).

```bash
# Create patch baseline
aws ssm create-patch-baseline \
  --name "prod-linux-baseline" \
  --operating-system "AMAZON_LINUX_2" \
  --approval-rules "PatchRules=[{PatchFilterGroup:{PatchFilters=[{Key=SEVERITY,Values=[Critical,High]}]},ApproveAfterDays=7}]" \
  --approved-patches-compliance-level CRITICAL

# Create maintenance window: every Sunday 2 AM UTC
aws ssm create-maintenance-window \
  --name "prod-patch-window" \
  --schedule "cron(0 2 ? * SUN *)" \
  --duration 4 \
  --cutoff 1 \
  --allow-unassociated-targets false
```

### AppConfig (Feature Flags & Config Management)
Part of Systems Manager. Validates configurations before deployment and enables safe, monitored config rollouts with automatic rollback.

```bash
# Create feature flags configuration
aws appconfig create-configuration-profile \
  --application-id myapp \
  --name feature-flags \
  --location-uri hosted \
  --type AWS.AppConfig.FeatureFlags

# Deploy with 10-minute bake time, rollback on CloudWatch alarm
aws appconfig start-deployment \
  --application-id myapp \
  --environment-id prod \
  --deployment-strategy-id rolling-10-min \
  --configuration-profile-id feature-flags \
  --configuration-version 2 \
  --description "Enable new checkout flow for 10% of users"
```

---

## 12. Common Interview Questions

**Q: What's the difference between CodeDeploy in-place and blue/green, and when would you choose each?**

**A:** In-place stops the old application on each instance, installs the new version, and restarts it. The instance is briefly out of service during this window, so it requires careful management of `minimumHealthyHosts` to maintain capacity. It's cost-effective because no new infrastructure is provisioned. Blue/green provisions an entirely new environment, validates the deployment there, then shifts traffic—giving you zero downtime and an instant rollback (just flip traffic back). I'd use in-place for non-critical internal services or batch workers where brief unavailability is acceptable. I'd always use blue/green for user-facing production services, Lambda functions, and ECS services where availability and rollback speed matter.

---

**Q: Walk me through how you'd set up a secure CI/CD pipeline from GitHub to AWS without long-lived credentials.**

**A:** OIDC federation. First, create an IAM OIDC identity provider in AWS for `token.actions.githubusercontent.com`. Then create an IAM role with a trust policy that conditions `AssumeRoleWithWebIdentity` on the `sub` claim matching the specific repo and branch (e.g., `repo:org/repo:ref:refs/heads/main`)—this prevents other repos from assuming the role. Attach the minimum-privilege policy needed (ECR push, ECS update-service, etc.). In the GitHub Actions workflow, set `permissions: id-token: write`, use `aws-actions/configure-aws-credentials` with `role-to-assume`. GitHub mints a JWT, exchanges it for temporary STS credentials (1 hour TTL). No secrets stored anywhere.

---

**Q: How would you build a multi-account pipeline that promotes a tested artifact from dev to prod?**

**A:** Single Tools/CICD account owns CodePipeline, CodeBuild, the ECR repository, the S3 artifact bucket, and the KMS key. The pipeline builds once, produces a versioned image, and promotes the same artifact through environments—never rebuilds. For each target account (Dev, Staging, Prod), create an IAM role with a trust policy trusting the pipeline's execution role in the Tools account. Update the S3 artifact bucket policy and KMS key policy to allow `Decrypt`/`GetObject` by these cross-account roles. In the pipeline, each deploy action specifies `RoleArn` of the target account's role. Manual approval gates separate staging → prod. The key principle: build once, deploy many times.

---

**Q: What's the difference between CloudFormation nested stacks and StackSets?**

**A:** Nested stacks are about template decomposition within a single account/region. A parent stack references child stack templates—you break a large template into reusable modules (network, IAM, compute). They still create a single logical stack hierarchy. StackSets are about multi-account/multi-region deployment. A single StackSet definition deploys identical stacks to multiple accounts (member accounts in an AWS Organization) and multiple regions. It's for governance at scale—e.g., deploying security baselines or VPC configurations to all 50 accounts in your org in one operation. The admin account manages the StackSet; execution roles in each member account perform the actual stack creation.

---

**Q: When would you use AWS CDK over Terraform? When would you use Terraform?**

**A:** CDK when the team is already TypeScript/Python developers, when you want type safety, IDE support, and reusable L2/L3 constructs that encode best practices. CDK Aspects are powerful for enforcing compliance policies across the entire construct tree. CDK Pipelines give you a self-mutating pipeline that's a first-class CDK construct. I'd choose Terraform when the infrastructure spans multiple clouds (not just AWS), when the team has existing Terraform expertise and modules, or when you need strict control over the change lifecycle with `plan`/`apply` separation. Terraform's state model is more explicit and inspectable. Both are valid; the practical answer often comes down to team skill set and the existing ecosystem.

---

**Q: How does CodeBuild handle secrets, and what are the common mistakes?**

**A:** Secrets should come from Parameter Store (`parameter-store` key in buildspec env section) or Secrets Manager (`secrets-manager` key). CodeBuild automatically decrypts them at build start using the project's service role (which must have `ssm:GetParameter` and `kms:Decrypt` permissions). The common mistakes: (1) putting secrets in plaintext environment variables in the CodeBuild project console—they show up in build logs and in `describe-projects` output; (2) echoing environment variables in build commands—always mask with `echo "***"` or avoid echoing sensitive vars; (3) not scoping the IAM role—the CodeBuild role should only be able to access `/myapp/prod/*` parameters, not all parameters in the account; (4) forgetting `--with-decryption` when reading SecureString parameters via CLI in a build script.

---

**Q: Explain the CodePipeline artifact model and how artifacts flow between stages.**

**A:** Every pipeline has an S3 artifact bucket (specified at pipeline creation). When a source action (e.g., GitHub) triggers, it downloads the source code and zips it into an artifact in that S3 bucket, encrypted with KMS. The artifact has a logical name (`SourceArtifact`). The next stage's action declares this as an `inputArtifact`—CodePipeline downloads and unzips it into the build environment. That action can produce its own `outputArtifact` (e.g., `BuildArtifact` containing `imagedefinitions.json`). This continues through stages. Key point: artifacts are versioned per pipeline execution. If two parallel actions in a stage both produce artifacts, each has a distinct S3 key. Cross-account pipelines require the artifact bucket's KMS key to be accessible by the cross-account deployment role.

---

**Q: What is SSM Session Manager and why is it better than a bastion host?**

**A:** Session Manager is an IAM-controlled, agent-based mechanism for shell access to instances and port forwarding. The advantages over a bastion host: (1) No open inbound ports—the SSM agent initiates an outbound connection to the SSM endpoint; (2) No SSH keys to manage, distribute, or rotate; (3) Access is controlled entirely by IAM policies (who can call `ssm:StartSession` on which instance); (4) All session activity is audited—keystrokes are logged to S3/CloudWatch Logs; (5) No separate EC2 bastion to patch, maintain, and pay for. The agent needs outbound HTTPS to SSM endpoints (or VPC endpoints for fully private scenarios). For databases, the port forwarding feature replaces SSH tunnels completely.

---

**Q: What deployment strategy would you use for a Lambda function that processes financial transactions?**

**A:** CodeDeploy with a canary or linear traffic shifting on a [Lambda](/aws/lambda-serverless) alias. I'd use `LambdaCanary10Percent5Minutes` to start: 10% of invocations go to the new version for 5 minutes while I monitor. I'd attach pre-traffic and post-traffic validation Lambda hooks—the pre-traffic hook runs integration tests against the new version before any live traffic is sent. I'd configure CloudWatch alarms on the new version's `Errors` and `Duration` metrics, linked to CodeDeploy for automatic rollback. If the error rate exceeds threshold during the canary window, CodeDeploy automatically rolls back by updating the alias to 100% on the old version. The whole thing is defined in an AppSpec file and triggered by CodePipeline.

---

**Q: How do you handle database migrations in a blue/green deployment?**

**A:** This is the hardest part. The key constraint: during the switchover window, both blue (old) and green (new) versions may be processing requests, so the database must be compatible with both. The pattern is **expand-contract migrations** (also called parallel-change): (1) Expand: add new columns/tables as nullable with defaults—both old and new code can read/write safely; (2) deploy new code (which starts writing to new columns); (3) backfill old rows; (4) Contract: after all old code is gone, run a second migration to add constraints, remove old columns, or make nullable columns required. Never do rename-and-drop in a single deploy. For blue/green specifically, run migrations before switching traffic—the old (blue) version must tolerate the expanded schema. Tools like Flyway and Liquibase support this with their migration + undo pattern.

---

## GitHub Actions + AWS OIDC — No Long-Lived Credentials

The modern pattern for GitHub Actions → AWS is to use OpenID Connect (OIDC) to get temporary credentials via `AssumeRoleWithWebIdentity`. No AWS access keys stored in GitHub Secrets.

### Why OIDC Over Access Keys
- Access keys are long-lived: if leaked (accidentally committed, GitHub breach), attacker has persistent access
- OIDC tokens are short-lived: GitHub mints a token per workflow run; token expires after the job
- Principle of least privilege: each workflow gets exactly the permissions it needs via a specific IAM role

### Setup (One-Time)
```bash
# Step 1: Create OIDC identity provider in AWS IAM
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

```json
// Step 2: Create IAM role with trust policy for GitHub
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
      "StringLike": {
        // Restrict to your org/repo and optionally a specific branch
        "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:ref:refs/heads/main"
      }
    }
  }]
}
```

### GitHub Actions Workflow
```yaml
name: Deploy to AWS
on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
          aws-region: us-east-1
          # No access-key-id or secret-access-key needed!

      - name: Deploy with CDK
        run: npx cdk deploy --all --require-approval never

      - name: Build and push to ECR
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY
          docker build -t my-app .
          docker push $ECR_REGISTRY/my-app:$GITHUB_SHA
        env:
          ECR_REGISTRY: 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

### Environment-Specific Roles
- Create separate IAM roles for staging vs production
- Staging role: trusted for any branch push
- Production role: trusted ONLY for `refs/heads/main` — prevents feature branches from deploying to prod
- Use GitHub Environments with required reviewers for production deployments

See also: [IAM & Security](/aws-iam-security) for OIDC identity provider configuration and trust policy patterns.

---

## CDK Pipelines v2 — Self-Mutating Pipeline

CDK Pipelines creates a CodePipeline that can update itself before deploying your application. See [Developer Tools](/aws-developer-tools) for the full CDK ecosystem and construct library reference.

### Complete Example — Multi-Stage Deployment
```typescript
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';

// Define your application stage (what gets deployed to each environment)
class ApiStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    new ApiStack(this, 'Api');          // Lambda + API Gateway
    new DatabaseStack(this, 'Database'); // DynamoDB
  }
}

class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      // Source: GitHub via OIDC (preferred) or CodeStar connection
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection('my-org/my-repo', 'main', {
          connectionArn: 'arn:aws:codestar-connections:us-east-1:...:connection/...',
        }),
        commands: [
          'npm ci',
          'npm run build',
          'npm run test',    // Unit tests before synth
          'npx cdk synth',
        ],
        primaryOutputDirectory: 'cdk.out',
      }),
      selfMutation: true,  // Pipeline updates itself before deploying app
      crossAccountKeys: true, // KMS keys for cross-account artifact encryption
      dockerEnabledForSynth: true,
      // Publish assets before pipeline execution (faster parallel deploys)
      publishAssetsInParallel: true,
    });

    // Staging: auto-deploy, run integration tests
    const stagingDeployment = pipeline.addStage(
      new ApiStage(this, 'Staging', { env: { account: '111111111111', region: 'us-east-1' } }),
      {
        pre: [
          new pipelines.ShellStep('LintAndTest', { commands: ['npm run lint', 'npm test'] }),
        ],
        post: [
          new pipelines.ShellStep('IntegrationTests', {
            envFromCfnOutputs: { API_URL: stagingStack.apiUrl },
            commands: ['npm run test:integration'],
          }),
          new pipelines.ShellStep('LoadTest', {
            commands: ['npm run test:load -- --threshold-p99=500ms'],
          }),
        ],
      }
    );

    // Production: manual approval gate + canary deployment
    pipeline.addStage(
      new ApiStage(this, 'Production', { env: { account: '222222222222', region: 'us-east-1' } }),
      {
        pre: [
          new pipelines.ManualApprovalStep('ApproveProductionDeploy', {
            comment: 'Review staging test results before deploying to production',
          }),
        ],
        post: [
          new pipelines.ShellStep('SmokeTest', {
            commands: ['curl -f $API_URL/health || exit 1'],
          }),
        ],
      }
    );
  }
}
```

### Self-Mutation Explained
When the pipeline detects changes to the pipeline definition itself (new stages, new steps, CDK version upgrade):
1. Pipeline runs the `Synth` step to generate new CloudFormation templates
2. `UpdatePipeline` action applies the new pipeline CloudFormation definition
3. Pipeline restarts from the beginning with the new configuration
4. Application stages deploy with the updated pipeline

This means you never manually update the pipeline — just push CDK code changes.

---

## SAM CLI — Local Development Workflow

### End-to-End Local Testing Flow
```bash
# 1. Start LocalStack or real DynamoDB Local for dependencies
docker run -p 8000:8000 amazon/dynamodb-local
docker run -p 4566:4566 localstack/localstack  # or use real AWS in dev environment

# 2. Set up environment variables for local testing
cat > env.json << 'EOF'
{
  "OrdersFunction": {
    "TABLE_NAME": "orders-dev",
    "AWS_ENDPOINT_URL": "http://localhost:8000"
  }
}
EOF

# 3. Invoke a single function locally
sam local invoke OrdersFunction \
  --event events/create-order.json \
  --env-vars env.json \
  --docker-network my-local-net

# 4. Start local API Gateway (all functions)
sam local start-api \
  --env-vars env.json \
  --docker-network my-local-net \
  --warm-containers EAGER  # keep containers warm between invocations

# 5. Generate sample events
sam local generate-event apigateway aws-proxy > events/api-event.json
sam local generate-event sqs receive-message > events/sqs-event.json
sam local generate-event s3 put > events/s3-event.json

# 6. Build (using container for Lambda-compatible deps)
sam build --use-container --container-env-var PIP_EXTRA_INDEX_URL=...

# 7. Deploy with guided setup (first time)
sam deploy --guided
# Creates samconfig.toml with your choices

# 8. Fast iteration: sam sync (no CloudFormation, direct Lambda update)
sam sync --watch --stack-name my-app-dev
```

### SAM Accelerate vs sam deploy
| | sam deploy | sam sync |
|---|---|---|
| Method | CloudFormation ChangeSet | Direct API calls |
| Speed | 1-3 minutes | 3-5 seconds |
| Drift | No drift | Creates drift from CF state |
| Rollback | Yes (CloudFormation) | Manual |
| Use for | CI/CD, staging, prod | Rapid local iteration only |

---

## AWS CodeDeploy — Advanced Deployment Strategies

### Lambda Deployment with Pre/Post Traffic Hooks
```yaml
# SAM template with canary deployment
Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      AutoPublishAlias: live
      DeploymentPreference:
        Type: Canary10Percent5Minutes  # 10% → wait 5min → 100%
        Alarms:
          - !Ref ErrorRateAlarm
          - !Ref LatencyAlarm
        Hooks:
          PreTraffic: !Ref PreTrafficCheck
          PostTraffic: !Ref PostTrafficCheck
```

```javascript
// PreTraffic hook: validate new version before any traffic
exports.handler = async (event) => {
  const functionToTest = process.env.NewVersion; // ARN of new version

  // Run validation against new version directly
  const result = await lambda.invoke({
    FunctionName: functionToTest,
    Payload: JSON.stringify({ path: '/health', httpMethod: 'GET' }),
    Qualifier: '$LATEST',
  }).promise();

  const statusCode = JSON.parse(result.Payload).statusCode;

  if (statusCode !== 200) {
    // Fail the deployment — CodeDeploy rolls back automatically
    await codedeploy.putLifecycleEventHookExecutionStatus({
      deploymentId: event.DeploymentId,
      lifecycleEventHookExecutionId: event.LifecycleEventHookExecutionId,
      status: 'Failed',
    }).promise();
  } else {
    await codedeploy.putLifecycleEventHookExecutionStatus({...status: 'Succeeded'}).promise();
  }
};
```

### ECS Blue/Green with CodeDeploy
- CodeDeploy shifts traffic from Blue task set to Green task set on ALB
- Terminates blue after configurable stabilization period
- Traffic shifting options: Canary (small% → wait → 100%), Linear (incremental %), All-at-once
- Rollback: manual or automatic (on CloudWatch alarm)

---

## AWS Systems Manager — Operational Toolbox

### Key SSM Capabilities
- **Session Manager**: SSH-less access to EC2/ECS containers — no inbound port 22, uses IAM auth, logs sessions to S3/[CloudWatch](/aws-observability)
- **Run Command**: execute scripts across fleet of EC2 instances; no SSH; results in Systems Manager console
- **Parameter Store**: configuration store; Standard tier free (10K params); Advanced tier ($0.05/10K params/month); SecureString uses KMS
- **Patch Manager**: automated OS patching; patch baseline (approved patches); maintenance windows
- **State Manager**: enforce configuration state (e.g., ensure CloudWatch agent is installed and running)
- **Automation**: multi-step operational tasks (runbooks); `AWS-CreateImage`, `AWS-StopEC2InstanceWithApproval`; event-triggered automation

### Session Manager vs Bastion Host
| Criterion | Session Manager | Bastion Host |
|---|---|---|
| Setup | SSM Agent (pre-installed on Amazon Linux 2) | EC2 instance + key pair + SG rule |
| Network | No inbound port needed | Port 22 must be open from bastion |
| Cost | Free (included with SSM) | EC2 instance cost |
| Audit | Session logs to S3/CloudWatch | Manual logging (or Jumpcloud) |
| MFA | IAM MFA on AssumeRole | SSH key management |
| Verdict | Always prefer Session Manager | Legacy only |

---

## Red Flags to Avoid

- **"I use long-lived IAM access keys in GitHub secrets."** Always OIDC in 2024+. No exceptions for new pipelines.
- **"I push directly to main and deploy manually."** No CI gate, no audit trail. Never acceptable in production.
- **"I store secrets in plaintext CodeBuild environment variables."** They appear in `describe-projects` output and build logs. Always Parameter Store or Secrets Manager.
- **"I run `aws cloudformation update-stack` directly in production."** Always create a change set first. Describe it. Review. Then execute. Skipping this in production is how you delete a database.
- **"I use `latest` tag for ECR images in production."** Mutable, non-reproducible, impossible to rollback to a known version. Always use immutable tags (commit SHA or semantic version).
- **"Rollback means I redeploy the old version."** For CodeDeploy blue/green, rollback is a traffic switch (seconds). For Lambda alias canary, it's an alias update (seconds). Redeployment as rollback strategy is too slow for production incidents.
- **"I don't need privileged mode for CodeBuild Docker builds."** Without privileged mode, `docker build` fails at the daemon socket connection. This is a common CodeBuild gotcha.
- **"Drift detection fixes infrastructure drift."** Drift detection only *reports* drift—it does not remediate it. You must re-deploy the CloudFormation stack or import the drifted resource to reconcile.
- **"I use one AWS account for everything."** Multi-account is the [AWS best practice](/aws/architecture). Separate accounts for dev/staging/prod provide the strongest blast radius isolation—a prod credential compromise cannot affect dev data and vice versa.
