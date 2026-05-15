# AWS Data Analytics: Interview Preparation Knowledge Base

## The 30-Second Pitch

AWS Data Analytics is a full-stack portfolio for building data lakes, data warehouses, and real-time pipelines without managing infrastructure. The key services are Athena (serverless SQL on S3), Redshift (MPP data warehouse), Glue (managed ETL + central data catalog), Lake Formation (fine-grained access control), EMR (managed Hadoop/Spark clusters), and OpenSearch (search + log analytics). These services compose into a modern lakehouse architecture where S3 is the storage layer, Glue Data Catalog is the universal metastore, and multiple query engines read the same data with different trade-offs. For a data engineering or solutions architect interview, you need to know when to use Athena vs Redshift, how to optimize query performance, and how to design a production-grade data pipeline end to end.

---

## How It Actually Works

The modern AWS data analytics stack is built around the **lakehouse pattern**: raw data lands in [S3](/aws-storage-s3), gets cataloged in the Glue Data Catalog, transformed by Glue ETL or EMR, and served to analytics consumers via Athena (ad-hoc), Redshift (BI/reporting), or OpenSearch (search). [Lake Formation](/aws-iam-security) sits on top as the governance layer — controlling who can query which tables, columns, and rows. [Kinesis](/aws-messaging-events) feeds streaming data in; [Lambda](/aws-lambda-serverless) handles event-driven ETL triggers and Athena federation.

```
Ingest                 Process                 Serve
------                 -------                 -----
S3 (batch)       →   Glue ETL / EMR    →    Athena (SQL)
Kinesis Firehose →   Spark / Hive       →    Redshift (BI)
DMS (CDC)        →   Iceberg / Delta    →    OpenSearch (search)
AppFlow          →   Glue Data Quality  →    QuickSight (dashboards)

Catalog: Glue Data Catalog (Hive-compatible metastore)
Governance: Lake Formation (column/row-level permissions)
```

---

## 1. Amazon Athena — Serverless SQL on S3

### How It Works

Athena is a serverless, interactive query service that runs SQL directly against data in [S3](/aws-storage-s3). No clusters to provision, no infrastructure to manage. You pay **$5 per TB of data scanned** — and you pay only for what you actually scan per query.

Under the hood, Athena is built on **Trino** (originally Presto) with a **Hive-compatible metastore** (the Glue Data Catalog). When you run a query, Athena:

1. Resolves table metadata from Glue Data Catalog (column types, S3 location, partition info)
2. Identifies which S3 prefixes to read based on partition filters
3. Distributes the scan across a fleet of managed workers (you never see them)
4. Returns results to S3 (`s3://your-bucket/athena-results/`) and to the console/API

**Supported formats**: CSV, JSON, Parquet, ORC, Avro, Apache Iceberg, Apache Hudi, Delta Lake (read-only for Hudi/Delta via manifest files).

**Federated queries**: Athena connectors extend queries beyond S3 to RDS, Aurora, DynamoDB, OpenSearch, Redshift, or any JDBC source. Each connector is a [Lambda](/aws-lambda-serverless) function that translates Athena's query fragment into the target data source's native protocol. You can JOIN an S3 Parquet table with a live RDS PostgreSQL table in a single SQL statement.

### Performance Optimization

The single most important Athena optimization is **reducing bytes scanned**. Every technique below serves that goal.

**Partition pruning** — Partition your S3 data by high-cardinality filter columns (date, region, account). Athena maps `WHERE year = '2024' AND month = '01'` directly to S3 prefix `s3://bucket/table/year=2024/month=01/`. Without partitioning, Athena scans every object in the table prefix.

**Columnar formats (biggest win)** — Parquet and ORC store data column-by-column. A query selecting 3 columns from a 100-column table scans ~3% of the data. Combined with **min/max statistics** embedded in row groups (Parquet) or stripes (ORC), Athena can skip entire row groups where no matching rows exist. Switching from CSV to Parquet typically reduces data scanned by **10–100×** and reduces query cost by the same factor.

**Compression** — Snappy is fast with moderate compression (default for Parquet). GZIP gives better compression ratios. Zstandard (zstd) is the best balance of speed and compression for most workloads.

**File size** — Avoid many small files. Athena opens a separate S3 request per file; thousands of 1 MB files are slower than tens of 200 MB files. **Target: 100–500 MB per file** after compression. Use Glue ETL or EMR to compact small files periodically.

**CTAS (CREATE TABLE AS SELECT) for format conversion** — Use Athena CTAS to convert existing CSV/JSON tables to Parquet in one SQL statement, without Spark:

```sql
-- Convert raw CSV table to partitioned Parquet in one query
CREATE TABLE orders_parquet
WITH (
    format = 'PARQUET',
    parquet_compression = 'SNAPPY',
    partitioned_by = ARRAY['year', 'month'],
    external_location = 's3://my-datalake/clean/orders_parquet/'
)
AS SELECT
    order_id,
    customer_id,
    amount,
    status,
    created_at,
    CAST(year(created_at) AS VARCHAR) AS year,
    LPAD(CAST(month(created_at) AS VARCHAR), 2, '0') AS month
FROM orders_csv
WHERE created_at IS NOT NULL;
```

CTAS scans the source table (you pay for that scan at $5/TB) and writes the output as Parquet. Subsequent queries on the new table pay 10–100× less. For one-time conversion jobs, CTAS is simpler than a Glue ETL job.

**Approximate functions** — For high-cardinality analytics where exact counts are not required:
- `approx_distinct(column)` — HyperLogLog-based count distinct, <2% error, much faster than `COUNT(DISTINCT ...)`
- `approx_percentile(column, 0.95)` — fast p95/p99 without full sort

**Workgroup result caching** — Athena caches query results for up to 7 days. Re-running the same query (same SQL, same data) within the window returns cached results at no cost.

**Format and partition impact (real numbers)**:

| Scenario | Data Scanned | Query Cost | Query Time |
|---|---|---|---|
| 1 TB CSV, no partitions | 1,000 GB | $5.00 | 60–120 sec |
| 1 TB CSV, date-partitioned (30-day query) | 82 GB | $0.41 | 15–30 sec |
| 1 TB → 80 GB Parquet, no partitions | 80 GB | $0.40 | 8–15 sec |
| 1 TB → 80 GB Parquet, date-partitioned | 6.5 GB | $0.033 | 2–5 sec |
| Parquet + partition projection | 6.5 GB | $0.033 | 1–3 sec (no catalog overhead) |

The combined effect of format conversion + partitioning is typically **150× cost reduction** on a realistic analytics query pattern.

