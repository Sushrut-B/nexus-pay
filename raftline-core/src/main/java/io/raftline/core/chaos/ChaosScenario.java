package io.raftline.core.chaos;

/**
 * Enumeration of predefined disaster scenarios and chaos experiments.
 */
public enum ChaosScenario {
    KILL_LEADER,          // Forces current leader to abdicate; tests automated re-election
    PARTITION_NODE,       // Isolates node from one or more peers
    PARTITION_MINORITY,   // Isolates a minority of peers from this node
    PARTITION_MAJORITY,   // Isolates a majority of peers from this node
    ASYMMETRIC_PARTITION, // Drops outbound traffic to peer while inbound remains
    PACKET_JITTER_STORM,  // Injects delay & drop rate across peers
    FREEZE_NODE,          // Freezes node (simulates GC pause or process hang)
    HEAL_ALL,             // Clears all faults and resumes node
    CUSTOM                // Custom delay/drop/isolation settings
}
