# Raftline (Quorix): Distributed Consensus Key-Value Database

A production-grade, fault-tolerant distributed key-value database powered by the **Raft consensus algorithm**, built with Java 21 LTS, gRPC / Protobuf inter-node replication, segmented Write-Ahead Log (WAL) with CRC32 checksums, linearizable reads via ReadIndex, point-in-time snapshotting, and client session deduplication.

---

## 🏛️ System Architecture

```
                                +-----------------------------------+
                                |     Client Application / SDK      |
                                |     (PUT / GET / DELETE / Status) |
                                +-----------------------------------+
                                                  |  HTTP REST (8001..8005)
                                                  v
     +------------------------------------------------------------------------------------------+
     | Node 1 (Leader)                                                                          |
     |                                                                                          |
     |   +-----------------------+     +------------------------+     +---------------------+   |
     |   |   HTTP REST Server    | --> |    Raft Consensus      | --> |  Segmented WAL      |   |
     |   |   - /v1/kv/{key}      |     |    - Roles & Election  |     |  - CRC32 Checksums  |   |
     |   |   - /v1/cluster/*     |     |    - Quorum Commit §5.4|     |  - Crash Auto-Trim  |   |
     |   |   - /v1/metrics       |     |    - ReadIndex Engine  |     |  - Atomic Term Meta |   |
     |   +-----------------------+     +------------------------+     +---------------------+   |
     |                                             |                             |              |
     |                                             v                             v              |
     |                                 +------------------------+     +---------------------+   |
     |                                 |   gRPC Replication     |     |   KV State Machine  |   |
     |                                 |   - RequestVote        |     |   - Session Dedupe  |   |
     |                                 |   - AppendEntries      |     |   - Snapshots       |   |
     |                                 |   - InstallSnapshot    |     +---------------------+   |
     +------------------------------------------------------------------------------------------+
                    | (Port 9001)                | (Port 9002)              | (Port 9003..9005)
                    | gRPC Replication           |                          |
                    v                            v                          v
          +-------------------+        +-------------------+      +-------------------+
          |  Follower Node 2  |        |  Follower Node 3  | ...  | Follower Nodes 4,5|
          |  Local Disk & WAL |        |  Local Disk & WAL |      | Local Disk & WAL  |
          +-------------------+        +-------------------+      +-------------------+
```

---

## 📦 Project Structure

```
Raftline/
├── raftline-storage/         # Durable Write-Ahead Log, CRC32 verification, Snapshots, and Key-Value State Machine
│   ├── wal/WriteAheadLog.java
│   ├── meta/RaftMetaStorage.java
│   ├── model/LogEntry.java, Command.java
│   └── state/KeyValueStore.java, StateMachine.java
├── raftline-core/            # Pure Raft Consensus Engine (Role, Leader Election, Commit Rule §5.4.2, ReadIndex)
│   ├── RaftNode.java
│   ├── Role.java
│   ├── config/RaftConfig.java
│   └── transport/RaftTransport.java
├── raftline-transport/       # gRPC + Protobuf inter-node replication protocol
│   ├── src/main/proto/raft.proto
│   ├── GrpcRaftTransport.java
│   └── GrpcRaftServer.java
├── raftline-api/             # Server entrypoint and client-facing HTTP REST API
│   ├── RaftServerMain.java
│   └── RaftHttpServer.java
├── raftline-client/          # Fault-tolerant Java Client SDK (Automatic redirect, retries, idempotency)
│   └── QuorixClient.java
├── raftline-testkit/         # Deterministic cluster simulator and fault injector
│   ├── ClusterSimulator.java
│   └── InProcessRaftTransport.java
├── deployment/
│   └── docker/
│       ├── Dockerfile
│       └── docker-compose.yml # 5 isolated nodes on bridge network with volume mounts
└── scripts/
    ├── start-5node-cluster.ps1
    ├── stop-5node-cluster.ps1
    └── demo-chaos-cluster.ps1
```