```sql
-- Partition projection: define partitions in table properties
-- instead of running MSCK REPAIR TABLE (eliminates catalog round-trips)
CREATE EXTERNAL TABLE cloudtrail_logs (
    eventVersion STRING,
    userIdentity STRUCT<type:STRING, principalId:STRING, arn:STRING>,
    eventTime STRING,
    eventSource STRING,
    eventName STRING,
    awsRegion STRING,
    sourceIPAddress STRING,
    requestParameters STRING,
    responseElements STRING
)
PARTITIONED BY (account STRING, region STRING, year STRING, month STRING, day STRING)
ROW FORMAT SERDE 'com.amazon.emr.hive.serde.CloudTrailSerde'
STORED AS INPUTFORMAT 'com.amazon.emr.cloudtrail.CloudTrailInputFormat'
OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
LOCATION 's3://my-cloudtrail-bucket/AWSLogs/'
TBLPROPERTIES (
    'projection.enabled' = 'true',
    'projection.account.type' = 'enum',
    'projection.account.values' = '123456789012',
    'projection.region.type' = 'enum',
    'projection.region.values' = 'us-east-1,us-west-2,eu-west-1',
    'projection.year.type' = 'integer',
    'projection.year.range' = '2022,2030',
    'projection.month.type' = 'integer',
    'projection.month.range' = '01,12',
    'projection.month.digits' = '2',
    'projection.day.type' = 'integer',
    'projection.day.range' = '01,31',
    'projection.day.digits' = '2',
    'storage.location.template' = 's3://my-cloudtrail-bucket/AWSLogs/${account}/CloudTrail/${region}/${year}/${month}/${day}/'
);

-- Query only Jan 2024 in us-east-1 — scans only those S3 prefixes
SELECT eventName, COUNT(*) AS event_count
FROM cloudtrail_logs
WHERE account = '123456789012'
  AND region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
GROUP BY eventName
ORDER BY event_count DESC
LIMIT 20;
```

### Apache Iceberg on Athena

Apache Iceberg is an open table format that brings **ACID transactions**, **schema evolution**, and **time travel** to data lake files on S3. Athena v3 supports full Iceberg read/write including INSERT, UPDATE, DELETE, and MERGE.

Why Iceberg matters: traditional Hive tables on S3 are append-only — you can't update or delete individual rows without rewriting entire partitions. Iceberg solves this with a metadata layer (snapshot-based) that tracks exactly which files contain which rows, enabling surgical row-level writes.

```sql
-- Create an Iceberg table
CREATE TABLE orders (
    order_id    BIGINT,
    customer_id BIGINT,
    amount      DECIMAL(10, 2),
    status      STRING,
    created_at  TIMESTAMP
)
LOCATION 's3://my-datalake/orders/'
TBLPROPERTIES (
    'table_type' = 'ICEBERG',
    'format'     = 'parquet',
    'write_compression' = 'snappy'
);

-- Standard INSERT
INSERT INTO orders VALUES (1001, 42, 99.99, 'pending', CURRENT_TIMESTAMP);

-- ACID MERGE (upsert pattern: update existing, insert new)
MERGE INTO orders t
USING orders_updates u ON t.order_id = u.order_id
WHEN MATCHED THEN
    UPDATE SET status = u.status, amount = u.amount
WHEN NOT MATCHED THEN
    INSERT (order_id, customer_id, amount, status, created_at)
    VALUES (u.order_id, u.customer_id, u.amount, u.status, u.created_at);

-- Row-level DELETE (impossible with Hive tables)
DELETE FROM orders WHERE status = 'cancelled' AND created_at < TIMESTAMP '2023-01-01 00:00:00';

-- Time travel: query as of a past snapshot
SELECT * FROM orders
FOR TIMESTAMP AS OF TIMESTAMP '2024-01-15 00:00:00';

-- Schema evolution: add a column without rewriting data
ALTER TABLE orders ADD COLUMNS (discount DECIMAL(5, 2));

-- Optimize: compact small files (run periodically)
OPTIMIZE orders REWRITE DATA USING BIN_PACK;

-- Expire old snapshots to reclaim S3 storage
VACUUM orders;
```

**Key Iceberg features**:
- **Snapshot isolation**: readers always see a consistent snapshot; writers don't block readers
- **Hidden partitioning**: Iceberg manages partition transforms internally — no need to expose `year=`, `month=` columns in schema
- **Partition evolution**: change partitioning strategy without rewriting existing data
- **Row-level deletes**: stored as delete files (position deletes or equality deletes); merged at read time

### Athena Query Engine v3

Athena v2 was Presto-based; **v3 is Trino 422**. Engine v3 delivers better performance on complex queries (UNION ALL, window functions, subquery pushdown), supports more SQL functions, and has improved JOIN strategies. Select per workgroup in the Athena console. New workgroups default to v3. Engine v2 remains available for compatibility.

---

## 2. Amazon Redshift — Cloud Data Warehouse

### Architecture

Redshift is a **Massively Parallel Processing (MPP)** columnar data warehouse. Unlike Athena (pay-per-scan, no state), Redshift maintains a persistent cluster with local storage, making it faster for repeat queries against the same data.

**Cluster components**:
- **Leader node**: receives client connections, parses SQL, builds query plan, coordinates execution, aggregates results
- **Compute nodes**: store data slices, execute parallel query fragments (query steps), return partial results to leader
- **Node slices**: each compute node is divided into slices (2 or 16 per node depending on type); each slice has its own portion of the data and runs a fragment of the query in parallel

**Node types**:
| Type | Use Case | Storage |
|---|---|---|
| ra3.xlplus | Recommended default; managed storage (S3-backed) | 32 TB managed/node |
| ra3.4xlarge | Medium-large workloads | 128 TB managed/node |
| ra3.16xlarge | Largest workloads, highest concurrency | 128 TB managed/node |
| dc2.large | Legacy, compute-dense, fast NVMe SSD | 160 GB SSD/node |
| dc2.8xlarge | Legacy, high-memory | 2.56 TB SSD/node |

**ra3 vs dc2**: ra3 decouples compute from storage — you scale them independently. Managed storage automatically offloads cold data to S3 and caches hot data on local NVMe. **Use ra3 for all new workloads.** dc2 is legacy.

**Redshift Serverless**: no cluster management; auto-scales from 8 to 512 RPUs (Redshift Processing Units); charges by RPU-second. Best for intermittent or unpredictable workloads. Not cost-effective for sustained heavy load — provisioned clusters are cheaper at high utilization.

**Redshift Spectrum**: query S3 data directly from Redshift SQL — the cluster's compute nodes fan out to read S3 objects in parallel. Same as Athena conceptually, but uses your Redshift cluster's resources rather than serverless compute. Useful when you want a single SQL interface across your Redshift tables and your data lake.

### Distribution Styles

How Redshift places rows across compute node slices determines how much data moves over the network during joins. Network shuffles (redistribution) are the #1 performance killer.

