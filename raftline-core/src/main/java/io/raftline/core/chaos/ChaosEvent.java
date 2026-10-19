package io.raftline.core.chaos;

import java.time.Instant;

/**
 * Represents an individual chaos event or action recorded in the audit log.
 */
public record ChaosEvent(
        long id,
        Instant timestamp,
        ChaosScenario scenario,
        String target,
        String details,
        boolean active
) {}