---

## 🚀 Getting Started

### 1. Build the Entire Project
```powershell
mvn clean package -DskipTests
```
This generates the executable fat JAR in `raftline-api/target/raftline-api-1.0.0-SNAPSHOT.jar`.

### 2. Run the 5-Node Cluster Locally
```powershell
.\scripts\start-5node-cluster.ps1
```
This starts 5 independent Java processes:
- `node-1`: HTTP 8001 / gRPC 9001
- `node-2`: HTTP 8002 / gRPC 9002
- `node-3`: HTTP 8003 / gRPC 9003
- `node-4`: HTTP 8004 / gRPC 9004
- `node-5`: HTTP 8005 / gRPC 9005

### 3. Run the Automated Chaos & Failover Demonstration
```powershell
.\scripts\demo-chaos-cluster.ps1
```
This script automatically:
1. Discovers the active leader.
2. Writes `PUT user:42 "Sushrut"`.
3. Verifies linearizable read on the leader.
4. **Kills the leader process** abruptly.
5. Observes the remaining 4 nodes detect the timeout and elect a new leader.
6. Reads `user:42` from the **new leader**, verifying zero data loss.
7. Shuts down the cluster cleanly.

---

## 🌐 Client REST API

| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/v1/kv/{key}` | Write a value. Commits when replicated to a quorum (\(3/5\)). |
| `GET` | `/v1/kv/{key}` | Linearizable read via `ReadIndex` (confirms current leadership). |
| `GET` | `/v1/kv/{key}?stale=true`| Fast follower read (allows bounded staleness). |
| `DELETE` | `/v1/kv/{key}` | Delete a key through consensus. |
| `GET` | `/v1/cluster/status` | Current role, term, leaderId, commitIndex, and lastApplied. |
| `GET` | `/v1/cluster/nodes` | Cluster membership, total nodes, and quorum count. |
| `GET` | `/v1/metrics` | Prometheus metrics (`raft_current_term`, `raft_commit_index`, etc.). |
| `POST` | `/v1/admin/snapshot` | Trigger a point-in-time snapshot and WAL log compaction. |

### cURL Examples
```bash
# Write to cluster
curl -X PUT http://localhost:8001/v1/kv/user:42 -d "Sushrut"

# Linearizable read
curl http://localhost:8001/v1/kv/user:42

# Check cluster status
curl http://localhost:8001/v1/cluster/status
```

---

## ☕ Java SDK Usage

```java
import io.raftline.client.QuorixClient;

// Connect with seed URLs (SDK automatically discovers leader and caches redirects)
QuorixClient client = QuorixClient.create(
    "http://localhost:8001",
    "http://localhost:8002",
    "http://localhost:8003",
    "http://localhost:8004",
    "http://localhost:8005"
);

// Idempotent write (client sequence ID attached automatically)
client.put("user:42", "Sushrut");

// Linearizable read
String name = client.getString("user:42"); // "Sushrut"

// Stale read from local follower
byte[] fastRead = client.get("user:42", true);

// Delete
client.delete("user:42");
```

---

## 🛡️ Correctness Guarantees Implemented

1. **Raft Commit Rule §5.4.2**:
   Leaders only directly commit entries created in their *current term*. Entries from previous terms commit indirectly once a current-term entry is committed.
2. **Atomic Term & Vote Persistence**:
   `currentTerm` and `votedFor` are fsynced to disk using atomic temporary file swap before responding to any `RequestVote` RPC.
3. **Log Suffix Truncation (§5.3)**:
   Followers truncate conflicting uncommitted entries physically from the WAL before appending new entries.
4. **ReadIndex Linearizability**:
   Leaders execute a quorum heartbeat verification round before returning state machine reads, preventing stale reads if partitioned.
5. **Session Idempotency**:
   The state machine maintains a client sequence table preserved across snapshots to guarantee exactly-once execution semantics under client retries.