| Style | How It Works | Best For |
|---|---|---|
| KEY | Rows with the same key value land on the same slice | Large fact tables that frequently JOIN on that key |
| EVEN | Round-robin across all slices | Tables with no clear join key; intermediate aggregation tables |
| ALL | Entire table replicated to every node | Small dimension tables (<3M rows, rarely updated) |
| AUTO | Redshift chooses based on statistics (default) | Let Redshift optimize; works well for most tables |

**Star schema strategy**: distribute the large fact table by the primary join key (e.g., `customer_id`). Set dimension tables to `DISTSTYLE ALL` if they are small. When the fact-dimension JOIN runs, the dimension data is already local on every node — zero redistribution.

```sql
-- Fact table: distributed by customer_id to co-locate with customer dimension
CREATE TABLE fact_orders (
    order_id    BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    product_id  INT NOT NULL,
    order_date  DATE NOT NULL,
    amount      DECIMAL(10, 2),
    quantity    INT
)
DISTSTYLE KEY
DISTKEY (customer_id)
SORTKEY (order_date);

-- Small dimension: replicate everywhere — no redistribution on JOIN
CREATE TABLE dim_customer (
    customer_id   BIGINT NOT NULL,
    customer_name VARCHAR(200),
    country       VARCHAR(50),
    segment       VARCHAR(50)
)
DISTSTYLE ALL
SORTKEY (customer_id);
```

### Sort Keys

Sort keys determine the physical order of rows on disk. Redshift maintains **zone maps** — automatic min/max statistics per 1 MB block per sort key column. A range filter on a sort key column can skip entire blocks without scanning them.

**Compound sort key**: `SORTKEY(year, month, day)` — rows physically sorted by year first, then month within year, then day within month. Optimal for range queries that filter on the leading column(s). Loses effectiveness for queries that filter on non-leading columns only.

**Interleaved sort key**: assigns equal weight to each column in the key. Better for workloads where filter columns vary per query (ad-hoc BI). Higher maintenance cost — requires `VACUUM REINDEX` (not just `VACUUM`), which is expensive on large tables.

**Rule of thumb**: use compound sort keys for predictable query patterns; use interleaved only when query patterns are truly variable and you can absorb the maintenance cost.

### COPY Command — Bulk Loading

`COPY` is the **only correct way to load large data into Redshift**. It parallelizes across all compute node slices simultaneously, reading from S3, DynamoDB, EMR, SSH, or remote hosts. Never use INSERT for bulk loads.

```sql
-- Load Parquet files from S3 (fastest for columnar data)
COPY sales
FROM 's3://my-bucket/sales/year=2024/month=01/'
IAM_ROLE 'arn:aws:iam::123456789012:role/RedshiftLoadRole'
FORMAT AS PARQUET;

-- Load JSON with auto field mapping
COPY orders
FROM 's3://my-bucket/orders/raw/'
IAM_ROLE 'arn:aws:iam::123456789012:role/RedshiftLoadRole'
JSON 'auto'
DATEFORMAT 'YYYY-MM-DD'
TIMEFORMAT 'YYYY-MM-DD HH:MI:SS'
MAXERROR 100            -- tolerate up to 100 parsing errors
COMPUPDATE OFF;         -- skip compression analysis for speed (if column encodings already set)

-- Load compressed CSV with explicit column list
COPY dim_product (product_id, product_name, category, price)
FROM 's3://my-bucket/products.csv.gz'
IAM_ROLE 'arn:aws:iam::123456789012:role/RedshiftLoadRole'
CSV IGNOREHEADER 1
GZIP
EMPTYASNULL
BLANKSASNULL;
```

**After bulk load**: run `ANALYZE` to update statistics (query planner uses these), and `VACUUM` if you deleted significant data (reclaims space, re-sorts).

### Concurrency Scaling and WLM

**Workload Management (WLM)**: routes queries to separate queues based on user group, query group, or query classification rules. Separate queues for short interactive queries vs long batch jobs prevents slow queries from blocking dashboards.

- **Automatic WLM**: Redshift's ML-based WLM mode allocates memory and concurrency dynamically based on workload type. Recommended for most clusters.
- **Manual WLM**: explicit queue definitions with memory allocation percentages and concurrency limits.

**Concurrency Scaling**: when query queue fills up, Redshift automatically adds transient additional cluster capacity. The additional cluster is ready in ~30 seconds. **First 1 hour per day of concurrency scaling is free**; after that, charged at the same per-second rate as your main cluster.

**Query monitoring rules (QMR)**: define rules like "if a query scans >500 GB or runs >300 seconds, cancel it / move it to a different queue / log it." Protects cluster resources from runaway queries.

### Materialized Views

Redshift materialized views precompute and store query results physically. Subsequent queries against the view hit the precomputed data rather than re-executing the full aggregation across the base tables. This is especially valuable for BI tool queries that hit the same aggregations repeatedly.

```sql
-- Materialized view: pre-aggregate daily sales by product
CREATE MATERIALIZED VIEW mv_daily_sales_by_product
AUTO REFRESH YES
AS
SELECT
    order_date,
    p.product_id,
    p.product_name,
    p.category,
    SUM(f.amount)   AS total_revenue,
    COUNT(*)        AS order_count,
    AVG(f.quantity) AS avg_quantity
FROM fact_orders f
JOIN dim_product p ON f.product_id = p.product_id
GROUP BY order_date, p.product_id, p.product_name, p.category;

-- Query hits the precomputed view — no full join/aggregation at query time
SELECT product_name, SUM(total_revenue)
FROM mv_daily_sales_by_product
WHERE order_date >= CURRENT_DATE - 30
GROUP BY product_name
ORDER BY 2 DESC;
```

`AUTO REFRESH YES` instructs Redshift to automatically refresh the view when the underlying base tables are updated (within a short delay). For views where freshness is critical, use `REFRESH MATERIALIZED VIEW mv_daily_sales_by_product` explicitly after each data load. Materialized views on external tables (Spectrum) are also supported and can dramatically speed up repeated Spectrum queries.

### Redshift Data API

The Data API allows Lambda functions, ECS containers, and serverless applications to execute Redshift queries without maintaining a persistent JDBC/ODBC connection. Queries execute asynchronously — you submit a query, get a `QueryId`, then poll for results. Eliminates connection pooling complexity for event-driven architectures.

```python
import boto3, time

client = boto3.client('redshift-data', region_name='us-east-1')

# Submit async query
response = client.execute_statement(
    ClusterIdentifier='my-redshift-cluster',
    Database='analytics',
    DbUser='admin',
    Sql='SELECT COUNT(*) FROM fact_orders WHERE order_date = CURRENT_DATE'
)
query_id = response['Id']

# Poll until done
while True:
    status = client.describe_statement(Id=query_id)['Status']
    if status in ('FINISHED', 'FAILED', 'ABORTED'):
        break
    time.sleep(1)

# Fetch results
result = client.get_statement_result(Id=query_id)
print(result['Records'])
```

