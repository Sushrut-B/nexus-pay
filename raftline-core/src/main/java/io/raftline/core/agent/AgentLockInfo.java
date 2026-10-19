package io.raftline.core.agent;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Objects;

/**
 * Immutable metadata representing an active or released Agent Lock.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public final class AgentLockInfo {
    private final String resource;
    private final String ownerAgentId;
    private final long fencingToken;
    private final long acquiredAtEpochMs;
    private final long expiresAtEpochMs;

    @JsonCreator
    public AgentLockInfo(
            @JsonProperty("resource") String resource,
            @JsonProperty("ownerAgentId") String ownerAgentId,
            @JsonProperty("fencingToken") long fencingToken,
            @JsonProperty("acquiredAtEpochMs") long acquiredAtEpochMs,
            @JsonProperty("expiresAtEpochMs") long expiresAtEpochMs) {
        this.resource = Objects.requireNonNull(resource, "resource");
        this.ownerAgentId = Objects.requireNonNull(ownerAgentId, "ownerAgentId");
        this.fencingToken = fencingToken;
        this.acquiredAtEpochMs = acquiredAtEpochMs;
        this.expiresAtEpochMs = expiresAtEpochMs;
    }

    public String getResource() {
        return resource;
    }

    public String getOwnerAgentId() {
        return ownerAgentId;
    }

    public long getFencingToken() {
        return fencingToken;
    }

    public long getAcquiredAtEpochMs() {
        return acquiredAtEpochMs;
    }

    public long getExpiresAtEpochMs() {
        return expiresAtEpochMs;
    }

    public boolean isExpired() {
        return System.currentTimeMillis() > expiresAtEpochMs;
    }

    public long getRemainingTtlMs() {
        return Math.max(0, expiresAtEpochMs - System.currentTimeMillis());
    }

    @Override
    public String toString() {
        return "AgentLockInfo{" +
                "resource='" + resource + '\'' +
                ", ownerAgentId='" + ownerAgentId + '\'' +
                ", fencingToken=" + fencingToken +
                ", expiresAt=" + expiresAtEpochMs +
                '}';
    }
}
