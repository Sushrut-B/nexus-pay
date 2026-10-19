package io.raftline.core.chaos;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Snapshot of current chaos state and injected faults.
 */
public record ChaosStatus(
        String nodeId,
        String role,
        boolean isPaused,
        Set<String> isolatedPeers,
        Map<String, Long> peerDelaysMs,
        Map<String, Double> peerDropRates,
        List<ChaosEvent> recentEvents
) {}