---

## 3. AWS Glue — Managed ETL and Data Catalog

### Glue Data Catalog

The Glue Data Catalog is the **central metadata repository** for the AWS analytics ecosystem. It stores databases, tables, column schemas, data types, S3 locations, partition information, and table statistics. It is a **Hive-compatible metastore** — Athena, Redshift Spectrum, and EMR all use it as their default metastore, meaning a table you define in Glue is immediately queryable from all three engines.

**Crawlers**: Glue Crawlers connect to data sources (S3, JDBC databases, DynamoDB), sample the data, infer schema, detect partitions, and write the results into the Glue Catalog. Schedule on-demand, on a cron, or trigger from an event. On subsequent runs, crawlers detect schema changes (added/removed/renamed columns) and either update the catalog or flag for review.

**Schema versioning**: every schema change creates a new schema version in the catalog. You can compare versions and roll back. Useful for catching upstream schema drift before it breaks downstream pipelines.

**Partition indexes**: for tables with many partitions (millions), add partition indexes on commonly-filtered partition columns to speed up Athena partition resolution.

### Glue ETL Jobs

Glue ETL runs managed Apache Spark (Python PySpark or Scala) or Python Shell for lightweight scripting. AWS handles cluster provisioning, Spark version management, and auto-scaling.

**Worker types**:
| Worker | vCPUs | Memory | Best For |
|---|---|---|---|
| G.025X | 2 | 4 GB | Most cost-effective for simple transforms |
| G.1X | 4 | 16 GB | Standard ETL workloads |
| G.2X | 8 | 32 GB | Memory-intensive joins, large aggregations |
| G.4X | 16 | 64 GB | Very large datasets, complex Spark jobs |

**Job bookmarks**: Glue tracks which S3 objects (by modification time + ETag) or JDBC rows (by primary key) have already been processed. Re-running a bookmarked job only processes new data. Essential for incremental ETL without state management code.

**DynamicFrame vs DataFrame**: Glue's `DynamicFrame` is schema-flexible — it handles inconsistent schemas, missing fields, and mixed types gracefully (stores inconsistencies as `ChoiceType`). Spark `DataFrame` requires a defined schema upfront. For complex transformations, convert DynamicFrame → DataFrame, transform with full Spark API, then convert back for Glue output writers.

```python
import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql.functions import col, to_date, year, month, lit

args = getResolvedOptions(sys.argv, ['JOB_NAME'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Read raw CSV from Glue Catalog (uses job bookmark automatically)
source_dyf = glueContext.create_dynamic_frame.from_catalog(
    database="raw_db",
    table_name="orders_csv",
    transformation_ctx="source_dyf"   # bookmark context key
)

# Convert to Spark DataFrame for rich transformations
df = source_dyf.toDF()

# Clean: drop nulls on critical key, cast types, add partition columns
df_clean = (
    df.filter(col("order_id").isNotNull())
      .withColumn("amount", col("amount").cast("double"))
      .withColumn("order_date", to_date(col("order_date_str"), "yyyy-MM-dd"))
      .withColumn("year",  year(col("order_date")).cast("string"))
      .withColumn("month", month(col("order_date")).cast("string"))
      .drop("order_date_str")
)

# Convert back to DynamicFrame for Glue S3 writer
clean_dyf = DynamicFrame.fromDF(df_clean, glueContext, "clean_dyf")

# Write Parquet to S3, partitioned by year/month
glueContext.write_dynamic_frame.from_options(
    frame=clean_dyf,
    connection_type="s3",
    connection_options={
        "path": "s3://my-datalake/clean/orders/",
        "partitionKeys": ["year", "month"]
    },
    format="parquet",
    format_options={"compression": "snappy"},
    transformation_ctx="sink"
)

job.commit()
```

### Glue Connections and VPC Integration

When your ETL source is a JDBC database (RDS, Aurora, Redshift) inside a [VPC](/aws-vpc-networking), Glue needs a **Glue Connection** to reach it. A Glue Connection stores the JDBC URL, credentials (via Secrets Manager), and network configuration (VPC, subnet, security group). Glue ETL workers launch inside a specified subnet and communicate with the JDBC source over the private VPC network.

Critical networking requirements for Glue JDBC connections:
- The security group on the Glue workers must allow self-referencing inbound rules (Glue workers communicate with each other)
- The RDS security group must allow inbound from the Glue workers' security group on the DB port (5432 for Postgres, 3306 for MySQL)
- The subnet must have a route to S3 via a VPC endpoint (otherwise all S3 reads/writes for the job traverse the NAT Gateway and incur data transfer costs)

```python
# Reading from an RDS PostgreSQL source using Glue Connection
source_dyf = glueContext.create_dynamic_frame.from_options(
    connection_type="postgresql",
    connection_options={
        "useConnectionProperties": "true",
        "connectionName": "rds-postgres-prod",   # Glue Connection name
        "dbtable": "public.transactions",
        "sampleQuery": "SELECT * FROM public.transactions WHERE updated_at > '2024-01-01'"
    }
)
```

### Glue Data Quality

Glue Data Quality lets you define declarative quality rules on datasets and run them as part of (or separate from) ETL jobs.

```python
# In a Glue ETL job: evaluate data quality and halt on failure
from awsglue.transforms import EvaluateDataQuality

ruleset = """
    Rules = [
        IsComplete "order_id",
        IsUnique "order_id",
        ColumnValues "amount" between 0.01 and 1000000,
        ColumnLength "status" between 3 and 20,
        RowCount > 1000
    ]
"""

dq_results = EvaluateDataQuality.apply(
    frame=clean_dyf,
    ruleset=ruleset,
    publishing_options={
        "dataQualityEvaluationContext": "orders_dq",
        "enableDataQualityResultsPublishing": True
    }
)
# dq_results["EvaluationStatus"] == "PASS" / "FAIL"
```

Rules can also run as standalone Glue Data Quality jobs on a schedule, publishing results to CloudWatch for dashboarding and alerting.

### AWS Glue DataBrew

DataBrew is a **visual, no-code data preparation** tool. 250+ built-in transforms (split columns, normalize values, impute missing values, pivot/unpivot). It automatically profiles datasets — showing distributions, missing value counts, outliers, and data type issues. Key differentiators: PII detection and masking (SSN, email, phone patterns), and no Spark knowledge required.

Use DataBrew for: data analysts doing exploratory prep, one-time data quality investigations, or rapid prototyping before writing a production Glue ETL job.

---

## 4. AWS Lake Formation — Data Lake Governance

### What It Adds Beyond IAM

