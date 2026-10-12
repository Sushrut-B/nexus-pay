package io.raftline.core;

import io.raftline.core.config.RaftConfig;
import io.raftline.core.rpc.*;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.core.transport.RaftTransport;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.model.Command;
import io.raftline.storage.model.LogEntry;
import io.raftline.storage.state.ApplyResult;
import io.raftline.storage.state.StateMachine;
import io.raftline.storage.wal.WriteAheadLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Core Raft Consensus Node.
 * Manages Role transitions, Election, Heartbeats, Log Replication,
 * Safety Invariants (including §5.4.2 Commit Rule), and Linearizable Reads.
 */
public class RaftNode implements RaftRpcHandler, Closeable {
    private static final Logger log = LoggerFactory.getLogger(RaftNode.class);

    private final RaftConfig config;
    private final WriteAheadLog wal;
    private final RaftMetaStorage metaStorage;
    private final StateMachine stateMachine;
    private final RaftTransport transport;

    private final ReentrantLock stateLock = new ReentrantLock();
    private final ScheduledExecutorService scheduler;
    private final Random random = new Random();

    // Node state
    private volatile Role role = Role.FOLLOWER;
    private volatile String currentLeaderId = null;

    // Volatile state on all servers
    private volatile long commitIndex = 0;
    private volatile long lastApplied = 0;

    // Leader-only volatile state
    private final Map<String, Long> nextIndex = new ConcurrentHashMap<>();
    private final Map<String, Long> matchIndex = new ConcurrentHashMap<>();

    // Client requests waiting for log entry commitment
    private final Map<Long, CompletableFuture<ApplyResult>> pendingClientRequests = new ConcurrentHashMap<>();

    // Timers
    private ScheduledFuture<?> electionTimeoutTask;
    private ScheduledFuture<?> heartbeatTask;
    private volatile long lastHeartbeatTimeMs = 0;

    private final AtomicBoolean running = new AtomicBoolean(false);

