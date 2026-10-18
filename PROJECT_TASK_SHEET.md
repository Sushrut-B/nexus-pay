# 📋 Raftline — Project Task Sheet & Timeline

**Project Name:** Raftline (Distributed Raft Consensus Engine & Distributed KV Store)  
**Version:** `1.0.0-SNAPSHOT`  
**Platform / Stack:** Java 21 LTS, gRPC 1.62.2, Protocol Buffers 3.25.3, Netty, Jackson, Docker, PowerShell  
**Repository:** [https://github.com/Sushrut-B/Raftline](https://github.com/Sushrut-B/Raftline) (Private)  
**Status Date:** October 12, 2026  
**Overall Completion:** **100% of Core Phases 1–7 Achieved**

---

## 🧭 How Many Days Project Is This? (Project Sizing & Production Roadmap)

Building an enterprise-grade distributed consensus database like Raftline (equivalent in architectural scope to Apache Ratis, etcd's raft engine, or CockroachDB's consensus layer) is ideally a **15 to 20 working day project (3 to 4 weeks)** for a dedicated systems engineer or small team.

Here is the realistic day-by-day roadmap:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        RAFTLINE COMPLETE 15-DAY ROADMAP                                │
├───────────────┬────────────────────────────────────────────────────────────────────────┤
│ Day 1 (TODAY) │ Core Consensus Foundation, WAL with CRC32, Protobuf/gRPC, Raft Core,   │
│               │ REST API, Client SDK, 5-Node Local Deployment, Chaos Verification,     │
│               │ Pre-Vote Protocol (§9.6), Dynamic Membership (§6), Auto-Snapshots.     │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 2 – 3    │ Disk-backed LSM Storage: RocksDB embedded engine integration,          │
│               │ zero-copy mmap, WAL segment rotation & garbage collection.             │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 4 – 5    │ Batching & Pipelining: Group commit, amortized disk fsync,              │
│               │ LMAX Disruptor ring buffer queue, pipelined AppendEntries RPCs.       │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 6 – 7    │ Production Security & Auth: Mutual TLS (mTLS), token-based auth,       │
│               │ encryption at rest, secure certificate rotation.                       │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 8 – 9    │ Production Observability: OpenTelemetry tracing, Prometheus exporter,  │
│               │ Grafana dashboards, health checks & leader election SLA monitors.      │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 10 – 12  │ Jepsen Chaos Suite: Automated partition injection, packet latency,     │
│               │ torn-write recovery fuzzing, crash-restart storm testing.              │
├───────────────┼────────────────────────────────────────────────────────────────────────┤
│ Days 13 – 15  │ Multi-Raft & Sharding: Range-based key partitioning, 2PC cross-shard   │
│               │ coordinator, high-throughput JMH benchmarks targeting 100k+ ops/sec.  │
└───────────────┴────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Summary of Day 1 Accomplishments

Today, the complete multi-module distributed consensus system was engineered from scratch, compiled, packaged, deployed into a 5-node cluster, hardened with next-phase features, and tested under real chaos conditions.

### Highlights:
- **6 Modules Built & Tested:** `raftline-storage`, `raftline-transport`, `raftline-core`, `raftline-api`, `raftline-client`, and `raftline-testkit`.
- **Pre-Vote Protocol (§9.6):** Eliminates disruptive elections from partitioned or lagging nodes before incrementing terms.
- **Dynamic Cluster Membership (§6):** Runtime addition and removal of nodes without taking down the cluster via `/v1/cluster/members` and `QuorixClient`.
- **Automatic Snapshot Compaction:** Asynchronous log pruning when entries exceed `snapshotThresholdCount`.
- **Packaging & Assembly:** Shaded Fat JAR created with SPI service transformer (`ServicesResourceTransformer`) to enable seamless gRPC Netty runtime without missing SPI providers.
- **5-Node Cluster Live Deployment:** Local multi-process cluster orchestrated on ports 8001–8005 (REST) and 9001–9005 (gRPC) with isolated data directories.
- **Chaos & Failover Verification:** Live cluster elected `node-1` as leader, committed `PUT user:42 "Sushrut"`, endured immediate hard termination (`kill`) of `node-1`, successfully triggered election of `node-4`, and maintained linearizable state with zero data loss.

---

## 🗂️ Work Breakdown Structure (WBS) & Task Sheet

| Task ID | Component / Milestone | Description | Status | Completion |
| :--- | :--- | :--- | :--- | :---: |
| **TSK-100** | **Project Foundation & Build System** | Multi-module Maven setup, Java 21 LTS compiler configuration, protobuf compiler plugin, dependencies | **Completed** | 100% |
| TSK-101 | Root `pom.xml` | Dependency management, Netty shaded plugins, compiler flags | Completed | 100% |
| TSK-102 | Shaded Packaging Configuration | Configured `maven-shade-plugin` with `ServicesResourceTransformer` for gRPC LoadBalancerProvider | Completed | 100% |
| **TSK-200** | **Durable Storage Engine (`raftline-storage`)** | Write-Ahead Log, CRC32 verification, atomic metadata, KV state machine | **Completed** | 100% |
| TSK-201 | CRC32 Segmented WAL | Binary framing (`[Magic:4][Len:4][CRC:8][Data:N]`), fsync policy, tail corruption auto-trim | Completed | 100% |
| TSK-202 | Log Suffix Truncation (§5.3) | Overwriting conflicting follower logs using offset-indexed binary truncation | Completed | 100% |
| TSK-203 | Persistent Meta Storage | Atomic term and `votedFor` state file (`raft.meta`) using FileChannel sync | Completed | 100% |
| TSK-204 | In-Memory State Machine | Concurrent state machine with snapshotting (`saveSnapshot` / `loadSnapshot`) | Completed | 100% |
| TSK-205 | Client Session Idempotency Table | Duplicate suppression table tracking `clientId` and `sequenceNum` for exactly-once semantics | Completed | 100% |
| **TSK-300** | **Network Transport & Protobuf (`raftline-transport`)** | Protobuf contract definitions, gRPC server, Netty client channels | **Completed** | 100% |
| TSK-301 | `raft.proto` Schema | Definitions for `RequestVote`, `AppendEntries`, and `InstallSnapshot` RPCs | Completed | 100% |
| TSK-302 | gRPC Netty Server | High-concurrency transport listener for inbound Raft consensus traffic | Completed | 100% |
| TSK-303 | Async Raft Client Transport | Pooled gRPC channels with asynchronous futures and configurable RPC deadlines | Completed | 100% |
| **TSK-400** | **Raft Consensus Core (`raftline-core`)** | State transitions, election safety, replication pipeline, linearizable reads | **Completed** | 100% |
| TSK-401 | Raft Role Lifecycle | `FOLLOWER` $\rightarrow$ `PRE_CANDIDATE` $\rightarrow$ `CANDIDATE` $\rightarrow$ `LEADER` transitions | Completed | 100% |
| TSK-402 | Pre-Vote Protocol (§9.6) | Non-disruptive pre-election phase avoiding split-brain disruptions from stale nodes | Completed | 100% |
| TSK-403 | Quorum Leader Election (§5.2) | Election term increment, self-voting, quorum threshold calculation ($\lfloor N/2 \rfloor + 1$) | Completed | 100% |
| TSK-404 | Election Safety Restriction (§5.4.1) | Candidate log up-to-dateness check (`lastLogTerm`, `lastLogIndex`) | Completed | 100% |
| TSK-405 | AppendEntries Log Matching (§5.3) | `prevLogIndex` / `prevLogTerm` consistency check and incremental catch-up | Completed | 100% |
| TSK-406 | Quorum Commit Rule (§5.4.2) | Log commit advancement guarded by current-term commitment rule | Completed | 100% |
| TSK-407 | Linearizable ReadIndex Protocol | Heartbeat quorum round verification for stale-read prevention without log writes | Completed | 100% |
| TSK-408 | Snapshot Compaction & Transfer (§7) | Point-in-time snapshot streaming (`InstallSnapshot`) and auto-compaction trigger | Completed | 100% |
| TSK-409 | Dynamic Membership Core (§6) | Dynamic `addPeer()` and `removePeer()` with runtime quorum adjustment | Completed | 100% |
| **TSK-500** | **Public API & Server Node (`raftline-api`)** | REST interface, cluster administration, leader discovery | **Completed** | 100% |
| TSK-501 | Embedded HTTP Server | High-throughput non-blocking JSON REST API endpoints | Completed | 100% |
| TSK-502 | Key-Value Operations | `GET /v1/kv/{key}`, `PUT /v1/kv/{key}`, `DELETE /v1/kv/{key}` | Completed | 100% |
| TSK-503 | HTTP 307 Leader Redirection | Automatic client forwarding to active leader URI if request hits follower | Completed | 100% |
| TSK-504 | Observability & Metrics Endpoints | `/v1/cluster/status`, `/v1/cluster/nodes`, `/v1/metrics`, `/v1/admin/snapshot` | Completed | 100% |
| TSK-505 | Dynamic Membership REST Endpoints | `GET /v1/cluster/members`, `POST /v1/cluster/members` (ADD/REMOVE) | Completed | 100% |
| TSK-506 | PID Lifecycle Tracking | Process writing `node.pid` directly into node storage directory for daemon control | Completed | 100% |
| **TSK-600** | **Client SDK (`raftline-client`)** | Resilient client driver with cluster discovery | **Completed** | 100% |
| TSK-601 | `QuorixClient` Java SDK | Thread-safe API client handling HTTP connection pooling and serializations | Completed | 100% |
| TSK-602 | Transparent Failover & Retries | Automatic discovery of current leader on HTTP 307 / network disconnect | Completed | 100% |
| TSK-603 | Idempotency Tokens | Client sequence number injection for duplicate prevention | Completed | 100% |
| TSK-604 | Client Membership Management | Methods `addMember(nodeId)`, `removeMember(nodeId)`, `getMembers()` | Completed | 100% |
| **TSK-700** | **DevOps & Verification Scripts** | Docker orchestration, local automation scripts, live chaos testing | **Completed** | 100% |
| TSK-701 | Multi-stage Dockerfile | Containerized build and slim JRE runtime image | Completed | 100% |
| TSK-702 | Docker Compose (5-Node) | Bridge networking topology for 5 container nodes | Completed | 100% |
| TSK-703 | PowerShell Control Suite | `start-5node-cluster.ps1`, `stop-5node-cluster.ps1` | Completed | 100% |
| TSK-704 | Chaos Demonstration Automation | `demo-chaos-cluster.ps1` validating failover and data persistence | Completed | 100% |
| **TSK-800** | **Day 2: Persistent Storage & Range Scan Engine** | LSM-Tree persistent backend, range scans, SSTables, tombstones | **Completed** | 100% |
| TSK-801 | `StateMachine.scan()` Contract | Range slicing contract across sorted keys [fromKey, toKey] | Completed | 100% |
| TSK-802 | `KeyValueStore` SkipList Upgrade | Upgraded in-memory engine to `ConcurrentSkipListMap` for $O(\log N)$ range slices | Completed | 100% |
| TSK-803 | Persistent LSM-Tree Engine (`LsmKeyValueStore`) | MemTable + immutable SSTables, sparse index binary search, tombstones | Completed | 100% |
| TSK-804 | Raft Range Scans (`scanLinearizable` & `scanStale`) | Quorum heartbeat lease confirmation for linearizable range reads | Completed | 100% |
| TSK-805 | REST Range Scan Endpoint | `GET /v1/kv/scan?from=A&to=Z&limit=100` with JSON response | Completed | 100% |
| TSK-806 | Client SDK Range Scan | Added `client.scan(fromKey, toKey, limit)` in `QuorixClient` | Completed | 100% |
| **TSK-900** | **Day 3: Segmented WAL Rolling, Snapshot GC & Cluster Benchmark** | Multi-segment rolling WAL, disk GC on snapshot, concurrency load benchmark | **Completed** | 100% |
| TSK-901 | Multi-Segment WAL Rolling | Auto-roll active log to `segment-%020d.wal` when reaching byte threshold (default 16MB) | Completed | 100% |
| TSK-902 | Cross-Segment Indexing & Truncation | Suffix truncation (§5.3) across multiple rolling files without data corruption | Completed | 100% |
| TSK-903 | Snapshot Boundary WAL Pruning | Safely delete sealed disk segments strictly preceding snapshot applied index | Completed | 100% |
| TSK-904 | Concurrency Load Benchmark Tool | `RaftBenchmark` measuring throughput (ops/sec) and p50/p90/p95/p99 latency | Completed | 100% |
| TSK-905 | Cluster Benchmark Automation Script | `scripts/run-benchmark.ps1` for multi-threaded stress verification on 5-node cluster | Completed | 100% |
| **TSK-1000** | **Day 4: Leader Leases & High-Throughput Batch Engine** | Leader leases (§6.4), zero-RPC reads, group commit & batch writes | **Completed** | 100% |
| TSK-1001 | Leader Lease Protocol (§6.4) | Configurable lease duration, monotonic nanosecond clock tracking, quorum ACK monitoring | Completed | 100% |
| TSK-1002 | Zero-RPC Linearizable Reads | Serving linearizable `GET` and range `scan` in 0 network roundtrips via active lease | Completed | 100% |
| TSK-1003 | Atomic Batch Execution (`executeBatch`) | Grouped consecutive indices with amortized single-fsync WAL append across full batch | Completed | 100% |
| TSK-1004 | REST Batch Endpoint | `POST /v1/kv/batch` for atomic batch command submission and execution | Completed | 100% |
| TSK-1005 | Client SDK Batch Support | Added `client.putBatch(Map<String, String>)` in `QuorixClient` | Completed | 100% |
| TSK-1006 | Integration Test Suite Verification | Validated lease linearizability and batch convergence across 5 nodes in `RaftClusterTest` | Completed | 100% |
| **TSK-1100** | **Day 5: Pipelined Log Replication & Chaos Suite** | Pipelined log streaming, rapid catch-up, automated fault injection | **Completed** | 100% |
| TSK-1101 | Pipelined Replication Pipeline | Asynchronous continuous log dispatch streaming unacknowledged entries to lagging followers | Completed | 100% |
| TSK-1102 | Rapid Lag Convergence Test | Validated in `RaftClusterTest.testPipelinedReplicationCatchup` with 30-entry streaming catch-up | Completed | 100% |
| TSK-1103 | Automated Chaos Engineering Suite | `scripts/run-chaos-suite.ps1` injecting random process termination, leader failovers & recovery | Completed | 100% |