Raw [IAM](/aws-iam-security) + S3 bucket policies control access at the S3 object level — you can grant or deny access to an entire S3 prefix, but you cannot say "analyst_role can query the `orders` table but only the `order_id` and `amount` columns, and only rows where `region = 'EU'`." That requires Lake Formation.

Lake Formation adds a **permission layer on top of the Glue Data Catalog**:

- **Database-level permissions**: DESCRIBE, CREATE_TABLE, ALTER, DROP
- **Table-level permissions**: SELECT, INSERT, DELETE, DESCRIBE, ALTER, DROP
- **Column-level permissions**: grant SELECT on specific columns; used to hide PII columns from certain roles
- **Row-level filters**: define a filter expression (e.g., `region = 'EU'`) and attach it to a principal; that principal only sees matching rows when querying via Athena or Redshift Spectrum
- **Cell-level security**: combine column permissions with row filters for true cell-level access control

**LF-Tags (attribute-based access control)**: instead of granting permissions table-by-table, attach tags (e.g., `sensitivity=PII`, `domain=finance`) to catalog objects, then grant access based on tag conditions. Scales to thousands of tables without managing individual grants.

```sql
-- Grant column-level SELECT to an analyst role via Lake Formation
-- (done via AWS console/CLI/SDK, shown here as conceptual SQL)
GRANT SELECT (order_id, customer_id, amount, order_date)
ON TABLE analytics_db.orders
TO ROLE analyst_role;
-- customer_name, customer_email (PII) are NOT in the grant → invisible to analyst_role

-- Row-level filter: EU analysts only see EU orders
-- Filter: region = 'EU' attached to eu_analyst_role
-- When eu_analyst_role runs: SELECT * FROM orders → automatically filters to EU rows
```

**Cross-account data sharing**: register an S3 location or Glue database with Lake Formation in Account A, then share it with Account B. Account B analysts query via Athena without needing direct S3 access.

**Governed tables**: Iceberg-backed tables in Lake Formation with built-in ACID transactions and automatic compaction. AWS manages the Iceberg metadata; you interact via standard SQL.

### Use Case Pattern

Without Lake Formation: separate S3 bucket policies per team, complex IAM role proliferation, no way to restrict at column level.

With Lake Formation: data producers register data locations once, tag tables with sensitivity/domain metadata. Data consumers request access to tag-based datasets. Athena queries automatically enforce column/row restrictions at query time — no application-level filtering required.

---

## 5. Amazon EMR — Big Data Processing

### What It Is

EMR is a managed cluster platform for running **Apache Hadoop ecosystem** workloads: Spark, Hive, Presto/Trino, HBase, Flink, Kafka (MSK is separate, but Flink-on-EMR processes Kafka). You get full control over Spark configuration, JVM heap settings, executor memory, and cluster topology — unlike Glue, which abstracts all of that.

**Deployment models**:

| Model | Cluster Management | Best For |
|---|---|---|
| EMR on EC2 | Full control; you size master, core, task nodes | Complex Spark jobs; long-running clusters; custom configs |
| EMR Serverless | No cluster management; auto-scales workers | Variable batch workloads; don't want to pre-size clusters |
| EMR on EKS | Spark/Hive jobs on existing EKS clusters | Sharing compute infrastructure; Kubernetes-native teams |

### EMR vs Glue ETL

| Dimension | AWS Glue ETL | Amazon EMR |
|---|---|---|
| Management | Fully managed, zero configuration | You configure Spark settings, cluster topology |
| Spark version | AWS-managed (recent, but fixed per Glue version) | Full control — any Spark version |
| Startup time | 5–10 min cold start (significant for frequent small jobs) | Pre-warmed clusters start in seconds |
| Cost model | Per DPU-second; can be expensive for large jobs | EC2 On-Demand/Spot pricing; cheaper at scale |
| Streaming | Glue Streaming (Spark Structured Streaming); limited | EMR + Flink or Structured Streaming; more control |
| Debugging | CloudWatch logs; Spark UI via Glue Studio | Full Spark History Server, Ganglia, YARN UI |
| Use case fit | Simple to medium ETL, catalog integration, bookmarks | Complex ML pipelines, HBase, custom Spark tuning |
| Python libraries | Limited (pre-installed packages + --additional-python-modules) | Install anything via bootstrap actions |

**Decision rule**: if your ETL fits the Glue model (S3-to-S3 transforms, catalog integration, moderate complexity), use Glue — less operational overhead. If you need custom Spark configuration, very large datasets, streaming with Flink, or non-standard libraries, use EMR.

### Bootstrap Actions and Custom Configuration

Bootstrap actions run on every node before EMR starts the Hadoop/Spark services. Use them to install Python packages, configure system settings, or download model artifacts.

```bash
#!/bin/bash
# bootstrap.sh — runs on all EMR nodes at cluster launch
set -e

# Install Python dependencies not in the default EMR image
sudo pip3 install --upgrade \
    scikit-learn==1.4.0 \
    xgboost==2.0.3 \
    boto3==1.34.0 \
    pyarrow==15.0.0

# Configure Spark defaults for our workload
cat >> /etc/spark/conf/spark-defaults.conf << 'EOF'
spark.sql.adaptive.enabled=true
spark.sql.adaptive.coalescePartitions.enabled=true
spark.sql.parquet.filterPushdown=true
spark.sql.parquet.mergeSchema=false
spark.hadoop.fs.s3.multipart.size=134217728
EOF

echo "Bootstrap complete"
```

Spark job submission to an EMR cluster (or EMR Serverless application):

```bash
# Submit Spark job to EMR on EC2
aws emr add-steps \
  --cluster-id j-XXXXXXXXXXXX \
  --steps Type=Spark,Name="DailyAggregation",ActionOnFailure=CONTINUE,\
Args=[--deploy-mode,cluster,\
      --class,com.example.DailyAggregationJob,\
      --conf,spark.executor.memory=8g,\
      --conf,spark.executor.cores=4,\
      --conf,spark.sql.shuffle.partitions=400,\
      s3://my-bucket/jars/analytics-job-1.0.jar,\
      --input,s3://my-datalake/clean/orders/year=2024/month=01/,\
      --output,s3://my-datalake/refined/daily-aggregations/]
```

### Spot Instance Strategy for EMR

Using Spot Instances for EMR batch jobs can reduce compute cost by **60–80%**. The key is to separate fault-tolerant from non-fault-tolerant nodes:

- **Master node**: On-Demand (1 node; if lost, cluster dies)
- **Core nodes**: On-Demand or mixed (store HDFS data; Spot interruption risks data loss)
- **Task nodes**: 100% Spot (compute only; no HDFS storage; if interrupted, Spark retries the task on another node)

**Instance type diversification**: specify 5–10 instance types of similar compute profile (e.g., m5.2xlarge, m5a.2xlarge, m5n.2xlarge, m4.2xlarge, r5.xlarge). Spot pools are independent — diversification dramatically reduces the probability of simultaneous interruption.