    public RaftNode(RaftConfig config,
                    WriteAheadLog wal,
                    RaftMetaStorage metaStorage,
                    StateMachine stateMachine,
                    RaftTransport transport) {
        this.config = Objects.requireNonNull(config, "config");
        this.wal = Objects.requireNonNull(wal, "wal");
        this.metaStorage = Objects.requireNonNull(metaStorage, "metaStorage");
        this.stateMachine = Objects.requireNonNull(stateMachine, "stateMachine");
        this.transport = Objects.requireNonNull(transport, "transport");

        this.commitIndex = wal.getSnapshotIndex();
        this.lastApplied = stateMachine.getLastAppliedIndex();

        this.scheduler = Executors.newScheduledThreadPool(2, r -> {
            Thread t = new Thread(r, "raft-" + config.getLocalNodeId() + "-timer");
            t.setDaemon(true);
            return t;
        });
    }

    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }

        transport.registerHandler(this);
        log.info("Starting RaftNode {} with term={}, lastLogIndex={}, lastLogTerm={}",
                config.getLocalNodeId(), metaStorage.getCurrentTerm(), wal.getLastLogIndex(), wal.getLastLogTerm());

        stateLock.lock();
        try {
            resetElectionTimeout();
        } finally {
            stateLock.unlock();
        }
    }

    // =========================================================================
    // Role Transitions & Timers
    // =========================================================================

    private volatile long currentElectionTimeoutMs = 300;

    private void resetElectionTimeout() {
        if (electionTimeoutTask != null && !electionTimeoutTask.isDone()) {
            electionTimeoutTask.cancel(false);
        }

        lastHeartbeatTimeMs = System.currentTimeMillis();
        currentElectionTimeoutMs = config.getMinElectionTimeoutMs() +
                (long) (random.nextDouble() * (config.getMaxElectionTimeoutMs() - config.getMinElectionTimeoutMs()));

        electionTimeoutTask = scheduler.schedule(this::handleElectionTimeout, currentElectionTimeoutMs, TimeUnit.MILLISECONDS);
    }

    private void handleElectionTimeout() {
        stateLock.lock();
        try {
            if (!running.get() || role == Role.LEADER) {
                return;
            }

            long elapsed = System.currentTimeMillis() - lastHeartbeatTimeMs;
            if (elapsed < currentElectionTimeoutMs) {
                long remaining = Math.max(50, currentElectionTimeoutMs - elapsed);
                electionTimeoutTask = scheduler.schedule(this::handleElectionTimeout, remaining, TimeUnit.MILLISECONDS);
                return;
            }

            log.info("Node {} election timeout elapsed (elapsed={}ms >= timeout={}ms). Starting election process.",
                    config.getLocalNodeId(), elapsed, currentElectionTimeoutMs);
            if (config.isPreVoteEnabled()) {
                startPreVote();
            } else {
                startElection();
            }
        } catch (Throwable t) {
            log.error("Exception in handleElectionTimeout for {}", config.getLocalNodeId(), t);
        } finally {
            stateLock.unlock();
        }
    }

    private void startPreVote() {
        this.role = Role.PRE_CANDIDATE;
        this.currentLeaderId = null;
        long nextTerm = metaStorage.getCurrentTerm() + 1;
        resetElectionTimeout();

        long lastLogIndex = wal.getLastLogIndex();
        long lastLogTerm = wal.getLastLogTerm();
        RequestVoteRequest preVoteRequest = new RequestVoteRequest(
                nextTerm,
                config.getLocalNodeId(),
                lastLogIndex,
                lastLogTerm,
                true // isPreVote = true
        );

        final int[] preVotesGranted = {1};
        final int quorum = config.getQuorum();
        log.info("Node {} entered PRE_CANDIDATE for term {}. Requesting pre-votes (quorum: {}/{})...",
                config.getLocalNodeId(), nextTerm, quorum, config.getClusterSize());

        if (preVotesGranted[0] >= quorum) {
            log.info("Node {} won single-node PRE_VOTE quorum. Starting election...", config.getLocalNodeId());
            startElection();
            return;
        }

        for (String peerId : config.getPeerIds()) {
            transport.sendRequestVote(peerId, preVoteRequest).whenComplete((response, error) -> {
                if (error != null) {
                    log.debug("PreVote to {} failed: {}", peerId, error.getMessage());
                    return;
                }

                stateLock.lock();
                try {
                    if (!running.get() || role != Role.PRE_CANDIDATE) {
                        return;
                    }

                    if (response.term() > metaStorage.getCurrentTerm()) {
                        stepDownToFollower(response.term(), null);
                        return;
                    }

                    if (response.voteGranted()) {
                        preVotesGranted[0]++;
                        log.debug("Node {} received PRE_VOTE from {}. Total: {}/{}", config.getLocalNodeId(), peerId, preVotesGranted[0], quorum);
                        if (preVotesGranted[0] >= quorum && role == Role.PRE_CANDIDATE) {
                            log.info("Node {} won PRE_VOTE quorum ({}/{}). Transitioning to CANDIDATE election!",
                                    config.getLocalNodeId(), preVotesGranted[0], quorum);
                            startElection();
                        }
                    }
                } finally {
                    stateLock.unlock();
                }
            });
        }
    }

    private void startElection() {
        this.role = Role.CANDIDATE;
        long newTerm = metaStorage.getCurrentTerm() + 1;
        this.currentLeaderId = null;

        try {
            metaStorage.save(newTerm, config.getLocalNodeId());
        } catch (IOException e) {
            log.error("Failed to save term & vote during election", e);
            return;
        }

        resetElectionTimeout();

        long lastLogIndex = wal.getLastLogIndex();
        long lastLogTerm = wal.getLastLogTerm();
        RequestVoteRequest voteRequest = new RequestVoteRequest(
                newTerm,
                config.getLocalNodeId(),
                lastLogIndex,
                lastLogTerm,
                false
        );

        // Vote for self
        final int[] votesGranted = {1};
        final int quorum = config.getQuorum();
        log.info("Node {} became CANDIDATE for term {}. Requesting votes (quorum: {}/{})...",
                config.getLocalNodeId(), newTerm, quorum, config.getClusterSize());

        if (votesGranted[0] >= quorum) {
            becomeLeader();
            return;
        }

        for (String peerId : config.getPeerIds()) {
            transport.sendRequestVote(peerId, voteRequest).whenComplete((response, error) -> {
                if (error != null) {
                    log.debug("RequestVote to {} failed: {}", peerId, error.getMessage());
                    return;
                }

                stateLock.lock();
                try {
                    if (!running.get() || role != Role.CANDIDATE || metaStorage.getCurrentTerm() != newTerm) {
                        return;
                    }

                    if (response.term() > newTerm) {
                        stepDownToFollower(response.term(), null);
                        return;
                    }

                    if (response.voteGranted()) {
                        votesGranted[0]++;
                        log.debug("Node {} received vote from {}. Total: {}/{}", config.getLocalNodeId(), peerId, votesGranted[0], quorum);
                        if (votesGranted[0] >= quorum && role == Role.CANDIDATE) {
                            becomeLeader();
                        }
                    }
                } finally {
                    stateLock.unlock();
                }
            });
        }
    }

    private void becomeLeader() {
        this.role = Role.LEADER;
        this.currentLeaderId = config.getLocalNodeId();
        if (electionTimeoutTask != null) {
            electionTimeoutTask.cancel(false);
        }

        long lastLogIndex = wal.getLastLogIndex();
        for (String peerId : config.getPeerIds()) {
            nextIndex.put(peerId, lastLogIndex + 1);
            matchIndex.put(peerId, 0L);
        }

        log.info("Node {} successfully elected LEADER for term {}! Initializing followers with nextIndex={}",
                config.getLocalNodeId(), metaStorage.getCurrentTerm(), lastLogIndex + 1);

        // Raft §5.4.2: Leader commits a NOOP entry in its current term
        try {
            long noopIndex = wal.getLastLogIndex() + 1;
            wal.append(new LogEntry(noopIndex, metaStorage.getCurrentTerm(), Command.noop()));
        } catch (IOException e) {
            log.error("Failed to append leader establishment NOOP entry", e);
        }

        // Start periodic heartbeat task
        if (heartbeatTask != null && !heartbeatTask.isDone()) {
            heartbeatTask.cancel(false);
        }
        heartbeatTask = scheduler.scheduleAtFixedRate(
                this::sendHeartbeatsToAll,
                0,
                config.getHeartbeatIntervalMs(),
                TimeUnit.MILLISECONDS
        );
    }

    private void stepDownToFollower(long newTerm, String leaderHint) {
        log.info("Node {} stepping down to FOLLOWER in term {} (leader hint: {})",
                config.getLocalNodeId(), newTerm, leaderHint);
        this.role = Role.FOLLOWER;
        this.currentLeaderId = leaderHint;

        try {
            metaStorage.save(newTerm, null);
        } catch (IOException e) {
            log.error("Failed to persist term update during step down", e);
        }

        if (heartbeatTask != null) {
            heartbeatTask.cancel(false);
        }

        // Fail pending client requests on old leader
        for (Map.Entry<Long, CompletableFuture<ApplyResult>> entry : pendingClientRequests.entrySet()) {
            entry.getValue().completeExceptionally(new NotLeaderException(leaderHint));
        }
        pendingClientRequests.clear();

        resetElectionTimeout();
    }

    // =========================================================================
    // RPC Handlers: RequestVote
    // =========================================================================

    @Override
    public RequestVoteResponse handleRequestVote(RequestVoteRequest request) {
        stateLock.lock();
        try {
            long currentTerm = metaStorage.getCurrentTerm();

            // 1. Reply false if term < currentTerm (§5.1)
            if (request.term() < currentTerm) {
                return new RequestVoteResponse(currentTerm, false);
            }

            // Pre-Vote handling (§9.6): Non-disruptive pre-election vote
            if (request.isPreVote()) {
                long timeSinceLeader = System.currentTimeMillis() - lastHeartbeatTimeMs;
                if (currentLeaderId != null && timeSinceLeader < config.getMinElectionTimeoutMs()) {
                    log.debug("Node {} rejected PRE_VOTE from {}: active leader {} is healthy (heard {}ms ago)",
                            config.getLocalNodeId(), request.candidateId(), currentLeaderId, timeSinceLeader);
                    return new RequestVoteResponse(currentTerm, false);
                }

                long myLastLogTerm = wal.getLastLogTerm();
                long myLastLogIndex = wal.getLastLogIndex();

                boolean candidateUpToDate = false;
                if (request.lastLogTerm() > myLastLogTerm) {
                    candidateUpToDate = true;
                } else if (request.lastLogTerm() == myLastLogTerm && request.lastLogIndex() >= myLastLogIndex) {
                    candidateUpToDate = true;
                }

                if (candidateUpToDate) {
                    log.info("Node {} granted PRE_VOTE to {} for hypothetical term {}",
                            config.getLocalNodeId(), request.candidateId(), request.term());
                    return new RequestVoteResponse(currentTerm, true);
                } else {
                    return new RequestVoteResponse(currentTerm, false);
                }
            }

            // If term > currentTerm, update term and convert to follower (§5.1)
            if (request.term() > currentTerm) {
                stepDownToFollower(request.term(), null);
                currentTerm = request.term();
            }

            String votedFor = metaStorage.getVotedFor();
            boolean canVoteForCandidate = (votedFor == null || votedFor.equals(request.candidateId()));

            // 2. Log up-to-dateness check (§5.4.1)
            long myLastLogTerm = wal.getLastLogTerm();
            long myLastLogIndex = wal.getLastLogIndex();

            boolean candidateUpToDate = false;
            if (request.lastLogTerm() > myLastLogTerm) {
                candidateUpToDate = true;
            } else if (request.lastLogTerm() == myLastLogTerm && request.lastLogIndex() >= myLastLogIndex) {
                candidateUpToDate = true;
            }

            if (canVoteForCandidate && candidateUpToDate) {
                try {
                    metaStorage.save(currentTerm, request.candidateId());
                } catch (IOException e) {
                    log.error("Failed to persist vote", e);
                    return new RequestVoteResponse(currentTerm, false);
                }

                log.info("Node {} granted vote to {} in term {}", config.getLocalNodeId(), request.candidateId(), currentTerm);
                resetElectionTimeout();
                return new RequestVoteResponse(currentTerm, true);
            }

            log.info("Node {} rejected vote to {} in term {} (canVote={}, upToDate={})",
                    config.getLocalNodeId(), request.candidateId(), currentTerm, canVoteForCandidate, candidateUpToDate);
            return new RequestVoteResponse(currentTerm, false);
        } finally {
            stateLock.unlock();
        }
    }

    // =========================================================================
    // RPC Handlers: AppendEntries
    // =========================================================================

    @Override
    public AppendEntriesResponse handleAppendEntries(AppendEntriesRequest request) {
        stateLock.lock();
        try {
            long currentTerm = metaStorage.getCurrentTerm();

            // 1. Reply false if term < currentTerm (§5.1)
            if (request.term() < currentTerm) {
                return new AppendEntriesResponse(currentTerm, false, wal.getLastLogIndex());
            }

            // If term > currentTerm or we were candidate/pre-candidate, recognize leader
            if (request.term() > currentTerm || role == Role.CANDIDATE || role == Role.PRE_CANDIDATE) {
                stepDownToFollower(request.term(), request.leaderId());
                currentTerm = request.term();
            }

            this.currentLeaderId = request.leaderId();
            lastHeartbeatTimeMs = System.currentTimeMillis();

            // 2. Reply false if log doesn't contain an entry at prevLogIndex matching prevLogTerm (§5.3)
            if (request.prevLogIndex() > 0) {
                if (request.prevLogIndex() > wal.getLastLogIndex()) {
                    // Log too short
                    return new AppendEntriesResponse(currentTerm, false, wal.getLastLogIndex());
                }

                long termAtPrev = wal.getTermForIndex(request.prevLogIndex());
                if (termAtPrev != request.prevLogTerm()) {
                    // Log term mismatch at prevLogIndex: follower will truncate from prevLogIndex
                    try {
                        wal.truncateSuffix(request.prevLogIndex());
                    } catch (IOException e) {
                        log.error("Failed to truncate conflicting suffix", e);
                    }
                    return new AppendEntriesResponse(currentTerm, false, wal.getLastLogIndex());
                }
            }

            // 3. Process new entries: if an existing entry conflicts with a new one, truncate (§5.3)
            long lastNewEntryIndex = request.prevLogIndex();
            List<LogEntry> entriesToAppend = new ArrayList<>();

            for (LogEntry newEntry : request.entries()) {
                long entryIndex = newEntry.getIndex();
                if (entryIndex <= wal.getLastLogIndex()) {
                    long existingTerm = wal.getTermForIndex(entryIndex);
                    if (existingTerm != newEntry.getTerm()) {
                        // Conflict: delete this entry and all that follow it
                        try {
                            wal.truncateSuffix(entryIndex);
                        } catch (IOException e) {
                            log.error("Failed to truncate on conflict", e);
                            return new AppendEntriesResponse(currentTerm, false, wal.getLastLogIndex());
                        }
                        entriesToAppend.add(newEntry);
                    }
                    // Else: existing entry matches, do nothing
                } else {
                    entriesToAppend.add(newEntry);
                }
                lastNewEntryIndex = entryIndex;
            }

            if (!entriesToAppend.isEmpty()) {
                try {
                    wal.append(entriesToAppend);
                } catch (IOException e) {
                    log.error("Failed to append new log entries", e);
                    return new AppendEntriesResponse(currentTerm, false, wal.getLastLogIndex());
                }
            }

            // 4. Update commit index (§5.3)
            if (request.leaderCommit() > commitIndex) {
                this.commitIndex = Math.min(request.leaderCommit(), wal.getLastLogIndex());
                applyEntriesToStateMachine();
            }

            return new AppendEntriesResponse(currentTerm, true, wal.getLastLogIndex());
        } finally {
            stateLock.unlock();
        }
    }

    // =========================================================================
    // RPC Handlers: InstallSnapshot
    // =========================================================================

    @Override
    public InstallSnapshotResponse handleInstallSnapshot(InstallSnapshotRequest request) {
        stateLock.lock();
        try {
            long currentTerm = metaStorage.getCurrentTerm();
            if (request.term() < currentTerm) {
                return new InstallSnapshotResponse(currentTerm);
            }

            if (request.term() > currentTerm) {
                stepDownToFollower(request.term(), request.leaderId());
                currentTerm = request.term();
            }

            this.currentLeaderId = request.leaderId();
            lastHeartbeatTimeMs = System.currentTimeMillis();
            resetElectionTimeout();

            // When snapshot is complete, install into state machine & compact WAL
            if (request.done() && request.lastIncludedIndex() > stateMachine.getLastAppliedIndex()) {
                try {
                    java.io.File tempSnapshotFile = java.io.File.createTempFile("snapshot_install_", ".bin");
                    java.nio.file.Files.write(tempSnapshotFile.toPath(), request.data());
                    stateMachine.installSnapshot(tempSnapshotFile);
                    tempSnapshotFile.delete();

                    wal.setSnapshotBoundary(request.lastIncludedIndex(), request.lastIncludedTerm());
                    this.commitIndex = Math.max(this.commitIndex, request.lastIncludedIndex());
                    this.lastApplied = request.lastIncludedIndex();

                    log.info("Successfully installed snapshot at index={}, term={}",
                            request.lastIncludedIndex(), request.lastIncludedTerm());
                } catch (IOException e) {
                    log.error("Failed to install snapshot from leader", e);
                }
            }

            return new InstallSnapshotResponse(currentTerm);
        } finally {
            stateLock.unlock();
        }
    }

    // =========================================================================
    // Leader Log Replication & Commit Tracking (§5.4.2)
    // =========================================================================

    private void sendHeartbeatsToAll() {
        stateLock.lock();
        try {
            if (!running.get() || role != Role.LEADER) {
                return;
            }

            for (String peerId : config.getPeerIds()) {
                replicateToPeer(peerId);
            }
        } finally {
            stateLock.unlock();
        }
    }

    private void replicateToPeer(String peerId) {
        long peerNextIndex = nextIndex.getOrDefault(peerId, wal.getLastLogIndex() + 1);

        // Check if follower is too far behind and needs InstallSnapshot
        if (peerNextIndex <= wal.getSnapshotIndex()) {
            sendSnapshotToPeer(peerId);
            return;
        }

        long prevLogIndex = peerNextIndex - 1;
        long prevLogTerm = wal.getTermForIndex(prevLogIndex);

        List<LogEntry> entries = wal.getEntriesFrom(peerNextIndex, config.getMaxEntriesPerAppend());
        AppendEntriesRequest request = new AppendEntriesRequest(
                metaStorage.getCurrentTerm(),
                config.getLocalNodeId(),
                prevLogIndex,
                prevLogTerm,
                entries,
                this.commitIndex
        );

        long currentTerm = metaStorage.getCurrentTerm();

        transport.sendAppendEntries(peerId, request).whenComplete((response, error) -> {
            if (error != null) {
                log.debug("AppendEntries to {} failed: {}", peerId, error.getMessage());
                return;
            }

            stateLock.lock();
            try {
                if (!running.get() || role != Role.LEADER || metaStorage.getCurrentTerm() != currentTerm) {
                    return;
                }

                if (response.term() > currentTerm) {
                    stepDownToFollower(response.term(), null);
                    return;
                }

                if (response.success()) {
                    nextIndex.put(peerId, response.matchIndex() + 1);
                    matchIndex.put(peerId, response.matchIndex());

                    // Check if commitIndex can advance
                    checkAndUpdateCommitIndex();
                } else {
                    // Decrement nextIndex and retry
                    long currentNext = nextIndex.getOrDefault(peerId, 2L);
                    long decremented = Math.max(1, Math.min(currentNext - 1, response.matchIndex() + 1));
                    nextIndex.put(peerId, decremented);
                    log.debug("AppendEntries rejected by {}. Decremented nextIndex to {}", peerId, decremented);
                }
            } finally {
                stateLock.unlock();
            }
        });
    }

    private void sendSnapshotToPeer(String peerId) {
        try {
            java.io.File tempSnapshot = java.io.File.createTempFile("snapshot_send_", ".bin");
            stateMachine.takeSnapshot(tempSnapshot, wal.getSnapshotIndex(), wal.getSnapshotTerm());
            byte[] snapshotBytes = java.nio.file.Files.readAllBytes(tempSnapshot.toPath());
            tempSnapshot.delete();

            InstallSnapshotRequest request = new InstallSnapshotRequest(
                    metaStorage.getCurrentTerm(),
                    config.getLocalNodeId(),
                    wal.getSnapshotIndex(),
                    wal.getSnapshotTerm(),
                    snapshotBytes,
                    true
            );

            transport.sendInstallSnapshot(peerId, request).whenComplete((response, error) -> {
                if (error != null) {
                    log.debug("InstallSnapshot to {} failed: {}", peerId, error.getMessage());
                    return;
                }

                stateLock.lock();
                try {
                    if (role != Role.LEADER) return;
                    if (response.term() > metaStorage.getCurrentTerm()) {
                        stepDownToFollower(response.term(), null);
                        return;
                    }
                    nextIndex.put(peerId, wal.getSnapshotIndex() + 1);
                    matchIndex.put(peerId, wal.getSnapshotIndex());
                } finally {
                    stateLock.unlock();
                }
            });
        } catch (IOException e) {
            log.error("Failed to prepare snapshot to send to {}", peerId, e);
        }
    }

    /**
     * Raft Commit Rule §5.4.2:
     * If there exists an N > commitIndex, a quorum of matchIndex[i] >= N,
     * and log[N].term == currentTerm: set commitIndex = N!
     */
    private void checkAndUpdateCommitIndex() {
        long currentTerm = metaStorage.getCurrentTerm();
        long medianN = commitIndex;

        // Collect all match indices including leader's own
        List<Long> matches = new ArrayList<>();
        matches.add(wal.getLastLogIndex());
        for (String peerId : config.getPeerIds()) {
            matches.add(matchIndex.getOrDefault(peerId, 0L));
        }
        Collections.sort(matches);

        // In 5-node cluster, sorted: [m0, m1, m2, m3, m4], majority index is size - quorum
        // For N=5, Quorum=3 -> index = 5 - 3 = 2 (the 3rd highest)
        int majorityOffset = matches.size() - config.getQuorum();
        long potentialCommit = matches.get(majorityOffset);

        if (potentialCommit > commitIndex) {
            // Raft §5.4.2: Leader only directly commits entries from its current term!
            long termAtN = wal.getTermForIndex(potentialCommit);
            if (termAtN == currentTerm) {
                log.info("Advancing commitIndex from {} to {} (term {})", commitIndex, potentialCommit, termAtN);
                this.commitIndex = potentialCommit;
                applyEntriesToStateMachine();
            }
        }
    }

    private void applyEntriesToStateMachine() {
        while (lastApplied < commitIndex) {
            long indexToApply = lastApplied + 1;
            LogEntry entry = wal.getEntry(indexToApply);
            if (entry == null) {
                break;
            }

            ApplyResult result = stateMachine.apply(entry);
            this.lastApplied = indexToApply;

            // Notify waiting client future
            CompletableFuture<ApplyResult> future = pendingClientRequests.remove(indexToApply);
            if (future != null) {
                future.complete(result);
            }
        }

        // Automatic log compaction & snapshot trigger (§7)
        if (config.getSnapshotThresholdCount() > 0 && (lastApplied - wal.getSnapshotIndex() >= config.getSnapshotThresholdCount())) {
            triggerSnapshot();
        }
    }

    // =========================================================================
    // Client API: Execute & Linearizable Read
    // =========================================================================

    /**
     * Executes a state machine command across the replicated cluster.
     * Completes when the command has safely achieved quorum and applied to state machine.
     */
    public CompletableFuture<ApplyResult> execute(Command command) {
        stateLock.lock();
        try {
            if (role != Role.LEADER) {
                CompletableFuture<ApplyResult> failed = new CompletableFuture<>();
                failed.completeExceptionally(new NotLeaderException(currentLeaderId));
                return failed;
            }

            long newIndex = wal.getLastLogIndex() + 1;
            long term = metaStorage.getCurrentTerm();
            LogEntry entry = new LogEntry(newIndex, term, command);

            try {
                wal.append(entry);
            } catch (IOException e) {
                CompletableFuture<ApplyResult> failed = new CompletableFuture<>();
                failed.completeExceptionally(e);
                return failed;
            }

            CompletableFuture<ApplyResult> future = new CompletableFuture<>();
            pendingClientRequests.put(newIndex, future);

            // Single node cluster fast path
            if (config.getClusterSize() == 1) {
                checkAndUpdateCommitIndex();
            } else {
                // Broadcast replication immediately
                for (String peerId : config.getPeerIds()) {
                    replicateToPeer(peerId);
                }
            }

            return future;
        } finally {
            stateLock.unlock();
        }
    }

    /**
     * Linearizable Read via ReadIndex:
     * Confirms current leadership with a heartbeat round before returning state.
     */
    public CompletableFuture<byte[]> readLinearizable(String key) {
        stateLock.lock();
        try {
            if (role != Role.LEADER) {
                CompletableFuture<byte[]> failed = new CompletableFuture<>();
                failed.completeExceptionally(new NotLeaderException(currentLeaderId));
                return failed;
            }

            long targetReadIndex = commitIndex;
            CompletableFuture<byte[]> readFuture = new CompletableFuture<>();

            if (config.getClusterSize() == 1) {
                readFuture.complete(stateMachine.get(key));
                return readFuture;
            }

            // Quorum heartbeat confirmation
            long currentTerm = metaStorage.getCurrentTerm();
            final int[] acks = {1}; // self
            final int quorum = config.getQuorum();

            for (String peerId : config.getPeerIds()) {
                long prevLogIndex = wal.getLastLogIndex();
                long prevLogTerm = wal.getLastLogTerm();
                AppendEntriesRequest heartbeat = new AppendEntriesRequest(
                        currentTerm,
                        config.getLocalNodeId(),
                        prevLogIndex,
                        prevLogTerm,
                        Collections.emptyList(),
                        commitIndex
                );

                transport.sendAppendEntries(peerId, heartbeat).whenComplete((res, err) -> {
                    if (err != null || !res.success()) return;

                    stateLock.lock();
                    try {
                        if (role != Role.LEADER || metaStorage.getCurrentTerm() != currentTerm) {
                            if (!readFuture.isDone()) {
                                readFuture.completeExceptionally(new NotLeaderException(currentLeaderId));
                            }
                            return;
                        }

                        acks[0]++;
                        if (acks[0] >= quorum && !readFuture.isDone()) {
                            // Quorum confirmed leadership!
                            readFuture.complete(stateMachine.get(key));
                        }
                    } finally {
                        stateLock.unlock();
                    }
                });
            }

            return readFuture;
        } finally {
            stateLock.unlock();
        }
    }

    /**
     * Stale read directly from local state machine (for follower reads).
     */
    public byte[] readStale(String key) {
        return stateMachine.get(key);
    }

    // =========================================================================
    // Getters & Lifecycle
    // =========================================================================

    public Role getRole() {
        return role;
    }

    public long getCurrentTerm() {
        return metaStorage.getCurrentTerm();
    }

    public String getCurrentLeaderId() {
        return currentLeaderId;
    }

    public long getCommitIndex() {
        return commitIndex;
    }

    public long getLastApplied() {
        return lastApplied;
    }

    public String getNodeId() {
        return config.getLocalNodeId();
    }

    public RaftConfig getConfig() {
        return config;
    }

    public StateMachine getStateMachine() {
        return stateMachine;
    }

    public WriteAheadLog getWal() {
        return wal;
    }

    /**
     * Takes an atomic snapshot of current state machine and advances WAL boundary.
     */
    public boolean triggerSnapshot() {
        stateLock.lock();
        try {
            if (lastApplied <= wal.getSnapshotIndex()) {
                return false;
            }
            long snapIndex = lastApplied;
            long snapTerm = wal.getTermForIndex(snapIndex);
            java.io.File snapshotDir = new java.io.File("data/" + config.getLocalNodeId() + "/snapshots");
            if (!snapshotDir.exists()) snapshotDir.mkdirs();
            java.io.File snapFile = new java.io.File(snapshotDir, "snapshot_" + snapIndex + ".bin");
            stateMachine.takeSnapshot(snapFile, snapIndex, snapTerm);
            wal.setSnapshotBoundary(snapIndex, snapTerm);
            log.info("Node {} completed snapshot at index {}, term {}. Snapshot file: {}",
                    config.getLocalNodeId(), snapIndex, snapTerm, snapFile.getName());
            return true;
        } catch (Exception e) {
            log.error("Node {} failed to take snapshot", config.getLocalNodeId(), e);
            return false;
        } finally {
            stateLock.unlock();
        }
    }

    /**
     * Dynamic Cluster Membership (§6): Adds a new peer to the cluster at runtime.
     */
    public boolean addPeer(String peerId) {
        stateLock.lock();
        try {
            boolean added = config.addPeer(peerId);
            if (added && role == Role.LEADER) {
                nextIndex.put(peerId, wal.getLastLogIndex() + 1);
                matchIndex.put(peerId, 0L);
                log.info("Leader {} added new cluster peer {}. Current peers: {}",
                        config.getLocalNodeId(), peerId, config.getPeerIds());
                sendHeartbeatsToAll();
            }
            return added;
        } finally {
            stateLock.unlock();
        }
    }

    /**
     * Dynamic Cluster Membership (§6): Removes an existing peer from the cluster at runtime.
     */
    public boolean removePeer(String peerId) {
        stateLock.lock();
        try {
            boolean removed = config.removePeer(peerId);
            if (removed && role == Role.LEADER) {
                nextIndex.remove(peerId);
                matchIndex.remove(peerId);
                log.info("Leader {} removed cluster peer {}. Remaining peers: {}",
                        config.getLocalNodeId(), peerId, config.getPeerIds());
            }
            return removed;
        } finally {
            stateLock.unlock();
        }
    }

    @Override
    public void close() throws IOException {
        if (running.compareAndSet(true, false)) {
            log.info("Shutting down RaftNode {}", config.getLocalNodeId());
            if (electionTimeoutTask != null) electionTimeoutTask.cancel(true);
            if (heartbeatTask != null) heartbeatTask.cancel(true);
            scheduler.shutdownNow();

            for (CompletableFuture<ApplyResult> future : pendingClientRequests.values()) {
                future.cancel(true);
            }
            pendingClientRequests.clear();

            wal.close();
            transport.close();
        }
    }
}
