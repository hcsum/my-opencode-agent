# ChatGPT AWS Interview Notes (2026-05-08)

## Source

- Source path: `/Users/sum/Downloads/ChatGPT-260508.txt`
- Original target: `/Users/sum/Downloads/ChatGPT-260508.txt`
- Raw file: `notes/knowledge/raw/processed/chatgpt-aws-interview-notes-2026-05-08.txt`
- Source type: exported ChatGPT conversation
- Language: English
- Date ingested: 2026-05-08

## Summary

This source is a long ChatGPT conversation focused on AWS interview preparation. The strongest through-line is that interviews test cloud tradeoff thinking more than service memorization, especially around compute abstraction, scaling, decoupling, and operational constraints.

The conversation spends the most time on the progression from EC2 to containers/ECS to Lambda. It frames this as a ladder of increasing abstraction and decreasing operational control, then uses that frame to explain scaling behavior, common interview questions, and production failure modes.

## Key Claims

1. A strong AWS interview answer is usually about choosing the right primitive for the workload, not naming many AWS services.
2. The core prep surface is relatively small: `Lambda vs EC2 vs containers`, `S3 vs RDS vs DynamoDB`, basic `VPC` separation, `SQS` for decoupling, and `CloudWatch` for debugging.
3. The compute abstraction ladder is a useful mental model:
   - `EC2`: persistent machines, high control, higher ops burden.
   - `ECS/Fargate` or containers: persistent services/tasks, medium control, orchestration added.
   - `Lambda`: ephemeral executions, lowest ops burden, strongest constraints.
4. Scaling EC2 and scaling ECS are not the same problem:
   - EC2 scaling means scaling machines, often with `ALB` plus `Auto Scaling Group`.
   - ECS scaling means scaling tasks/services, but ECS on EC2 is still bounded by underlying EC2 capacity.
5. Horizontal scaling assumes or strongly prefers stateless application design. Session-in-memory is called out as a classic failure mode.
6. Lambda is presented as strong for event-driven, bursty, async, and fast-moving product work, but weaker for long-running, latency-sensitive, stateful, or connection-heavy workloads.

## Evidence

- The source explicitly recommends a narrow prep focus: `Lambda vs EC2 vs containers`, `S3 vs RDS vs DynamoDB`, `VPC basics`, `SQS`, and `CloudWatch`.
- It uses the abstraction ladder `EC2 -> containers/ECS -> Lambda` to explain how infrastructure responsibility decreases while abstraction increases.
- It preserves an interview-ready system path: `Client -> CloudFront -> API Gateway -> Lambda -> DynamoDB -> S3 -> SQS`.
- It repeatedly returns to the distinction between orchestration and capacity in ECS, especially the claim that tasks can remain `PENDING` when EC2-backed capacity is insufficient.

## Takeaways

1. This source is most useful as an interview mental-model artifact, not as a service reference.
2. The most reusable idea is the abstraction ladder and its effect on control, scaling unit, and operational overhead.
3. The strongest production insight in the source is that `ECS` scheduling and `EC2` capacity are separate layers.

## Notable Examples

- Example AWS system-design chain: `Client -> CloudFront -> API Gateway -> Lambda -> DynamoDB -> S3 -> SQS`.
- ECS placement failure example: tasks remain `PENDING` when requested task count exceeds EC2-backed cluster capacity.
- Interview-ready contrast line: `EC2 = persistent machines`, `ECS = persistent services`, `Lambda = ephemeral executions`.

## Caveats

1. This is AI-generated guidance, not AWS documentation.
2. The raw export contains formatting noise and some malformed Q/A markers.
3. The source is useful as a mental-model and interview-prep artifact, but it should not be treated as authoritative for exact AWS limits or service behavior.

## Related Pages

- [[concepts/aws-compute-abstraction-and-scaling-tradeoffs.md]]
- [[reports/aws-interview-question-bank.md]]