**Instance Fleet vs Instance Group**: use Instance Fleets (newer) with weighted capacity — you define a target capacity in vCPUs, and EMR fulfills it from your diversified instance type list.

```json
{
  "InstanceFleetType": "TASK",
  "TargetSpotCapacity": 20,
  "LaunchSpecifications": {
    "SpotSpecification": {
      "TimeoutDurationMinutes": 10,
      "TimeoutAction": "SWITCH_TO_ON_DEMAND"
    }
  },
  "InstanceTypeConfigs": [
    {"InstanceType": "m5.2xlarge",  "WeightedCapacity": 1},
    {"InstanceType": "m5a.2xlarge", "WeightedCapacity": 1},
    {"InstanceType": "m5n.2xlarge", "WeightedCapacity": 1},
    {"InstanceType": "r5.xlarge",   "WeightedCapacity": 1},
    {"InstanceType": "r5a.xlarge",  "WeightedCapacity": 1}
  ]
}
```

---

## 6. Amazon OpenSearch Service

OpenSearch Service is managed **Elasticsearch** (AWS forked Elasticsearch 7.10 in 2021 after licensing disputes) plus the OpenSearch project's own additions.

**Primary use cases**:
- **Application search**: full-text, fuzzy, faceted search with relevance ranking
- **Log analytics**: ingest application/infrastructure logs, query with Lucene syntax or OpenSearch Dashboards (fork of Kibana)
- **Security analytics (SIEM)**: correlate security events at scale; built-in threat intelligence integration
- **Vector search (k-NN)**: store and search embedding vectors for [semantic search in RAG architectures](/aws-ai-ml-services); supports FAISS (fast approximate k-NN) and NMSLIB algorithms

**OpenSearch Serverless**: auto-scales collections; no capacity planning; charges by OCU-hour (~$0.24/OCU-hr for indexing, ~$0.24/OCU-hr for search). Each collection is either **time-series** (optimized for log ingestion) or **search** (optimized for full-text/vector search). No hot/warm/cold tier management.

**OpenSearch Ingestion (managed Data Prepper)**: a fully managed pipeline service for ingesting data from S3, [Kinesis Data Streams](/aws-messaging-events), Kafka, and other sources into OpenSearch. Replaces the need to run your own Logstash or Data Prepper servers. Define pipelines in YAML; AWS handles scaling.

**Vector search details**: store dense float vectors as a field type (`knn_vector`). At query time, find the k nearest neighbors by cosine similarity, dot product, or L2 distance. Used in [RAG pipelines](/aws-ai-ml-services) where you embed a query, search OpenSearch for the nearest document vectors, and pass retrieved context to a language model.

---

## 7. Streaming Ingestion — Kinesis Firehose Patterns

While [Kinesis Data Streams and Firehose](/aws-messaging-events) are covered in depth in the Messaging & Events article, the data analytics perspective is worth spelling out because the Firehose delivery configuration directly determines how queryable your streaming data is in Athena.

### Firehose → S3 for Athena Queries

Default Firehose delivery writes raw JSON or CSV with a time-based prefix like `s3://bucket/prefix/YYYY/MM/DD/HH/`. This is not partition-compatible with Hive-style partitioning (`year=2024/month=01/day=15/`) that Athena partition pruning and partition projection expect.

**Configure Firehose with dynamic partitioning** to write data into Hive-style prefixes based on record content:

```json
{
  "ExtendedS3DestinationConfiguration": {
    "BucketARN": "arn:aws:s3:::my-datalake",
    "Prefix": "events/year=!{partitionKeyFromQuery:year}/month=!{partitionKeyFromQuery:month}/day=!{partitionKeyFromQuery:day}/",
    "ErrorOutputPrefix": "errors/year=!{timestamp:yyyy}/month=!{timestamp:MM}/",
    "DynamicPartitioningConfiguration": {
      "Enabled": true
    },
    "ProcessingConfiguration": {
      "Enabled": true,
      "Processors": [{
        "Type": "MetadataExtraction",
        "Parameters": [{
          "ParameterName": "MetadataExtractionQuery",
          "ParameterValue": "{year:.event_time | split(\"-\") | .[0], month:.event_time | split(\"-\") | .[1], day:.event_time | split(\"-\") | .[2] | split(\"T\") | .[0]}"
        }, {
          "ParameterName": "JsonParsingEngine",
          "ParameterValue": "JQ-1.6"
        }]
      }]
    },
    "BufferingHints": {
      "SizeInMBs": 128,
      "IntervalInSeconds": 300
    },
    "CompressionFormat": "SNAPPY",
    "DataFormatConversionConfiguration": {
      "Enabled": true,
      "OutputFormatConfiguration": {
        "Serializer": {"ParquetSerDe": {"Compression": "SNAPPY"}}
      },
      "SchemaConfiguration": {
        "DatabaseName": "raw_db",
        "TableName": "events",
        "RoleARN": "arn:aws:iam::123456789012:role/FirehoseGlueRole"
      }
    }
  }
}
```

Key configuration choices:
- **Buffer size 128 MB, interval 300 seconds** — Firehose writes when either threshold is hit first. 5-minute latency is acceptable for near-real-time; smaller buffers (64 MB / 60 seconds) reduce latency but produce smaller files
- **Parquet conversion** — Firehose can convert JSON to Parquet on the fly using the Glue Catalog schema definition, eliminating a separate ETL conversion job
- **Dynamic partitioning** — extracts partition values from record content using JQ expressions, writes to correct Hive-style prefixes automatically

### Cost Comparison Across Query Engines

Understanding the cost model differences is essential for architecture decisions:

| Engine | Pricing Model | 1 TB Query Cost | Best Break-Even |
|---|---|---|---|
| Athena | $5.00/TB scanned (Parquet ~90% savings) | $0.50 (Parquet) – $5.00 (CSV) | <5 TB/day scanned |
| Redshift Spectrum | $5.00/TB scanned + cluster cost | $0.50 + cluster overhead | Complement to existing Redshift |
| Redshift ra3.xlplus (2-node) | ~$0.65/hr/node = $1.30/hr | Fixed; ~$936/month | >5-10 TB/day repeated queries |
| Redshift Serverless | $0.36/RPU-hr; auto-scales | Variable; ~$2–8/query-hr | Intermittent workloads, unpredictable |
| EMR (Spark, m5.xlarge ×4 Spot) | ~$0.05/hr/instance = $0.20/hr | ~$0.20–0.50 for 1 TB job | Large-scale batch ETL, ML |
| Glue ETL (G.2X ×10 workers) | $0.44/DPU-hr = $4.40/hr | ~$2–4 for 1 TB job | Managed ETL without cluster ops |

