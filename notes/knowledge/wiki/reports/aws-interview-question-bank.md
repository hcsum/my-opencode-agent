# AWS Interview Question Bank

## Scope

This report distills the most reusable interview questions from `notes/knowledge/raw/processed/chatgpt-aws-interview-notes-2026-05-08.txt` into a direct prep artifact. It is optimized for recall and answer framing rather than for preserving the full conversation flow.

## What Interviewers Are Usually Testing

- Whether you choose the right abstraction for the workload instead of listing many AWS services.
- Whether you understand scaling units, bottlenecks, and operational tradeoffs.
- Whether you can explain secure and resilient system design in concrete primitives.
- Whether you know when to introduce decoupling, caching, and observability.

## Core Prep Surface

- `Lambda vs EC2 vs containers`
- `S3 vs RDS vs DynamoDB`
- `VPC` basics, especially public vs private placement
- `SQS` for decoupling
- `CloudWatch` for debugging

## Question Bank

### 1. Why use Lambda instead of EC2?

What it tests:

- Whether you understand abstraction level, operational burden, scaling behavior, and workload fit.

Strong answer shape:

- `Lambda` fits event-driven or bursty workloads where fast iteration and low ops matter more than runtime control.
- `EC2` fits stable, long-running, stateful, or heavily customized workloads where OS and network control matter.
- `Fargate` or containers sit in the middle when you want container packaging without managing as much infrastructure directly.

Pitfalls:

- Saying `Lambda is always better because it scales automatically`.
- Ignoring cold starts, timeout limits, or statefulness.

### 2. Why store images in S3 instead of a database?

What it tests:

- Whether you separate blob storage from transactional data stores.

Strong answer shape:

- `S3` is cheap, scalable object storage built for files such as images and attachments.
- Databases are better for metadata, indexing, and relational access patterns than for serving large binary objects directly.
- A common pattern is to keep image metadata in the database and the files themselves in `S3`.

Pitfalls:

- Treating all storage systems as interchangeable.
- Missing the cost and scaling differences between object storage and database storage.

### 3. When would you choose DynamoDB over RDS?

What it tests:

- Whether you understand SQL vs NoSQL tradeoffs and access-pattern-driven design.

Strong answer shape:

- `DynamoDB` fits very high scale, predictable low latency, and well-defined access patterns.
- `RDS` fits flexible querying, joins, and relational consistency requirements.
- The decision should be explained through workload shape, query flexibility, and scaling expectations rather than brand preference.

Pitfalls:

- Saying `NoSQL is more scalable` without explaining access-pattern constraints.
- Ignoring that `RDS` is often simpler when relational queries are central.

### 4. How do you make a service private but accessible via API?

What it tests:

- Whether you can combine networking and identity into a secure architecture.

Strong answer shape:

- Keep internal compute and data paths in private subnets.
- Expose only the intended ingress layer, such as `API Gateway` or a public load balancer.
- Use `Security Groups` for network boundaries and `IAM roles` for service permissions.
- Emphasize least privilege instead of broad access.

Pitfalls:

- Mixing up network controls and identity controls.
- Making internal services public just because they must be reachable indirectly.

### 5. How do you handle 10x traffic?

What it tests:

- Whether you think in bottlenecks, horizontal scaling, caching, and decoupling.

Strong answer shape:

- Identify the scaling unit first: machines, containers, or function concurrency.
- Add or tune auto scaling at the correct layer.
- Use `CloudFront` or caching where reads dominate.
- Introduce queues when write or background workloads should be absorbed asynchronously.
- Mention statelessness as a precondition for clean horizontal scaling.

Pitfalls:

- Answering only with `make the server bigger`.
- Ignoring session state, warm-up time, or downstream bottlenecks such as the database.

### 6. Why use SQS between services?

What it tests:

- Whether you understand async architecture and loose coupling.

Strong answer shape:

- `SQS` buffers spikes, decouples producers from consumers, and supports retries when downstream processing is slower or temporarily unavailable.
- It is useful when work does not need to complete synchronously on the request path.

Pitfalls:

- Treating queues as a default for every interaction.
- Forgetting that queues add eventual consistency and operational visibility needs.

### 7. Lambda is slow, what do you check?

What it tests:

- Whether you can debug production behavior instead of repeating service marketing.

Strong answer shape:

- Start with `CloudWatch` logs and metrics.
- Separate cold-start effects from handler execution time.
- Check memory sizing, timeout settings, dependency weight, downstream latency, and concurrency behavior.
- Explain whether the problem is inside the function, in its initialization path, or in the services it calls.

Pitfalls:

- Blaming Lambda generically without checking where the latency actually sits.

### 8. Design a scalable API on AWS.

What it tests:

- Whether you can assemble primitives into a coherent system with explicit tradeoffs.

Strong answer shape:

- A representative path from the source is `Client -> CloudFront -> API Gateway -> Lambda -> DynamoDB -> S3 -> SQS` for async jobs.
- Explain why each piece exists, where caching helps, where async work begins, and what the likely bottlenecks are.
- Show failure handling and observability, not just happy-path components.

Pitfalls:

- Drawing a service diagram without explaining tradeoffs.
- Omitting failure modes, retries, or operational visibility.

### 9. How do you scale EC2? How do you scale ECS?

What it tests:

- Whether you understand that infrastructure capacity and orchestration are separate layers.

Strong answer shape:

- `EC2` scaling means scaling machines, typically through `ALB + Auto Scaling Group`.
- `ECS` scaling means scaling tasks or services, but `ECS on EC2` still depends on underlying EC2 capacity.
- A senior answer names the real bottleneck: tasks can stay `PENDING` because cluster capacity is insufficient even when desired task count increases.
- Mention that stateless service design makes horizontal scaling much cleaner.

Pitfalls:

- Saying `ECS scales easier` without explaining the underlying capacity layer.
- Ignoring the difference between vertical and horizontal scaling.

### 10. ECS vs EKS?

What it tests:

- Whether you can distinguish AWS-native container orchestration from managed Kubernetes without overcomplicating the answer.

Strong answer shape:

- `ECS` is the simpler AWS-native orchestration path.
- `EKS` is managed Kubernetes and usually makes sense when Kubernetes portability or ecosystem fit matters enough to justify more operational complexity.
- For many interviews, the useful point is not feature comparison but explaining when extra control is worth the cost.

Pitfalls:

- Treating `EKS` as automatically more advanced or better.

## Fast Recall Lines

- `EC2 = persistent machines`
- `ECS/Fargate = persistent services or tasks`
- `Lambda = ephemeral executions`
- `EC2 scaling = machines; ECS scaling = tasks; Lambda scaling = concurrency-like executions`
- `Higher abstraction reduces ops burden but also reduces runtime control`

## Related Pages

- [[sources/chatgpt-aws-interview-notes-2026-05-08.md]]
- [[concepts/aws-compute-abstraction-and-scaling-tradeoffs.md]]