**Rule**: Athena is always the right choice for infrequent, exploratory queries on S3 data. Redshift is cheaper at sustained, high-frequency BI workloads. EMR with Spot beats everything for large-scale batch processing where you accept operational complexity.

---

## 8. Data Lake Reference Architecture

```
INGEST LAYER
─────────────────────────────────────────────────────────
App Events      → Kinesis Data Streams → Kinesis Firehose → S3 (raw)
Batch Uploads   → S3 Transfer (direct PUT, Multipart)   → S3 (raw)
DB Change Data  → DMS (CDC) → S3 (raw) or Kinesis
CloudTrail Logs → S3 (raw/cloudtrail bucket, automatic)
VPC Flow Logs   → S3 or CloudWatch Logs

PROCESS LAYER
─────────────────────────────────────────────────────────
S3 (raw zone)
    ↓ [Glue Crawler: discover schema → Glue Catalog]
    ↓ [Glue ETL / EMR Spark: cleanse, cast, deduplicate]
S3 (clean zone, Parquet, partitioned by date)
    ↓ [Glue ETL: aggregate, join, business logic]
S3 (refined zone, aggregated metrics, star schema tables)

GOVERNANCE LAYER
─────────────────────────────────────────────────────────
Glue Data Catalog  — unified metastore for all zones
Lake Formation     — column/row-level permissions on catalog tables
IAM + S3 Policies  — underlying bucket access (Lake Formation enforces on top)

SERVE LAYER
─────────────────────────────────────────────────────────
Athena             — ad-hoc SQL queries; pay-per-scan; BI tools via JDBC
Redshift Spectrum  — query S3 from Redshift; join with Redshift tables
OpenSearch         — full-text search; log analytics; vector search
QuickSight         — dashboards and visualizations (connects to all above)

MONITORING & QUALITY
─────────────────────────────────────────────────────────
Glue Data Quality  — rule-based checks in ETL pipeline
CloudWatch Metrics — Glue job duration, Athena scanned bytes, Redshift WLM
CloudTrail         — API-level audit log (who queried what, when)
```

**Cost flow**: raw data is cheapest ([S3 Standard-IA or Intelligent-Tiering](/aws-storage-s3)); query cost depends on engine choice (Athena: $5/TB scanned; Redshift: fixed hourly + Spectrum $5/TB; EMR: EC2 cost). Columnar Parquet with partitioning is the single highest-ROI optimization across the entire stack.

---

## Interview Q&A

**Q: When would you use Athena vs Redshift for analytics?**

A: Use Athena when: data lives in S3, queries are infrequent or unpredictable, you need zero infrastructure management, or you want to query raw data lake files directly. Cost advantage at low query volumes (pay only per query). Use Redshift when: queries are frequent and repeat against the same dataset, you need sub-second response times for dashboards, you have complex multi-table joins that benefit from MPP optimization and local data residency, or you need Redshift-specific features (WLM, concurrency scaling, materialized views). Rule of thumb: Redshift breaks even vs Athena around 5–10 TB scanned per day consistently; below that, Athena is usually cheaper.

---

**Q: How do you optimize Athena query performance? What are the most impactful changes?**

A: In order of impact: (1) **Switch to Parquet or ORC** — eliminates scanning unused columns; 10–100× reduction in bytes scanned and cost. (2) **Add partitioning** on commonly-filtered columns (date, region) and use partition projection to eliminate Glue Catalog round-trips. (3) **Right-size files** — compact small files to 100–500 MB each; reduce per-file S3 API overhead. (4) Use **approximate functions** (`approx_distinct`, `approx_percentile`) for high-cardinality aggregations where exact results are not required. (5) Use **Iceberg** for mutable data instead of rewriting Hive partitions. (6) Use **workgroup result caching** for repeated dashboard queries.

---

**Q: Explain Redshift distribution styles. How do you choose for a star schema?**

A: Distribution style controls how rows are physically distributed across compute node slices. KEY co-locates rows with the same key value on the same slice, eliminating network shuffles for joins on that key. EVEN distributes round-robin, good when no dominant join key exists. ALL replicates the entire table to every node, ideal for small dimension tables where the replication cost is lower than redistribution cost on every query. AUTO lets Redshift choose based on statistics. For a star schema: set the large fact table to `DISTSTYLE KEY` on the primary join key (e.g., `customer_id`); set small dimension tables to `DISTSTYLE ALL`. Fact-to-dimension joins then require zero redistribution.

---

**Q: What is Apache Iceberg and why is it significant for data lakes?**

A: Iceberg is an open table format specification (not an engine) that adds a metadata layer on top of Parquet/ORC files in S3. The metadata layer (manifest files, snapshot files) enables: ACID transactions (concurrent writers, isolated readers), row-level UPDATE/DELETE/MERGE without rewriting entire partitions, time travel (query as of any past snapshot), schema evolution (add/rename/drop columns without rewrites), and hidden partitioning (partition strategies stored in metadata, not in column names). The significance: traditional Hive tables on S3 are effectively append-only — any update requires full partition rewrite. Iceberg makes data lakes first-class databases for mutable workloads. AWS supports Iceberg natively in Athena v3, Glue, EMR, and Lake Formation.

---

**Q: How does the Glue Data Catalog relate to Athena and Redshift Spectrum?**

A: The Glue Data Catalog is a Hive-compatible metastore. Athena, Redshift Spectrum, and EMR all use it as their default metadata source. When you create a table in the Glue Catalog (manually or via a Crawler), that table definition — schema, column types, S3 location, partition information — is immediately available to all three engines without any additional configuration. This means you define your data lake schema once in one place, and any engine can query it. Redshift Spectrum specifically uses `CREATE EXTERNAL SCHEMA` to reference a Glue Catalog database, making external (S3) tables look and behave like Redshift local tables.

---

**Q: Design a data pipeline for processing 1 TB of daily transaction data for analytics.**

A: Ingest: transactions arrive via application events to Kinesis Data Streams → Kinesis Data Firehose buffers and writes to S3 raw zone in Parquet format, partitioned by `year/month/day`, in 5-minute micro-batches. ETL: a Glue ETL job (G.2X workers, 20 workers) runs at midnight (or triggered by S3 event on day completion), reads the day's raw Parquet, applies data quality rules (order_id non-null, amount > 0, known status values), casts types, deduplicates on order_id, and writes clean Parquet to the clean zone partitioned by date. A second Glue job computes daily aggregations (by customer, by product, by region) and writes to the refined zone. Serving: Athena for ad-hoc analyst queries on raw/clean zones; Redshift + Spectrum for BI tool reporting. Governance: Lake Formation column-level grants so analysts can query order amounts but not customer PII. Monitoring: Glue job CloudWatch metrics; Data Quality results to S3 for trending; SNS alert on DQ failure.

---

**Q: What is the difference between Glue ETL and EMR? When do you use each?**

A: Both run Apache Spark. Glue ETL is fully managed — no cluster sizing, no Spark tuning, auto-scaling, native Glue Catalog integration, job bookmarks, DynamicFrames, and built-in Data Quality. EMR gives full control — custom Spark configuration, any Spark version, full library ecosystem via bootstrap actions, HBase, Flink, Presto, and much lower cost at scale when using Spot instances. Use Glue for: standard S3-to-S3 ETL, medium complexity, teams without deep Spark expertise, catalog-integrated pipelines. Use EMR for: complex custom Spark jobs, streaming with Flink, HBase workloads, very large jobs where the cost savings from Spot instances matter, or when you need specific Spark/Hadoop version compatibility.

---

**Q: How does Lake Formation improve on raw IAM + S3 bucket policies for data access control?**

A: IAM and S3 policies operate at the object/prefix level — you can grant access to `s3://bucket/orders/` but you cannot restrict which columns or rows a principal can see within that data. Lake Formation adds a permission model on top of the Glue Data Catalog that enforces column-level and row-level access at query execution time (Athena, Redshift Spectrum, EMR enforce LF permissions). Practical benefits: (1) one permission model instead of complex per-bucket IAM + bucket policy combinations, (2) column-level grants to hide PII fields from non-privileged roles, (3) row-level filters to enforce data residency (EU analysts see only EU data), (4) LF-Tags for attribute-based access control that scales to thousands of tables without per-table grant management, (5) cross-account data sharing without granting S3 bucket access to external accounts.

---

**Q: Explain how you'd implement a near-real-time analytics pipeline with under 5-minute latency.**

A: Architecture: application events → Kinesis Data Streams (sub-second ingestion) → Kinesis Data Firehose (60-second buffer, writes Parquet to S3 raw zone) → Athena with partition projection queries the latest partition. Alternatively, for sub-minute latency: events → Kinesis Data Streams → EMR Flink (Flink reads the stream directly, applies windowed aggregations, writes results to OpenSearch or a Redshift staging table every 30 seconds). The Firehose approach achieves ~2–3 minute end-to-end latency (stream buffer + S3 consistency + Athena query time). The Flink approach achieves 30-second to 1-minute latency with higher operational complexity. For truly real-time dashboards (<30 seconds), push aggregated results from Flink directly to OpenSearch or DynamoDB, bypassing S3 and Athena entirely.

---

**Q: What are the key differences between EMR Serverless and EMR on EC2?**

A: EMR on EC2: you provision and manage master, core, and task nodes; you choose instance types and sizes; clusters are persistent (long-running) or transient (spin up for each job). Pre-warmed clusters execute jobs in seconds. Full Spark and YARN configuration control. Cost-efficient with Spot instances for batch. EMR Serverless: no cluster management; you specify vCPU and memory requirements per application; AWS auto-scales workers within seconds of job submission; you pay only for the vCPU-seconds and memory-GB-seconds used. Slower cold start than a pre-warmed EC2 cluster (~1–2 minutes for first job). Better for variable workloads where clusters would be idle much of the time. Not suitable for very latency-sensitive streaming jobs that need persistent, always-ready workers.

---

**Q: How would you set up data quality checks in a production Glue ETL pipeline?**

A: Layer the checks at three points. (1) **Schema validation** at job start: verify the source table schema matches expectations — fail fast before processing if upstream schema changed. (2) **In-pipeline DQ rules** using Glue Data Quality `EvaluateDataQuality`: define `IsComplete`, `IsUnique`, `ColumnValues` range checks, `RowCount` lower bounds. Configure `publishing_options` to write results to S3 and CloudWatch. Set `StopJobOnFailure: True` for critical rules so bad data never reaches the clean zone. (3) **Post-load reconciliation**: after writing to the clean zone, count source rows vs written rows; compare key metrics (total amount, distinct customer count) against yesterday's values; alert on deviations >5%. For complex anomaly detection, write DQ metric time series to a DynamoDB table and run a [Lambda](/aws-lambda-serverless) function that checks for statistical outliers (3-sigma rule) after each job completion.

---

## Red Flags to Avoid

- Using INSERT statements to load bulk data into Redshift instead of COPY — INSERT is single-threaded and 10–100× slower
- Creating Athena tables without partitions on a large dataset — full table scan on every query, high cost
- Storing data in CSV in S3 for analytics — always convert to Parquet or ORC; CSV is 10–100× more expensive to query
- Many small files in S3 (thousands of 1 MB files) — kills Athena and Spark performance; compact to 100–500 MB files
- Using an interleaved sort key in Redshift without a VACUUM REINDEX schedule — maintenance overhead accumulates silently
- Choosing dc2 node types for new Redshift clusters — use ra3; dc2 is legacy with fixed, non-scalable storage
- Granting S3 bucket-level access for data lake access control when Lake Formation is available — loses column/row-level enforcement
- Running Glue ETL jobs with `COMPUPDATE ON` during COPY to Redshift — doubles load time; set column encodings once during table creation
- Using Redshift for infrequent ad-hoc queries on raw S3 data — Athena is cheaper and operationally simpler for that use case
- Forgetting to run ANALYZE and VACUUM after large Redshift data loads — stale statistics cause bad query plans; deleted row space is not reclaimed
- Using EMR on-demand task nodes instead of Spot — leaving 60–80% compute cost savings on the table for batch workloads
- Confusing Glue DynamicFrame and Spark DataFrame — DynamicFrame handles schema inconsistencies; DataFrame is faster for clean, typed data

---

## See Also

- [Storage & S3](/aws-storage-s3) — S3 as the data lake storage foundation; storage classes for hot/warm/cold analytics data
- [Messaging & Events](/aws-messaging-events) — Kinesis Data Streams and Firehose for streaming ingestion into the analytics pipeline
- [AI/ML Services](/aws-ai-ml-services) — SageMaker integration with Athena for feature engineering; OpenSearch vector search for RAG
- [IAM & Security](/aws-iam-security) — Lake Formation permission model; IAM roles for Glue, Redshift, and Athena; Redshift IAM authentication
- [Cost Optimization](/aws-cost-optimization) — Athena vs Redshift cost break-even analysis; Spot instances for EMR; S3 storage class selection for data lake zones
- [Lambda](/aws-lambda-serverless) — Lambda as Athena federation connectors; event-driven Glue job triggers from S3 events; Redshift Data API callers
- [VPC & Networking](/aws-vpc-networking) — Redshift cluster VPC placement; VPC endpoints for S3 to avoid data transfer costs; Glue VPC connections for JDBC sources
- [Observability](/aws-observability) — CloudTrail logs as analytics input; Glue job metrics in CloudWatch; Redshift query monitoring and audit logging
